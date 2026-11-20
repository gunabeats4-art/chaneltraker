// Kamus kata sentimen dwibahasa (Indonesia & Inggris) untuk komentar YouTube

const POSITIVE_WORDS = new Set([
  // Indonesia
  'bagus', 'keren', 'mantap', 'hebat', 'luar', 'biasa', 'bermanfaat', 'inspiratif',
  'edukatif', 'jelas', 'lengkap', 'rapi', 'seru', 'asik', 'lucu', 'suka', 'cinta',
  'sayang', 'terbaik', 'juara', 'sukses', 'semangat', 'makasih', 'terimakasih', 'terima',
  'kasih', 'membantu', 'paham', 'mengerti', 'gokil', 'epic', 'epik', 'recommended',
  'top', 'oke', 'sip', 'jos', 'mantul', 'kece', 'indah', 'cantik', 'rindu', 'salut',
  'kagum', 'bangga', 'berkah', 'lanjutkan', 'ditunggu', 'worth', 'favorit', 'idola',
  // Inggris
  'good', 'great', 'awesome', 'amazing', 'excellent', 'helpful', 'informative',
  'clear', 'love', 'loved', 'best', 'nice', 'cool', 'fantastic', 'wonderful',
  'brilliant', 'perfect', 'thanks', 'thank', 'appreciated', 'inspiring', 'epic',
  'clean', 'solid', 'enjoyed', 'enjoy', 'super', 'wow', 'impressive', 'fire',
  'masterpiece', 'goat', 'legend', 'subscribed', 'useful', 'accurate'
]);

const NEGATIVE_WORDS = new Set([
  // Indonesia
  'jelek', 'buruk', 'parah', 'kecewa', 'bohong', 'hoax', 'palsu', 'clickbait',
  'sampah', 'bosan', 'membosankan', 'gagal', 'lambat', 'ribet', 'bingung', 'susah',
  'kurang', 'benci', 'kesal', 'marah', 'muak', 'aneh', 'garing', 'cacat', 'rusak',
  'penipu', 'spam', 'berisik', 'kacau', 'lemot', 'payah', 'norak', 'malas', 'rugi',
  'nyesel', 'menyesal', 'salah', 'keliru', 'toxic', 'lebay', 'pusing', 'maksa',
  // Inggris
  'bad', 'worst', 'terrible', 'awful', 'horrible', 'boring', 'useless', 'trash',
  'garbage', 'hate', 'hated', 'disappointed', 'disappointing', 'fake', 'scam',
  'clickbait', 'annoying', 'confusing', 'wrong', 'poor', 'slow', 'broken', 'waste',
  'cringe', 'toxic', 'stupid', 'dumb', 'sucks', 'suck', 'fail', 'failed', 'misleading'
]);

const NEGATIONS = new Set([
  'tidak', 'tak', 'bukan', 'kurang', 'belum', 'jangan', 'gak', 'ga', 'nggak', 'enggak',
  'not', 'no', 'never', 'hardly', 'barely', "don't", "didn't", "isn't", "wasn't", "can't"
]);

const INTENSIFIERS = new Set([
  'sangat', 'banget', 'sekali', 'amat', 'terlalu', 'benar', 'bener', 'super', 'paling',
  'very', 'really', 'extremely', 'super', 'so', 'totally', 'absolutely', 'highly'
]);

const POSITIVE_EMOJIS = ['🔥', '❤️', '❤', '👍', '👏', '🙌', '😍', '🤩', '💯', '✨', '🎉', '🙏', '😊', '😁', '💪', '⭐'];
const NEGATIVE_EMOJIS = ['👎', '😡', '🤬', '🤮', '🤢', '💩', '😤', '😒', '🙄', '💔', '😭', '😞'];

/**
 * Analisis sentimen satu teks komentar, menghasilkan skor [-1, 1] dan label.
 */
export function analyzeSingleComment(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();

  // Hitung polaritas emoji terlebih dahulu
  let score = 0;
  for (const emoji of POSITIVE_EMOJIS) {
    if (raw.includes(emoji)) score += 0.6;
  }
  for (const emoji of NEGATIVE_EMOJIS) {
    if (raw.includes(emoji)) score -= 0.6;
  }

  // Tokenisasi kata alfabetik
  const tokens = lower.replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : '';
    const prev2 = i > 1 ? tokens[i - 2] : '';

    const hasNegation = NEGATIONS.has(prev) || NEGATIONS.has(prev2);
    const hasIntensifier = INTENSIFIERS.has(prev) || INTENSIFIERS.has(prev2);
    const multiplier = hasIntensifier ? 1.4 : 1.0;

    if (POSITIVE_WORDS.has(word)) {
      score += (hasNegation ? -0.9 : 1.0) * multiplier;
    } else if (NEGATIVE_WORDS.has(word)) {
      score += (hasNegation ? 0.5 : -1.0) * multiplier;
    }
  }

  // Normalisasi skor ke rentang [-1, 1]
  const normalized = Math.max(-1, Math.min(1, Number((score / 2.5).toFixed(3))));
  let label = 'neutral';
  if (normalized >= 0.15) label = 'positive';
  else if (normalized <= -0.15) label = 'negative';

  return { score: normalized, label };
}

