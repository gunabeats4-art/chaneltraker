import db from '../db.js';

export const MILESTONES = [
  100, 1000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000, 50000000, 100000000,
];

/**
 * Normalisasi data statistik channel agar selalu memiliki field default 0 (aman untuk data lama).
 */
export function normalizeChannelStats(ch) {
  if (!ch) return null;
  const subscriberCount = Number(ch?.statistics?.subscriberCount ?? ch?.current_subscribers ?? 0) || 0;
  const viewCount = Number(ch?.statistics?.viewCount ?? ch?.current_views ?? 0) || 0;
  const videoCount = Number(ch?.statistics?.videoCount ?? ch?.current_videos ?? 0) || 0;
  const totalLikesTracked = Number(ch?.total_likes_tracked ?? 0) || 0;
  const subscriberTarget = Number(ch?.subscriber_target ?? 0) || 0;

  return {
    ...ch,
    current_subscribers: subscriberCount,
    current_views: viewCount,
    current_videos: videoCount,
    total_likes_tracked: totalLikesTracked,
    subscriber_target: subscriberTarget,
    statistics: {
      subscriberCount,
      viewCount,
      videoCount,
    },
  };
}

/**
 * Format angka milestone menjadi label singkat (100, 1K, 10K, 100K, 1M, dst).
 */
export function formatMilestoneLabel(value) {
  if (value >= 1000000) return `${value / 1000000}M`;
  if (value >= 1000) return `${value / 1000}K`;
  return String(value);
}

/**
 * Hitung daftar milestone yang sudah dicapai dan target milestone berikutnya.
 */
export function getMilestones(currentSubscribers) {
  const subs = Number(currentSubscribers || 0);
  const achieved = MILESTONES.filter((m) => subs >= m).map((m) => ({
    value: m,
    label: formatMilestoneLabel(m),
  }));

  const nextValue = MILESTONES.find((m) => subs < m) || null;
  const prevValue = achieved.length > 0 ? achieved[achieved.length - 1].value : 0;
  const progressPct = nextValue
    ? Math.min(100, Math.max(0, Number((((subs - prevValue) / (nextValue - prevValue)) * 100).toFixed(1))))
    : 100;

  return {
    achieved,
    highestBadge: achieved.length > 0 ? achieved[achieved.length - 1] : null,
    nextMilestone: nextValue
      ? {
          value: nextValue,
          label: formatMilestoneLabel(nextValue),
          remaining: nextValue - subs,
          progressPct,
        }
      : null,
  };
}

/**
 * Kelompokkan snapshot menjadi 1 titik data terakhir per hari (YYYY-MM-DD).
 */
function buildDailySeries(snapshots) {
  const byDate = new Map();
  for (const snap of snapshots) {
    const dateKey = String(snap.recorded_at).slice(0, 10);
    byDate.set(dateKey, snap);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, snap]) => ({
      date,
      subscribers: Number(snap.subscribers || 0),
      views: Number(snap.views || 0),
      videoCount: Number(snap.video_count || 0),
      likesTotal: Number(snap.likes_total || 0),
      recordedAt: snap.recorded_at,
    }));
}

/**
 * Hitung laju pertumbuhan harian & mingguan beserta persentase perubahan dibanding periode sebelumnya.
 */
