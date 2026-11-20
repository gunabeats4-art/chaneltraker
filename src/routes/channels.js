import { Router } from 'express';
import db, { writeLog } from '../db.js';
import { resolveAndFetchChannel, YouTubeApiError } from '../services/youtube.js';
import {
  calculateGrowthRate,
  detectSpikesAndCorrelations,
  getChannelAnalytics,
  getMilestones,
  normalizeChannelStats,
} from '../services/analytics.js';
import { syncChannelVideos } from '../jobs/checker.js';

const router = Router();

/**
 * Validasi ID numerik dari parameter URL.
 */
function parsePositiveId(rawId) {
  const num = Number(rawId);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/**
 * GET /api/channels
 * Ambil seluruh channel yang dipantau beserta ringkasan pertumbuhan dan milestone.
 */
router.get('/', (_req, res) => {
  const channels = db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all();

  const enriched = channels.map((rawCh) => {
    const ch = normalizeChannelStats(rawCh);
    const snapshots = db
      .prepare('SELECT * FROM channel_snapshots WHERE channel_id = ? ORDER BY recorded_at ASC')
      .all(ch.id);

    const growth = calculateGrowthRate(snapshots);
    const milestones = getMilestones(ch.current_subscribers);
    const targetProgressPct =
      ch.subscriber_target > 0
        ? Math.min(100, Number(((ch.current_subscribers / ch.subscriber_target) * 100).toFixed(1)))
        : 0;

    return {
      ...ch,
      growth,
      milestones,
      targetProgressPct,
    };
  });

  res.json({ channels: enriched });
});

/**
 * POST /api/channels
 * Tambahkan channel baru dari URL, @handle, atau ID channel, lalu simpan snapshot awal.
 */
router.post('/', async (req, res, next) => {
  try {
    const input = String(req.body?.input || '').trim();
    const rawTarget = Number(req.body?.subscriberTarget || 0);
    const subscriberTarget = Number.isFinite(rawTarget) && rawTarget > 0 ? Math.floor(rawTarget) : 0;

    if (!input) {
      return res.status(400).json({
        error: 'Input URL, @handle, atau ID channel wajib diisi.',
        code: 'INVALID_INPUT',
      });
    }

    const ytChannel = await resolveAndFetchChannel(input);

    // Pastikan channel belum terdaftar
    const duplicate = db
      .prepare('SELECT id, title FROM channels WHERE youtube_id = ?')
      .get(ytChannel.youtubeId);
    if (duplicate) {
      return res.status(409).json({
        error: `Channel "${duplicate.title}" sudah ada di daftar pantauan.`,
        code: 'DUPLICATE_CHANNEL',
      });
    }

    const nowIso = new Date().toISOString();

    const insertResult = db
      .prepare(
        `INSERT INTO channels (
          youtube_id, handle, title, description, thumbnail_url, uploads_playlist_id,
          subscriber_target, current_subscribers, current_views, current_videos,
          total_likes_tracked, last_checked_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        ytChannel.youtubeId,
        ytChannel.handle,
        ytChannel.title,
        ytChannel.description,
        ytChannel.thumbnailUrl,
        ytChannel.uploadsPlaylistId,
        subscriberTarget,
        ytChannel.subscribers,
        ytChannel.views,
        ytChannel.videoCount,
        nowIso,
        nowIso
      );

    const newChannelId = Number(insertResult.lastInsertRowid);
    const createdRow = db.prepare('SELECT * FROM channels WHERE id = ?').get(newChannelId);

    // Sinkronkan 10 video terbaru tanpa mengirim spam notifikasi awal
    let totalLikes = 0;
    try {
      const syncRes = await syncChannelVideos(createdRow, false);
      totalLikes = syncRes.totalLikes;
    } catch (syncErr) {
      writeLog('warn', 'channels', `Gagal sinkronisasi video awal untuk ${ytChannel.title}: ${syncErr.message}`);
    }

    // Perbarui total likes terlacak dan simpan snapshot perdana
    db.prepare('UPDATE channels SET total_likes_tracked = ? WHERE id = ?').run(totalLikes, newChannelId);
    db.prepare(
      `INSERT INTO channel_snapshots (channel_id, subscribers, views, video_count, likes_total, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      newChannelId,
      ytChannel.subscribers,
      ytChannel.views,
      ytChannel.videoCount,
      totalLikes,
      nowIso
    );

    writeLog('info', 'channels', `Channel baru ditambahkan: ${ytChannel.title} (${ytChannel.youtubeId}).`);

    const finalChannel = normalizeChannelStats(
      db.prepare('SELECT * FROM channels WHERE id = ?').get(newChannelId)
    );
    res.status(201).json({
      message: `Channel "${ytChannel.title}" berhasil ditambahkan ke daftar pantauan.`,
      channel: {
        ...finalChannel,
        growth: calculateGrowthRate([]),
        milestones: getMilestones(finalChannel.current_subscribers),
        targetProgressPct:
          finalChannel.subscriber_target > 0
            ? Math.min(
                100,
                Number(((finalChannel.current_subscribers / finalChannel.subscriber_target) * 100).toFixed(1))
              )
            : 0,
      },
    });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      writeLog('error', 'channels', `[${err.code}] ${err.message}`);
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

/**
 * PATCH /api/channels/:id/target
 * Perbarui target subscriber channel.
 */
router.patch('/:id/target', (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID channel tidak valid.' });

  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
  if (!channel) return res.status(404).json({ error: 'Channel tidak ditemukan.' });

  const rawTarget = Number(req.body?.subscriberTarget);
  if (!Number.isFinite(rawTarget) || rawTarget < 0) {
    return res.status(400).json({ error: 'Target subscriber harus berupa angka >= 0.' });
  }

  const target = Math.floor(rawTarget);
  db.prepare('UPDATE channels SET subscriber_target = ? WHERE id = ?').run(target, id);

  res.json({
    message: 'Target subscriber berhasil diperbarui.',
    subscriberTarget: target,
  });
});

/**
 * DELETE /api/channels/:id
 * Hapus channel beserta seluruh snapshot, video, dan notifikasi terkait.
 */
router.delete('/:id', (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID channel tidak valid.' });

  const channel = db.prepare('SELECT id, title FROM channels WHERE id = ?').get(id);
  if (!channel) return res.status(404).json({ error: 'Channel tidak ditemukan.' });

  db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  writeLog('info', 'channels', `Channel "${channel.title}" dihapus dari daftar pantauan.`);

  res.json({ message: `Channel "${channel.title}" berhasil dihapus.` });
});

/**
 * GET /api/channels/:id/history?range=7d|30d|all
 * Ambil data historis snapshot subscriber & views untuk grafik.
 */
router.get('/:id/history', (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID channel tidak valid.' });

  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
  if (!channel) return res.status(404).json({ error: 'Channel tidak ditemukan.' });

  const range = String(req.query.range || '30d').toLowerCase();
  let snapshots;

  if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30;
    const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();
    snapshots = db
      .prepare(
        `SELECT * FROM channel_snapshots
         WHERE channel_id = ? AND recorded_at >= ?
         ORDER BY recorded_at ASC`
      )
      .all(id, cutoffIso);
  } else {
    snapshots = db
      .prepare('SELECT * FROM channel_snapshots WHERE channel_id = ? ORDER BY recorded_at ASC')
      .all(id);
  }

  const videos = db
    .prepare('SELECT * FROM videos WHERE channel_id = ? ORDER BY published_at DESC')
    .all(id);
  const { spikes } = detectSpikesAndCorrelations(snapshots, videos);

  res.json({
    channelId: id,
    range,
    snapshots,
    spikes,
  });
});

/**
 * GET /api/channels/:id/analytics
 * Kembalikan analisis lengkap: laju pertumbuhan, proyeksi linear, milestone, lonjakan, performa video.
 */
router.get('/:id/analytics', (req, res) => {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID channel tidak valid.' });

  const analytics = getChannelAnalytics(id);
  if (!analytics) return res.status(404).json({ error: 'Channel tidak ditemukan.' });

  res.json(analytics);
});

export default router;
