import { Router } from 'express';
import db, { writeLog } from '../db.js';
import {
  fetchVideoCommentsTimeline,
  resolveVideoCategory,
  YouTubeApiError,
} from '../services/youtube.js';
import { analyzeCommentBatch } from '../services/sentiment.js';

const router = Router();

/**
 * Ambil dan analisis sentimen komentar satu video (gunakan cache database kecuali refresh=true).
 */
async function getOrAnalyzeVideoSentiment(videoRow, forceRefresh = false) {
  const cached = db.prepare('SELECT * FROM video_sentiments WHERE video_id = ?').get(videoRow.id);

  // Gunakan cache jika masih berumur < 6 jam, tidak diminta refresh, dan sudah memiliki data tren mingguan
  if (cached && !forceRefresh) {
    const ageMs = Date.now() - new Date(cached.analyzed_at).getTime();
    let parsedTrend = [];
    try {
      parsedTrend = JSON.parse(cached.weekly_trend_json || '[]');
    } catch {
      parsedTrend = [];
    }

    const hasValidTrend = (cached.total_analyzed || 0) === 0 || parsedTrend.length > 0;
    if (ageMs < 6 * 3600000 && hasValidTrend) {
      const total = cached.total_analyzed || 0;
      return {
        videoId: videoRow.id,
        youtubeVideoId: videoRow.youtube_video_id,
        title: videoRow.title,
        channelTitle: videoRow.channel_title,
        publishedAt: videoRow.published_at,
        views: videoRow.views,
        likes: videoRow.likes,
        commentsCount: videoRow.comments_count,
        positiveCount: cached.positive_count,
        neutralCount: cached.neutral_count,
        negativeCount: cached.negative_count,
        totalAnalyzed: total,
        positivePct: total > 0 ? Number(((cached.positive_count / total) * 100).toFixed(1)) : 0,
        neutralPct: total > 0 ? Number(((cached.neutral_count / total) * 100).toFixed(1)) : 0,
        negativePct: total > 0 ? Number(((cached.negative_count / total) * 100).toFixed(1)) : 0,
        sentimentScore: cached.sentiment_score,
        samples: JSON.parse(cached.sample_comments_json || '[]'),
        weeklyTrend: parsedTrend,
        analyzedAt: cached.analyzed_at,
        cached: true,
      };
    }
  }

  // Ambil komentar relevan + terbaru dari YouTube API v3 agar tren mingguan akurat
  const comments = await fetchVideoCommentsTimeline(videoRow.youtube_video_id);
  const analysis = analyzeCommentBatch(comments, videoRow.published_at);
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO video_sentiments (
      video_id, positive_count, neutral_count, negative_count, total_analyzed,
      sentiment_score, sample_comments_json, weekly_trend_json, analyzed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      positive_count = excluded.positive_count,
      neutral_count = excluded.neutral_count,
      negative_count = excluded.negative_count,
      total_analyzed = excluded.total_analyzed,
      sentiment_score = excluded.sentiment_score,
      sample_comments_json = excluded.sample_comments_json,
      weekly_trend_json = excluded.weekly_trend_json,
      analyzed_at = excluded.analyzed_at`
  ).run(
    videoRow.id,
    analysis.positiveCount,
    analysis.neutralCount,
    analysis.negativeCount,
    analysis.totalAnalyzed,
    analysis.sentimentScore,
    JSON.stringify(analysis.samples),
    JSON.stringify(analysis.weeklyTrend || []),
    nowIso
  );

  return {
    videoId: videoRow.id,
    youtubeVideoId: videoRow.youtube_video_id,
    title: videoRow.title,
    channelTitle: videoRow.channel_title,
    publishedAt: videoRow.published_at,
    views: videoRow.views,
    likes: videoRow.likes,
    commentsCount: videoRow.comments_count,
    ...analysis,
    analyzedAt: nowIso,
    cached: false,
  };
}

/**
 * GET /api/videos/latest
 * Ambil daftar video terbaru dari seluruh channel yang dipantau lengkap dengan views/jam, likes, dan sentimen.
 */
router.get('/latest', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const channelId = req.query.channelId ? Number(req.query.channelId) : null;

  let rows;
  if (channelId && Number.isInteger(channelId)) {
    rows = db
      .prepare(
        `SELECT v.*, c.title AS channel_title, c.thumbnail_url AS channel_thumbnail,
                vs.positive_count, vs.neutral_count, vs.negative_count, vs.total_analyzed, vs.sentiment_score
         FROM videos v
         JOIN channels c ON c.id = v.channel_id
         LEFT JOIN video_sentiments vs ON vs.video_id = v.id
         WHERE v.channel_id = ?
         ORDER BY v.published_at DESC
         LIMIT ?`
      )
      .all(channelId, limit);
  } else {
    rows = db
      .prepare(
        `SELECT v.*, c.title AS channel_title, c.thumbnail_url AS channel_thumbnail,
                vs.positive_count, vs.neutral_count, vs.negative_count, vs.total_analyzed, vs.sentiment_score
         FROM videos v
         JOIN channels c ON c.id = v.channel_id
         LEFT JOIN video_sentiments vs ON vs.video_id = v.id
         ORDER BY v.published_at DESC
         LIMIT ?`
      )
      .all(limit);
  }

  const now = Date.now();

  // Hitung rata-rata pertumbuhan views/jam per channel dari seluruh video yang tersimpan
  const allChannelVideoRows = db
    .prepare('SELECT channel_id, published_at, views FROM videos')
    .all();
  const channelStatsAcc = new Map();
  for (const row of allChannelVideoRows) {
    const parsedMs = new Date(row.published_at).getTime();
    const ageHours = Math.max(1, (now - (Number.isNaN(parsedMs) ? now : parsedMs)) / 3600000);
    const vph = Number(row.views || 0) / ageHours;
    const acc = channelStatsAcc.get(row.channel_id) || { sum: 0, count: 0 };
    acc.sum += vph;
    acc.count += 1;
    channelStatsAcc.set(row.channel_id, acc);
  }
  const channelAvgMap = new Map();
  for (const [cid, acc] of channelStatsAcc.entries()) {
    channelAvgMap.set(cid, acc.count > 0 ? Number((acc.sum / acc.count).toFixed(2)) : 0);
  }

  const videos = rows.map((v) => {
    const parsedMs = new Date(v.published_at).getTime();
    const ageHours = Math.max(1, (now - (Number.isNaN(parsedMs) ? now : parsedMs)) / 3600000);
    const viewsPerHour = Number((Number(v.views || 0) / ageHours).toFixed(2));
    const channelAvgViewsPerHour = channelAvgMap.get(v.channel_id) ?? viewsPerHour;
    const categoryName = resolveVideoCategory({
      categoryId: v.category_id,
      categoryName: v.category_name,
      title: v.title,
    });
    return {
      id: v.id,
      channelId: v.channel_id,
      channelTitle: v.channel_title,
      channelThumbnail: v.channel_thumbnail,
      youtubeVideoId: v.youtube_video_id,
      title: v.title,
      categoryId: v.category_id || null,
      categoryName,
      thumbnailUrl: v.thumbnail_url,
      publishedAt: v.published_at,
      views: Number(v.views || 0),
      likes: Number(v.likes || 0),
      commentsCount: Number(v.comments_count || 0),
      viewsPerHour,
      channelAvgViewsPerHour,
      isViral: viewsPerHour >= channelAvgViewsPerHour,
      url: `https://www.youtube.com/watch?v=${v.youtube_video_id}`,
      sentiment:
        v.total_analyzed > 0
          ? {
              positiveCount: v.positive_count,
              neutralCount: v.neutral_count,
              negativeCount: v.negative_count,
              totalAnalyzed: v.total_analyzed,
              sentimentScore: v.sentiment_score,
            }
          : null,
    };
  });

  // Susun ringkasan performa per kategori untuk memudahkan perbandingan di frontend
  const categoryAcc = new Map();
  for (const vid of videos) {
    const cat = vid.categoryName || 'Lainnya';
    const acc = categoryAcc.get(cat) || {
      name: cat,
      count: 0,
      totalViews: 0,
      totalLikes: 0,
      totalViewsPerHour: 0,
    };
    acc.count += 1;
    acc.totalViews += vid.views;
    acc.totalLikes += vid.likes;
    acc.totalViewsPerHour += vid.viewsPerHour;
    categoryAcc.set(cat, acc);
  }

  const categories = [...categoryAcc.values()]
    .map((c) => ({
      name: c.name,
      count: c.count,
      totalViews: c.totalViews,
      avgViews: c.count > 0 ? Math.round(c.totalViews / c.count) : 0,
      avgLikes: c.count > 0 ? Math.round(c.totalLikes / c.count) : 0,
      avgViewsPerHour: c.count > 0 ? Number((c.totalViewsPerHour / c.count).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.avgViewsPerHour - a.avgViewsPerHour);

  res.json({ videos, categories });
});

/**
 * GET /api/videos/sentiment/compare?ids=1,2,3&refresh=false
 * Bandingkan sentimen komentar beberapa video secara berdampingan.
 */
router.get('/sentiment/compare', async (req, res, next) => {
  try {
    const rawIds = String(req.query.ids || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    const uniqueIds = [...new Set(rawIds)].slice(0, 6);
    if (uniqueIds.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal 1 ID video pada parameter ids.' });
    }

    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const placeholders = uniqueIds.map(() => '?').join(',');
    const videoRows = db
      .prepare(
        `SELECT v.*, c.title AS channel_title
         FROM videos v
         JOIN channels c ON c.id = v.channel_id
         WHERE v.id IN (${placeholders})`
      )
      .all(...uniqueIds);

    if (videoRows.length === 0) {
      return res.status(404).json({ error: 'Video tidak ditemukan.' });
    }

    const comparisons = [];
    const warnings = [];

    for (const row of videoRows) {
      try {
        const result = await getOrAnalyzeVideoSentiment(row, forceRefresh);
        comparisons.push(result);
      } catch (err) {
        if (err instanceof YouTubeApiError) {
          warnings.push({
            videoId: row.id,
            title: row.title,
            code: err.code,
            message: err.message,
          });
          writeLog('warn', 'sentiment', `Video "${row.title}": ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    if (comparisons.length === 0 && warnings.length > 0) {
      return res.status(400).json({
        error: warnings[0].message,
        warnings,
        comparisons: [],
      });
    }

    res.json({ comparisons, warnings });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/videos/:id/sentiment
 * Analisis ulang sentimen komentar untuk satu video tertentu.
 */
router.post('/:id/sentiment', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID video tidak valid.' });
    }

    const videoRow = db
      .prepare(
        `SELECT v.*, c.title AS channel_title
         FROM videos v
         JOIN channels c ON c.id = v.channel_id
         WHERE v.id = ?`
      )
      .get(id);

    if (!videoRow) {
      return res.status(404).json({ error: 'Video tidak ditemukan.' });
    }

    const result = await getOrAnalyzeVideoSentiment(videoRow, true);
    res.json({ sentiment: result });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

/**
 * GET /api/videos/:id/sentiment-trend?refresh=false
 * Ambil tren sentimen komentar per minggu setelah tanggal rilis video.
 */
router.get('/:id/sentiment-trend', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID video tidak valid.' });
    }

    const videoRow = db
      .prepare(
        `SELECT v.*, c.title AS channel_title
         FROM videos v
         JOIN channels c ON c.id = v.channel_id
         WHERE v.id = ?`
      )
      .get(id);

    if (!videoRow) {
      return res.status(404).json({ error: 'Video tidak ditemukan.' });
    }

    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const result = await getOrAnalyzeVideoSentiment(videoRow, forceRefresh);

    res.json({
      video: {
        id: videoRow.id,
        youtubeVideoId: videoRow.youtube_video_id,
        title: videoRow.title,
        channelTitle: videoRow.channel_title,
        publishedAt: videoRow.published_at,
        url: `https://www.youtube.com/watch?v=${videoRow.youtube_video_id}`,
      },
      totalAnalyzed: result.totalAnalyzed,
      sentimentScore: result.sentimentScore,
      weeklyTrend: result.weeklyTrend || [],
      analyzedAt: result.analyzedAt,
      cached: result.cached,
    });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

export default router;
