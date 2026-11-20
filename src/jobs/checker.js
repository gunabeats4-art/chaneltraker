import cron from 'node-cron';
import db, { writeLog } from '../db.js';
import {
  fetchChannelsBatch,
  fetchLatestVideosForChannel,
  getApiKey,
  YouTubeApiError,
} from '../services/youtube.js';
import {
  calculateGrowthRate,
  detectSpikesAndCorrelations,
  formatMilestoneLabel,
  MILESTONES,
} from '../services/analytics.js';

let isCheckRunning = false;
let scheduledTask = null;
let activeCronExpression = '*/10 * * * *';

/**
 * Buat notifikasi baru di tabel notifications.
 */
function createNotification({ channelId, type, title, message, linkUrl = null }) {
  db.prepare(
    `INSERT INTO notifications (channel_id, type, title, message, link_url, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(channelId || null, type, title, message, linkUrl, new Date().toISOString());
}

/**
 * Sinkronkan video terbaru milik satu channel ke database dan deteksi video baru.
 */
export async function syncChannelVideos(channelRow, notifyNewVideos = true) {
  if (!channelRow.uploads_playlist_id) return { newVideosCount: 0, totalLikes: 0 };

  const latestVideos = await fetchLatestVideosForChannel(channelRow.uploads_playlist_id, 10);
  const nowIso = new Date().toISOString();

  const existingStmt = db.prepare('SELECT id FROM videos WHERE youtube_video_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO videos (channel_id, youtube_video_id, title, category_id, category_name, thumbnail_url, published_at, views, likes, comments_count, last_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE videos
    SET title = ?, category_id = ?, category_name = ?, thumbnail_url = ?, views = ?, likes = ?, comments_count = ?, last_updated_at = ?
    WHERE youtube_video_id = ?
  `);

  let newVideosCount = 0;

  for (const vid of latestVideos) {
    const existing = existingStmt.get(vid.youtubeVideoId);
    if (!existing) {
      insertStmt.run(
        channelRow.id,
        vid.youtubeVideoId,
        vid.title,
        vid.categoryId || null,
        vid.categoryName || null,
        vid.thumbnailUrl,
        vid.publishedAt,
        vid.views,
        vid.likes,
        vid.commentsCount,
        nowIso
      );
      newVideosCount += 1;

      if (notifyNewVideos) {
        createNotification({
          channelId: channelRow.id,
          type: 'new_video',
          title: `Video Baru: ${channelRow.title}`,
          message: vid.title,
          linkUrl: `https://www.youtube.com/watch?v=${vid.youtubeVideoId}`,
        });
      }
    } else {
      updateStmt.run(
        vid.title,
        vid.categoryId || null,
        vid.categoryName || null,
        vid.thumbnailUrl,
        vid.views,
        vid.likes,
        vid.commentsCount,
        nowIso,
        vid.youtubeVideoId
      );
    }
  }

  // Hitung total like dari video-video yang terlacak pada channel ini
  const likesRow = db
    .prepare('SELECT COALESCE(SUM(likes), 0) AS total_likes FROM videos WHERE channel_id = ?')
    .get(channelRow.id);

  return {
    newVideosCount,
    totalLikes: Number(likesRow?.total_likes || 0),
  };
}

/**
 * Jalankan satu siklus pengecekan penuh untuk seluruh channel yang dipantau.
 */
