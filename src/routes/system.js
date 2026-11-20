import { Router } from 'express';
import db from '../db.js';
import { compareChannelsData } from '../services/analytics.js';
import { getSchedulerStatus, runCheckCycle } from '../jobs/checker.js';
import { getApiKey } from '../services/youtube.js';

const router = Router();

/**
 * Escape nilai sel CSV agar aman untuk Excel & parser standar.
 */
function csvEscape(val) {
  const str = String(val ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/compare?ids=1,2,3
 * Bandingkan pertumbuhan beberapa channel sekaligus dalam satu chart.
 */
router.get('/compare', (req, res) => {
  const rawIds = String(req.query.ids || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (rawIds.length === 0) {
    // Jika tidak diberi parameter, gunakan 3 channel pertama secara default
    const defaultIds = db
      .prepare('SELECT id FROM channels ORDER BY id ASC LIMIT 3')
      .all()
      .map((r) => r.id);
    return res.json(compareChannelsData(defaultIds));
  }

  res.json(compareChannelsData(rawIds));
});

/**
 * GET /api/export/:id.csv
 * Ekspor riwayat snapshot channel ke file CSV siap buka di Excel/Google Sheets.
 */
router.get('/export/:fileParam', (req, res) => {
  const match = String(req.params.fileParam || '').match(/^(\d+)\.csv$/i);
  if (!match) {
    return res.status(400).json({ error: 'Format endpoint ekspor harus /api/export/:id.csv' });
  }

  const channelId = Number(match[1]);
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!channel) {
    return res.status(404).json({ error: 'Channel tidak ditemukan.' });
  }

  const range = String(req.query.range || 'all').toLowerCase();
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
      .all(channelId, cutoffIso);
  } else {
    snapshots = db
      .prepare('SELECT * FROM channel_snapshots WHERE channel_id = ? ORDER BY recorded_at ASC')
      .all(channelId);
  }

  const videos = db
    .prepare('SELECT * FROM videos WHERE channel_id = ? ORDER BY published_at DESC')
    .all(channelId);

  const lines = [
    '# RIWAYAT SNAPSHOT CHANNEL',
    ['Channel', 'YouTube ID', 'Waktu Snapshot (UTC)', 'Subscriber', 'Total Views', 'Jumlah Video', 'Total Likes Terlacak']
      .map(csvEscape)
      .join(','),
  ];

  for (const s of snapshots) {
    lines.push(
      [
        channel.title,
        channel.youtube_id,
        s.recorded_at,
        Number(s.subscribers ?? 0) || 0,
        Number(s.views ?? 0) || 0,
        Number(s.video_count ?? 0) || 0,
        Number(s.likes_total ?? 0) || 0,
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  lines.push('');
  lines.push('# DAFTAR VIDEO TERLACAK');
  lines.push(
    ['Judul Video', 'Video ID', 'Tanggal Upload', 'Views', 'Likes', 'Komentar', 'Link']
      .map(csvEscape)
      .join(',')
  );

  for (const v of videos) {
    lines.push(
      [
        v.title,
        v.youtube_video_id,
        v.published_at,
        v.views,
        v.likes,
        v.comments_count,
        `https://www.youtube.com/watch?v=${v.youtube_video_id}`,
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  const safeSlug = channel.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `channel-${channelId}`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}-analytics.csv"`);
  // Tambahkan UTF-8 BOM agar Excel langsung mengenali encoding UTF-8
  res.send('\uFEFF' + lines.join('\r\n'));
});

/**
 * POST /api/check-now
 * Picu siklus pengecekan bot secara manual saat pengguna menekan tombol "Cek Sekarang".
 */
router.post('/check-now', async (_req, res, next) => {
  try {
    const result = await runCheckCycle('manual');
    if (result.errorCode === 'API_KEY_MISSING') {
      return res.status(503).json({
        error: result.message,
        code: result.errorCode,
      });
    }
    res.json({
      message: result.skipped ? result.reason : 'Pengecekan manual selesai dijalankan.',
      summary: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/status
 * Status konfigurasi API key, jadwal cron, dan log bot terbaru.
 */
router.get('/status', (_req, res) => {
  const channelCount = db.prepare('SELECT COUNT(*) AS count FROM channels').get().count;
  const videoCount = db.prepare('SELECT COUNT(*) AS count FROM videos').get().count;
  const lastSnapshot = db
    .prepare('SELECT recorded_at FROM channel_snapshots ORDER BY id DESC LIMIT 1')
    .get();
  const logs = db
    .prepare('SELECT * FROM app_logs ORDER BY id DESC LIMIT 30')
    .all();

  res.json({
    apiKeyConfigured: Boolean(getApiKey()),
    scheduler: getSchedulerStatus(),
    totals: {
      channels: channelCount,
      videos: videoCount,
    },
    lastCheckedAt: lastSnapshot?.recorded_at || null,
    logs,
  });
});

export default router;
