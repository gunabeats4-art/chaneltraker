// State aplikasi frontend
const state = {
  channels: [],
  latestVideos: [],
  notifications: [],
  unreadCount: 0,
  lastSeenNotifId: Number(localStorage.getItem('yt_last_notif_id') || 0),
  activeView: 'overview',
  selectedChannelId: null,
  historyRange: '30d',
  historyMetric: 'subscribers',
  compareMetric: 'subscribers',
  selectedCompareIds: new Set(),
  selectedSentimentVideoIds: new Set(),
  selectedTrendVideoId: null,
  sentimentTrendMetric: 'score',
  lastTrendPayload: null,
  channelVideoFilter: 'all',
  allVideoFilter: 'all',
  channelSearchQuery: '',
  channelVideosSearchQuery: '',
  allVideosSearchQuery: '',
  allVideosCategoryFilter: '',
  latestVideoCategories: [],
  lastChannelVideos: [],
  lastChannelAvgViewsPerHour: 0,
  lastAnalyticsPayload: null,
  lastCompareData: null,
  heatmapMetric: 'viewsPerHour',
  lastHeatmapPayload: null,
  pendingDeleteId: null,
  charts: {
    history: null,
    uploadHours: null,
    compare: null,
    sentiment: null,
    sentimentTrend: null,
  },
};

const CHART_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

// Fallback SVG inline agar gambar tidak pernah tampil rusak
const AVATAR_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#e2e8f0"/><circle cx="32" cy="24" r="11" fill="#94a3b8"/><path d="M14 54c2-10 10-16 18-16s16 6 18 16" fill="#94a3b8"/></svg>'
  );

const THUMB_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#1e293b"/><polygon points="145,68 188,90 145,112" fill="#94a3b8"/></svg>'
  );

// Utilitas pemformatan angka & tanggal
function formatCompact(num) {
  const n = Number(num || 0);
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('id-ID');
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('id-ID');
}

function formatDateShort(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'Baru saja';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} mnt lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return formatDateShort(iso);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Ambil field statistik channel secara aman (mendukung data lama & optional chaining)
function getChannelStats(ch) {
  const subscriberCount = Number(ch?.statistics?.subscriberCount ?? ch?.current_subscribers ?? 0) || 0;
  const viewCount = Number(ch?.statistics?.viewCount ?? ch?.current_views ?? 0) || 0;
  const videoCount = Number(ch?.statistics?.videoCount ?? ch?.current_videos ?? 0) || 0;
  const totalLikes = Number(ch?.total_likes_tracked ?? 0) || 0;
  const subscriberTarget = Number(ch?.subscriber_target ?? 0) || 0;
  return { subscriberCount, viewCount, videoCount, totalLikes, subscriberTarget };
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4200);
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request gagal (HTTP ${res.status})`);
  }
  return data;
}

// Ambil palet warna Chart.js sesuai mode terang/gelap aktif
function getChartTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    textColor: isDark ? '#94a3b8' : '#475569',
    gridColor: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.07)',
  };
}

function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    state.charts[key] = null;
  }
}

// Manajemen Mode Gelap / Terang
function initTheme() {
  const saved = localStorage.getItem('yt_tracker_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;
  applyTheme(isDark);
}

function applyTheme(isDark) {
  document.documentElement.classList.toggle('dark', isDark);
  localStorage.setItem('yt_tracker_theme', isDark ? 'dark' : 'light');
  document.getElementById('themeIconSun').classList.toggle('hidden', !isDark);
  document.getElementById('themeIconMoon').classList.toggle('hidden', isDark);
}

// Navigasi antar tampilan
const VIEW_TITLES = {
  overview: 'Ringkasan Channel',
  analytics: 'Analisis Pertumbuhan Channel',
  compare: 'Perbandingan Antar Channel',
  videos: 'Analisis Video & Sentimen Komentar',
  logs: 'Log Bot & Status Kuota',
};

function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });
  document.getElementById('viewTitle').textContent = VIEW_TITLES[viewName] || 'Dashboard';

  // Tutup drawer mobile setelah memilih menu
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');

  if (viewName === 'analytics') loadChannelAnalyticsView();
  if (viewName === 'compare') loadCompareView();
  if (viewName === 'videos') loadVideosView();
  if (viewName === 'logs') loadStatusAndLogs();
}

// Muat status sistem & peringatan API key
async function loadStatusAndLogs() {
  try {
    const data = await apiJson('/api/status');
    document.getElementById('apiWarningBanner').classList.toggle('hidden', data.apiKeyConfigured);

    document.getElementById('statusApiKey').textContent = data.apiKeyConfigured
      ? 'Terpasang'
      : 'Belum Diatur';
    document.getElementById('statusCron').textContent = data.scheduler?.cronExpression || '-';
    document.getElementById('statusLastCheck').textContent = data.lastCheckedAt
      ? `Cek terakhir: ${formatDateTime(data.lastCheckedAt)}`
      : 'Belum ada pengecekan';

    const tbody = document.getElementById('logsTableBody');
    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4">Belum ada log aktivitas bot.</td></tr>';
      return;
    }

    tbody.innerHTML = data.logs
      .map(
        (log) => `
        <tr>
          <td class="font-mono">${escapeHtml(formatDateTime(log.created_at))}</td>
          <td>${escapeHtml(log.level.toUpperCase())}</td>
          <td class="font-mono">${escapeHtml(log.source)}</td>
          <td>${escapeHtml(log.message)}</td>
        </tr>`
      )
      .join('');
  } catch (err) {
    console.error(err);
  }
}

// Muat daftar channel & render kartu ringkasan
async function loadChannels() {
  const data = await apiJson('/api/channels');
  state.channels = data.channels || [];

  if (!state.selectedChannelId && state.channels.length > 0) {
    state.selectedChannelId = state.channels[0].id;
  } else if (
    state.selectedChannelId &&
    !state.channels.some((c) => c.id === state.selectedChannelId)
  ) {
    state.selectedChannelId = state.channels.length > 0 ? state.channels[0].id : null;
  }

  // Inisialisasi default pilihan perbandingan (maksimal 3 channel pertama)
  if (state.selectedCompareIds.size === 0 && state.channels.length > 0) {
    state.channels.slice(0, 3).forEach((c) => state.selectedCompareIds.add(c.id));
  }

  renderChannelsGrid();
  populateChannelSelectors();
}

function renderOverviewSummaryCards() {
  const totalChannels = state.channels.length;
  let totalSubs = 0;
  let totalViews = 0;
  let totalVideos = 0;
  let totalLikes = 0;
  let totalDailySubs = 0;

  for (const ch of state.channels) {
    const stats = getChannelStats(ch);
    totalSubs += stats.subscriberCount;
    totalViews += stats.viewCount;
    totalVideos += stats.videoCount;
    totalLikes += stats.totalLikes;
    totalDailySubs += Number(ch?.growth?.dailySubscribers ?? 0) || 0;
  }

  document.getElementById('overviewTotalSubscribers').textContent = formatCompact(totalSubs);
  const dailySign = totalDailySubs >= 0 ? '+' : '';
  document.getElementById('overviewTotalSubsMeta').textContent =
    totalChannels > 0
      ? `${formatNumber(totalSubs)} total · ${dailySign}${formatNumber(totalDailySubs)}/hari`
      : '0 channel dipantau';

  document.getElementById('overviewTotalViews').textContent = formatCompact(totalViews);
  document.getElementById('overviewTotalViewsMeta').textContent =
    totalChannels > 0
      ? `${formatNumber(totalViews)} views dari ${totalChannels} channel`
      : 'Akumulasi semua channel';

  document.getElementById('overviewTotalVideos').textContent = formatNumber(totalVideos);
  document.getElementById('overviewTotalVideosMeta').textContent =
    totalChannels > 0
      ? `Rata-rata ${formatNumber(Math.round(totalVideos / totalChannels))} video/channel`
      : 'Di seluruh daftar pantauan';

  document.getElementById('overviewTotalLikes').textContent = formatCompact(totalLikes);
  document.getElementById('overviewTotalLikesMeta').textContent =
    totalChannels > 0
      ? `${formatNumber(totalLikes)} likes terlacak`
      : 'Dari video terbaru terpantau';
}

function renderChannelsGrid() {
  const grid = document.getElementById('channelsGrid');
  const summary = document.getElementById('channelsSummaryText');

  renderOverviewSummaryCards();

  if (state.channels.length === 0) {
    summary.textContent = 'Belum ada channel yang dipantau.';
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        Tambahkan channel YouTube pertama Anda menggunakan formulir di atas untuk mulai memantau pertumbuhan subscriber, views, likes, dan video terbaru.
      </div>`;
    return;
  }

  const totalSubs = state.channels.reduce(
    (s, c) => s + getChannelStats(c).subscriberCount,
    0
  );

  const query = state.channelSearchQuery.trim().toLowerCase();
  const visibleChannels = query
    ? state.channels.filter((ch) => {
        const title = String(ch?.title || '').toLowerCase();
        const handle = String(ch?.handle || '').toLowerCase();
        const youtubeId = String(ch?.youtube_id || '').toLowerCase();
        return title.includes(query) || handle.includes(query) || youtubeId.includes(query);
      })
    : state.channels;

  summary.textContent = query
    ? `Menampilkan ${visibleChannels.length} dari ${state.channels.length} channel untuk "${state.channelSearchQuery.trim()}" · Total gabungan ${formatCompact(totalSubs)} subscriber`
    : `${state.channels.length} channel dipantau · Total gabungan ${formatCompact(totalSubs)} subscriber`;

  if (visibleChannels.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        Tidak ada channel yang cocok dengan kata kunci "<strong>${escapeHtml(
          state.channelSearchQuery.trim()
        )}</strong>".
      </div>`;
    return;
  }

  grid.innerHTML = visibleChannels
    .map((ch) => {
      const stats = getChannelStats(ch);
      const milestoneLabel = ch?.milestones?.highestBadge
        ? `Milestone ${ch.milestones.highestBadge.label}`
        : 'Awal Pertumbuhan';
      const handleText = ch?.handle || ch?.youtube_id || '-';
      const dailyGain = Number(ch?.growth?.dailySubscribers ?? 0) || 0;
      const dailySign = dailyGain > 0 ? `+${formatCompact(dailyGain)}` : formatCompact(dailyGain);

      const hasTarget = stats.subscriberTarget > 0;
      const pct = Number(ch?.targetProgressPct ?? 0) || 0;
      const isDone = pct >= 100;

      const isConfirmDelete = state.pendingDeleteId === ch.id;

      return `
      <article class="channel-card" data-channel-id="${ch.id}">
        <div class="channel-card-top">
          <img
            class="channel-avatar"
            src="${escapeHtml(ch?.thumbnail_url || AVATAR_FALLBACK)}"
            alt="${escapeHtml(ch?.title || 'Channel')}"
            referrerpolicy="no-referrer"
            onerror="this.onerror=null;this.src='${AVATAR_FALLBACK}'"
          />
          <div class="channel-identity">
            <h3 class="channel-name" title="${escapeHtml(ch?.title || 'Tanpa Nama')}">${escapeHtml(ch?.title || 'Tanpa Nama')}</h3>
            <div class="channel-meta-line">
              ${escapeHtml(handleText)} · ${escapeHtml(milestoneLabel)} · ${dailySign}/hari
            </div>
          </div>
        </div>

        <div class="channel-stats-row">
          <div>
            <div class="stat-cell-label">Subscriber</div>
            <div class="stat-cell-val">${formatCompact(stats.subscriberCount)}</div>
          </div>
          <div>
            <div class="stat-cell-label">Total Views</div>
            <div class="stat-cell-val">${formatCompact(stats.viewCount)}</div>
          </div>
          <div>
            <div class="stat-cell-label">Likes Video</div>
            <div class="stat-cell-val">${formatCompact(stats.totalLikes)}</div>
          </div>
          <div>
            <div class="stat-cell-label">Video</div>
            <div class="stat-cell-val">${formatNumber(stats.videoCount)}</div>
          </div>
        </div>

        <div class="target-progress-wrap">
          <div class="target-progress-head">
            <span>${
              hasTarget
                ? `Target ${formatCompact(stats.subscriberTarget)} sub`
                : 'Belum ada target subscriber'
            }</span>
            <span class="font-mono">${hasTarget ? `${pct}%` : '-'}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${isDone ? 'done' : ''}" style="width: ${hasTarget ? pct : 0}%"></div>
          </div>
        </div>

        <div class="channel-card-actions">
          <div class="toolbar-group">
            <button type="button" class="btn btn-secondary btn-sm" data-action="analyze" data-id="${ch.id}">
              Analisis
            </button>
            <a class="btn btn-secondary btn-sm" href="/api/export/${ch.id}.csv" download>
              CSV
            </a>
          </div>
          <button
            type="button"
            class="btn btn-danger-ghost"
            data-action="delete"
            data-id="${ch.id}"
          >
            ${isConfirmDelete ? 'Konfirmasi Hapus' : 'Hapus'}
          </button>
        </div>
      </article>`;
    })
    .join('');
}

function populateChannelSelectors() {
  const analyticsSelect = document.getElementById('analyticsChannelSelect');
  const videosFilter = document.getElementById('videosFilterChannel');

  analyticsSelect.innerHTML =
    state.channels.length === 0
      ? '<option value="">Belum ada channel</option>'
      : state.channels
          .map(
            (ch) =>
              `<option value="${ch.id}" ${ch.id === state.selectedChannelId ? 'selected' : ''}>${escapeHtml(
                ch.title
              )}</option>`
          )
          .join('');

  const prevFilter = videosFilter.value;
  videosFilter.innerHTML =
    '<option value="">Semua Channel</option>' +
    state.channels
      .map((ch) => `<option value="${ch.id}">${escapeHtml(ch.title)}</option>`)
      .join('');
  videosFilter.value = prevFilter;
}

// Muat video terbaru untuk Ringkasan & tab Video
async function loadLatestVideos(channelIdFilter = '') {
  const qs = channelIdFilter ? `?channelId=${encodeURIComponent(channelIdFilter)}&limit=50` : '?limit=50';
  const data = await apiJson(`/api/videos/latest${qs}`);
  state.latestVideos = data.videos || [];
  state.latestVideoCategories = data.categories || [];
  renderLatestVideosOverview();
  populateTrendVideoSelect();
  populateVideoCategoryFilter();
  if (state.activeView === 'videos') {
    renderAllVideosTable();
  }
}

function populateVideoCategoryFilter() {
  const selectEl = document.getElementById('videosFilterCategory');
  if (!selectEl) return;

  const baseCategories = ['Edukasi', 'Gaming', 'Hiburan', 'Musik', 'Sains & Teknologi'];
  const countMap = new Map();
  for (const v of state.latestVideos) {
    const cat = v.categoryName || 'Lainnya';
    countMap.set(cat, (countMap.get(cat) || 0) + 1);
  }

  const allCategoryNames = new Set([...countMap.keys(), ...baseCategories]);
  const sortedNames = [...allCategoryNames].sort((a, b) => {
    const diff = (countMap.get(b) || 0) - (countMap.get(a) || 0);
    if (diff !== 0) return diff;
    return a.localeCompare(b, 'id');
  });

  const prevVal = state.allVideosCategoryFilter || selectEl.value || '';
  selectEl.innerHTML =
    '<option value="">Semua Kategori</option>' +
    sortedNames
      .map((cat) => {
        const count = countMap.get(cat) || 0;
        const label = count > 0 ? `${cat} (${count})` : cat;
        return `<option value="${escapeHtml(cat)}">${escapeHtml(label)}</option>`;
      })
      .join('');

  if (prevVal && sortedNames.includes(prevVal)) {
    selectEl.value = prevVal;
    state.allVideosCategoryFilter = prevVal;
  } else {
    selectEl.value = '';
    state.allVideosCategoryFilter = '';
  }
}

function populateTrendVideoSelect() {
  const sel = document.getElementById('sentimentTrendVideoSelect');
  if (!sel) return;

  if (state.latestVideos.length === 0) {
    sel.innerHTML = '<option value="">Belum ada video</option>';
    state.selectedTrendVideoId = null;
    return;
  }

  if (!state.selectedTrendVideoId || !state.latestVideos.some((v) => v.id === state.selectedTrendVideoId)) {
    state.selectedTrendVideoId = state.latestVideos[0].id;
  }

  sel.innerHTML = state.latestVideos
    .map((v) => {
      const shortTitle = v.title.length > 48 ? `${v.title.slice(0, 48)}...` : v.title;
      return `<option value="${v.id}" ${v.id === state.selectedTrendVideoId ? 'selected' : ''}>${escapeHtml(
        shortTitle
      )} (${escapeHtml(v.channelTitle)})</option>`;
    })
    .join('');
}

function renderLatestVideosOverview() {
  const grid = document.getElementById('latestVideosGrid');
  const slice = state.latestVideos.slice(0, 8);

  if (slice.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        Belum ada video terlacak. Tambahkan channel untuk melihat video terbarunya di sini.
      </div>`;
    return;
  }

  grid.innerHTML = slice
    .map(
      (v) => `
      <article class="video-card">
        <a class="video-thumb-wrap" href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">
          <img
            class="video-thumb"
            src="${escapeHtml(v.thumbnailUrl || THUMB_FALLBACK)}"
            alt="${escapeHtml(v.title)}"
            referrerpolicy="no-referrer"
            onerror="this.onerror=null;this.src='${THUMB_FALLBACK}'"
          />
        </a>
        <div class="video-card-body">
          <a class="video-card-title" href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(v.title)}
          </a>
          <div class="video-card-meta">
            ${escapeHtml(v.channelTitle)} · ${timeAgo(v.publishedAt)} · ${formatCompact(v.views)} views · ${formatCompact(v.likes)} likes
          </div>
        </div>
      </article>`
    )
    .join('');
}