function formatWeekRangeLabel(startMs, endMs) {
  const fmt = (ms) =>
    new Date(ms).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
    });
  return `${fmt(startMs)} - ${fmt(endMs)}`;
}

/**
 * Hitung tren sentimen per minggu setelah tanggal rilis video.
 */
export function buildWeeklySentimentTrend(analyzedComments = [], videoPublishedAt = null) {
  const validBaseMs = videoPublishedAt ? new Date(videoPublishedAt).getTime() : NaN;
  const hasReleaseBase = !Number.isNaN(validBaseMs);

  // Jika tanggal rilis video tidak tersedia, pakai komentar terawal sebagai titik awal
  let baseMs = validBaseMs;
  if (!hasReleaseBase) {
    const timestamps = analyzedComments
      .map((c) => (c.publishedAt ? new Date(c.publishedAt).getTime() : NaN))
      .filter((t) => !Number.isNaN(t));
    if (timestamps.length === 0) return [];
    baseMs = Math.min(...timestamps);
  }

  const weekMap = new Map();
  const WEEK_MS = 7 * 86400000;

  for (const item of analyzedComments) {
    if (!item.publishedAt) continue;
    const commentMs = new Date(item.publishedAt).getTime();
    if (Number.isNaN(commentMs)) continue;

    const diffMs = Math.max(0, commentMs - baseMs);
    const weekIndex = Math.floor(diffMs / WEEK_MS) + 1;

    if (!weekMap.has(weekIndex)) {
      const startMs = baseMs + (weekIndex - 1) * WEEK_MS;
      const endMs = startMs + 6 * 86400000;
      weekMap.set(weekIndex, {
        weekIndex,
        label: `Minggu ${weekIndex}`,
        dateRange: formatWeekRangeLabel(startMs, endMs),
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        totalScore: 0,
        totalComments: 0,
      });
    }

    const bucket = weekMap.get(weekIndex);
    if (item.label === 'positive') bucket.positiveCount += 1;
    else if (item.label === 'negative') bucket.negativeCount += 1;
    else bucket.neutralCount += 1;

    bucket.totalScore += item.score;
    bucket.totalComments += 1;
  }

  return [...weekMap.values()]
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .map((b) => {
      const total = b.totalComments;
      return {
        weekIndex: b.weekIndex,
        label: b.label,
        dateRange: b.dateRange,
        totalComments: total,
        positiveCount: b.positiveCount,
        neutralCount: b.neutralCount,
        negativeCount: b.negativeCount,
        positivePct: total > 0 ? Number(((b.positiveCount / total) * 100).toFixed(1)) : 0,
        neutralPct: total > 0 ? Number(((b.neutralCount / total) * 100).toFixed(1)) : 0,
        negativePct: total > 0 ? Number(((b.negativeCount / total) * 100).toFixed(1)) : 0,
        sentimentScore: total > 0 ? Number(((b.totalScore / total) * 100).toFixed(1)) : 0,
      };
    });
}

/**
 * Analisis sekumpulan komentar video menjadi ringkasan statistik sentimen, tren mingguan, + contoh komentar.
 */
export function analyzeCommentBatch(comments = [], videoPublishedAt = null) {
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let totalScore = 0;

  const analyzedItems = comments.map((c) => {
    const result = analyzeSingleComment(c.text);
    if (result.label === 'positive') positive += 1;
    else if (result.label === 'negative') negative += 1;
    else neutral += 1;

    totalScore += result.score;
    return {
      author: c.author,
      text: c.text.slice(0, 220),
      likes: c.likes || 0,
      publishedAt: c.publishedAt || null,
      label: result.label,
      score: result.score,
    };
  });

  const total = analyzedItems.length;
  // Skor agregat dalam skala -100 hingga +100
  const sentimentScore = total > 0 ? Number(((totalScore / total) * 100).toFixed(1)) : 0;

  // Ambil 6 sampel komentar representatif (2 positif, 2 negatif, 2 netral jika tersedia)
  const samples = [
    ...analyzedItems.filter((x) => x.label === 'positive').slice(0, 2),
    ...analyzedItems.filter((x) => x.label === 'negative').slice(0, 2),
    ...analyzedItems.filter((x) => x.label === 'neutral').slice(0, 2),
  ].slice(0, 6);

  const weeklyTrend = buildWeeklySentimentTrend(analyzedItems, videoPublishedAt);

  return {
    positiveCount: positive,
    neutralCount: neutral,
    negativeCount: negative,
    totalAnalyzed: total,
    positivePct: total > 0 ? Number(((positive / total) * 100).toFixed(1)) : 0,
    neutralPct: total > 0 ? Number(((neutral / total) * 100).toFixed(1)) : 0,
    negativePct: total > 0 ? Number(((negative / total) * 100).toFixed(1)) : 0,
    sentimentScore,
    samples,
    weeklyTrend,
  };
}