export async function runCheckCycle(triggerSource = 'cron') {
  if (isCheckRunning) {
    return {
      skipped: true,
      reason: 'Siklus pengecekan sebelumnya masih berjalan.',
    };
  }

  if (!getApiKey()) {
    const msg = 'Pengecekan dilewati: YOUTUBE_API_KEY belum dikonfigurasi.';
    writeLog('warn', 'checker', msg);
    return {
      skipped: true,
      errorCode: 'API_KEY_MISSING',
      message: msg,
    };
  }

  isCheckRunning = true;
  const startedAt = Date.now();
  const summary = {
    triggerSource,
    channelsChecked: 0,
    newVideos: 0,
    notificationsCreated: 0,
    errors: [],
    durationMs: 0,
  };

  try {
    const channels = db.prepare('SELECT * FROM channels ORDER BY id ASC').all();
    if (channels.length === 0) {
      return { ...summary, message: 'Belum ada channel yang dipantau.' };
    }

    // Ambil seluruh statistik channel dalam request batch (1 unit kuota per 50 channel)
    const youtubeIds = channels.map((c) => c.youtube_id);
    const freshStatsList = await fetchChannelsBatch(youtubeIds);
    const freshByYtId = new Map(freshStatsList.map((item) => [item.youtubeId, item]));

    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);

    for (const ch of channels) {
      const fresh = freshByYtId.get(ch.youtube_id);
      if (!fresh) {
        const msg = `Channel ${ch.title} (${ch.youtube_id}) tidak ditemukan pada respons batch API.`;
        summary.errors.push(msg);
        writeLog('warn', 'checker', msg);
        continue;
      }

      try {
        const prevSubs = Number(ch.current_subscribers || 0);
        const newSubs = Number(fresh.subscribers || 0);

        // Sinkronisasi video terbaru + deteksi video baru (lewati request jika videoCount 0 untuk hemat kuota)
        let newVideosCount = 0;
        let totalLikes = Number(ch.total_likes_tracked || 0);
        if (fresh.videoCount > 0) {
          try {
            const channelForSync = {
              ...ch,
              uploads_playlist_id: fresh.uploadsPlaylistId || ch.uploads_playlist_id,
            };
            const syncRes = await syncChannelVideos(channelForSync, true);
            newVideosCount = syncRes.newVideosCount;
            totalLikes = syncRes.totalLikes;
            summary.newVideos += newVideosCount;
            summary.notificationsCreated += newVideosCount;
          } catch (videoErr) {
            writeLog('warn', 'checker', `Sinkronisasi video ${fresh.title} dilewati: ${videoErr.message}`);
          }
        }

        // Simpan snapshot statistik terbaru ke database
        db.prepare(
          `INSERT INTO channel_snapshots (channel_id, subscribers, views, video_count, likes_total, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(ch.id, newSubs, fresh.views, fresh.videoCount, totalLikes, nowIso);

        // Perbarui tabel channels
        db.prepare(
          `UPDATE channels
           SET title = ?, handle = ?, thumbnail_url = ?, uploads_playlist_id = ?,
               current_subscribers = ?, current_views = ?, current_videos = ?,
               total_likes_tracked = ?, last_checked_at = ?
           WHERE id = ?`
        ).run(
          fresh.title,
          fresh.handle || ch.handle,
          fresh.thumbnailUrl || ch.thumbnail_url,
          fresh.uploadsPlaylistId || ch.uploads_playlist_id,
          newSubs,
          fresh.views,
          fresh.videoCount,
          totalLikes,
          nowIso,
          ch.id
        );

        // Cek pencapaian target subscriber
        if (ch.subscriber_target > 0 && prevSubs < ch.subscriber_target && newSubs >= ch.subscriber_target) {
          createNotification({
            channelId: ch.id,
            type: 'target_reached',
            title: `Target Tercapai: ${fresh.title}`,
            message: `Berhasil mencapai target ${ch.subscriber_target.toLocaleString('id-ID')} subscriber!`,
          });
          summary.notificationsCreated += 1;
        }

        // Cek pencapaian milestone otomatis (100, 1K, 10K, 100K, ...)
        for (const m of MILESTONES) {
          if (prevSubs < m && newSubs >= m) {
            createNotification({
              channelId: ch.id,
              type: 'milestone',
              title: `Milestone ${formatMilestoneLabel(m)}: ${fresh.title}`,
              message: `Channel ${fresh.title} menembus ${m.toLocaleString('id-ID')} subscriber!`,
            });
            summary.notificationsCreated += 1;
          }
        }

        // Cek lonjakan subscriber (> 2x rata-rata 7 hari) dan cegah duplikasi notifikasi di hari yang sama
        const allSnapshots = db
          .prepare('SELECT * FROM channel_snapshots WHERE channel_id = ? ORDER BY recorded_at ASC')
          .all(ch.id);
        const allVideos = db
          .prepare('SELECT * FROM videos WHERE channel_id = ? ORDER BY published_at DESC')
          .all(ch.id);
        const { spikes } = detectSpikesAndCorrelations(allSnapshots, allVideos);
        const growth = calculateGrowthRate(allSnapshots);

        const todaySpike = spikes.find((s) => s.date === todayDate);
        if (todaySpike) {
          const alreadyNotified = db
            .prepare(
              `SELECT id FROM notifications
               WHERE channel_id = ? AND type = 'subscriber_spike' AND substr(created_at, 1, 10) = ?`
            )
            .get(ch.id, todayDate);

          if (!alreadyNotified) {
            createNotification({
              channelId: ch.id,
              type: 'subscriber_spike',
              title: `Lonjakan Subscriber: ${fresh.title}`,
              message: `Pertumbuhan +${todaySpike.delta.toLocaleString('id-ID')} sub/hari (${todaySpike.multiplier || '>2'}x rata-rata 7 hari, laju saat ini ${growth.dailySubscribers}/hari).`,
            });
            summary.notificationsCreated += 1;
          }
        }

        summary.channelsChecked += 1;
      } catch (chErr) {
        const msg = `Gagal memeriksa channel ${ch.title}: ${chErr.message}`;
        summary.errors.push(msg);
        writeLog('error', 'checker', msg);
      }
    }

    summary.durationMs = Date.now() - startedAt;
    writeLog(
      'info',
      'checker',
      `Siklus (${triggerSource}) selesai: ${summary.channelsChecked} channel dicek, ${summary.newVideos} video baru, ${summary.notificationsCreated} notifikasi (${summary.durationMs}ms).`
    );
    return summary;
  } catch (err) {
    const errMsg =
      err instanceof YouTubeApiError
        ? `[${err.code}] ${err.message}`
        : `Kesalahan pengecekan bot: ${err.message}`;
    summary.errors.push(errMsg);
    writeLog('error', 'checker', errMsg);
    return summary;
  } finally {
    isCheckRunning = false;
  }
}

/**
 * Mulai penjadwalan cron pengecekan berkala sesuai CHECK_INTERVAL di .env.
 */
export function startScheduler() {
  const rawExpr = (process.env.CHECK_INTERVAL || '*/10 * * * *').trim();
  activeCronExpression = cron.validate(rawExpr) ? rawExpr : '*/10 * * * *';

  if (!cron.validate(rawExpr)) {
    writeLog(
      'warn',
      'scheduler',
      `Ekspresi cron CHECK_INTERVAL "${rawExpr}" tidak valid, menggunakan default "*/10 * * * *".`
    );
  }

  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(activeCronExpression, () => {
    runCheckCycle('cron').catch((err) => {
      writeLog('error', 'scheduler', `Unhandled error pada cron job: ${err.message}`);
    });
  });

  writeLog('info', 'scheduler', `Bot pengecek YouTube aktif dengan jadwal "${activeCronExpression}".`);
  return activeCronExpression;
}

export function getSchedulerStatus() {
  return {
    cronExpression: activeCronExpression,
    isRunning: isCheckRunning,
  };
}
