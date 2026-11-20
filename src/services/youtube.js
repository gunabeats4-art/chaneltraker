const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const REQUEST_TIMEOUT_MS = 12000;

/**
 * Kelas error khusus untuk menangani kegagalan YouTube Data API v3 dengan rapi.
 */
export class YouTubeApiError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'YouTubeApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Ambil API key dari environment variable tanpa hardcode.
 */
export function getApiKey() {
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!key || key === 'YOUR_YOUTUBE_DATA_API_V3_KEY') {
    return null;
  }
  return key;
}

/**
 * Lakukan permintaan HTTP GET ke YouTube Data API v3 dengan timeout dan deteksi error kuota.
 */
async function ytFetch(endpoint, params = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new YouTubeApiError(
      'API_KEY_MISSING',
      'YOUTUBE_API_KEY belum diatur pada file .env atau environment server.',
      503
    );
  }

  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set('key', apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const apiErr = data?.error;
      const reason = apiErr?.errors?.[0]?.reason || '';
      const rawMessage = apiErr?.message || `HTTP ${response.status}`;

      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        throw new YouTubeApiError(
          'QUOTA_EXCEEDED',
          'Kuota harian YouTube Data API v3 (10.000 unit) telah habis. Coba lagi besok setelah reset kuota.',
          429
        );
      }
      if (reason === 'keyInvalid' || reason === 'badRequest' && rawMessage.toLowerCase().includes('api key')) {
        throw new YouTubeApiError(
          'INVALID_API_KEY',
          'YOUTUBE_API_KEY tidak valid atau belum mengaktifkan YouTube Data API v3.',
          401
        );
      }
      if (reason === 'commentsDisabled') {
        throw new YouTubeApiError(
          'COMMENTS_DISABLED',
          'Komentar dinonaktifkan pada video ini oleh pemilik channel.',
          403
        );
      }
      if (reason === 'playlistNotFound' || (response.status === 404 && rawMessage.includes('playlistId'))) {
        throw new YouTubeApiError(
          'PLAYLIST_NOT_FOUND',
          'Playlist upload channel belum tersedia atau tidak memiliki video publik.',
          404
        );
      }
      throw new YouTubeApiError('YOUTUBE_API_ERROR', rawMessage, response.status);
    }

    return data;
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      throw err;
    }
    if (err?.name === 'AbortError') {
      throw new YouTubeApiError('NETWORK_TIMEOUT', 'Koneksi ke YouTube Data API timeout.', 504);
    }
    throw new YouTubeApiError(
      'NETWORK_ERROR',
      `Gagal terhubung ke YouTube Data API: ${err?.message || 'Koneksi gagal'}`,
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ekstrak tipe dan nilai input channel dari URL YouTube, @handle, atau Channel ID.
 */
export function parseChannelInput(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) {
    throw new YouTubeApiError('INVALID_INPUT', 'Masukkan URL channel, @handle, atau ID channel YouTube.', 400);
  }

  // Format Channel ID langsung (diawali UC dengan panjang 24 karakter)
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(input)) {
    return { type: 'id', value: input };
  }

  // Format @handle langsung
  if (/^@[a-zA-Z0-9._-]{3,50}$/.test(input)) {
    return { type: 'handle', value: input };
  }

  // Coba parse sebagai URL YouTube
  let parsedUrl = null;
  try {
    const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    parsedUrl = new URL(withProtocol);
  } catch {
    // Jika bukan URL dan tidak diawali @, anggap sebagai handle
    if (/^[a-zA-Z0-9._-]{3,50}$/.test(input)) {
      return { type: 'handle', value: `@${input}` };
    }
    throw new YouTubeApiError('INVALID_INPUT', 'Format URL, @handle, atau ID channel tidak valid.', 400);
  }

  const host = parsedUrl.hostname.toLowerCase();
  if (!host.includes('youtube.com') && !host.includes('youtu.be')) {
    throw new YouTubeApiError('INVALID_INPUT', 'URL harus berasal dari domain youtube.com.', 400);
  }

  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new YouTubeApiError('INVALID_INPUT', 'URL YouTube tidak mengandung informasi channel.', 400);
  }

  // Contoh: youtube.com/@handle atau youtube.com/@handle/videos
  if (segments[0].startsWith('@')) {
    return { type: 'handle', value: decodeURIComponent(segments[0]) };
  }

  // Contoh: youtube.com/channel/UC...
  if (segments[0] === 'channel' && segments[1] && /^UC[a-zA-Z0-9_-]{22}$/.test(segments[1])) {
    return { type: 'id', value: segments[1] };
  }

  // Contoh: youtube.com/user/username
  if (segments[0] === 'user' && segments[1]) {
    return { type: 'username', value: decodeURIComponent(segments[1]) };
  }

  // Contoh: youtube.com/c/customname -> coba resolusi via @handle terlebih dahulu (hemat kuota)
  if (segments[0] === 'c' && segments[1]) {
    return { type: 'handle', value: `@${decodeURIComponent(segments[1])}` };
  }

  // Fallback jika path langsung berupa nama pendek: youtube.com/namachannel
  return { type: 'handle', value: `@${decodeURIComponent(segments[0])}` };
}