// Muat analisis mendalam 1 channel
async function loadChannelAnalyticsView() {
  const emptyEl = document.getElementById('analyticsEmpty');
  const contentEl = document.getElementById('analyticsContent');

  if (!state.selectedChannelId || state.channels.length === 0) {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  try {
    const [analytics, history] = await Promise.all([
      apiJson(`/api/channels/${state.selectedChannelId}/analytics`),
      apiJson(`/api/channels/${state.selectedChannelId}/history?range=${state.historyRange}`),
    ]);

    const channelStats = getChannelStats(analytics?.channel);
    document.getElementById('editTargetInput').value = channelStats.subscriberTarget || '';

    // Isi KPI Strip dengan fallback aman
    const g = analytics?.growth || {};
    const dailySubscribers = Number(g?.dailySubscribers ?? 0) || 0;
    const weeklySubscribers = Number(g?.weeklySubscribers ?? 0) || 0;
    const growthChangePct = Number(g?.growthChangePct ?? 0) || 0;
    const dailyViews = Number(g?.dailyViews ?? 0) || 0;
    const weeklyViews = Number(g?.weeklyViews ?? 0) || 0;
    const viewsChangePct = Number(g?.viewsChangePct ?? 0) || 0;

    const subSign = dailySubscribers >= 0 ? '+' : '';
    document.getElementById('kpiDailySubs').textContent = `${subSign}${formatNumber(
      dailySubscribers
    )} / hari`;

    const pctClass = growthChangePct > 0 ? 'trend-up' : growthChangePct < 0 ? 'trend-down' : '';
    const pctSign = growthChangePct > 0 ? '+' : '';
    document.getElementById('kpiSubTrend').innerHTML = `${subSign}${formatNumber(
      weeklySubscribers
    )}/minggu · <span class="${pctClass}">${pctSign}${growthChangePct}%</span> vs periode lalu`;

    // Proyeksi pertumbuhan subscriber 30 hari ke depan berdasarkan rata-rata harian saat ini
    const projected30dGain = Math.round(dailySubscribers * 30);
    const projected30dSubs = Math.max(0, channelStats.subscriberCount + projected30dGain);
    const projected30dPct =
      channelStats.subscriberCount > 0
        ? Number(((projected30dGain / channelStats.subscriberCount) * 100).toFixed(1))
        : 0;
    const gain30Sign = projected30dGain >= 0 ? '+' : '';
    const gain30Class =
      projected30dGain > 0 ? 'trend-up' : projected30dGain < 0 ? 'trend-down' : '';
    const pct30Sign = projected30dPct > 0 ? '+' : '';

    document.getElementById('kpiProjection30d').textContent = `${formatCompact(projected30dSubs)} sub`;
    document.getElementById('kpiProjection30dMeta').innerHTML =
      `<span class="${gain30Class}">${gain30Sign}${formatNumber(
        projected30dGain
      )}</span> (${pct30Sign}${projected30dPct}%) · ${subSign}${formatNumber(
        dailySubscribers
      )}/hari`;

    const viewSign = dailyViews >= 0 ? '+' : '';
    document.getElementById('kpiDailyViews').textContent = `${viewSign}${formatCompact(
      dailyViews
    )} / hari`;
    document.getElementById('kpiViewsTrend').textContent = `${viewSign}${formatCompact(
      weeklyViews
    )}/minggu (${viewsChangePct >= 0 ? '+' : ''}${viewsChangePct}%)`;

    const proj = analytics?.projection || {};
    document.getElementById('kpiProjectionDate').textContent = proj?.estimatedDate
      ? formatDateShort(proj.estimatedDate)
      : proj?.status === 'target_reached'
      ? 'Tercapai'
      : '-';
    document.getElementById('kpiProjectionMeta').textContent =
      proj?.message || 'Belum ada data proyeksi.';

    const ms = analytics?.milestones || {};
    const highest = ms?.highestBadge?.label || '0';
    const nextText = ms?.nextMilestone
      ? `Berikutnya ${ms.nextMilestone.label} (${ms.nextMilestone.progressPct ?? 0}%)`
      : 'Semua milestone tercapai';
    document.getElementById('kpiMilestone').textContent = `${highest} · ${formatCompact(
      channelStats.totalLikes
    )} Likes`;
    document.getElementById('kpiMilestoneMeta').textContent = `${ms?.achieved?.length ?? 0} badge · ${nextText}`;

    renderHistoryChart(history?.snapshots || [], history?.spikes || []);
    renderSpikesList(analytics?.spikes || []);
    renderUploadHoursChart(
      analytics?.videoAnalysis?.hourlyStats || [],
      analytics?.videoAnalysis?.bestUploadHours || []
    );
    state.lastHeatmapPayload = {
      weeklyHeatmap: analytics?.videoAnalysis?.weeklyHeatmap || [],
      bestUploadSlots: analytics?.videoAnalysis?.bestUploadSlots || [],
    };
    renderAudienceHeatmap(
      state.lastHeatmapPayload.weeklyHeatmap,
      state.lastHeatmapPayload.bestUploadSlots
    );
    state.lastChannelVideos = analytics?.videoAnalysis?.rankedVideos || [];
    state.lastChannelAvgViewsPerHour = Number(analytics?.videoAnalysis?.avgViewsPerHour ?? 0) || 0;
    state.lastAnalyticsPayload = {
      channelId: state.selectedChannelId,
      range: state.historyRange,
      historyMetric: state.historyMetric,
      analytics,
      history,
    };
    renderChannelVideosTable(state.lastChannelVideos, state.lastChannelAvgViewsPerHour);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderHistoryChart(snapshots, spikes) {
  const canvas = document.getElementById('historyChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const theme = getChartTheme();

  const spikeDates = new Set(spikes.map((s) => s.date));
  const labels = snapshots.map((s) => formatDateTime(s.recorded_at));
  const metricKey = state.historyMetric === 'views' ? 'views' : 'subscribers';
  const values = snapshots.map((s) => Number(s[metricKey] || 0));

  const datasetLabel = metricKey === 'views' ? 'Total Views' : 'Subscriber';
  const borderColor = metricKey === 'views' ? '#16a34a' : '#2563eb';
  const backgroundColor =
    metricKey === 'views' ? 'rgba(22, 163, 74, 0.12)' : 'rgba(37, 99, 235, 0.12)';

  const pointRadii = snapshots.map((s) => {
    const dateKey = String(s.recorded_at).slice(0, 10);
    return spikeDates.has(dateKey) ? 6 : 2.5;
  });
  const pointColors = snapshots.map((s) => {
    const dateKey = String(s.recorded_at).slice(0, 10);
    return spikeDates.has(dateKey) ? '#dc2626' : borderColor;
  });

  // Perbarui instance Chart.js secara langsung agar transisi antar metrik halus
  if (state.charts.history && state.charts.history.canvas === canvas) {
    const chart = state.charts.history;
    const ds = chart.data.datasets[0];
    chart.data.labels = labels;
    ds.label = datasetLabel;
    ds.data = values;
    ds.borderColor = borderColor;
    ds.backgroundColor = backgroundColor;
    ds.pointRadius = pointRadii;
    ds.pointBackgroundColor = pointColors;

    chart.options.plugins.legend.labels.color = theme.textColor;
    chart.options.scales.x.ticks.color = theme.textColor;
    chart.options.scales.x.grid.color = theme.gridColor;
    chart.options.scales.y.ticks.color = theme.textColor;
    chart.options.scales.y.grid.color = theme.gridColor;

    chart.update();
    return;
  }

  destroyChart('history');
  state.charts.history = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: datasetLabel,
          data: values,
          borderColor,
          backgroundColor,
          fill: true,
          tension: 0.25,
          pointRadius: pointRadii,
          pointBackgroundColor: pointColors,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 600,
        easing: 'easeOutQuart',
      },
      transitions: {
        active: {
          animation: {
            duration: 300,
          },
        },
      },
      plugins: {
        legend: { labels: { color: theme.textColor } },
      },
      scales: {
        x: { ticks: { color: theme.textColor, maxTicksLimit: 8 }, grid: { color: theme.gridColor } },
        y: {
          ticks: {
            color: theme.textColor,
            callback: (val) => formatCompact(val),
          },
          grid: { color: theme.gridColor },
        },
      },
    },
  });
}