export function calculateGrowthRate(snapshots) {
  if (!snapshots || snapshots.length < 2) {
    return {
      dailySubscribers: 0,
      weeklySubscribers: 0,
      growthChangePct: 0,
      trend: 'flat',
      dailyViews: 0,
      weeklyViews: 0,
      viewsChangePct: 0,
      dataPoints: snapshots ? snapshots.length : 0,
    };
  }

  const daily = buildDailySeries(snapshots);

  // Jika semua snapshot masih berada di hari yang sama, hitung rata-rata berbasis selisih jam
  if (daily.length < 2) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const hoursDiff = Math.max(
      (new Date(last.recorded_at).getTime() - new Date(first.recorded_at).getTime()) / 3600000,
      0.01
    );
    const subDiff = Number(last.subscribers) - Number(first.subscribers);
    const viewDiff = Number(last.views) - Number(first.views);
    const estDailySubs = hoursDiff >= 1 ? Math.round((subDiff / hoursDiff) * 24) : subDiff;
    const estDailyViews = hoursDiff >= 1 ? Math.round((viewDiff / hoursDiff) * 24) : viewDiff;

    return {
      dailySubscribers: estDailySubs,
      weeklySubscribers: estDailySubs * 7,
      growthChangePct: 0,
      trend: estDailySubs > 0 ? 'up' : estDailySubs < 0 ? 'down' : 'flat',
      dailyViews: estDailyViews,
      weeklyViews: estDailyViews * 7,
      viewsChangePct: 0,
      dataPoints: snapshots.length,
    };
  }

  const latest = daily[daily.length - 1];
  const lastTime = new Date(latest.date).getTime();

  // Cari titik pembanding ~7 hari lalu dan ~14 hari lalu
  const findClosestBefore = (daysAgo) => {
    const targetTime = lastTime - daysAgo * 86400000;
    let candidate = daily[0];
    for (const point of daily) {
      if (new Date(point.date).getTime() <= targetTime) {
        candidate = point;
      }
    }
    return candidate;
  };

  const point7d = findClosestBefore(7);
  const point14d = findClosestBefore(14);

  const daysSpanCurrent = Math.max(
    1,
    Math.round((lastTime - new Date(point7d.date).getTime()) / 86400000)
  );
  const currentSubGain = latest.subscribers - point7d.subscribers;
  const currentViewGain = latest.views - point7d.views;

  const dailySubscribers = Math.round(currentSubGain / daysSpanCurrent);
  const weeklySubscribers = Math.round(dailySubscribers * 7);
  const dailyViews = Math.round(currentViewGain / daysSpanCurrent);
  const weeklyViews = Math.round(dailyViews * 7);

  // Bandingkan dengan periode 7 hari sebelumnya bila tersedia
  let growthChangePct = 0;
  let viewsChangePct = 0;
  const daysSpanPrev = Math.round(
    (new Date(point7d.date).getTime() - new Date(point14d.date).getTime()) / 86400000
  );

  if (daysSpanPrev >= 1) {
    const prevDailySubs = (point7d.subscribers - point14d.subscribers) / daysSpanPrev;
    const prevDailyViews = (point7d.views - point14d.views) / daysSpanPrev;
    if (Math.abs(prevDailySubs) > 0) {
      growthChangePct = Number(
        (((dailySubscribers - prevDailySubs) / Math.abs(prevDailySubs)) * 100).toFixed(1)
      );
    } else if (dailySubscribers > 0) {
      growthChangePct = 100;
    }

    if (Math.abs(prevDailyViews) > 0) {
      viewsChangePct = Number(
        (((dailyViews - prevDailyViews) / Math.abs(prevDailyViews)) * 100).toFixed(1)
      );
    }
  }

  let trend = 'flat';
  if (growthChangePct > 0 || (growthChangePct === 0 && dailySubscribers > 0)) trend = 'up';
  else if (growthChangePct < 0 || dailySubscribers < 0) trend = 'down';

  return {
    dailySubscribers,
    weeklySubscribers,
    growthChangePct,
    trend,
    dailyViews,
    weeklyViews,
    viewsChangePct,
    dataPoints: snapshots.length,
  };
}

/**
 * Proyeksi sederhana tanggal pencapaian target menggunakan regresi linear (OLS).
 */