/**
 * Normalisasi objek channel dari respons YouTube channels.list.
 */
function normalizeChannelItem(item) {
  const snippet = item?.snippet || {};
  const statistics = item?.statistics || {};
  const contentDetails = item?.contentDetails || {};
  const thumbs = snippet?.thumbnails || {};

  const subscriberCount = Number(statistics?.subscriberCount ?? 0) || 0;
  const viewCount = Number(statistics?.viewCount ?? 0) || 0;
  const videoCount = Number(statistics?.videoCount ?? 0) || 0;

  return {
    youtubeId: item?.id,
    title: snippet?.title || 'Tanpa Nama',
    handle: snippet?.customUrl || null,
    description: snippet?.description || '',
    thumbnailUrl: thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url || '',
    uploadsPlaylistId: contentDetails?.relatedPlaylists?.uploads || null,
    subscribers: subscriberCount,
    views: viewCount,
    videoCount,
    statistics: {
      subscriberCount,
      viewCount,
      videoCount,
    },
  };
}

/**
 * Ambil data 1 channel dari input URL/@handle/ID menggunakan channels.list (1 unit kuota).
 */
export async function resolveAndFetchChannel(rawInput) {
  const parsed = parseChannelInput(rawInput);
  const params = {
    part: 'snippet,statistics,contentDetails',
    maxResults: 1,
  };

  if (parsed.type === 'id') {
    params.id = parsed.value;
  } else if (parsed.type === 'handle') {
    params.forHandle = parsed.value;
  } else if (parsed.type === 'username') {
    params.forUsername = parsed.value;
  }

  let data = await ytFetch('channels', params);

  // Jika forHandle tidak ditemukan dan berasal dari URL custom/legacy, coba fallback forUsername (1 unit)
  if ((!data.items || data.items.length === 0) && parsed.type === 'handle') {
    const cleanName = parsed.value.replace(/^@/, '');
    data = await ytFetch('channels', {
      part: 'snippet,statistics,contentDetails',
      forUsername: cleanName,
      maxResults: 1,
    });
  }

  if (!data.items || data.items.length === 0) {
    throw new YouTubeApiError(
      'CHANNEL_NOT_FOUND',
      `Channel "${rawInput}" tidak ditemukan di YouTube.`,
      404
    );
  }

  return normalizeChannelItem(data.items[0]);
}

/**
 * Ambil statistik terbaru untuk banyak channel sekaligus dalam 1 request per 50 ID (super hemat kuota).
 */