function renderSpikesList(spikes) {
  const container = document.getElementById('spikesContainer');
  if (!spikes || spikes.length === 0) {
    container.innerHTML =
      '<div class="empty-state">Belum terdeteksi lonjakan subscriber (&gt; 2x rata-rata 7 hari) pada data historis channel ini.</div>';
    return;
  }

  container.innerHTML = spikes
    .map((s) => {
      const vidHtml =
        s.correlatedVideos && s.correlatedVideos.length > 0
          ? s.correlatedVideos
              .map(
                (v) =>
                  `<a href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                    v.title
                  )}</a>`
              )
              .join(' · ')
          : 'Tidak ada video yang diupload dalam ±48 jam dari tanggal lonjakan.';

      return `
        <div class="spike-item">
          <div class="spike-head">
            <span>${formatDateShort(s.date)}</span>
            <span class="trend-up font-mono">+${formatNumber(s.delta)} sub (${s.multiplier || '>2'}x rata-rata)</span>
          </div>
          <div class="spike-videos">Video terkait: ${vidHtml}</div>
        </div>`;
    })
    .join('');
}

function renderUploadHoursChart(hourlyStats, bestHours) {
  destroyChart('uploadHours');
  const ctx = document.getElementById('uploadHoursChart').getContext('2d');
  const theme = getChartTheme();

  const summaryEl = document.getElementById('bestHoursSummary');
  if (bestHours.length > 0) {
    summaryEl.textContent =
      'Jam terbaik: ' +
      bestHours.map((h) => `${h.label} WIB (${formatCompact(h.avgViewsPerHour)} views/jam)`).join(' · ');
  } else {
    summaryEl.textContent = 'Belum ada data video untuk menghitung jam upload terbaik.';
  }

  const bestHourSet = new Set(bestHours.map((h) => h.hour));

  state.charts.uploadHours = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: hourlyStats.map((h) => h.label),
      datasets: [
        {
          label: 'Rata-rata Views / Jam',
          data: hourlyStats.map((h) => h.avgViewsPerHour),
          backgroundColor: hourlyStats.map((h) =>
            bestHourSet.has(h.hour) ? '#dc2626' : 'rgba(37, 99, 235, 0.55)'
          ),
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: theme.textColor, maxTicksLimit: 12 }, grid: { display: false } },
        y: {
          ticks: { color: theme.textColor, callback: (v) => formatCompact(v) },
          grid: { color: theme.gridColor },
        },
      },
    },
  });
}