export function calculateLinearProjection(snapshots, currentSubscribers, targetSubscribers) {
  if (!targetSubscribers || targetSubscribers <= 0) {
    return {
      status: 'no_target',
      message: 'Atur target subscriber untuk melihat perkiraan tanggal pencapaian.',
      slopePerDay: 0,
      daysRemaining: null,
      estimatedDate: null,
      projected30Days: currentSubscribers,
      rSquared: 0,
    };
  }

  if (currentSubscribers >= targetSubscribers) {
    return {
      status: 'target_reached',
      message: 'Target subscriber telah tercapai!',
      slopePerDay: 0,
      daysRemaining: 0,
      estimatedDate: new Date().toISOString().slice(0, 10),
      projected30Days: currentSubscribers,
      rSquared: 1,
    };
  }

  if (!snapshots || snapshots.length < 2) {
    return {
      status: 'insufficient_data',
      message: 'Butuh minimal 2 snapshot waktu berbeda untuk menghitung regresi linear.',
      slopePerDay: 0,
      daysRemaining: null,
      estimatedDate: null,
      projected30Days: currentSubscribers,
      rSquared: 0,
    };
  }

  const t0 = new Date(snapshots[0].recorded_at).getTime();
  const points = snapshots.map((s) => ({
    x: (new Date(s.recorded_at).getTime() - t0) / 86400000,
    y: Number(s.subscribers),
  }));

  const n = points.length;
  const sumX = points.reduce((acc, p) => acc + p.x, 0);
  const sumY = points.reduce((acc, p) => acc + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    den += dx * dx;
  }

  if (den === 0) {
    return {
      status: 'insufficient_data',
      message: 'Rentang waktu antar snapshot masih terlalu rapat untuk regresi.',
      slopePerDay: 0,
      daysRemaining: null,
      estimatedDate: null,
      projected30Days: currentSubscribers,
      rSquared: 0,
    };
  }

  const slope = num / den;
  const intercept = meanY - slope * meanX;

  // Hitung koefisien determinasi R^2
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    const pred = intercept + slope * p.x;
    ssTot += (p.y - meanY) ** 2;
    ssRes += (p.y - pred) ** 2;
  }
  const rSquared = ssTot > 0 ? Number(Math.max(0, 1 - ssRes / ssTot).toFixed(3)) : 1;

  if (slope <= 0) {
    return {
      status: 'flat_or_negative',
      message: 'Tren historis saat ini datar atau menurun sehingga target belum dapat diproyeksikan.',
      slopePerDay: Number(slope.toFixed(2)),
      daysRemaining: null,
      estimatedDate: null,
      projected30Days: Math.max(0, Math.round(currentSubscribers + slope * 30)),
      rSquared,
    };
  }

  const lastX = points[points.length - 1].x;
  const targetX = (targetSubscribers - intercept) / slope;
  const daysRemaining = Math.max(1, Math.ceil(targetX - lastX));
  const estMs = new Date(snapshots[snapshots.length - 1].recorded_at).getTime() + daysRemaining * 86400000;

  return {
    status: 'ok',
    message: `Perkiraan tercapai dalam ${daysRemaining} hari pada laju +${Math.round(slope)} sub/hari.`,
    slopePerDay: Number(slope.toFixed(2)),
    daysRemaining,
    estimatedDate: new Date(estMs).toISOString().slice(0, 10),
    projected30Days: Math.round(currentSubscribers + slope * 30),
    rSquared,
  };
}

/**
 * Deteksi lonjakan subscriber (> 2x rata-rata 7 hari) dan korelasikan dengan video yang diupload di sekitar waktu itu.
 */