export async function fetchChannelsBatch(youtubeIds = []) {
  const uniqueIds = [...new Set(youtubeIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const results = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    const data = await ytFetch('channels', {
      part: 'snippet,statistics,contentDetails',
      id: chunk.join(','),
      maxResults: 50,
    });
    for (const item of data.items || []) {
      results.push(normalizeChannelItem(item));
    }
  }
  return results;
}

export const YOUTUBE_CATEGORY_MAP = {
  1: 'Film & Animasi',
  2: 'Otomotif',
  10: 'Musik',
  15: 'Hewan & Peliharaan',
  17: 'Olahraga',
  19: 'Perjalanan & Acara',
  20: 'Gaming',
  22: 'Orang & Blog',
  23: 'Komedi',
  24: 'Hiburan',
  25: 'Berita & Politik',
  26: 'Gaya Hidup & Tutorial',
  27: 'Edukasi',
  28: 'Sains & Teknologi',
  29: 'Nirlaba & Aktivisme',
};

/**
 * Tentukan nama kategori video berdasarkan categoryId YouTube API atau fallback kata kunci judul.
 */
export function resolveVideoCategory({ categoryId = null, categoryName = null, title = '' } = {}) {
  const idKey = categoryId ? String(categoryId).trim() : '';
  if (idKey && YOUTUBE_CATEGORY_MAP[idKey]) {
    return YOUTUBE_CATEGORY_MAP[idKey];
  }
  if (categoryName && String(categoryName).trim()) {
    return String(categoryName).trim();
  }

  const lower = String(title || '').toLowerCase();
  if (
    /\b(tutorial|belajar|kursus|edukasi|panduan|materi|kuliah|cara|tips|explain|explained|lesson|course|guide|how to)\b/i.test(
      lower
    )
  ) {
    return 'Edukasi';
  }
  if (
    /\b(game|gaming|gameplay|walkthrough|playthrough|valorant|minecraft|mobile legends|mlbb|pubg|free fire|esports|stream)\b/i.test(
      lower
    )
  ) {
    return 'Gaming';
  }
  if (
    /\b(musik|music|lagu|beat|type beat|instrumental|cover|mv|official video|audio|remix|lirik|lyrics)\b/i.test(
      lower
    )
  ) {
    return 'Musik';
  }
  if (
    /\b(coding|programming|javascript|python|react|ai|tech|teknologi|gadget|unboxing|review|software|hardware|sains|science)\b/i.test(
      lower
    )
  ) {
    return 'Sains & Teknologi';
  }
  if (
    /\b(vlog|podcast|drama|prank|lucu|hiburan|entertainment|reaction|challenge|komedi|comedy|shorts)\b/i.test(
      lower
    )
  ) {
    return 'Hiburan';
  }
  return 'Lainnya';
}

/**
 * Ambil daftar video terbaru dari playlist uploads channel (1 unit via playlistItems.list, bukan search.list!).
 * Lalu ambil statistik lengkap views & likes dengan 1 request videos.list per 50 video.
 */
export async function fetchLatestVideosForChannel(uploadsPlaylistId, maxResults = 10) {
  if (!uploadsPlaylistId) return [];

  let playlistData;
  try {
    playlistData = await ytFetch('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(Math.max(Number(maxResults) || 10, 1), 25),
    });
  } catch (err) {
    // Channel baru atau channel tanpa video publik sering mengembalikan 404 playlistNotFound untuk playlist uploads
    if (err instanceof YouTubeApiError && err.code === 'PLAYLIST_NOT_FOUND') {
      return [];
    }
    throw err;
  }

  const videoIds = [];
  const basicMap = new Map();

  for (const item of playlistData.items || []) {
    const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
    if (!videoId) continue;
    videoIds.push(videoId);
    const thumbs = item.snippet?.thumbnails || {};
    basicMap.set(videoId, {
      youtubeVideoId: videoId,
      title: item.snippet?.title || 'Tanpa Judul',
      thumbnailUrl: thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || '',
      publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || new Date().toISOString(),
    });
  }

  if (videoIds.length === 0) return [];

  // Ambil views, likes, dan jumlah komentar secara batch (1 unit kuota)
  const videosStatsData = await ytFetch('videos', {
    part: 'snippet,statistics',
    id: videoIds.join(','),
    maxResults: 50,
  });

  const enriched = [];
  for (const v of videosStatsData.items || []) {
    const base = basicMap.get(v.id) || {};
    const thumbs = v.snippet?.thumbnails || {};
    const title = v?.snippet?.title || base.title || 'Tanpa Judul';
    const categoryId = v?.snippet?.categoryId ? String(v.snippet.categoryId) : null;
    const categoryName = resolveVideoCategory({ categoryId, title });
    enriched.push({
      youtubeVideoId: v?.id,
      title,
      categoryId,
      categoryName,
      thumbnailUrl:
        thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url || base.thumbnailUrl || '',
      publishedAt: v?.snippet?.publishedAt || base.publishedAt || new Date().toISOString(),
      views: Number(v?.statistics?.viewCount ?? 0) || 0,
      likes: Number(v?.statistics?.likeCount ?? 0) || 0,
      commentsCount: Number(v?.statistics?.commentCount ?? 0) || 0,
    });
  }

  return enriched;
}

/**
 * Ambil komentar suatu video untuk analisis sentimen (1 unit kuota).
 */
export async function fetchVideoComments(youtubeVideoId, maxResults = 50, order = 'relevance') {
  const data = await ytFetch('commentThreads', {
    part: 'snippet',
    videoId: youtubeVideoId,
    order: order === 'time' ? 'time' : 'relevance',
    textFormat: 'plainText',
    maxResults: Math.min(Math.max(Number(maxResults) || 50, 5), 100),
  });

  return (data.items || [])
    .map((thread) => {
      const top = thread.snippet?.topLevelComment?.snippet;
      if (!top) return null;
      return {
        id: thread.id || thread.snippet?.topLevelComment?.id || '',
        author: top.authorDisplayName || 'Anonim',
        text: String(top.textDisplay || '').trim(),
        likes: Number(top.likeCount || 0),
        publishedAt: top.publishedAt || null,
      };
    })
    .filter((c) => c && c.text.length > 0);
}

/**
 * Ambil kombinasi komentar relevan & terbaru (maks 100 unik) agar distribusi mingguan setelah rilis lebih lengkap.
 */
export async function fetchVideoCommentsTimeline(youtubeVideoId) {
  const relevanceComments = await fetchVideoComments(youtubeVideoId, 50, 'relevance');

  let timeComments = [];
  try {
    timeComments = await fetchVideoComments(youtubeVideoId, 50, 'time');
  } catch (err) {
    if (err instanceof YouTubeApiError && err.code === 'COMMENTS_DISABLED') {
      throw err;
    }
    // Jika panggilan kedua gagal sementara, tetap kembalikan hasil pertama
  }

  const seen = new Set();
  const merged = [];
  for (const c of [...relevanceComments, ...timeComments]) {
    const key = c.id || `${c.author}|${c.publishedAt}|${c.text.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }

  return merged;
}