function renderAudienceHeatmap(weeklyHeatmap, bestUploadSlots) {
  const container = document.getElementById('audienceHeatmapContainer');
  const summaryEl = document.getElementById('heatmapSummary');
  const bestSlotsEl = document.getElementById('heatmapBestSlots');
  const detailEl = document.getElementById('heatmapCellDetail');
  if (!container) return;

  const rows = Array.isArray(weeklyHeatmap) ? weeklyHeatmap : [];
  const metricKey =
    state.heatmapMetric === 'engagement' ? 'avgEngagementPct' : 'avgViewsPerHour';

  const activeCells = [];
  for (const row of rows) {
    for (const cell of row.cells || []) {
      if (cell.videoCount > 0) activeCells.push(cell);
    }
  }

  if (rows.length === 0 || activeCells.length === 0) {
    container.innerHTML =
      '<div class="empty-state">Belum ada data waktu publikasi video yang cukup untuk memetakan heatmap aktivitas mingguan.</div>';
    if (bestSlotsEl) {
      bestSlotsEl.textContent = 'Jadwal terbaik: Belum tersedia.';
    }
    if (detailEl) {
      detailEl.textContent = 'Tambahkan atau tunggu sinkronisasi video channel terlebih dahulu.';
    }
    return;
  }

  const maxMetric = Math.max(
    ...activeCells.map((c) => Number(c[metricKey] || 0)),
    0.01
  );

  // Urutkan slot terbaik sesuai metrik heatmap aktif
  const topSlots = [...activeCells]
    .sort((a, b) => Number(b[metricKey] || 0) - Number(a[metricKey] || 0))
    .slice(0, 3);
  const topSlotKeys = new Set(topSlots.map((s) => `${s.dayIndex}-${s.hour}`));

  if (summaryEl) {
    summaryEl.textContent =
      metricKey === 'avgEngagementPct'
        ? 'Distribusi rata-rata rasio engagement (likes + komentar per views) berdasarkan hari & jam upload (WIB)'
        : 'Distribusi rata-rata kecepatan views/jam berdasarkan hari & jam upload (WIB) untuk memilih waktu posting terbaik';
  }

  if (bestSlotsEl) {
    const labelList = (topSlots.length > 0 ? topSlots : bestUploadSlots || [])
      .map((s) =>
        metricKey === 'avgEngagementPct'
          ? `${s.dayLabel} ${s.hourLabel} (${s.avgEngagementPct}%)`
          : `${s.dayLabel} ${s.hourLabel} (${formatCompact(s.avgViewsPerHour)}/jam)`
      )
      .join(' · ');
    bestSlotsEl.innerHTML = `<strong>Waktu Posting Terbaik:</strong> ${escapeHtml(labelList)} WIB`;
  }

  if (detailEl && topSlots[0]) {
    const best = topSlots[0];
    detailEl.textContent = `Puncak: ${best.dayLabel} ${best.hourLabel} WIB · ${best.videoCount} video · ${formatNumber(
      best.avgViewsPerHour
    )} views/jam · ${best.avgEngagementPct}% eng.`;
  }

  const hourHeaders = Array.from({ length: 24 }, (_, h) =>
    `<div class="heatmap-hour-label">${String(h).padStart(2, '0')}</div>`
  ).join('');

  const rowsHtml = rows
    .map((row) => {
      const cellsHtml = (row.cells || [])
        .map((cell) => {
          let level = 0;
          if (cell.videoCount > 0) {
            const ratio = Number(cell[metricKey] || 0) / maxMetric;
            if (ratio >= 0.75) level = 4;
            else if (ratio >= 0.45) level = 3;
            else if (ratio >= 0.2) level = 2;
            else level = 1;
          }

          const isBest = topSlotKeys.has(`${cell.dayIndex}-${cell.hour}`);
          const tooltip =
            cell.videoCount > 0
              ? `${cell.dayLabel}, ${cell.hourLabel} WIB · ${cell.videoCount} video · ${formatNumber(
                  cell.avgViewsPerHour
                )} views/jam · Engagement ${cell.avgEngagementPct}%`
              : `${cell.dayLabel}, ${cell.hourLabel} WIB · Belum ada video diupload pada jam ini`;

          return `<button
            type="button"
            class="heatmap-cell${isBest ? ' is-best' : ''}"
            data-level="${level}"
            data-day-label="${escapeHtml(cell.dayLabel)}"
            data-hour-label="${escapeHtml(cell.hourLabel)}"
            data-video-count="${cell.videoCount}"
            data-avg-vph="${cell.avgViewsPerHour}"
            data-avg-views="${cell.avgViews}"
            data-avg-eng="${cell.avgEngagementPct}"
            title="${escapeHtml(tooltip)}"
            aria-label="${escapeHtml(tooltip)}"
          ></button>`;
        })
        .join('');

      return `
        <div class="heatmap-row">
          <div class="heatmap-day-label">${escapeHtml(row.dayShort)}</div>
          ${cellsHtml}
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="heatmap-matrix">
      <div class="heatmap-header-row">
        <div class="heatmap-day-label">WIB</div>
        ${hourHeaders}
      </div>
      ${rowsHtml}
    </div>`;
}

function renderChannelVideosTable(videos, avgViewsPerHour = state.lastChannelAvgViewsPerHour) {
  const tbody = document.getElementById('channelVideosTableBody');
  const subtitle = document.getElementById('channelVideosSubtitle');
  const allVideos = videos || [];

  if (allVideos.length === 0) {
    if (subtitle) {
      subtitle.textContent =
        'Performa kecepatan views, jumlah like, dan rasio interaksi sejak waktu upload';
    }
    tbody.innerHTML = '<tr><td colspan="5">Belum ada video terlacak untuk channel ini.</td></tr>';
    return;
  }

  const avg =
    Number(avgViewsPerHour) ||
    allVideos.reduce((sum, v) => sum + Number(v.viewsPerHour || 0), 0) / allVideos.length;

  const query = state.channelVideosSearchQuery.trim().toLowerCase();
  const filtered = allVideos.filter((v) => {
    const matchesViral =
      state.channelVideoFilter !== 'viral' || Number(v.viewsPerHour || 0) >= avg;
    if (!matchesViral) return false;
    if (!query) return true;
    return String(v.title || '')
      .toLowerCase()
      .includes(query);
  });

  if (subtitle) {
    const avgFormatted = formatNumber(Number(avg.toFixed(1)));
    if (query) {
      subtitle.textContent = `Menampilkan ${filtered.length} dari ${allVideos.length} video untuk "${state.channelVideosSearchQuery.trim()}" (rata-rata channel ${avgFormatted} views/jam)`;
    } else if (state.channelVideoFilter === 'viral') {
      subtitle.textContent = `Menampilkan ${filtered.length} dari ${allVideos.length} video dengan pertumbuhan ≥ rata-rata channel (${avgFormatted} views/jam)`;
    } else {
      subtitle.textContent = `Rata-rata channel: ${avgFormatted} views/jam · ${allVideos.length} video terlacak`;
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML = query
      ? `<tr><td colspan="5">Tidak ada video yang cocok dengan kata kunci "${escapeHtml(
          state.channelVideosSearchQuery.trim()
        )}".</td></tr>`
      : '<tr><td colspan="5">Tidak ada video di atas rata-rata pertumbuhan channel saat ini.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (v) => `
      <tr>
        <td>
          <a class="table-video-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(v.title)}
          </a>
          <div style="font-size:12px;color:var(--text-muted)">${formatDateShort(v.publishedAt)} · ${v.ageHours} jam lalu</div>
        </td>
        <td class="num">${formatNumber(v.views)}</td>
        <td class="num">${formatNumber(v.likes)}</td>
        <td class="num">${formatNumber(v.viewsPerHour)}</td>
        <td class="num">${v.engagementRatePct}%</td>
      </tr>`
    )
    .join('');
}

function toPdfText(value) {
  return String(value ?? '')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/±/g, '+/-')
    .replace(/→/g, '->')
    .replace(/·/g, '|')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncatePdfText(doc, text, maxWidth) {
  const clean = toPdfText(text);
  if (!clean) return '-';
  if (doc.getTextWidth(clean) <= maxWidth) return clean;
  let trimmed = clean;
  while (trimmed.length > 3 && doc.getTextWidth(`${trimmed}...`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed.trim()}...`;
}

function captureChartPngForPdf(chartInstance) {
  if (!chartInstance || !chartInstance.canvas) return null;
  const origTheme = getChartTheme();
  const options = chartInstance.options || {};

  // Sementara gunakan warna kontras gelap agar grafik terbaca tajam di atas kertas putih PDF
  if (options.plugins?.legend?.labels) {
    options.plugins.legend.labels.color = '#1e293b';
  }
  if (options.scales) {
    Object.values(options.scales).forEach((scale) => {
      if (scale?.ticks) scale.ticks.color = '#334155';
      if (scale?.grid && scale.grid.display !== false) {
        scale.grid.color = 'rgba(15, 23, 42, 0.08)';
      }
    });
  }
  chartInstance.update('none');

  const srcCanvas = chartInstance.canvas;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = srcCanvas.width || 1200;
  exportCanvas.height = srcCanvas.height || 600;
  const ctx = exportCanvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(srcCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
  const dataUrl = exportCanvas.toDataURL('image/png', 1.0);

  // Kembalikan warna tema grafik ke tampilan dashboard aktif
  if (options.plugins?.legend?.labels) {
    options.plugins.legend.labels.color = origTheme.textColor;
  }
  if (options.scales) {
    Object.values(options.scales).forEach((scale) => {
      if (scale?.ticks) scale.ticks.color = origTheme.textColor;
      if (scale?.grid && scale.grid.display !== false) {
        scale.grid.color = origTheme.gridColor;
      }
    });
  }
  chartInstance.update('none');

  return {
    dataUrl,
    aspectRatio: exportCanvas.width / Math.max(exportCanvas.height, 1),
  };
}

function drawFittedChartImage(doc, chartCapture, boxX, boxY, boxW, boxH) {
  if (!chartCapture?.dataUrl) return;
  const ratio = chartCapture.aspectRatio || 2;
  let drawW = boxW;
  let drawH = drawW / ratio;
  if (drawH > boxH) {
    drawH = boxH;
    drawW = drawH * ratio;
  }
  const offsetX = boxX + (boxW - drawW) / 2;
  const offsetY = boxY + (boxH - drawH) / 2;
  doc.addImage(chartCapture.dataUrl, 'PNG', offsetX, offsetY, drawW, drawH, undefined, 'FAST');
}

async function generateAnalyticsPdfReport() {
  const channelId = Number(
    document.getElementById('analyticsChannelSelect').value || state.selectedChannelId
  );
  if (!channelId || !state.lastAnalyticsPayload) {
    showToast('Pilih channel terlebih dahulu untuk mengunduh laporan PDF.', 'error');
    return;
  }

  const jsPdfNs = window.jspdf;
  if (!jsPdfNs || !jsPdfNs.jsPDF) {
    showToast('Pustaka pembuat PDF belum siap. Muat ulang halaman lalu coba lagi.', 'error');
    return;
  }

  const btn = document.getElementById('exportPdfBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menyiapkan PDF...';

  try {
    const payload = state.lastAnalyticsPayload;
    const analytics = payload.analytics || {};
    const channel = analytics.channel || state.channels.find((c) => c.id === channelId) || {};
    const channelStats = getChannelStats(channel);
    const growth = analytics.growth || {};
    const projection = analytics.projection || {};
    const milestones = analytics.milestones || {};
    const spikes = analytics.spikes || [];
    const bestHours = analytics.videoAnalysis?.bestUploadHours || [];
    const rankedVideos = analytics.videoAnalysis?.rankedVideos || [];
    const avgViewsPerHour = Number(analytics.videoAnalysis?.avgViewsPerHour ?? 0) || 0;

    const historyChartCapture = captureChartPngForPdf(state.charts.history);
    const uploadHoursCapture = captureChartPngForPdf(state.charts.uploadHours);

    const { jsPDF } = jsPdfNs;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pageW = 297;
    const pageH = 210;
    const margin = 14;
    const contentW = pageW - margin * 2;
    const rangeLabel =
      state.historyRange === '7d'
        ? '7 Hari Terakhir'
        : state.historyRange === 'all'
        ? 'Semua Data Historis'
        : '30 Hari Terakhir';
    const metricLabel = state.historyMetric === 'views' ? 'Total Views' : 'Subscriber';
    const printedAt = formatDateTime(new Date().toISOString());

    const channelTitle = toPdfText(channel.title || 'Channel YouTube');
    const channelHandle = toPdfText(channel.handle || channel.youtube_id || '-');

    // === HALAMAN 1: RINGKASAN EKSEKUTIF & VISUALISASI GRAFIK ===
    // Banner Header Presentasi
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 28, 'F');
    doc.setFillColor(220, 38, 38);
    doc.rect(0, 0, pageW, 2.2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(248, 113, 113);
    doc.text('CHANNELTRACKER  |  LAPORAN ANALISIS YOUTUBE', margin, 9);

    doc.setFontSize(17);
    doc.setTextColor(255, 255, 255);
    doc.text(truncatePdfText(doc, channelTitle, 180), margin, 17.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(203, 213, 225);
    doc.text(`${channelHandle}  |  Rentang: ${rangeLabel}  |  Metrik Grafik: ${metricLabel}`, margin, 23.5);

    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text('Dibuat pada:', pageW - margin, 12.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(toPdfText(printedAt), pageW - margin, 18, { align: 'right' });

    // Bar Ringkasan Statistik Utama Channel
    const stripY = 33;
    const stripH = 15;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, stripY, contentW, stripH, 2, 2, 'FD');

    const targetPct =
      channelStats.subscriberTarget > 0
        ? Math.min(100, Math.round((channelStats.subscriberCount / channelStats.subscriberTarget) * 100))
        : 0;
    const stripItems = [
      { label: 'TOTAL SUBSCRIBER', value: formatNumber(channelStats.subscriberCount) },
      { label: 'TOTAL VIEWS', value: formatNumber(channelStats.viewCount) },
      { label: 'TOTAL VIDEO PUBLIK', value: formatNumber(channelStats.videoCount) },
      {
        label: 'TARGET SUBSCRIBER',
        value:
          channelStats.subscriberTarget > 0
            ? `${formatNumber(channelStats.subscriberTarget)} (${targetPct}%)`
            : 'Belum diatur',
      },
    ];

    const colW = contentW / 4;
    stripItems.forEach((item, idx) => {
      const x = margin + idx * colW + 4;
      if (idx > 0) {
        doc.setDrawColor(226, 232, 240);
        doc.line(margin + idx * colW, stripY + 3, margin + idx * colW, stripY + stripH - 3);
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(item.label, x, stripY + 5.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(toPdfText(item.value), x, stripY + 11.5);
    });

    // 5 Kartu KPI Pertumbuhan & Proyeksi
    const kpiY = 52;
    const kpiGap = 3.5;
    const kpiW = (contentW - kpiGap * 4) / 5;
    const kpiH = 24;

    const dailySubs = Number(growth.dailySubscribers ?? 0) || 0;
    const weeklySubs = Number(growth.weeklySubscribers ?? 0) || 0;
    const growthChangePct = Number(growth.growthChangePct ?? 0) || 0;
    const dailyViews = Number(growth.dailyViews ?? 0) || 0;
    const weeklyViews = Number(growth.weeklyViews ?? 0) || 0;
    const viewsChangePct = Number(growth.viewsChangePct ?? 0) || 0;

    const projValue = projection.estimatedDate
      ? formatDateShort(projection.estimatedDate)
      : projection.status === 'target_reached'
      ? 'Tercapai'
      : '-';
    const projected30dGain = Math.round(dailySubs * 30);
    const projected30dSubs = Math.max(0, channelStats.subscriberCount + projected30dGain);
    const highestBadge = milestones.highestBadge?.label || '0';
    const nextMsText = milestones.nextMilestone
      ? `Berikutnya ${milestones.nextMilestone.label} (${milestones.nextMilestone.progressPct ?? 0}%)`
      : 'Semua milestone tercapai';

    const kpiCards = [
      {
        title: 'PERTUMBUHAN SUB',
        value: `${dailySubs >= 0 ? '+' : ''}${formatNumber(dailySubs)} / hari`,
        meta: `${weeklySubs >= 0 ? '+' : ''}${formatNumber(weeklySubs)}/mgg | ${
          growthChangePct >= 0 ? '+' : ''
        }${growthChangePct}%`,
        accent: [37, 99, 235],
      },
      {
        title: 'PROYEKSI 30 HARI',
        value: `${formatCompact(projected30dSubs)} sub`,
        meta: `${projected30dGain >= 0 ? '+' : ''}${formatNumber(projected30dGain)} sub (laju harian)`,
        accent: [124, 58, 237],
      },
      {
        title: 'PERTUMBUHAN VIEWS',
        value: `${dailyViews >= 0 ? '+' : ''}${formatCompact(dailyViews)} / hari`,
        meta: `${weeklyViews >= 0 ? '+' : ''}${formatCompact(weeklyViews)}/mgg (${
          viewsChangePct >= 0 ? '+' : ''
        }${viewsChangePct}%)`,
        accent: [22, 163, 74],
      },
      {
        title: 'PROYEKSI TARGET',
        value: projValue,
        meta: projection.message || 'Belum ada data proyeksi.',
        accent: [217, 119, 6],
      },
      {
        title: 'MILESTONE & LIKES',
        value: `${highestBadge} | ${formatCompact(channelStats.totalLikes)} Likes`,
        meta: `${milestones.achieved?.length ?? 0} badge | ${nextMsText}`,
        accent: [220, 38, 38],
      },
    ];

    kpiCards.forEach((card, idx) => {
      const cx = margin + idx * (kpiW + kpiGap);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(cx, kpiY, kpiW, kpiH, 2, 2, 'FD');

      doc.setFillColor(...card.accent);
      doc.rect(cx, kpiY, 1.5, kpiH, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(card.title, cx + 4, kpiY + 6);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.8);
      doc.setTextColor(15, 23, 42);
      doc.text(truncatePdfText(doc, card.value, kpiW - 7), cx + 4, kpiY + 13.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(truncatePdfText(doc, card.meta, kpiW - 7), cx + 4, kpiY + 19.5);
    });

    // Dua Panel Grafik Berdampingan
    const chartsY = 81;
    const chartsH = 114;
    const leftChartW = 175;
    const rightChartX = margin + leftChartW + 4;
    const rightChartW = contentW - leftChartW - 4;

    // Panel Grafik Riwayat
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, chartsY, leftChartW, chartsH, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Riwayat ${metricLabel} (${rangeLabel})`, margin + 5, chartsY + 7.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Snapshot historis dengan titik merah penanda lonjakan | ${spikes.length} lonjakan terdeteksi`,
      margin + 5,
      chartsY + 12.5
    );

    if (historyChartCapture) {
      drawFittedChartImage(
        doc,
        historyChartCapture,
        margin + 4,
        chartsY + 16,
        leftChartW - 8,
        chartsH - 21
      );
    } else {
      doc.text('Grafik riwayat belum tersedia.', margin + 8, chartsY + 32);
    }

    // Panel Jam Upload Terbaik
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(rightChartX, chartsY, rightChartW, chartsH, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Jam Upload Terbaik (WIB)', rightChartX + 5, chartsY + 7.5);

    const bestHoursText =
      bestHours.length > 0
        ? bestHours
            .slice(0, 3)
            .map((h) => `${h.label} (${formatCompact(h.avgViewsPerHour)}/jam)`)
            .join(' | ')
        : 'Belum ada data jam publikasi.';

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      truncatePdfText(doc, `Rekomendasi: ${bestHoursText}`, rightChartW - 10),
      rightChartX + 5,
      chartsY + 12.5
    );

    if (uploadHoursCapture) {
      drawFittedChartImage(
        doc,
        uploadHoursCapture,
        rightChartX + 4,
        chartsY + 16,
        rightChartW - 8,
        chartsH - 21
      );
    } else {
      doc.text('Grafik jam upload belum tersedia.', rightChartX + 8, chartsY + 32);
    }

    // Footer Halaman 1
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Sumber: Pemantauan pasif data publik YouTube Data API v3',
      margin,
      pageH - 7
    );
    doc.text('Halaman 1 dari 2', pageW - margin, pageH - 7, { align: 'right' });

    // === HALAMAN 2: KORELASI LONJAKAN & PERINGKAT VIDEO ===
    doc.addPage('a4', 'landscape');

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(220, 38, 38);
    doc.rect(0, 0, pageW, 2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(255, 255, 255);
    doc.text(
      truncatePdfText(doc, `${channelTitle} - Korelasi Lonjakan & Performa Video`, 210),
      margin,
      11.5
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(203, 213, 225);
    doc.text(toPdfText(`Rentang: ${rangeLabel} | Dicetak: ${printedAt}`), pageW - margin, 11.5, {
      align: 'right',
    });

    // Bagian 1: Korelasi Lonjakan Subscriber
    const spikeBoxY = 24;
    const topSpikes = spikes.slice(0, 4);
    const spikeRowH = 9.5;
    const spikeBoxH = Math.max(24, 13 + Math.max(topSpikes.length, 1) * spikeRowH);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, spikeBoxY, contentW, spikeBoxH, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Korelasi Lonjakan Subscriber (> 2x Rata-Rata 7 Hari)', margin + 4, spikeBoxY + 7);

    if (topSpikes.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'Belum terdeteksi lonjakan subscriber di atas 2x rata-rata 7 hari pada data historis channel ini.',
        margin + 4,
        spikeBoxY + 16
      );
    } else {
      topSpikes.forEach((s, idx) => {
        const ry = spikeBoxY + 14 + idx * spikeRowH;
        const vidTitles =
          s.correlatedVideos && s.correlatedVideos.length > 0
            ? s.correlatedVideos.map((v) => v.title).join(', ')
            : 'Tidak ada video diupload dalam +/-48 jam';

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(220, 38, 38);
        doc.text(
          toPdfText(`${formatDateShort(s.date)} (+${formatNumber(s.delta)} sub | ${s.multiplier || '>2'}x)`),
          margin + 4,
          ry
        );

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        doc.text(
          truncatePdfText(doc, `Video terkait: ${vidTitles}`, contentW - 84),
          margin + 78,
          ry
        );
      });
    }

    // Bagian 2: Tabel Peringkat Video Teratas
    const tableY = spikeBoxY + spikeBoxH + 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      toPdfText(
        `Peringkat Video Teratas Berdasarkan Views/Jam (Rata-rata channel: ${formatNumber(
          Number(avgViewsPerHour.toFixed(1))
        )} views/jam)`
      ),
      margin,
      tableY
    );

    const headY = tableY + 4;
    const headH = 8.5;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, headY, contentW, headH, 'FD');

    const cols = {
      no: margin + 3,
      title: margin + 13,
      date: margin + 158,
      views: margin + 194,
      likes: margin + 220,
      vph: margin + 247,
      eng: margin + contentW - 3,
    };

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('NO', cols.no, headY + 5.7);
    doc.text('JUDUL VIDEO', cols.title, headY + 5.7);
    doc.text('RILIS', cols.date, headY + 5.7);
    doc.text('VIEWS', cols.views, headY + 5.7, { align: 'right' });
    doc.text('LIKES', cols.likes, headY + 5.7, { align: 'right' });
    doc.text('VIEWS/JAM', cols.vph, headY + 5.7, { align: 'right' });
    doc.text('ENGAGEMENT', cols.eng, headY + 5.7, { align: 'right' });

    const maxRows = Math.min(rankedVideos.length, Math.floor((pageH - 16 - (headY + headH)) / 9));
    const topVideos = rankedVideos.slice(0, Math.max(maxRows, 1));

    if (rankedVideos.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Belum ada video terlacak untuk channel ini.', margin + 4, headY + 16);
    } else {
      topVideos.forEach((v, idx) => {
        const ry = headY + headH + idx * 9;
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, ry, contentW, 9, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, ry + 9, margin + contentW, ry + 9);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(100, 116, 139);
        doc.text(String(idx + 1), cols.no, ry + 6);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(truncatePdfText(doc, v.title, 140), cols.title, ry + 6);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(toPdfText(formatDateShort(v.publishedAt)), cols.date, ry + 6);
        doc.text(toPdfText(formatNumber(v.views)), cols.views, ry + 6, { align: 'right' });
        doc.text(toPdfText(formatNumber(v.likes)), cols.likes, ry + 6, { align: 'right' });
        doc.text(toPdfText(formatNumber(v.viewsPerHour)), cols.vph, ry + 6, { align: 'right' });
        doc.text(toPdfText(`${v.engagementRatePct ?? 0}%`), cols.eng, ry + 6, { align: 'right' });
      });
    }

    // Footer Halaman 2
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Menampilkan ${topVideos.length} dari ${rankedVideos.length} video terlacak`,
      margin,
      pageH - 7
    );
    doc.text('Halaman 2 dari 2', pageW - margin, pageH - 7, { align: 'right' });

    const slug =
      (channel.title || `channel-${channelId}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `channel-${channelId}`;
    const filename = `${slug}-laporan-analisis-${state.historyRange || '30d'}.pdf`;

    doc.save(filename);
    showToast(`Laporan PDF ${filename} berhasil diunduh.`, 'success');
  } catch (err) {
    showToast(err.message || 'Gagal membuat laporan PDF.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// Perbandingan antar channel
async function loadCompareView() {
  const boxContainer = document.getElementById('compareCheckboxes');
  if (state.channels.length === 0) {
    boxContainer.innerHTML = '<span style="color:var(--text-muted)">Tambahkan channel terlebih dahulu.</span>';
    destroyChart('compare');
    document.getElementById('compareTableBody').innerHTML = '';
    return;
  }

  boxContainer.innerHTML = state.channels
    .map((ch) => {
      const checked = state.selectedCompareIds.has(ch.id) ? 'checked' : '';
      return `
        <label class="check-chip">
          <input type="checkbox" class="compare-checkbox" value="${ch.id}" ${checked} />
          <span>${escapeHtml(ch.title)}</span>
        </label>`;
    })
    .join('');

  const ids = [...state.selectedCompareIds].filter((id) =>
    state.channels.some((c) => c.id === id)
  );
  if (ids.length === 0) {
    state.lastCompareData = null;
    destroyChart('compare');
    document.getElementById('compareTableBody').innerHTML =
      '<tr><td colspan="5">Pilih minimal 1 channel di atas untuk dibandingkan.</td></tr>';
    return;
  }

  try {
    const data = await apiJson(`/api/compare?ids=${ids.join(',')}`);
    state.lastCompareData = data;
    renderCompareChart(data);
    renderCompareTable(data.channels || []);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderCompareChart(data) {
  const canvas = document.getElementById('compareChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const theme = getChartTheme();

  const key =
    state.compareMetric === 'views'
      ? 'viewPoints'
      : state.compareMetric === 'growthPct'
      ? 'growthPctPoints'
      : 'subscriberPoints';

  const channels = data.channels || [];
  const labels = data.dates || [];

  // Perbarui instance yang sudah ada untuk animasi transisi garis yang halus
  if (state.charts.compare && state.charts.compare.canvas === canvas) {
    const chart = state.charts.compare;
    chart.data.labels = labels;

    if (chart.data.datasets.length === channels.length) {
      channels.forEach((ch, idx) => {
        const ds = chart.data.datasets[idx];
        ds.label = ch.title;
        ds.data = ch[key];
        ds.borderColor = CHART_COLORS[idx % CHART_COLORS.length];
      });
    } else {
      chart.data.datasets = channels.map((ch, idx) => ({
        label: ch.title,
        data: ch[key],
        borderColor: CHART_COLORS[idx % CHART_COLORS.length],
        backgroundColor: 'transparent',
        tension: 0.25,
        borderWidth: 2.2,
        spanGaps: true,
      }));
    }

    chart.options.plugins.legend.labels.color = theme.textColor;
    chart.options.scales.x.ticks.color = theme.textColor;
    chart.options.scales.x.grid.color = theme.gridColor;
    chart.options.scales.y.ticks.color = theme.textColor;
    chart.options.scales.y.grid.color = theme.gridColor;

    chart.update();
    return;
  }

  destroyChart('compare');
  const datasets = channels.map((ch, idx) => ({
    label: ch.title,
    data: ch[key],
    borderColor: CHART_COLORS[idx % CHART_COLORS.length],
    backgroundColor: 'transparent',
    tension: 0.25,
    borderWidth: 2.2,
    spanGaps: true,
  }));

  state.charts.compare = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 600,
        easing: 'easeOutQuart',
      },
      transitions: {
        active: {
          animation: {
            duration: 300,
          },
        },
      },
      plugins: {
        legend: { labels: { color: theme.textColor } },
      },
      scales: {
        x: { ticks: { color: theme.textColor }, grid: { color: theme.gridColor } },
        y: {
          ticks: {
            color: theme.textColor,
            callback: (val) =>
              state.compareMetric === 'growthPct' ? `${val}%` : formatCompact(val),
          },
          grid: { color: theme.gridColor },
        },
      },
    },
  });
}

function renderCompareTable(channels) {
  const tbody = document.getElementById('compareTableBody');
  tbody.innerHTML = channels
    .map(
      (ch) => `
      <tr>
        <td><strong>${escapeHtml(ch.title)}</strong></td>
        <td class="num">${formatNumber(ch.currentSubscribers)}</td>
        <td class="num">${formatNumber(ch.currentViews)}</td>
        <td class="num">${formatNumber(ch.totalLikesTracked)}</td>
        <td class="num">${ch.dailySubscribers >= 0 ? '+' : ''}${formatNumber(ch.dailySubscribers)}</td>
      </tr>`
    )
    .join('');
}

// Tab Video & Sentimen Komentar
async function loadVideosView() {
  const filterId = document.getElementById('videosFilterChannel').value;
  await loadLatestVideos(filterId);
  renderAllVideosTable();
}

function renderCategoryCompareStrip(videos) {
  const strip = document.getElementById('categoryCompareStrip');
  if (!strip) return;

  if (!videos || videos.length === 0) {
    strip.classList.add('hidden');
    strip.innerHTML = '';
    return;
  }

  const accMap = new Map();
  for (const v of videos) {
    const cat = v.categoryName || 'Lainnya';
    const acc = accMap.get(cat) || {
      name: cat,
      count: 0,
      totalViews: 0,
      totalLikes: 0,
      totalVph: 0,
    };
    acc.count += 1;
    acc.totalViews += Number(v.views || 0);
    acc.totalLikes += Number(v.likes || 0);
    acc.totalVph += Number(v.viewsPerHour || 0);
    accMap.set(cat, acc);
  }

  const summaries = [...accMap.values()]
    .map((c) => ({
      name: c.name,
      count: c.count,
      avgViews: Math.round(c.totalViews / c.count),
      avgLikes: Math.round(c.totalLikes / c.count),
      avgVph: Number((c.totalVph / c.count).toFixed(1)),
    }))
    .sort((a, b) => b.avgVph - a.avgVph);

  if (summaries.length === 0) {
    strip.classList.add('hidden');
    strip.innerHTML = '';
    return;
  }

  strip.classList.remove('hidden');
  strip.innerHTML = summaries
    .map((item) => {
      const isActive = state.allVideosCategoryFilter === item.name;
      return `
        <button
          type="button"
          class="category-stat-card${isActive ? ' active' : ''}"
          data-category-chip="${escapeHtml(item.name)}"
          title="Klik untuk memfilter kategori ${escapeHtml(item.name)}"
        >
          <div class="category-stat-head">
            <span class="category-stat-name">${escapeHtml(item.name)}</span>
            <span class="category-stat-count">${item.count} video</span>
          </div>
          <div class="category-stat-vph">${formatNumber(item.avgVph)} views/jam</div>
          <div class="category-stat-meta">Rata-rata ${formatCompact(item.avgViews)} views · ${formatCompact(
        item.avgLikes
      )} likes</div>
        </button>`;
    })
    .join('');
}

function renderAllVideosTable() {
  const tbody = document.getElementById('allVideosTableBody');
  const subtitle = document.getElementById('allVideosSubtitle');
  const sorted = [...state.latestVideos].sort((a, b) => b.viewsPerHour - a.viewsPerHour);

  if (sorted.length === 0) {
    renderCategoryCompareStrip([]);
    if (subtitle) {
      subtitle.textContent = 'Centang video untuk dibandingkan sentimen komentarnya';
    }
    tbody.innerHTML = '<tr><td colspan="9">Belum ada video terlacak.</td></tr>';
    return;
  }

  // Fallback rata-rata per channel jika backend belum mengirim channelAvgViewsPerHour
  const fallbackAvgMap = new Map();
  for (const v of sorted) {
    const acc = fallbackAvgMap.get(v.channelId) || { sum: 0, count: 0 };
    acc.sum += Number(v.viewsPerHour || 0);
    acc.count += 1;
    fallbackAvgMap.set(v.channelId, acc);
  }

  // Tampilkan perbandingan antar kategori sebelum penyaringan kategori tunggal
  const viralAndQueryVideos = sorted.filter((v) => {
    if (state.allVideoFilter === 'viral') {
      const acc = fallbackAvgMap.get(v.channelId);
      const fallbackAvg = acc && acc.count > 0 ? acc.sum / acc.count : 0;
      const channelAvg = Number(v.channelAvgViewsPerHour ?? fallbackAvg);
      if (Number(v.viewsPerHour || 0) < channelAvg) return false;
    }
    const query = state.allVideosSearchQuery.trim().toLowerCase();
    if (!query) return true;
    const title = String(v.title || '').toLowerCase();
    const channelTitle = String(v.channelTitle || '').toLowerCase();
    const catName = String(v.categoryName || '').toLowerCase();
    return title.includes(query) || channelTitle.includes(query) || catName.includes(query);
  });

  renderCategoryCompareStrip(viralAndQueryVideos);

  const selectedCategory = state.allVideosCategoryFilter;
  const visibleVideos = selectedCategory
    ? viralAndQueryVideos.filter((v) => (v.categoryName || 'Lainnya') === selectedCategory)
    : viralAndQueryVideos;

  const query = state.allVideosSearchQuery.trim().toLowerCase();
  if (subtitle) {
    const parts = [];
    if (selectedCategory) parts.push(`Kategori ${selectedCategory}`);
    if (state.allVideoFilter === 'viral') parts.push('Video Viral');
    if (query) parts.push(`kata kunci "${state.allVideosSearchQuery.trim()}"`);

    if (parts.length > 0) {
      subtitle.textContent = `Menampilkan ${visibleVideos.length} dari ${sorted.length} video (${parts.join(
        ' · '
      )})`;
    } else {
      subtitle.textContent = 'Centang video untuk dibandingkan sentimen komentarnya';
    }
  }

  if (visibleVideos.length === 0) {
    const reasonParts = [];
    if (selectedCategory) reasonParts.push(`kategori "${escapeHtml(selectedCategory)}"`);
    if (query) reasonParts.push(`kata kunci "${escapeHtml(state.allVideosSearchQuery.trim())}"`);
    if (state.allVideoFilter === 'viral') reasonParts.push('filter Video Viral');
    tbody.innerHTML =
      reasonParts.length > 0
        ? `<tr><td colspan="9">Tidak ada video yang cocok untuk ${reasonParts.join(' dan ')}.</td></tr>`
        : '<tr><td colspan="9">Tidak ada video terlacak saat ini.</td></tr>';
    return;
  }

  tbody.innerHTML = visibleVideos
    .map((v) => {
      const checked = state.selectedSentimentVideoIds.has(v.id) ? 'checked' : '';
      const sentimentText = v.sentiment
        ? `${v.sentiment.sentimentScore >= 0 ? '+' : ''}${v.sentiment.sentimentScore}`
        : 'Belum dianalisis';
      const categoryLabel = v.categoryName || 'Lainnya';

      return `
      <tr>
        <td class="col-check">
          <input type="checkbox" class="sentiment-video-check" value="${v.id}" ${checked} aria-label="Pilih ${escapeHtml(v.title)}" />
        </td>
        <td>
          <a class="table-video-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(v.title)}
          </a>
          <div style="font-size:12px;color:var(--text-muted)">${timeAgo(v.publishedAt)}</div>
        </td>
        <td>${escapeHtml(v.channelTitle)}</td>
        <td>${escapeHtml(categoryLabel)}</td>
        <td class="num">${formatNumber(v.views)}</td>
        <td class="num">${formatNumber(v.likes)}</td>
        <td class="num">${formatNumber(v.commentsCount)}</td>
        <td class="num">${formatNumber(v.viewsPerHour)}</td>
        <td class="num">${escapeHtml(sentimentText)}</td>
      </tr>`;
    })
    .join('');

  document.getElementById('selectedVideoCount').textContent = String(
    state.selectedSentimentVideoIds.size
  );
}

async function runSentimentComparison(forceRefresh = false) {
  const ids = [...state.selectedSentimentVideoIds];
  if (ids.length === 0) {
    showToast('Centang minimal 1 video pada tabel di bawah untuk menganalisis sentimen.', 'error');
    return;
  }

  const btn = document.getElementById('compareSentimentBtn');
  btn.disabled = true;
  btn.textContent = 'Menganalisis komentar...';

  try {
    const data = await apiJson(
      `/api/videos/sentiment/compare?ids=${ids.join(',')}&refresh=${forceRefresh}`
    );

    if (data.warnings && data.warnings.length > 0) {
      data.warnings.forEach((w) => showToast(`${w.title}: ${w.message}`, 'error'));
    }

    const comparisons = data.comparisons || [];
    if (comparisons.length === 0) return;

    document.getElementById('sentimentResultArea').classList.remove('hidden');
    renderSentimentChart(comparisons);
    renderSentimentCards(comparisons);

    // Tampilkan langsung tren mingguan untuk video pertama yang dibandingkan
    if (comparisons[0]?.videoId) {
      state.selectedTrendVideoId = comparisons[0].videoId;
      populateTrendVideoSelect();
      renderSentimentTrendChart({
        video: {
          id: comparisons[0].videoId,
          title: comparisons[0].title,
          publishedAt: comparisons[0].publishedAt,
        },
        totalAnalyzed: comparisons[0].totalAnalyzed,
        weeklyTrend: comparisons[0].weeklyTrend || [],
      });
    }

    await loadLatestVideos(document.getElementById('videosFilterChannel').value);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Bandingkan Sentimen (<span id="selectedVideoCount">${state.selectedSentimentVideoIds.size}</span>)`;
  }
}

function renderSentimentChart(comparisons) {
  destroyChart('sentiment');
  const ctx = document.getElementById('sentimentCompareChart').getContext('2d');
  const theme = getChartTheme();

  const labels = comparisons.map((c) =>
    c.title.length > 34 ? `${c.title.slice(0, 34)}...` : c.title
  );

  state.charts.sentiment = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Positif (%)',
          data: comparisons.map((c) => c.positivePct),
          backgroundColor: '#16a34a',
        },
        {
          label: 'Netral (%)',
          data: comparisons.map((c) => c.neutralPct),
          backgroundColor: '#94a3b8',
        },
        {
          label: 'Negatif (%)',
          data: comparisons.map((c) => c.negativePct),
          backgroundColor: '#dc2626',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: theme.textColor } } },
      scales: {
        x: { stacked: true, ticks: { color: theme.textColor }, grid: { display: false } },
        y: {
          stacked: true,
          max: 100,
          ticks: { color: theme.textColor, callback: (v) => `${v}%` },
          grid: { color: theme.gridColor },
        },
      },
    },
  });
}

function renderSentimentCards(comparisons) {
  const grid = document.getElementById('sentimentCardsGrid');
  grid.innerHTML = comparisons
    .map((c) => {
      const samplesHtml =
        c.samples && c.samples.length > 0
          ? c.samples
              .map(
                (s) => `
                <div class="sample-comment">
                  <span class="sample-label-${s.label}">[${s.label.toUpperCase()}]</span>
                  ${escapeHtml(s.text)}
                </div>`
              )
              .join('')
          : '<div class="sample-comment">Tidak ada teks komentar yang tersedia.</div>';

      return `
        <div class="sentiment-card">
          <div class="sentiment-card-title">${escapeHtml(c.title)}</div>
          <div class="sentiment-card-meta">
            Skor bersih: <strong class="font-mono">${c.sentimentScore >= 0 ? '+' : ''}${
        c.sentimentScore
      }</strong> · ${c.totalAnalyzed} komentar dianalisis · ${c.positivePct}% Positif / ${
        c.neutralPct
      }% Netral / ${c.negativePct}% Negatif
          </div>
          <div class="sentiment-samples">${samplesHtml}</div>
        </div>`;
    })
    .join('');
}

// Muat dan gambar grafik garis tren sentimen komentar mingguan setelah video rilis
async function loadSentimentTrend(videoId, forceRefresh = false) {
  const id = Number(videoId);
  if (!id) {
    showToast('Pilih video terlebih dahulu untuk melihat tren sentimen mingguan.', 'error');
    return;
  }

  const btn = document.getElementById('loadSentimentTrendBtn');
  btn.disabled = true;
  btn.textContent = 'Memuat...';

  try {
    const payload = await apiJson(`/api/videos/${id}/sentiment-trend?refresh=${forceRefresh}`);
    renderSentimentTrendChart(payload);
    await loadLatestVideos(document.getElementById('videosFilterChannel').value);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Muat Tren';
  }
}

function renderSentimentTrendChart(payload) {
  state.lastTrendPayload = payload;
  const trend = payload?.weeklyTrend || [];
  const emptyEl = document.getElementById('sentimentTrendEmpty');
  const wrapEl = document.getElementById('sentimentTrendChartWrap');
  const summaryEl = document.getElementById('sentimentTrendSummary');

  if (trend.length === 0) {
    destroyChart('sentimentTrend');
    wrapEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    emptyEl.textContent =
      'Belum ada komentar bertanggal yang dapat dikelompokkan per minggu untuk video ini.';
    summaryEl.textContent = payload?.video?.title || 'Tidak ada data komentar';
    return;
  }

  emptyEl.classList.add('hidden');
  wrapEl.classList.remove('hidden');

  const first = trend[0];
  const last = trend[trend.length - 1];
  const deltaScore = Number((last.sentimentScore - first.sentimentScore).toFixed(1));
  const deltaText =
    trend.length > 1
      ? ` · Perubahan ${first.label} (${first.sentimentScore >= 0 ? '+' : ''}${first.sentimentScore}) → ${last.label} (${last.sentimentScore >= 0 ? '+' : ''}${last.sentimentScore}): ${deltaScore >= 0 ? '+' : ''}${deltaScore} poin`
      : ` · Skor ${first.label}: ${first.sentimentScore >= 0 ? '+' : ''}${first.sentimentScore}`;

  summaryEl.textContent = `${payload?.video?.title || ''} · ${payload?.totalAnalyzed || 0} komentar dianalisis${deltaText}`;

  destroyChart('sentimentTrend');
  const ctx = document.getElementById('sentimentTrendChart').getContext('2d');
  const theme = getChartTheme();

  const labels = trend.map((w) => `${w.label} (${w.dateRange})`);
  const isScoreMode = state.sentimentTrendMetric === 'score';

  const datasets = isScoreMode
    ? [
        {
          label: 'Skor Sentimen (-100 s/d +100)',
          data: trend.map((w) => w.sentimentScore),
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.12)',
          fill: true,
          tension: 0.28,
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: trend.map((w) =>
            w.sentimentScore > 0 ? '#16a34a' : w.sentimentScore < 0 ? '#dc2626' : '#64748b'
          ),
        },
      ]
    : [
        {
          label: 'Positif (%)',
          data: trend.map((w) => w.positivePct),
          borderColor: '#16a34a',
          backgroundColor: 'rgba(22, 163, 74, 0.08)',
          fill: false,
          tension: 0.28,
          borderWidth: 2.2,
          pointRadius: 4,
        },
        {
          label: 'Netral (%)',
          data: trend.map((w) => w.neutralPct),
          borderColor: '#64748b',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.28,
          borderWidth: 2,
          pointRadius: 3.5,
        },
        {
          label: 'Negatif (%)',
          data: trend.map((w) => w.negativePct),
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220, 38, 38, 0.08)',
          fill: false,
          tension: 0.28,
          borderWidth: 2.2,
          pointRadius: 4,
        },
      ];

  state.charts.sentimentTrend = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.textColor } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items?.[0]?.dataIndex;
              if (idx === undefined || !trend[idx]) return '';
              const w = trend[idx];
              return `Total komentar minggu ini: ${w.totalComments} (${w.positiveCount} pos · ${w.neutralCount} net · ${w.negativeCount} neg)`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: theme.textColor },
          grid: { color: theme.gridColor },
        },
        y: {
          min: isScoreMode ? -100 : 0,
          max: 100,
          ticks: {
            color: theme.textColor,
            callback: (val) => (isScoreMode ? val : `${val}%`),
          },
          grid: { color: theme.gridColor },
        },
      },
    },
  });
}

// Notifikasi website & browser
async function loadNotifications(triggerBrowserAlert = false) {
  try {
    const data = await apiJson('/api/notifications');
    state.notifications = data.notifications || [];
    state.unreadCount = Number(data.unreadCount || 0);

    const badge = document.getElementById('notifBadge');
    badge.textContent = state.unreadCount > 99 ? '99+' : String(state.unreadCount);
    badge.classList.toggle('hidden', state.unreadCount === 0);

    const list = document.getElementById('notifList');
    if (state.notifications.length === 0) {
      list.innerHTML = '<div class="notif-item"><div class="notif-item-msg">Belum ada notifikasi.</div></div>';
    } else {
      list.innerHTML = state.notifications
        .map(
          (n) => `
          <div class="notif-item ${n.is_read ? '' : 'unread'}" data-notif-id="${n.id}">
            <div class="notif-item-title">${escapeHtml(n.title)}</div>
            <div class="notif-item-msg">${
              n.link_url
                ? `<a href="${escapeHtml(n.link_url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">${escapeHtml(n.message)}</a>`
                : escapeHtml(n.message)
            }</div>
            <div class="notif-item-time">${timeAgo(n.created_at)}</div>
          </div>`
        )
        .join('');
    }

    // Kirim notifikasi browser untuk entri baru yang belum pernah tampil
    if (state.notifications.length > 0) {
      const newestId = state.notifications[0].id;
      if (
        triggerBrowserAlert &&
        newestId > state.lastSeenNotifId &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        const freshUnread = state.notifications.filter(
          (n) => !n.is_read && n.id > state.lastSeenNotifId
        );
        freshUnread.slice(0, 3).forEach((n) => {
          new Notification(n.title, { body: n.message });
        });
      }
      state.lastSeenNotifId = Math.max(state.lastSeenNotifId, newestId);
      localStorage.setItem('yt_last_notif_id', String(state.lastSeenNotifId));
    }
  } catch (err) {
    console.error(err);
  }
}

// Inisialisasi seluruh event listener
function bindEvents() {
  // Navigasi sidebar
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.querySelectorAll('[data-jump]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.jump));
  });

  // Drawer mobile
  document.getElementById('menuToggleBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarBackdrop').classList.toggle('open');
  });
  document.getElementById('sidebarBackdrop').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('open');
  });

  // Mode Gelap / Terang
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const currentlyDark = document.documentElement.classList.contains('dark');
    applyTheme(!currentlyDark);
    if (state.activeView === 'analytics') loadChannelAnalyticsView();
    if (state.activeView === 'compare') loadCompareView();
    if (state.activeView === 'videos' && state.lastTrendPayload) {
      renderSentimentTrendChart(state.lastTrendPayload);
    }
  });

  // Tambah channel
  document.getElementById('addChannelForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputEl = document.getElementById('channelInput');
    const targetEl = document.getElementById('targetInput');
    const btn = document.getElementById('addChannelBtn');

    btn.disabled = true;
    btn.textContent = 'Menambahkan...';
    try {
      const res = await apiJson('/api/channels', {
        method: 'POST',
        body: JSON.stringify({
          input: inputEl.value.trim(),
          subscriberTarget: Number(targetEl.value || 0),
        }),
      });
      showToast(res.message || 'Channel berhasil ditambahkan.', 'success');
      inputEl.value = '';
      targetEl.value = '';
      await Promise.all([loadChannels(), loadLatestVideos()]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Tambah Channel';
    }
  });

  // Aksi kartu channel (Analisis / Hapus 2 langkah)
  document.getElementById('channelsGrid').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === 'analyze') {
      state.selectedChannelId = id;
      populateChannelSelectors();
      switchView('analytics');
    } else if (action === 'delete') {
      if (state.pendingDeleteId !== id) {
        state.pendingDeleteId = id;
        renderChannelsGrid();
        setTimeout(() => {
          if (state.pendingDeleteId === id) {
            state.pendingDeleteId = null;
            renderChannelsGrid();
          }
        }, 4000);
        return;
      }

      try {
        const res = await apiJson(`/api/channels/${id}`, { method: 'DELETE' });
        state.pendingDeleteId = null;
        state.selectedCompareIds.delete(id);
        showToast(res.message || 'Channel dihapus.', 'success');
        await Promise.all([loadChannels(), loadLatestVideos()]);
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  // Kontrol Analisis Channel
  document.getElementById('analyticsChannelSelect').addEventListener('change', (e) => {
    state.selectedChannelId = Number(e.target.value);
    loadChannelAnalyticsView();
  });

  document.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.historyRange = btn.dataset.range;
      document
        .querySelectorAll('[data-range]')
        .forEach((b) => b.classList.toggle('active', b === btn));
      loadChannelAnalyticsView();
    });
  });

  document.querySelectorAll('[data-history-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.historyMetric = btn.dataset.historyMetric;
      document
        .querySelectorAll('[data-history-metric]')
        .forEach((b) => b.classList.toggle('active', b === btn));

      if (
        state.lastAnalyticsPayload &&
        state.lastAnalyticsPayload.channelId === state.selectedChannelId &&
        state.lastAnalyticsPayload.range === state.historyRange
      ) {
        state.lastAnalyticsPayload.historyMetric = state.historyMetric;
        renderHistoryChart(
          state.lastAnalyticsPayload.history?.snapshots || [],
          state.lastAnalyticsPayload.history?.spikes || []
        );
      } else {
        loadChannelAnalyticsView();
      }
    });
  });

  // Toggle metrik & interaksi sel Heatmap Aktivitas Penonton
  document.querySelectorAll('[data-heatmap-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.heatmapMetric = btn.dataset.heatmapMetric;
      document
        .querySelectorAll('[data-heatmap-metric]')
        .forEach((b) => b.classList.toggle('active', b === btn));
      if (state.lastHeatmapPayload) {
        renderAudienceHeatmap(
          state.lastHeatmapPayload.weeklyHeatmap,
          state.lastHeatmapPayload.bestUploadSlots
        );
      }
    });
  });

  const heatmapContainer = document.getElementById('audienceHeatmapContainer');
  const updateHeatmapDetail = (e) => {
    const cell = e.target.closest('.heatmap-cell');
    if (!cell) return;
    const detailEl = document.getElementById('heatmapCellDetail');
    if (!detailEl) return;
    const count = Number(cell.dataset.videoCount || 0);
    if (count === 0) {
      detailEl.textContent = `${cell.dataset.dayLabel} ${cell.dataset.hourLabel} WIB · Belum ada video diupload pada slot ini`;
    } else {
      detailEl.textContent = `${cell.dataset.dayLabel} ${cell.dataset.hourLabel} WIB · ${count} video · ${formatNumber(
        Number(cell.dataset.avgVph || 0)
      )} views/jam · ${cell.dataset.avgEng || 0}% eng.`;
    }
  };
  heatmapContainer.addEventListener('mouseover', updateHeatmapDetail);
  heatmapContainer.addEventListener('click', updateHeatmapDetail);
  heatmapContainer.addEventListener('focusin', updateHeatmapDetail);

  document.getElementById('updateTargetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.selectedChannelId) return;
    const val = Number(document.getElementById('editTargetInput').value || 0);
    try {
      await apiJson(`/api/channels/${state.selectedChannelId}/target`, {
        method: 'PATCH',
        body: JSON.stringify({ subscriberTarget: val }),
      });
      showToast('Target subscriber diperbarui.', 'success');
      await Promise.all([loadChannels(), loadChannelAnalyticsView()]);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('exportCsvBtn').addEventListener('click', async () => {
    const channelId = Number(
      document.getElementById('analyticsChannelSelect').value || state.selectedChannelId
    );
    if (!channelId) {
      showToast('Pilih channel terlebih dahulu untuk mengekspor CSV.', 'error');
      return;
    }

    const btn = document.getElementById('exportCsvBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Menyiapkan CSV...';

    try {
      const url = `/api/export/${channelId}.csv?range=${encodeURIComponent(state.historyRange || 'all')}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Gagal mengunduh CSV (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const nameMatch = disposition.match(/filename="([^"]+)"/i);
      const selectedChannel = state.channels.find((c) => c.id === channelId);
      const fallbackSlug =
        (selectedChannel?.title || `channel-${channelId}`)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || `channel-${channelId}`;
      const filename = nameMatch ? nameMatch[1] : `${fallbackSlug}-analytics.csv`;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);

      showToast(`File ${filename} berhasil diunduh.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  document.getElementById('exportPdfBtn').addEventListener('click', async () => {
    await generateAnalyticsPdfReport();
  });

  // Kontrol Perbandingan Channel
  document.getElementById('compareCheckboxes').addEventListener('change', (e) => {
    const cb = e.target.closest('.compare-checkbox');
    if (!cb) return;
    const id = Number(cb.value);
    if (cb.checked) state.selectedCompareIds.add(id);
    else state.selectedCompareIds.delete(id);
    loadCompareView();
  });

  document.querySelectorAll('[data-compare-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.compareMetric = btn.dataset.compareMetric;
      document
        .querySelectorAll('[data-compare-metric]')
        .forEach((b) => b.classList.toggle('active', b === btn));

      if (state.lastCompareData) {
        renderCompareChart(state.lastCompareData);
      } else {
        loadCompareView();
      }
    });
  });

  // Pencarian Real-Time Channel & Video
  document.getElementById('channelSearchInput').addEventListener('input', (e) => {
    state.channelSearchQuery = e.target.value;
    renderChannelsGrid();
  });

  document.getElementById('channelVideosSearchInput').addEventListener('input', (e) => {
    state.channelVideosSearchQuery = e.target.value;
    renderChannelVideosTable(state.lastChannelVideos, state.lastChannelAvgViewsPerHour);
  });

  document.getElementById('allVideosSearchInput').addEventListener('input', (e) => {
    state.allVideosSearchQuery = e.target.value;
    renderAllVideosTable();
  });

  // Kontrol Video & Sentimen
  document.getElementById('videosFilterChannel').addEventListener('change', () => {
    loadVideosView();
  });

  document.getElementById('videosFilterCategory').addEventListener('change', (e) => {
    state.allVideosCategoryFilter = e.target.value;
    renderAllVideosTable();
  });

  document.getElementById('categoryCompareStrip').addEventListener('click', (e) => {
    const card = e.target.closest('[data-category-chip]');
    if (!card) return;
    const cat = card.dataset.categoryChip;
    state.allVideosCategoryFilter = state.allVideosCategoryFilter === cat ? '' : cat;
    document.getElementById('videosFilterCategory').value = state.allVideosCategoryFilter;
    renderAllVideosTable();
  });

  document.querySelectorAll('[data-all-video-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.allVideoFilter = btn.dataset.allVideoFilter;
      document
        .querySelectorAll('[data-all-video-filter]')
        .forEach((b) => b.classList.toggle('active', b === btn));
      renderAllVideosTable();
    });
  });

  document.querySelectorAll('[data-channel-video-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.channelVideoFilter = btn.dataset.channelVideoFilter;
      document
        .querySelectorAll('[data-channel-video-filter]')
        .forEach((b) => b.classList.toggle('active', b === btn));
      renderChannelVideosTable(state.lastChannelVideos, state.lastChannelAvgViewsPerHour);
    });
  });

  document.getElementById('allVideosTableBody').addEventListener('change', (e) => {
    const cb = e.target.closest('.sentiment-video-check');
    if (!cb) return;
    const id = Number(cb.value);
    if (cb.checked) {
      if (state.selectedSentimentVideoIds.size >= 6) {
        cb.checked = false;
        showToast('Maksimal 6 video untuk perbandingan sentimen.', 'error');
        return;
      }
      state.selectedSentimentVideoIds.add(id);
    } else {
      state.selectedSentimentVideoIds.delete(id);
    }
    document.getElementById('selectedVideoCount').textContent = String(
      state.selectedSentimentVideoIds.size
    );
  });

  document.getElementById('compareSentimentBtn').addEventListener('click', () => {
    runSentimentComparison(false);
  });
  document.getElementById('refreshSentimentBtn').addEventListener('click', () => {
    runSentimentComparison(true);
  });

  document.getElementById('sentimentTrendVideoSelect').addEventListener('change', (e) => {
    state.selectedTrendVideoId = Number(e.target.value) || null;
  });

  document.getElementById('loadSentimentTrendBtn').addEventListener('click', () => {
    const selVal = document.getElementById('sentimentTrendVideoSelect').value;
    loadSentimentTrend(selVal, false);
  });

  document.querySelectorAll('[data-trend-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sentimentTrendMetric = btn.dataset.trendMetric;
      document
        .querySelectorAll('[data-trend-metric]')
        .forEach((b) => b.classList.toggle('active', b === btn));
      if (state.lastTrendPayload) {
        renderSentimentTrendChart(state.lastTrendPayload);
      }
    });
  });

  // Tombol Cek Sekarang
  document.getElementById('checkNowBtn').addEventListener('click', async () => {
    const btn = document.getElementById('checkNowBtn');
    btn.disabled = true;
    const span = btn.querySelector('span');
    span.textContent = 'Mengecek...';
    try {
      const res = await apiJson('/api/check-now', { method: 'POST' });
      const sum = res.summary || {};
      showToast(
        res.message +
          (sum.channelsChecked !== undefined
            ? ` (${sum.channelsChecked} channel, ${sum.newVideos || 0} video baru)`
            : ''),
        'success'
      );
      await Promise.all([
        loadChannels(),
        loadLatestVideos(),
        loadNotifications(true),
        loadStatusAndLogs(),
      ]);
      if (state.activeView === 'analytics') loadChannelAnalyticsView();
      if (state.activeView === 'compare') loadCompareView();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      span.textContent = 'Cek Sekarang';
    }
  });

  // Notifikasi Dropdown & Browser Notification
  const notifBtn = document.getElementById('notifBtn');
  const notifDropdown = document.getElementById('notifDropdown');

  notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = notifDropdown.classList.contains('hidden');
    notifDropdown.classList.toggle('hidden', !isHidden);
    notifBtn.setAttribute('aria-expanded', String(isHidden));
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrapper')) {
      notifDropdown.classList.add('hidden');
      notifBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('markAllReadBtn').addEventListener('click', async () => {
    await apiJson('/api/notifications/all/read', { method: 'PATCH' });
    await loadNotifications(false);
  });

  document.getElementById('browserNotifBtn').addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Browser ini tidak mendukung Web Notification API.', 'error');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      showToast('Notifikasi browser aktif.', 'success');
    } else {
      showToast('Izin notifikasi browser ditolak.', 'error');
    }
  });

  document.getElementById('notifList').addEventListener('click', async (e) => {
    const item = e.target.closest('.notif-item[data-notif-id]');
    if (!item) return;
    const id = item.dataset.notifId;
    await apiJson(`/api/notifications/${id}/read`, { method: 'PATCH' });
    await loadNotifications(false);
  });

  document.getElementById('refreshLogsBtn').addEventListener('click', () => {
    loadStatusAndLogs();
  });
}

// Bootstrap aplikasi saat DOM siap
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  bindEvents();
  await Promise.all([
    loadStatusAndLogs(),
    loadChannels(),
    loadLatestVideos(),
    loadNotifications(false),
  ]);

  // Polling ringan notifikasi & data setiap 60 detik agar perubahan cron terlihat otomatis
  setInterval(() => {
    loadNotifications(true);
    loadChannels();
    loadLatestVideos();
  }, 60000);
});