export function detectSpikesAndCorrelations(snapshots, videos) {
  const daily = buildDailySeries(snapshots);
  if (daily.length < 2) {
    return { spikes: [], dailyDeltas: [] };
  }

  const dailyDeltas = [];
  for (let i = 1; i < daily.length; i++) {
    const prev = daily[i - 1];
    const curr = daily[i];
    const dayGap = Math.max(
      1,
      Math.round((new Date(curr.date).getTime() - new Date(prev.date).getTime()) / 86400000)
    );
    const delta = Math.round((curr.subscribers - prev.subscribers) / dayGap);
    dailyDeltas.push({
      date: curr.date,
      subscribers: curr.subscribers,
      delta,
    });
  }

  const spikes = [];
  for (let i = 0; i < dailyDeltas.length; i++) {
    const current = dailyDeltas[i];
    const windowStart = Math.max(0, i - 7);
    const priorSlice = dailyDeltas.slice(windowStart, i);

    if (priorSlice.length === 0) continue;

    const avg7d =
      priorSlice.reduce((sum, item) => sum + Math.max(0, item.delta), 0) / priorSlice.length;

    // Anggap lonjakan jika pertumbuhan > 2x rata-rata 7 hari dan melewati ambang minimal 15 sub/hari
    if (current.delta > 2 * avg7d && current.delta >= Math.max(15, avg7d * 2)) {
      const spikeTime = new Date(`${current.date}T12:00:00Z`).getTime();
      // Cari video yang diupload antara 48 jam sebelum hingga 24 jam sesudah hari lonjakan
      const correlatedVideos = (videos || [])
        .filter((v) => {
          const pubTime = new Date(v.published_at).getTime();
          return pubTime >= spikeTime - 48 * 3600000 && pubTime <= spikeTime + 24 * 3600000;
        })
        .map((v) => ({
          id: v.id,
          youtubeVideoId: v.youtube_video_id,
          title: v.title,
          thumbnailUrl: v.thumbnail_url,
          publishedAt: v.published_at,
          views: v.views,
          likes: v.likes,
          url: `https://www.youtube.com/watch?v=${v.youtube_video_id}`,
        }));

      spikes.push({
        date: current.date,
        delta: current.delta,
        avg7d: Number(avg7d.toFixed(1)),
        multiplier: avg7d > 0 ? Number((current.delta / avg7d).toFixed(1)) : null,
        correlatedVideos,
      });
    }
  }

  return {
    spikes: spikes.reverse(),
    dailyDeltas,
  };
}

/**
 * Analisis performa video: peringkat views per jam sejak upload & jam upload terbaik berdasarkan data historis.
 */
export function analyzeVideosPerformance(videos) {
  const now = Date.now();
  const rankedVideos = (videos || [])
    .map((v) => {
      const parsedMs = new Date(v.published_at).getTime();
      const publishedMs = Number.isNaN(parsedMs) ? now : parsedMs;
      const ageHours = Math.max(1, (now - publishedMs) / 3600000);
      const views = Number(v.views || 0);
      const likes = Number(v.likes || 0);
      const commentsCount = Number(v.comments_count || 0);
      const viewsPerHour = Number((views / ageHours).toFixed(2));
      const likesPerHour = Number((likes / ageHours).toFixed(2));
      const engagementRatePct =
        views > 0 ? Number((((likes + commentsCount) / views) * 100).toFixed(2)) : 0;

      return {
        id: v.id,
        channelId: v.channel_id,
        youtubeVideoId: v.youtube_video_id,
        title: v.title,
        thumbnailUrl: v.thumbnail_url,
        publishedAt: v.published_at,
        ageHours: Number(ageHours.toFixed(1)),
        views,
        likes,
        commentsCount,
        viewsPerHour,
        likesPerHour,
        engagementRatePct,
        url: `https://www.youtube.com/watch?v=${v.youtube_video_id}`,
      };
    })
    .sort((a, b) => b.viewsPerHour - a.viewsPerHour);

  // Hitung jam upload terbaik (00 - 23 WIB / UTC+7 untuk relevansi waktu lokal Indonesia)
  const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    videoCount: 0,
    totalViewsPerHour: 0,
    totalViews: 0,
    totalLikes: 0,
  }));

  for (const v of rankedVideos) {
    const dateObj = new Date(v.publishedAt);
    if (Number.isNaN(dateObj.getTime())) continue;
    // Konversi ke UTC+7 (WIB) agar jam upload konsisten dengan pengguna Indonesia
    const wibHour = (dateObj.getUTCHours() + 7) % 24;
    const bucket = hourBuckets[wibHour];
    if (!bucket) continue;
    bucket.videoCount += 1;
    bucket.totalViewsPerHour += v.viewsPerHour;
    bucket.totalViews += v.views;
    bucket.totalLikes += v.likes;
  }

  const hourlyStats = hourBuckets.map((b) => ({
    hour: b.hour,
    label: b.label,
    videoCount: b.videoCount,
    avgViewsPerHour: b.videoCount > 0 ? Number((b.totalViewsPerHour / b.videoCount).toFixed(1)) : 0,
    avgViews: b.videoCount > 0 ? Math.round(b.totalViews / b.videoCount) : 0,
    avgLikes: b.videoCount > 0 ? Math.round(b.totalLikes / b.videoCount) : 0,
  }));

  const bestUploadHours = [...hourlyStats]
    .filter((h) => h.videoCount > 0)
    .sort((a, b) => b.avgViewsPerHour - a.avgViewsPerHour)
    .slice(0, 3);

  // Bangun matriks heatmap 7 hari (Senin-Minggu) x 24 jam (WIB / UTC+7)
  const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const dayShorts = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const heatmapBuckets = dayNames.map((dayLabel, dayIndex) => ({
    dayIndex,
    dayLabel,
    dayShort: dayShorts[dayIndex],
    hours: Array.from({ length: 24 }, (_, hour) => ({
      dayIndex,
      dayLabel,
      dayShort: dayShorts[dayIndex],
      hour,
      hourLabel: `${String(hour).padStart(2, '0')}:00`,
      videoCount: 0,
      totalViewsPerHour: 0,
      totalViews: 0,
      totalEngagement: 0,
    })),
  }));

  for (const v of rankedVideos) {
    const dateObj = new Date(v.publishedAt);
    if (Number.isNaN(dateObj.getTime())) continue;
    const wibDate = new Date(dateObj.getTime() + 7 * 3600000);
    const jsDay = wibDate.getUTCDay(); // 0 = Minggu .. 6 = Sabtu
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1; // 0 = Senin .. 6 = Minggu
    const wibHour = wibDate.getUTCHours();
    const cell = heatmapBuckets[dayIndex]?.hours?.[wibHour];
    if (!cell) continue;
    cell.videoCount += 1;
    cell.totalViewsPerHour += v.viewsPerHour;
    cell.totalViews += v.views;
    cell.totalEngagement += v.engagementRatePct;
  }

  const allActiveCells = [];
  const weeklyHeatmap = heatmapBuckets.map((dayRow) => ({
    dayIndex: dayRow.dayIndex,
    dayLabel: dayRow.dayLabel,
    dayShort: dayRow.dayShort,
    cells: dayRow.hours.map((c) => {
      const formattedCell = {
        dayIndex: c.dayIndex,
        dayLabel: c.dayLabel,
        dayShort: c.dayShort,
        hour: c.hour,
        hourLabel: c.hourLabel,
        videoCount: c.videoCount,
        avgViewsPerHour:
          c.videoCount > 0 ? Number((c.totalViewsPerHour / c.videoCount).toFixed(1)) : 0,
        avgViews: c.videoCount > 0 ? Math.round(c.totalViews / c.videoCount) : 0,
        avgEngagementPct:
          c.videoCount > 0 ? Number((c.totalEngagement / c.videoCount).toFixed(2)) : 0,
      };
      if (formattedCell.videoCount > 0) {
        allActiveCells.push(formattedCell);
      }
      return formattedCell;
    }),
  }));

  const bestUploadSlots = [...allActiveCells]
    .sort((a, b) => b.avgViewsPerHour - a.avgViewsPerHour)
    .slice(0, 3);

  const avgViewsPerHour =
    rankedVideos.length > 0
      ? Number(
          (
            rankedVideos.reduce((sum, item) => sum + Number(item.viewsPerHour || 0), 0) /
            rankedVideos.length
          ).toFixed(2)
        )
      : 0;

  const enrichedRanked = rankedVideos.map((item) => ({
    ...item,
    channelAvgViewsPerHour: avgViewsPerHour,
    isViral: item.viewsPerHour >= avgViewsPerHour,
  }));

  return {
    rankedVideos: enrichedRanked,
    avgViewsPerHour,
    hourlyStats,
    bestUploadHours,
    weeklyHeatmap,
    bestUploadSlots,
  };
}

/**
 * Susun analisis lengkap untuk 1 channel berdasarkan id di database.
 */
export function getChannelAnalytics(channelId) {
  const rawChannel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!rawChannel) return null;

  const channel = normalizeChannelStats(rawChannel);

  const snapshots = db
    .prepare('SELECT * FROM channel_snapshots WHERE channel_id = ? ORDER BY recorded_at ASC')
    .all(channelId);

  const videos = db
    .prepare('SELECT * FROM videos WHERE channel_id = ? ORDER BY published_at DESC')
    .all(channelId);

  const growth = calculateGrowthRate(snapshots);
  const projection = calculateLinearProjection(
    snapshots,
    channel.current_subscribers,
    channel.subscriber_target
  );
  const milestones = getMilestones(channel.current_subscribers);
  const { spikes, dailyDeltas } = detectSpikesAndCorrelations(snapshots, videos);
  const videoAnalysis = analyzeVideosPerformance(videos);

  const targetProgressPct =
    channel.subscriber_target > 0
      ? Math.min(
          100,
          Number(((channel.current_subscribers / channel.subscriber_target) * 100).toFixed(1))
        )
      : 0;

  return {
    channel: {
      ...channel,
      targetProgressPct,
    },
    growth,
    projection,
    milestones,
    spikes,
    dailyDeltas,
    videoAnalysis,
  };
}

/**
 * Bandingkan beberapa channel dalam satu seri waktu terpadu.
 */
export function compareChannelsData(channelIds = []) {
  const validIds = channelIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (validIds.length === 0) {
    return { dates: [], channels: [] };
  }

  const placeholders = validIds.map(() => '?').join(',');
  const channels = db
    .prepare(`SELECT * FROM channels WHERE id IN (${placeholders})`)
    .all(...validIds);

  const allDatesSet = new Set();
  const channelSeriesMap = new Map();

  for (const ch of channels) {
    const snapshots = db
      .prepare('SELECT * FROM channel_snapshots WHERE channel_id = ? ORDER BY recorded_at ASC')
      .all(ch.id);

    const daily = buildDailySeries(snapshots);
    const dateLookup = new Map();
    for (const point of daily) {
      allDatesSet.add(point.date);
      dateLookup.set(point.date, point);
    }

    const growth = calculateGrowthRate(snapshots);
    channelSeriesMap.set(ch.id, { channel: ch, daily, dateLookup, growth });
  }

  const dates = [...allDatesSet].sort((a, b) => a.localeCompare(b));

  const series = channels.map((rawCh) => {
    const ch = normalizeChannelStats(rawCh);
    const entry = channelSeriesMap.get(ch.id);
    let lastSub = null;
    let lastView = null;
    let baselineSub = entry.daily.length > 0 ? entry.daily[0].subscribers : ch.current_subscribers;

    const subscriberPoints = [];
    const viewPoints = [];
    const growthPctPoints = [];

    for (const d of dates) {
      const point = entry.dateLookup.get(d);
      if (point) {
        lastSub = point.subscribers;
        lastView = point.views;
      }
      subscriberPoints.push(lastSub);
      viewPoints.push(lastView);

      if (lastSub !== null && baselineSub > 0) {
        growthPctPoints.push(Number((((lastSub - baselineSub) / baselineSub) * 100).toFixed(2)));
      } else {
        growthPctPoints.push(lastSub !== null ? 0 : null);
      }
    }

    return {
      id: ch.id,
      title: ch.title,
      handle: ch.handle,
      thumbnailUrl: ch.thumbnail_url,
      currentSubscribers: ch.current_subscribers,
      currentViews: ch.current_views,
      totalLikesTracked: ch.total_likes_tracked,
      statistics: ch.statistics,
      dailySubscribers: entry.growth.dailySubscribers,
      subscriberPoints,
      viewPoints,
      growthPctPoints,
    };
  });

  return { dates, channels: series };
}
