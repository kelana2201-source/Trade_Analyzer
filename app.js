/* Extracted App Logic */


// ═══════════════════════════════════════════════════════════
//  STATE & CONFIGURATION (V5.6 SMART AUTO-FLUSH - REVIEWED)
// ═══════════════════════════════════════════════════════════
const GOLD_SYMBOL = 'OANDA:XAUUSD';
const SYMBOL_CONFIG = {
  [GOLD_SYMBOL]: { display: 'XAUUSD', initial: 4087.60, decimals: 2, tv: 'OANDA:XAUUSD', type: 'gold' }
};

const CHART_FEED_FALLBACKS = {
  [GOLD_SYMBOL]: ['FX_IDC:XAUUSD', 'FOREXCOM:XAUUSD', 'OANDA:XAUUSD', 'TVC:GOLD']
};

const GOLD_PLAN = {
  entryOffset: 4.50,
  slDistance: 8.00,
  tp1Distance: 12.00,
  tp2Distance: 25.00,
  tp3Distance: 45.00,
  contractSize: 100,
  minLot: 0.01,
  maxLot: 5.00,
  autoRenewDistance: 12.00,
  autoRenewConfirmations: 2,
  breakoutStrength: 65,
  breakoutMomentumPct: 0.035,
  breakEvenTrigger: 8.00,
  atrPeriod: 14,
  atrSlMult: 1.0,
  atrTp1Mult: 1.5,
  atrTp2Mult: 3.0,
  atrTp3Mult: 5.5,
  atrEntryMult: 0.45,
  atrFloor: 4.0,
  atrCeil: 40.0
};

const UI_DEBOUNCE_MS = 500; // [FIX] Diperbesar dari 220 agar UI rendering lebih efisien pada data tick volatilitas tinggi
const CALENDAR_CACHE_KEY = 'aiTradingCalendarCache.v1';
const CALENDAR_CACHE_TTL_MS = 10 * 60 * 1000;
const OHLC_CACHE = { M15: [], H1: [], H4: [], D1: [], updatedAt: 0 };




const MIN_TREND_SAMPLES = 12;
const SIDEWAYS_RANGE_PCT = 0.035; // percentage of price, not fixed dollars
// CLEAN-125: simulasi harga dinonaktifkan permanen — offline = tidak ada sinyal.

// Forex/gold spot market tutup dari Jumat ~21:00 UTC sampai Minggu ~21:00 UTC (buka lagi bareng sesi Sydney).
// Dipakai bersama oleh assessTradingReadiness() (blokir entry) dan Session Monitor (status OPEN/CLOSED per sesi).
function isForexMarketOpen(now = new Date()) {
  const day = now.getUTCDay(); // 0=Minggu, 5=Jumat, 6=Sabtu
  const hour = now.getUTCHours();
  if (day === 6) return false; // Sabtu: tutup penuh
  if (day === 0 && hour < 21) return false; // Minggu sebelum jam 21:00 UTC: masih tutup
  if (day === 5 && hour >= 21) return false; // Jumat setelah jam 21:00 UTC: sudah tutup
  return true;
}
function getMarketReopenInfo(now = new Date()) {
  // Estimasi kapan buka lagi: Minggu jam 21:00 UTC (Sydney open).
  const reopen = new Date(now);
  const day = now.getUTCDay();
  let daysToAdd = (7 - day) % 7; // menuju Minggu berikutnya
  if (day === 0 && now.getUTCHours() < 21) daysToAdd = 0; // sudah hari Minggu, tinggal tunggu jam 21:00
  reopen.setUTCDate(now.getUTCDate() + daysToAdd);
  reopen.setUTCHours(21, 0, 0, 0);
  if (reopen.getTime() <= now.getTime()) reopen.setUTCDate(reopen.getUTCDate() + 7);
  return reopen;
}

const CALENDAR_SOURCES = [
  {
    name: 'ForexFactory CDN',
    url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    parser: 'forexFactory'
  },
  {
    name: 'TradingEconomics Guest',
    url: 'https://api.tradingeconomics.com/calendar?c=guest:guest&f=json',
    parser: 'tradingEconomics'
  }
];

// SECURITY (CLEAN-125): jangan hardcode secret di sisi klien.
// Biarkan kosong secara default — isi URL + token Sheets Anda sendiri di Settings.
const GOOGLE_SHEETS_WEBHOOK_URL = '';
const GOOGLE_SHEETS_TOKEN = '';

const STORAGE_KEYS = {
  settings: 'aiTradingEnterpriseSettings.v1',
  journal: 'aiTradingJournalHistory.v1',
  backup: 'aiTradingJournalBackup.v1',
  stats: 'aiTradingDailyStats.v1',
  lockedPlan: 'aiTradingLockedPlanState.v1'
};
const STRATEGY_PRESETS = {
  scalping: { weights: { structure: 35, supplyDemand: 25, trend: 15, candlestick: 25 }, minConfidenceScore: 55 },
  intraday: { weights: { structure: 40, supplyDemand: 30, trend: 20, candlestick: 10 }, minConfidenceScore: 60 },
  swing:    { weights: { structure: 45, supplyDemand: 30, trend: 20, candlestick: 5  }, minConfidenceScore: 70 }
};

const DEFAULT_SETTINGS = {
  sheetsUrl: GOOGLE_SHEETS_WEBHOOK_URL,
  sheetsToken: GOOGLE_SHEETS_TOKEN,
  telegramToken: '',
  telegramChatId: '',
  riskDefault: 1,
  theme: 'institutional-dark',
  timezone: 'Asia/Jakarta',
  broker: 'Manual / Broker',
  apiMode: 'auto',
  notifyBrowser: true,
  notifySound: true,
  notifyTelegramOnLock: true,
  useWs: true,
  proxyBaseUrl: 'https://xau-proxy.kelana2201.workers.dev',
  strategyPreset: 'intraday',
  entryScoreWeights: { ...STRATEGY_PRESETS.intraday.weights },
  minConfidenceScore: STRATEGY_PRESETS.intraday.minConfidenceScore
};


let currentSymbol = GOLD_SYMBOL;
let currentRes = '15';
let chartFeedIndex = 0;
let chartMode = 'tradingview';
let lastWsPrice = SYMBOL_CONFIG[currentSymbol].initial;
let connected = false;
let livePriceInterval = null;
let lockedEntryPrice = null;
let lockedSL = null;
let lockedTradeSide = 'WAIT';
let lockedOrderType = 'NO TRADE';
let lockedTrendSnapshot = null;
let autoRenewAwayCount = 0;
let internalChartFrame = null;
let tradingViewLoadWarned = false;
let recentPrices = [];
let lastPctChange = 0;
let highImpactNewsDetected = false;
let highImpactNewsLabel = '';
let newsRiskUnknown = false;
let currentPlanDecision = null;
let lastEntryScoreAnalysis = null;
let entryTriggered = false;      // true begitu harga pertama kali menyentuh zona entry plan yang sedang terkunci
let entryTouchLog = [];          // riwayat tiap kali harga masuk zona entry: [{index, price, time}]
let entryZoneInsidePrev = false; // dipakai buat anti-spam: cegah 1 sentuhan dihitung berkali-kali saat harga cuma gonjang-ganjing tipis
let deferredPwaPrompt = null;
let appSettings = null;
let lastApiResponseMs = 0;
let lastDataSource = 'offline';
let usingSimulatedPrice = true;
let livePriceVerified = false;
let liveOfflineLogged = false;
let lastPriceLogMs = 0;
let lastLatencyMs = 0;
let calendarCountdownTimer = null;
let calendarApiOnline = false;
let calendarSourceName = 'Not checked';
let calendarLastUpdatedAt = null;
let calendarManualOverride = false; // false: high-impact TERVERIFIKASI menahan entry. ON = admin tanggung risiko news.
let nextCalendarEvent = null;
let calendarValidated = false;          // TRUE hanya jika API kalender berhasil & terverifikasi
let calendarStatus = 'not_checked';     // not_checked | verified | updating | unavailable | high_impact
let calendarRetryCount = 0;             // jumlah kegagalan sejak sukses terakhir
let nextHighImpactNews = null;          // event high-impact terdekat (untuk tampilan/countdown)
let calendarAutoTimer = null;
const CALENDAR_AUTO_INTERVAL_MS = 10 * 60 * 1000; // auto-validasi tiap 10 menit
let dxyState = { value: null, changePct: 0, bias: 'UNKNOWN', source: 'not checked' };
let newsHardBlockActive = false;
let breakEvenSuggested = false;
let bestFavorProgress = 0;
let currentOpenTradeId = null;
let lastNotifiedLockCode = null;
let lastDecisionCode = null;
let notifyPermissionAsked = false;
let priceUiTimer = null;
let pendingPriceUi = null;
let lastAtrValue = null;
let ohlcRefreshTimer = null;
let priceSocket = null;
let priceSocketRetryTimer = null;
let priceSocketRetries = 0;
let wsFailHinted = false;
let wsModeActive = false;
const WS_INTERVAL_MS = 1000;
const WS_MAX_RETRIES = 4;



function getSymbolConfig() {
  return SYMBOL_CONFIG[GOLD_SYMBOL];
}

function formatPrice(value, decimals = getSymbolConfig().decimals) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function safeText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function addLog(message, level = 'info') {
  const logBox = document.getElementById('logBox');
  if (!logBox) return;
  const line = document.createElement('div');
  line.className = `log-line ${level === 'error' ? 'text-red-400' : level === 'success' ? 'text-emerald-400' : 'text-dim'}`;
  line.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${message}`;
  logBox.prepend(line);
  while (logBox.children.length > 80) logBox.removeChild(logBox.lastChild);
}


function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

window.addEventListener('error', (event) => {
  addLog(`Runtime error: ${event.message}`, 'error');
  setSystemStatus('ai', 'warn', 'Recovered');
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason || 'Promise rejection');
  addLog(`Async warning: ${msg}`, 'error');
  setSystemStatus('ai', 'warn', 'Recovered');
});

function setInitialPlan(price = lastWsPrice) {
  const trend = analyzeMarketTrend(price);
  lockedTradeSide = deriveTradeSide(trend);
  lockedTrendSnapshot = trend;
  const plan = calculateDirectionalPlan(price, lockedTradeSide, trend);
  lockedEntryPrice = plan.entry;
  lockedSL = plan.sl;
  lockedOrderType = plan.orderType;
  autoRenewAwayCount = 0;
  breakEvenSuggested = false;
  bestFavorProgress = 0;
  entryTriggered = false;
  entryTouchLog = [];
  entryZoneInsidePrev = false;
  updateEntryTouchLogUi();
  const detailEl = document.getElementById('tpValidityDetail');
  if (detailEl) {
    detailEl.innerHTML = 'Plan baru dikunci. Klik "CEK VALIDASI SETUP" kapan saja untuk melihat apakah setup masih menuju TP atau sebaiknya ditutup manual.';
    detailEl.className = 'text-[11px] text-muted mt-1';
  }
  saveLockedPlanState();
}

// Simpan state plan/trade yang sedang aktif supaya tidak hilang saat app di-refresh/ditutup-buka lagi (umum terjadi di HP).
function saveLockedPlanState() {
  try {
    localStorage.setItem(STORAGE_KEYS.lockedPlan, JSON.stringify({
      lockedTradeSide, lockedEntryPrice, lockedSL, lockedOrderType,
      currentOpenTradeId, bestFavorProgress,
      entryTriggered, entryTouchLog,
      savedAt: new Date().toISOString()
    }));
  } catch (e) { /* storage penuh/diblokir, abaikan diam-diam */ }
}

// Dipanggil sekali saat startup. Mengembalikan true kalau berhasil memulihkan plan yang masih aktif.
function restoreLockedPlanState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.lockedPlan) || 'null'); } catch (e) { return false; }
  if (!saved || (saved.lockedTradeSide !== 'BUY' && saved.lockedTradeSide !== 'SELL')) return false;
  if (!Number.isFinite(saved.lockedEntryPrice) || !Number.isFinite(saved.lockedSL)) return false;

  // Kalau ada trade yang tadinya OPEN, pastikan masih benar-benar OPEN di journal (belum kena TP/SL/tutup manual sebelumnya).
  let openTradeId = null;
  if (saved.currentOpenTradeId) {
    const rows = getJournalHistory();
    const row = rows.find(r => r.tradeId === saved.currentOpenTradeId);
    if (row && row.resultTrade === 'OPEN') openTradeId = saved.currentOpenTradeId;
  }

  lockedTradeSide = saved.lockedTradeSide;
  lockedEntryPrice = saved.lockedEntryPrice;
  lockedSL = saved.lockedSL;
  lockedOrderType = saved.lockedOrderType || 'NO TRADE';
  currentOpenTradeId = openTradeId;
  bestFavorProgress = Number.isFinite(saved.bestFavorProgress) ? saved.bestFavorProgress : 0;
  entryTriggered = Boolean(saved.entryTriggered);
  entryTouchLog = Array.isArray(saved.entryTouchLog) ? saved.entryTouchLog : [];
  entryZoneInsidePrev = false; // aman: biar sentuhan pertama pasca-reload dievaluasi ulang, bukan diasumsikan masih "di dalam"
  updateEntryTouchLogUi();

  const detailEl = document.getElementById('tpValidityDetail');
  if (detailEl) {
    detailEl.innerHTML = openTradeId
      ? 'Plan aktif dipulihkan dari sesi sebelumnya (masih dipantau otomatis). Klik "CEK VALIDASI SETUP" untuk analisis terbaru.'
      : 'Plan aktif dipulihkan dari sesi sebelumnya. Klik "CEK VALIDASI SETUP" untuk analisis terbaru.';
    detailEl.className = 'text-[11px] text-muted mt-1';
  }
  addLog(`Plan ${lockedTradeSide} @ ${formatPrice(lockedEntryPrice)} dipulihkan dari sesi sebelumnya.${openTradeId ? ' Trade OPEN tetap dipantau.' : ''}`, 'success');
  return true;
}

function tickClock() {
  const now = new Date();
  safeText('clockEl', now.toLocaleTimeString('id-ID'));
  safeText('signalTimeEl', now.toLocaleTimeString('id-ID'));
}
setInterval(tickClock, 1000);


function getWsUrl() {
  const base = getProxyBase();
  if (!base) return null;
  try {
    const u = new URL(base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    u.search = '?interval=' + WS_INTERVAL_MS;
    return u.toString();
  } catch (e) {
    return null;
  }
}

function applyLiveTick(newPrice, sourceLabel, latencyMs) {
  if (!Number.isFinite(newPrice) || newPrice <= 0) return;
  const startedAt = performance.now();
  usingSimulatedPrice = false;
  livePriceVerified = true;
  const pctChange = lastWsPrice ? ((newPrice - lastWsPrice) / lastWsPrice) * 100 : 0;
  handleGoldAutoRenew(newPrice);
  lastLatencyMs = Number.isFinite(latencyMs) ? latencyMs : Math.round(performance.now() - startedAt);
  lastApiResponseMs = lastLatencyMs;
  lastDataSource = sourceLabel || 'ws';
  lastWsPrice = newPrice;
  updatePriceDisplay(newPrice, pctChange);
  updateMarketTelemetry(lastDataSource, lastLatencyMs, lastApiResponseMs);
  applyTradingReadiness(newPrice);
}

function closePriceSocket() {
  wsModeActive = false;
  if (priceSocketRetryTimer) {
    clearTimeout(priceSocketRetryTimer);
    priceSocketRetryTimer = null;
  }
  if (priceSocket) {
    try {
      priceSocket.onopen = null;
      priceSocket.onmessage = null;
      priceSocket.onerror = null;
      priceSocket.onclose = null;
      priceSocket.close();
    } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); }
    priceSocket = null;
  }
}

function schedulePriceSocketReconnect() {
  if (!connected) return;
  if (priceSocketRetries >= WS_MAX_RETRIES) {
    addLog('WebSocket gagal berulang — memakai HTTP poll 3s (interval cadangan sudah aktif).', 'error');
    wsModeActive = false;
    // Auto-disable WS persisten: connect berikutnya tak mencoba WS lagi → log bersih.
    try {
      const st = getSettings();
      if (st.useWs !== false) {
        st.useWs = false;
        appSettings = st;
        localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(st));
        const cb = document.getElementById('settingUseWs'); if (cb) cb.checked = false;
        addLog('WebSocket otomatis dimatikan (proxy tidak mendukung WS). Aktifkan manual di Settings bila proxy sudah mendukung.', 'info');
      }
    } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); }
    if (!wsFailHinted) { wsFailHinted = true; showToast('WebSocket tidak didukung proxy — otomatis dimatikan. HTTP poll tetap jalan.', 'info'); }
    return;
  }
  const delay = Math.min(10000, 800 * Math.pow(1.6, priceSocketRetries));
  priceSocketRetries += 1;
  addLog('WebSocket reconnect #' + priceSocketRetries + ' dalam ' + Math.round(delay) + 'ms', 'info');
  priceSocketRetryTimer = setTimeout(function () {
    if (connected) connectPriceSocket();
  }, delay);
}

function connectPriceSocket() {
  const wsUrl = getWsUrl();
  if (!wsUrl) {
    addLog('Proxy Base URL kosong — WebSocket tidak bisa. Pakai polling.', 'error');
    return false;
  }
  if (typeof WebSocket === 'undefined') {
    addLog('Browser tidak mendukung WebSocket — polling HTTP.', 'error');
    return false;
  }
  closePriceSocket();
  try {
    addLog('Menghubungkan WebSocket: ' + wsUrl, 'info');
    const sock = new WebSocket(wsUrl);
    priceSocket = sock;
    wsModeActive = true;

    sock.onopen = function () {
      priceSocketRetries = 0;
      wsModeActive = true;
      addLog('WebSocket live tick aktif (' + WS_INTERVAL_MS + 'ms).', 'success');
      showToast('WebSocket real-time aktif', 'success');
      // HTTP poll dibiarkan hidup; ia otomatis skip selama wsModeActive=true,
      // & resume sendiri bila WS putus (tak perlu menunggu retry habis).
      try { sock.send(JSON.stringify({ type: 'ping' })); } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); }
    };

    sock.onmessage = function (ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || !msg.type) return;
      if (msg.type === 'hello') {
        addLog('WS hello — interval ' + (msg.intervalMs || WS_INTERVAL_MS) + 'ms', 'info');
        return;
      }
      if (msg.type === 'pong') return;
      if (msg.type === 'tick' && Number.isFinite(Number(msg.price))) {
        applyLiveTick(Number(msg.price), 'ws:' + (msg.source || 'proxy'), Number(msg.latencyMs));
        return;
      }
      if (msg.type === 'error') {
        addLog('WS upstream: ' + (msg.message || 'error'), 'error');
        if (Number.isFinite(Number(msg.lastPrice)) && Number(msg.lastPrice) > 0) {
          // keep last known; do not mark simulated
        }
      }
    };

    sock.onerror = function () {
      addLog('WebSocket error event', 'error');
    };

    sock.onclose = function () {
      priceSocket = null;
      if (!connected) return;
      wsModeActive = false;
      addLog('WebSocket tertutup — mencoba reconnect / fallback.', 'error');
      schedulePriceSocketReconnect();
    };
    return true;
  } catch (err) {
    addLog('WebSocket gagal dibuka: ' + err.message, 'error');
    wsModeActive = false;
    return false;
  }
}

async function fetchRealLivePrice() {
  const cfg = getSymbolConfig();
  const startedAt = performance.now();
  let newPrice = null;
  let sourceLabel = 'offline';

  try {
    const proxied = proxyUrl('/price/XAU');
    const endpoints = proxied ? [proxied, 'https://api.gold-api.com/price/XAU'] : ['https://api.gold-api.com/price/XAU'];
    let lastErr = null;
    for (const endpoint of endpoints) {
      try {
        const response = await fetchWithTimeout(endpoint, { cache: 'no-store' }, 8000);
        lastApiResponseMs = Math.round(performance.now() - startedAt);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const px = Number(data.price ?? data.Price ?? data.ask);
        if (Number.isFinite(px) && px > 0) {
          newPrice = px;
          sourceLabel = proxied && endpoint === proxied ? ('proxy:' + (data.source || 'worker')) : 'gold-api';
          break;
        }
      } catch (err) { lastErr = err; }
    }
    if (!Number.isFinite(newPrice) && lastErr) throw lastErr;
  } catch (err) {
    lastApiResponseMs = Math.round(performance.now() - startedAt);
    if (!liveOfflineLogged) addLog('Live feed XAUUSD tidak tersedia (' + err.message + '). Set Proxy Base URL di Settings jika CORS memblokir.', 'error');
  }

  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    // REAL-ONLY: no simulated ticks. Keep last known price; mark feed offline.
    usingSimulatedPrice = true;
    livePriceVerified = false;
    lastDataSource = 'offline';
    lastLatencyMs = Math.round(performance.now() - startedAt);
    updateMarketTelemetry('offline', lastLatencyMs, lastApiResponseMs);
    applyTradingReadiness(lastWsPrice);
    if (!liveOfflineLogged) { addLog('Live feed XAUUSD offline. Tidak ada harga simulasi — entry diblokir. Polling lanjut diam-diam sampai pulih.', 'error'); liveOfflineLogged = true; }
    return;
  }

  usingSimulatedPrice = false;
  livePriceVerified = true;
  const justRecovered = liveOfflineLogged;
  if (justRecovered) { addLog('Live feed XAUUSD kembali online.', 'success'); liveOfflineLogged = false; lastPriceLogMs = 0; }

  const pctChange = lastWsPrice ? ((newPrice - lastWsPrice) / lastWsPrice) * 100 : 0;
  handleGoldAutoRenew(newPrice);

  lastLatencyMs = Math.round(performance.now() - startedAt);
  lastDataSource = sourceLabel;
  lastWsPrice = newPrice;
  updatePriceDisplay(newPrice, pctChange);
  updateMarketTelemetry(sourceLabel, lastLatencyMs, lastApiResponseMs);
  // Anti-spam: catat harga saat recovery atau maksimal setiap 30 dtk (bukan tiap poll / tiap ganti source).
  if (justRecovered || Date.now() - lastPriceLogMs > 30000) {
    addLog(`Harga XAUUSD live dari ${sourceLabel}: ${formatPrice(newPrice)}`, 'success');
    lastPriceLogMs = Date.now();
  }
}

function handleGoldAutoRenew(price) {
  if (!Number.isFinite(price) || !lockedEntryPrice || lockedTradeSide === 'WAIT') return;
  const distanceFromEntry = Math.abs(price - lockedEntryPrice);

  const renewDist = getDynamicPlanDistances(price).autoRenewDistance;
  if (distanceFromEntry > renewDist) {
    autoRenewAwayCount += 1;
  } else {
    autoRenewAwayCount = 0;
  }

  if (autoRenewAwayCount >= GOLD_PLAN.autoRenewConfirmations) {
    const oldEntry = lockedEntryPrice;
    setInitialPlan(price);
    showToast('Plan Auto-Renewed', 'success');
    addLog(`Plan Auto-Renewed: harga menjauh $${distanceFromEntry.toFixed(2)} dari entry ${formatPrice(oldEntry)} selama ${GOLD_PLAN.autoRenewConfirmations}x cek. New entry ${formatPrice(lockedEntryPrice)} / SL ${formatPrice(lockedSL)}.`, 'success');
  }
}


function getSettings() {
  if (appSettings) return appSettings;
  try {
    appSettings = { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}')) };
  } catch (err) {
    appSettings = { ...DEFAULT_SETTINGS };
  }
  // Always prefer working proxy if user has not set one
  if (!appSettings.proxyBaseUrl || !String(appSettings.proxyBaseUrl).trim()) {
    appSettings.proxyBaseUrl = DEFAULT_SETTINGS.proxyBaseUrl || 'https://xau-proxy.kelana2201.workers.dev';
  }
  // Deep-merge bobot entry-score supaya settingan lama yang belum punya field ini tetap dapat default lengkap.
  appSettings.entryScoreWeights = { ...DEFAULT_SETTINGS.entryScoreWeights, ...(appSettings.entryScoreWeights || {}) };
  if (!Number.isFinite(appSettings.minConfidenceScore)) appSettings.minConfidenceScore = DEFAULT_SETTINGS.minConfidenceScore;
  return appSettings;
}

function loadSettingsToForm() {
  const st = getSettings();
  safeSetValue('settingSheetsUrl', st.sheetsUrl);
  safeSetValue('settingSheetsToken', st.sheetsToken);
  safeSetValue('settingTelegramToken', st.telegramToken);
  safeSetValue('settingTelegramChatId', st.telegramChatId);
  safeSetValue('settingRiskDefault', st.riskDefault);
  safeSetValue('settingBroker', st.broker);
  safeSetValue('settingTimezone', st.timezone);
  safeSetValue('settingTheme', st.theme);
  safeSetValue('settingApiMode', st.apiMode);
  safeSetValue('settingProxyBaseUrl', st.proxyBaseUrl || '');
  const nb = document.getElementById('settingNotifyBrowser');
  if (nb) nb.checked = st.notifyBrowser !== false;
  const ns = document.getElementById('settingNotifySound');
  if (ns) ns.checked = st.notifySound !== false;
  const nt = document.getElementById('settingNotifyTelegramOnLock');
  if (nt) nt.checked = st.notifyTelegramOnLock !== false;
  const uw = document.getElementById('settingUseWs');
  if (uw) uw.checked = st.useWs !== false;
  const w = st.entryScoreWeights || DEFAULT_SETTINGS.entryScoreWeights;
  safeSetValue('settingWeightStructure', w.structure);
  safeSetValue('settingWeightSupplyDemand', w.supplyDemand);
  safeSetValue('settingWeightTrend', w.trend);
  safeSetValue('settingWeightCandlestick', w.candlestick);
  safeSetValue('settingMinConfidenceScore', Number.isFinite(st.minConfidenceScore) ? st.minConfidenceScore : DEFAULT_SETTINGS.minConfidenceScore);
  updateWeightTotalHint();
  setSystemStatus('telegram', st.telegramToken && st.telegramChatId ? 'ok' : 'warn', st.telegramToken && st.telegramChatId ? 'Ready' : 'Setup');
  setSystemStatus('sheets', st.sheetsUrl && st.sheetsToken ? 'ok' : 'warn', st.sheetsUrl && st.sheetsToken ? 'Ready' : 'Setup');
}

function safeSetValue(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined && value !== null) el.value = value;
}

function saveSettings() {
  const rawWeights = {
    structure: Number(document.getElementById('settingWeightStructure')?.value ?? DEFAULT_SETTINGS.entryScoreWeights.structure),
    supplyDemand: Number(document.getElementById('settingWeightSupplyDemand')?.value ?? DEFAULT_SETTINGS.entryScoreWeights.supplyDemand),
    trend: Number(document.getElementById('settingWeightTrend')?.value ?? DEFAULT_SETTINGS.entryScoreWeights.trend),
    candlestick: Number(document.getElementById('settingWeightCandlestick')?.value ?? DEFAULT_SETTINGS.entryScoreWeights.candlestick)
  };
  const weightSum = rawWeights.structure + rawWeights.supplyDemand + rawWeights.trend + rawWeights.candlestick;
  let entryScoreWeights = rawWeights;
  if (!Number.isFinite(weightSum) || weightSum <= 0) {
    entryScoreWeights = { ...DEFAULT_SETTINGS.entryScoreWeights };
    showToast('Bobot tidak valid, dikembalikan ke default.', 'error');
  } else if (Math.round(weightSum) !== 100) {
    // Normalisasi proporsional supaya totalnya tetap 100, bukan menolak simpan.
    const factor = 100 / weightSum;
    entryScoreWeights = {
      structure: Math.round(rawWeights.structure * factor),
      supplyDemand: Math.round(rawWeights.supplyDemand * factor),
      trend: Math.round(rawWeights.trend * factor),
      candlestick: Math.round(rawWeights.candlestick * factor)
    };
    showToast(`Total bobot ${weightSum}% dinormalisasi otomatis jadi 100%.`, 'info');
  }
  const st = {
    sheetsUrl: document.getElementById('settingSheetsUrl')?.value?.trim() || '',
    sheetsToken: document.getElementById('settingSheetsToken')?.value?.trim() || '',
    telegramToken: document.getElementById('settingTelegramToken')?.value?.trim() || '',
    telegramChatId: document.getElementById('settingTelegramChatId')?.value?.trim() || '',
    riskDefault: Number(document.getElementById('settingRiskDefault')?.value || 1),
    broker: document.getElementById('settingBroker')?.value?.trim() || 'Manual / Broker',
    timezone: document.getElementById('settingTimezone')?.value?.trim() || 'Asia/Jakarta',
    theme: document.getElementById('settingTheme')?.value || 'institutional-dark',
    apiMode: document.getElementById('settingApiMode')?.value || 'auto',
    notifyBrowser: document.getElementById('settingNotifyBrowser')?.checked !== false,
    notifySound: document.getElementById('settingNotifySound')?.checked !== false,
    notifyTelegramOnLock: document.getElementById('settingNotifyTelegramOnLock')?.checked !== false,
    useWs: document.getElementById('settingUseWs')?.checked !== false,
    proxyBaseUrl: document.getElementById('settingProxyBaseUrl')?.value?.trim() || '',
    entryScoreWeights,
    minConfidenceScore: Math.max(0, Math.min(100, Number(document.getElementById('settingMinConfidenceScore')?.value ?? DEFAULT_SETTINGS.minConfidenceScore))),
    strategyPreset: appSettings?.strategyPreset || DEFAULT_SETTINGS.strategyPreset
  };
  appSettings = { ...DEFAULT_SETTINGS, ...st };
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(appSettings));
  applySettingsToRuntime();
  loadSettingsToForm();
  showToast('Settings berhasil disimpan', 'success');
  addLog('Settings saved.', 'success');
}

// Terapkan preset dari tombol Settings UI, lalu refresh form supaya angka bobot langsung kelihatan.
function applyStrategyPresetUi(name) {
  applyStrategyPreset(name);
  loadSettingsToForm();
}

// Kasih indikator visual kalau total bobot yang sedang diketik user di form belum pas 100%
// (tetap boleh disimpan — saveSettings() akan menormalisasi otomatis — ini cuma bantuan visual).
function updateWeightTotalHint() {
  const el = document.getElementById('weightTotalHint');
  if (!el) return;
  const vals = ['settingWeightStructure','settingWeightSupplyDemand','settingWeightTrend','settingWeightCandlestick']
    .map(id => Number(document.getElementById(id)?.value || 0));
  const total = vals.reduce((a,b) => a+b, 0);
  el.textContent = `Total bobot: ${total}%` + (total !== 100 ? ' (akan dinormalisasi ke 100% saat disimpan)' : '');
  el.className = total === 100 ? 'text-[10px] text-emerald-400 mt-1' : 'text-[10px] text-orange-400 mt-1';
}

function applySettingsToRuntime() {
  const st = getSettings();
  const riskInput = document.getElementById('riskPct');
  if (riskInput && !riskInput.dataset.userEdited) riskInput.value = st.riskDefault;
  setSystemStatus('broker', 'ok', st.broker ? 'Connected' : 'Manual');
  setSystemStatus('telegram', st.telegramToken && st.telegramChatId ? 'ok' : 'warn', st.telegramToken && st.telegramChatId ? 'Ready' : 'Setup');
  setSystemStatus('sheets', st.sheetsUrl && st.sheetsToken ? 'ok' : 'warn', st.sheetsUrl && st.sheetsToken ? 'Ready' : 'Setup');
  applyTheme(st.theme);
}

function applyTheme(theme) {
  const VALID = ['institutional-dark', 'gold-premium', 'oled-black', 'dark-pro', 'light'];
  const t = VALID.includes(theme) ? theme : 'institutional-dark';
  document.body.classList.remove('theme-gold-premium', 'theme-oled-black', 'theme-dark-pro', 'theme-light');
  if (t !== 'institutional-dark') document.body.classList.add('theme-' + t);
  const meta = document.querySelector('meta[name="theme-color"]');
  const colors = { 'institutional-dark': '#060a13', 'gold-premium': '#1a160c', 'oled-black': '#000000', 'dark-pro': '#0b1220', 'light': '#eef2f7' };
  if (meta) meta.setAttribute('content', colors[t] || '#060a13');
}

function setSystemStatus(key, state = 'ok', label = 'Ready') {
  const ids = { broker:'statusBroker', sheets:'statusSheets', tradingview:'statusTradingView', calendar:'statusCalendar', telegram:'statusTelegram', livefeed:'statusLiveFeed', ai:'statusAI' };
  const titles = { broker:'Broker', sheets:'Sheets', tradingview:'TradingView', calendar:'Calendar', telegram:'Telegram', livefeed:'Live Feed', ai:'Analysis Engine' };
  const el = document.getElementById(ids[key]);
  if (!el) return;
  const cls = state === 'ok' ? 'sys-ok' : state === 'bad' ? 'sys-bad' : 'sys-warn';
  el.innerHTML = `<strong>${titles[key] || key}</strong><span class="flex items-center gap-2"><i class="sys-dot ${cls}"></i>${escapeHtml(label)}</span>`;
  if (key === 'calendar') safeText('mobileStatusCalendar', String(label).toUpperCase().slice(0, 10));
  if (key === 'ai') safeText('mobileStatusAI', String(label).toUpperCase().slice(0, 10));
  if (key === 'livefeed') safeText('mobileStatusMarket', state === 'ok' ? 'LIVE' : 'OFFLINE');
}


function updateMarketTelemetry(sourceLabel = lastDataSource, latency = lastLatencyMs, apiMs = lastApiResponseMs) {
  const isLive = sourceLabel && sourceLabel !== 'simulated' && sourceLabel !== 'offline';
  safeText('dataModeBadge', isLive ? '🟢 LIVE MARKET' : '🔴 LIVE FEED OFFLINE');
  const updateTime = new Date().toLocaleTimeString('id-ID');
  safeText('lastUpdateEl', updateTime);
  safeText('mobileStatusUpdate', updateTime.slice(0,5));
  safeText('latencyEl', `${latency || 0} ms`);
  // "Ping" di browser tidak bisa diukur (ICMP). Pakai RTT fetch yang nyata, bukan angka acak.
  safeText('pingEl', latency ? `${latency} ms` : '-- ms');
  safeText('apiRespEl', apiMs ? `${apiMs} ms` : '-- ms');
  setSystemStatus('livefeed', isLive ? 'ok' : 'bad', isLive ? 'Live Market' : 'Offline');
  setSystemStatus('ai', 'ok', 'Active');
  const radar = document.getElementById('radarBadge');
  if (radar && connected) {
    if (isLive) {
      radar.className = 'badge badge-green mono';
      radar.innerHTML = '<i class="fas fa-satellite-dish radar-icon"></i> LIVE FEED';
    } else {
      radar.className = 'badge badge-orange mono';
      radar.innerHTML = '<i class="fas fa-satellite-dish"></i> OFFLINE';
    }
  }
}


function getTradingSession(now = new Date()) {
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const inLondon = hour >= 7 && hour < 16;
  const inNewYork = hour >= 12 && hour < 21;
  const inAsia = hour >= 0 && hour < 7;
  const inSydney = hour >= 21 && hour < 24;
  if (inLondon && inNewYork) return { name: 'London / New York Overlap', risk: 'HIGH LIQUIDITY', active: true };
  if (inLondon) return { name: 'London Session', risk: 'ACTIVE', active: true };
  if (inNewYork) return { name: 'New York Session', risk: 'ACTIVE', active: true };
  if (inSydney) return { name: 'Sydney Session', risk: 'OPENING', active: true };
  if (inAsia) return { name: 'Asia Session', risk: 'LOWER VOL', active: true };
  return { name: 'Off Major Session', risk: 'THIN LIQUIDITY', active: false };
}

function updateSessionUI() {
  const session = getTradingSession();
  safeText('summarySessionBadge', `${session.name.toUpperCase()} • ${session.risk}`);
  return session;
}

async function updateDxyMonitoring() {
  const startedAt = performance.now();
  try {
    const proxiedDxy = proxyUrl('/dxy');
    const response = await fetchWithTimeout(proxiedDxy || 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=1d&interval=5m', { cache: 'no-store' }, 8000);
    if (!response.ok) throw new Error(`DXY HTTP ${response.status}`);
    const data = await response.json();
    if (proxiedDxy && Number.isFinite(Number(data.value))) {
      dxyState = {
        value: Number(data.value),
        changePct: Number(data.changePct) || 0,
        bias: data.bias || 'NEUTRAL',
        source: `proxy ${Math.round(performance.now() - startedAt)}ms`
      };
    } else {
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(v => Number.isFinite(v)) || [];
      if (closes.length < 2) throw new Error('DXY empty');
      const first = closes[0];
      const last = closes[closes.length - 1];
      const changePct = ((last - first) / first) * 100;
      dxyState = {
        value: last,
        changePct,
        bias: changePct > 0.08 ? 'USD_STRONG' : changePct < -0.08 ? 'USD_WEAK' : 'NEUTRAL',
        source: `Yahoo ${Math.round(performance.now() - startedAt)}ms`
      };
    }
  } catch (err) {
    dxyState = { value: null, changePct: 0, bias: 'UNKNOWN', source: `offline: ${err.message}` };
  }
  updateDxyUI();
  updateAIIntelligence(currentPlanDecision || assessTradingReadiness(lastWsPrice));
}

function updateDxyUI() {
  const el = document.getElementById('dxyStatusEl');
  if (!el) return;
  const cls = dxyState.bias === 'USD_STRONG' ? 'dxy-bull' : dxyState.bias === 'USD_WEAK' ? 'dxy-bear' : 'dxy-neutral';
  el.className = `telemetry-value ${cls}`;
  const label = dxyState.value ? `${dxyState.value.toFixed(2)} ${dxyState.changePct >= 0 ? '+' : ''}${dxyState.changePct.toFixed(2)}%` : 'Offline';
  el.innerText = `${label} ${dxyState.bias}`;
}

function initEnterpriseModules() {
  appSettings = getSettings();
  loadSettingsToForm();
  applySettingsToRuntime();
  updateDashboardSummary();
  updateRiskManagement();
  updateSMCGrid();
  updateAIIntelligence(currentPlanDecision || assessTradingReadiness(lastWsPrice));
  renderBacktestCharts();
  updateCalendarMonitorUI();
  updateSessionUI();
  updateDxyMonitoring();
  setInterval(updateDxyMonitoring, 180000);
  refreshOhlcFromProxy();
  if (ohlcRefreshTimer) clearInterval(ohlcRefreshTimer);
  ohlcRefreshTimer = setInterval(function () { refreshOhlcFromProxy(); }, 5 * 60 * 1000);
  updateNewsHardBlockUI();
  setInterval(() => {
    updateCalendarCountdowns();
    updateSessionUI();
  }, 30000);
  // [CALENDAR FIX] Auto-validasi kalender: sekologi setelah startup + tiap 10 menit (silent, tidak memblok AI).
  setTimeout(function () { checkRealEconomicCalendar(true); }, 8000);
  if (calendarAutoTimer) clearInterval(calendarAutoTimer);
  calendarAutoTimer = setInterval(function () { checkRealEconomicCalendar(true); }, CALENDAR_AUTO_INTERVAL_MS);
  document.getElementById('riskPct')?.addEventListener('input', (e) => { e.currentTarget.dataset.userEdited = '1'; });
}

function getJournalHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.journal) || '[]'); }
  catch { return []; }
}
function setJournalHistory(rows) { localStorage.setItem(STORAGE_KEYS.journal, JSON.stringify(rows.slice(-500))); }
function recordJournal(payload) {
  const rows = getJournalHistory();
  rows.push({ ...payload, savedAt: new Date().toISOString(), resultTrade: payload.resultTrade || 'OPEN', traderNotes: payload.traderNotes || '' });
  setJournalHistory(rows);
  updateDashboardSummary();
  updateRiskManagement();
  autoBackupJournal(true);
}

function formatMoney(value) {
  const n = Number(value) || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function updateDashboardSummary() {
  const rows = getJournalHistory();
  const today = new Date().toISOString().slice(0,10);
  const todayRows = rows.filter(r => String(r.savedAt || '').slice(0,10) === today);
  const wins = todayRows.filter(r => Number(r.pnl || 0) > 0).length;
  const losses = todayRows.filter(r => Number(r.pnl || 0) < 0).length;
  const profit = todayRows.reduce((a,r)=>a+Math.max(0, Number(r.pnl || 0)),0);
  const loss = todayRows.reduce((a,r)=>a+Math.min(0, Number(r.pnl || 0)),0);
  const winRate = todayRows.length ? (wins / todayRows.length) * 100 : 0;
  const risk = parseFloat(document.getElementById('riskPct')?.value || getSettings().riskDefault || 1);
  safeText('kpiTradesToday', todayRows.length);
  safeText('kpiProfitToday', formatMoney(profit));
  safeText('kpiLossToday', formatMoney(loss));
  safeText('kpiWinRateToday', todayRows.length ? `${winRate.toFixed(1)}%` : '--%');
  safeText('kpiRiskToday', `${risk.toFixed(2)}%`);
  safeText('kpiSignalsToday', todayRows.length);
  safeText('kpiOpenPosition', todayRows.filter(r => r.resultTrade === 'OPEN').length);
}

function updateRiskManagement() {
  const acc = Math.max(0, parseFloat(document.getElementById('accSize')?.value) || 10000);
  const risk = Math.min(100, Math.max(0, parseFloat(document.getElementById('riskPct')?.value) || 1));
  const riskAmt = acc * (risk / 100);
  const rows = getJournalHistory();
  const now = new Date();
  const day = now.toISOString().slice(0,10);
  const weekAgo = Date.now() - 7*24*3600*1000;
  const month = now.toISOString().slice(0,7);
  const dayRows = rows.filter(r => String(r.savedAt || '').slice(0,10) === day);
  const weekRows = rows.filter(r => new Date(r.savedAt || 0).getTime() >= weekAgo);
  const monthRows = rows.filter(r => String(r.savedAt || '').slice(0,7) === month);
  const sumPos = arr => arr.reduce((a,r)=>a+Math.max(0,Number(r.pnl||0)),0);
  const sumNeg = arr => arr.reduce((a,r)=>a+Math.min(0,Number(r.pnl||0)),0);
  const wins = rows.filter(r => Number(r.pnl||0)>0).length;
  const closed = rows.filter(r => r.resultTrade && r.resultTrade !== 'OPEN').length;
  const floating = rows.filter(r => r.resultTrade === 'OPEN').reduce((sum, r) => {
    const entry = Number(r.entry);
    const totalLot = Number(r.lotSize) || 0;
    const openLot = Math.max(0, totalLot - (Number(r.closedLot) || 0));
    const side = r.action;
    if (!openLot || !Number.isFinite(entry) || (side !== 'BUY' && side !== 'SELL') || !livePriceVerified || !Number.isFinite(lastWsPrice) || lastWsPrice <= 0) return sum;
    const move = side === 'BUY' ? (lastWsPrice - entry) : (entry - lastWsPrice);
    return sum + move * openLot * GOLD_PLAN.contractSize;
  }, 0);
  safeText('riskDailyProfit', formatMoney(sumPos(dayRows)));
  safeText('riskDailyLoss', formatMoney(sumNeg(dayRows)));
  safeText('riskWeeklyProfit', formatMoney(sumPos(weekRows)));
  safeText('riskWeeklyLoss', formatMoney(sumNeg(weekRows)));
  safeText('riskMonthlyProfit', formatMoney(sumPos(monthRows)));
  safeText('riskWinRate', closed ? `${((wins/closed)*100).toFixed(1)}%` : '--%');
  safeText('riskDrawdown', `${Math.min(12, Math.max(0, Math.abs(sumNeg(monthRows))/Math.max(acc,1)*100)).toFixed(2)}%`);
  safeText('riskFloatingPL', formatMoney(floating));
  safeText('riskEquity', formatMoney(acc + sumPos(monthRows) + sumNeg(monthRows) + floating));
  // Margin butuh data broker sungguhan; tidak ditampilkan angka estimasi fiktif.
  safeText('riskMargin', '— (broker)');
  safeText('riskFreeMargin', '— (broker)');
  safeText('riskMaxRisk', formatMoney(riskAmt));
  safeText('riskRemaining', formatMoney(Math.max(0, riskAmt - Math.abs(sumNeg(dayRows)))));
}

function getPriceSamples(extraPrice = lastWsPrice) {
  const samples = recentPrices.filter(v => Number.isFinite(v) && v > 0);
  if (Number.isFinite(extraPrice) && extraPrice > 0 && samples[samples.length - 1] !== extraPrice) samples.push(extraPrice);
  return samples.slice(-48);
}


function getProxyBase() {
  const st = getSettings();
  return (st.proxyBaseUrl || '').trim().replace(/\/+$/, '');
}
function proxyUrl(pathQuery) {
  const base = getProxyBase();
  if (!base) return null;
  return base + (pathQuery.startsWith('/') ? pathQuery : '/' + pathQuery);
}
function computeAtrFromOhlc(candles, period = GOLD_PLAN.atrPeriod) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    if (Number.isFinite(tr)) trs.push(tr);
  }
  const slice = trs.slice(-period);
  if (!slice.length) return null;
  const atr = slice.reduce((a, b) => a + b, 0) / slice.length;
  return Math.min(GOLD_PLAN.atrCeil, Math.max(GOLD_PLAN.atrFloor, atr));
}
function getActiveAtr() {
  // ATR hanya dihitung dari candle OHLC nyata (proxy). Tanpa OHLC → pakai default plan konservatif,
  // bukan estimasi fiktif dari tick tunggal (data tidak akurat dilarang CLEAN-125).
  const atr = computeAtrFromOhlc(OHLC_CACHE.M15.length ? OHLC_CACHE.M15 : OHLC_CACHE.H1) || GOLD_PLAN.slDistance;
  lastAtrValue = atr;
  return atr;
}
function getDynamicPlanDistances(price = lastWsPrice) {
  const atr = getActiveAtr();
  return {
    atr,
    entryOffset: Math.min(GOLD_PLAN.atrCeil * 0.5, Math.max(2.5, atr * GOLD_PLAN.atrEntryMult)),
    slDistance: Math.min(GOLD_PLAN.atrCeil, Math.max(GOLD_PLAN.atrFloor, atr * GOLD_PLAN.atrSlMult)),
    tp1Distance: Math.max(GOLD_PLAN.atrFloor * 1.2, atr * GOLD_PLAN.atrTp1Mult),
    tp2Distance: Math.max(GOLD_PLAN.atrFloor * 2, atr * GOLD_PLAN.atrTp2Mult),
    tp3Distance: Math.max(GOLD_PLAN.atrFloor * 3, atr * GOLD_PLAN.atrTp3Mult),
    breakEvenTrigger: Math.max(4, atr * 0.9),
    autoRenewDistance: Math.max(8, atr * 1.4)
  };
}
// CATATAN SKALA: fungsi ini punya bobot (80/120/40) & threshold sideways (strength<15) sendiri,
// SENGAJA berbeda dari analyzeMarketTrend() (bobot 900/1500/550, threshold<18) di bawah.
// Nilai `strength` dari kedua fungsi TIDAK boleh dibandingkan langsung satu sama lain —
// masing-masing hanya dipakai secara internal oleh fungsinya sendiri (lihat grep `.strength`
// di seluruh file: tidak ada tempat yang mencampur output kedua fungsi ini).
function analyzeTrendFromCloses(closes, label) {
  if (!closes || closes.length < 8) return { direction: 'UNKNOWN', side: 'WAIT', label: label + ' warmup', strength: 0, reason: 'Butuh data ' + label };
  const fast = calculateEMA(closes, Math.min(8, closes.length));
  const slow = calculateEMA(closes, Math.min(21, closes.length));
  const f = fast[fast.length - 1], s = slow[slow.length - 1];
  const last = closes[closes.length - 1], first = closes[0];
  const prev = closes[Math.max(0, closes.length - 5)];
  const slopePct = ((last - first) / first) * 100;
  const momentumPct = ((last - prev) / prev) * 100;
  const maxP = Math.max(...closes), minP = Math.min(...closes);
  const rangePct = ((maxP - minP) / Math.max(last, 1)) * 100;
  const strength = Math.min(100, Math.round(Math.abs(slopePct) * 80 + Math.abs((f - s) / last * 100) * 120 + Math.abs(momentumPct) * 40));
  if (rangePct < 0.08 || strength < 15) return { direction: 'SIDEWAYS', side: 'WAIT', label: label + ' sideways', strength, slopePct, rangePct, reason: label + ' range ketat' };
  if (f > s && slopePct > 0.02) return { direction: 'BULLISH', side: 'BUY', label: label + ' bullish', strength, slopePct, rangePct, reason: label + ' EMA up' };
  if (f < s && slopePct < -0.02) return { direction: 'BEARISH', side: 'SELL', label: label + ' bearish', strength, slopePct, rangePct, reason: label + ' EMA down' };
  return { direction: 'NEUTRAL', side: 'WAIT', label: label + ' neutral', strength, slopePct, rangePct, reason: label + ' mixed' };
}
function getMultiTfTrends() {
  const fromOhlc = (key, label) => analyzeTrendFromCloses((OHLC_CACHE[key] || []).map(c => c.c).filter(Number.isFinite), label);
  const ticks = getPriceSamples(lastWsPrice);
  const tickTf = (n, label) => analyzeTrendFromCloses(ticks.slice(-n), label);
  return {
    M15: OHLC_CACHE.M15.length >= 8 ? fromOhlc('M15', 'M15') : tickTf(16, 'M15~'),
    H1: OHLC_CACHE.H1.length >= 8 ? fromOhlc('H1', 'H1') : tickTf(24, 'H1~'),
    H4: OHLC_CACHE.H4.length >= 8 ? fromOhlc('H4', 'H4') : tickTf(40, 'H4~'),
    D1: OHLC_CACHE.D1.length >= 8 ? fromOhlc('D1', 'D1') : tickTf(60, 'D1~')
  };
}
function updateMultiTfUi() {
  const tfs = getMultiTfTrends();
  const map = { tfM15: tfs.M15, tfH1: tfs.H1, tfH4: tfs.H4, tfD1: tfs.D1 };
  Object.entries(map).forEach(([id, t]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = t.label || t.direction;
    el.className = t.direction === 'BULLISH' ? 'text-emerald-400 font-bold text-sm' : t.direction === 'BEARISH' ? 'text-red-400 font-bold text-sm' : 'text-orange-400 font-bold text-sm';
  });
}
async function refreshOhlcFromProxy() {
  if (!getProxyBase()) return false;
  try {
    const specs = [{ key: 'M15', tf: 15 }, { key: 'H1', tf: 60 }, { key: 'H4', tf: 240 }, { key: 'D1', tf: 1440 }];
    await Promise.all(specs.map(async (s) => {
      const res = await fetchWithTimeout(proxyUrl('/ohlc?tf=' + s.tf + '&limit=120'), { cache: 'no-store' }, 12000);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.candles) && data.candles.length) OHLC_CACHE[s.key] = data.candles;
    }));
    OHLC_CACHE.updatedAt = Date.now();
    updateMultiTfUi();
    updateSMCGrid();
    addLog('OHLC multi-TF diperbarui via proxy.', 'success');
    return true;
  } catch (err) {
    addLog('OHLC proxy gagal: ' + err.message, 'error');
    return false;
  }
}

// CATATAN SKALA: bobot (900/1500/550) di sini kalibrasi khusus untuk fungsi ini —
// dipakai oleh GOLD_PLAN.breakoutStrength, dxyState check, getSMCState.bosOk, dan confidence score.
// Jangan disamakan dengan bobot di analyzeTrendFromCloses() (lihat catatan di sana).
function analyzeMarketTrend(price = lastWsPrice) {
  const samples = getPriceSamples(price);
  const last = Number(price) || samples[samples.length - 1] || lastWsPrice;
  if (samples.length < MIN_TREND_SAMPLES) {
    return { direction: 'UNKNOWN', side: 'WAIT', label: 'Data belum cukup', strength: 0, slopePct: 0, rangePct: 0, fast: last, slow: last, momentumPct: 0, reason: `Butuh minimal ${MIN_TREND_SAMPLES} tick live untuk analisis tren; saat ini ${samples.length}.` };
  }
  const fastSeries = calculateEMA(samples, Math.min(8, samples.length));
  const slowSeries = calculateEMA(samples, Math.min(21, samples.length));
  const fast = fastSeries[fastSeries.length - 1];
  const slow = slowSeries[slowSeries.length - 1];
  const first = samples[0];
  const prev = samples[Math.max(0, samples.length - 5)];
  const slopePct = ((last - first) / first) * 100;
  const momentumPct = ((last - prev) / prev) * 100;
  const maxP = Math.max(...samples);
  const minP = Math.min(...samples);
  const rangePct = ((maxP - minP) / Math.max(last, 1)) * 100;
  const emaSpreadPct = ((fast - slow) / Math.max(last, 1)) * 100;
  const strength = Math.min(100, Math.round((Math.abs(slopePct) * 900) + (Math.abs(emaSpreadPct) * 1500) + (Math.abs(momentumPct) * 550)));
  if (rangePct < SIDEWAYS_RANGE_PCT || strength < 18) return { direction: 'SIDEWAYS', side: 'WAIT', label: 'Sideways / compression', strength, slopePct, rangePct, fast, slow, momentumPct, reason: `Range ${rangePct.toFixed(3)}% < ${SIDEWAYS_RANGE_PCT}% atau trend strength lemah.` };
  if (fast > slow && slopePct > 0.015 && momentumPct > -0.010) return { direction: 'BULLISH', side: 'BUY', label: 'Bullish', strength, slopePct, rangePct, fast, slow, momentumPct, reason: `EMA cepat di atas EMA lambat, slope ${slopePct.toFixed(3)}%, momentum ${momentumPct.toFixed(3)}%.` };
  if (fast < slow && slopePct < -0.015 && momentumPct < 0.010) return { direction: 'BEARISH', side: 'SELL', label: 'Bearish', strength, slopePct, rangePct, fast, slow, momentumPct, reason: `EMA cepat di bawah EMA lambat, slope ${slopePct.toFixed(3)}%, momentum ${momentumPct.toFixed(3)}%.` };
  return { direction: 'NEUTRAL', side: 'WAIT', label: 'Neutral / mixed', strength, slopePct, rangePct, fast, slow, momentumPct, reason: `EMA/slope belum searah. Spread EMA ${emaSpreadPct.toFixed(4)}%, slope ${slopePct.toFixed(3)}%.` };
}

// Sumber kebenaran tunggal untuk arah trade: Market Structure (wajib) + S&D + Trend H1/H4 + Candlestick.
// Parameter `trend` dipertahankan untuk kompatibilitas pemanggil lama, tapi keputusan akhir
// sepenuhnya mengikuti getEntryScoreAnalysis() — lihat definisinya di atas.
function deriveTradeSide(trend = analyzeMarketTrend(lastWsPrice)) {
  const analysis = getEntryScoreAnalysis(lastWsPrice);
  lastEntryScoreAnalysis = analysis;
  if (analysis.side === 'NO_TRADE') return 'WAIT';
  return analysis.side;
}

function isBreakoutPlan(trend) {
  if (!trend || !['BULLISH', 'BEARISH'].includes(trend.direction)) return false;
  return trend.strength >= GOLD_PLAN.breakoutStrength && Math.abs(trend.momentumPct) >= GOLD_PLAN.breakoutMomentumPct;
}

// Menentukan tipe order berdasarkan posisi entry relatif ke harga sekarang:
//   - Kalau harga SUDAH di dalam buffer entry (selisih <= toleransi spread) → NOW (market execution),
//     bukan STOP/LIMIT lagi, karena order pending sudah tidak relevan saat harga sudah menyentuh level itu.
//   - BUY, entry > harga sekarang & belum tersentuh → BUY STOP (breakout, tunggu harga naik ke entry)
//   - BUY, entry < harga sekarang & belum tersentuh → BUY LIMIT (retracement, tunggu harga turun ke entry)
//   - SELL, entry < harga sekarang & belum tersentuh → SELL STOP (breakout, tunggu harga turun ke entry)
//   - SELL, entry > harga sekarang & belum tersentuh → SELL LIMIT (retracement, tunggu harga naik ke entry)
function getOrderType(side, entry, currentPrice, buffer = getEntryBuffer(currentPrice)) {
  if (Number.isFinite(entry) && Number.isFinite(currentPrice) && Math.abs(entry - currentPrice) <= buffer) {
    if (side === 'BUY') return 'BUY NOW';
    if (side === 'SELL') return 'SELL NOW';
  }
  if (side === 'BUY') return entry > currentPrice ? 'BUY STOP' : 'BUY LIMIT';
  if (side === 'SELL') return entry < currentPrice ? 'SELL STOP' : 'SELL LIMIT';
  return 'NO TRADE';
}

function getOrderNarrative(orderType) {
  return {
    'BUY STOP': 'Menunggu harga pecah ke atas / breakout bullish.',
    'BUY LIMIT': 'Menunggu harga turun ke area diskon / retracement.',
    'SELL STOP': 'Menunggu harga pecah ke bawah / breakout bearish.',
    'SELL LIMIT': 'Menunggu harga naik dulu ke supply / retracement sell.',
    'BUY NOW': 'Harga sudah tepat di area entry — eksekusi market BUY sekarang, tidak perlu pasang pending order lagi.',
    'SELL NOW': 'Harga sudah tepat di area entry — eksekusi market SELL sekarang, tidak perlu pasang pending order lagi.'
  }[orderType] || 'Tidak ada order aktif.';
}

function calculateDirectionalPlan(price, side, trend = analyzeMarketTrend(price)) {
  const breakout = isBreakoutPlan(trend);
  const d = getDynamicPlanDistances(price);
  if (side === 'BUY') {
    const entry = breakout ? price + d.entryOffset : price - d.entryOffset;
    const sl = entry - d.slDistance;
    const orderType = getOrderType(side, entry, price);
    return { entry, sl, tp1: entry + d.tp1Distance, tp2: entry + d.tp2Distance, tp3: entry + d.tp3Distance, orderType, orderMode: breakout ? 'BREAKOUT' : 'RETRACEMENT', narrative: getOrderNarrative(orderType), atr: d.atr };
  }
  if (side === 'SELL') {
    const entry = breakout ? price - d.entryOffset : price + d.entryOffset;
    const sl = entry + d.slDistance;
    const orderType = getOrderType(side, entry, price);
    return { entry, sl, tp1: entry - d.tp1Distance, tp2: entry - d.tp2Distance, tp3: entry - d.tp3Distance, orderType, orderMode: breakout ? 'BREAKOUT' : 'RETRACEMENT', narrative: getOrderNarrative(orderType), atr: d.atr };
  }
  return { entry: price, sl: price, tp1: price, tp2: price, tp3: price, orderType: 'NO TRADE', orderMode: 'NONE', narrative: 'Tidak ada order aktif.', atr: d.atr };
}

function getSMCState() {
  const m = getTradeMetrics(lastWsPrice);
  const trend = analyzeMarketTrend(lastWsPrice);
  const dataOk = livePriceVerified && !usingSimulatedPrice && recentPrices.length >= MIN_TREND_SAMPLES;
  const nearEntry = m.side !== 'WAIT' && Math.abs(lastWsPrice - m.entry) <= getEntryBuffer(lastWsPrice);
  const sideways = isSidewaysMarket(lastWsPrice);
  const premiumDiscount = m.side === 'BUY' ? (lastWsPrice <= m.entry + GOLD_PLAN.tp1Distance / 2 ? 'Discount proxy' : 'Premium proxy') : m.side === 'SELL' ? (lastWsPrice >= m.entry - GOLD_PLAN.tp1Distance / 2 ? 'Premium proxy' : 'Discount proxy') : 'Unconfirmed';
  const invalid = m.side === 'BUY' ? lastWsPrice <= m.sl : m.side === 'SELL' ? lastWsPrice >= m.sl : false;
  if (!dataOk) {
    const reason = usingSimulatedPrice ? 'Simulation price' : `Need ${MIN_TREND_SAMPLES} live ticks`;
    return {
      smcBos: ['BOS', `Unconfirmed (${reason})`, false], smcChoch: ['CHoCH', `Unconfirmed (${reason})`, false], smcSweep: ['Liquidity Sweep', `Unconfirmed (${reason})`, false], smcEqual: ['Equal High / Low', `Unconfirmed (${reason})`, false], smcFvg: ['Fair Value Gap', `Unconfirmed (${reason})`, false], smcMitigation: ['Mitigation Block', `Unconfirmed (${reason})`, false], smcBreaker: ['Breaker Block', `Unconfirmed (${reason})`, false], smcPremium: ['Premium / Discount', `Unconfirmed (${reason})`, false], smcSupplyDemand: ['Supply Demand', `Unconfirmed (${reason})`, false], smcOrderBlock: ['Order Block', `Unconfirmed (${reason})`, false]
    };
  }
  const bosOk = ['BULLISH', 'BEARISH'].includes(trend.direction) && trend.strength >= 35;
  const chochOk = Math.sign(trend.slopePct) !== Math.sign(trend.momentumPct) && Math.abs(trend.momentumPct) > 0.015;
  const sweepOk = nearEntry && Math.abs(trend.momentumPct) > 0.01;
  const fvgOk = Math.abs(lastPctChange) > 0.015 && trend.rangePct > SIDEWAYS_RANGE_PCT;
  const obOk = nearEntry && bosOk && !invalid;
  return {
    smcBos: ['BOS', bosOk ? `${trend.direction} proxy` : 'Not confirmed', bosOk],
    smcChoch: ['CHoCH', chochOk ? 'Momentum shift proxy' : 'None', chochOk],
    smcSweep: ['Liquidity Sweep', sweepOk ? 'Entry-zone sweep proxy' : 'Waiting', sweepOk],
    smcEqual: ['Equal High / Low', sideways ? 'EQ range proxy' : 'No cluster', sideways],
    smcFvg: ['Fair Value Gap', fvgOk ? 'Imbalance proxy' : 'Balanced', fvgOk],
    smcMitigation: ['Mitigation Block', nearEntry ? 'At mitigation area proxy' : 'Unmitigated', nearEntry],
    smcBreaker: ['Breaker Block', invalid ? 'Invalidated' : 'Valid proxy', !invalid && bosOk],
    smcPremium: ['Premium / Discount', premiumDiscount, premiumDiscount !== 'Unconfirmed'],
    smcSupplyDemand: ['Supply Demand', m.side === 'SELL' ? `Supply ${formatPrice(m.entry)}` : m.side === 'BUY' ? `Demand ${formatPrice(m.entry)}` : 'No zone', m.side !== 'WAIT'],
    smcOrderBlock: ['Order Block', obOk ? 'Confirmed proxy' : 'Waiting', obOk]
  };
}
function updateSMCGrid() {
  const state = getSMCState();
  Object.entries(state).forEach(([id, item]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', Boolean(item[2]));
    el.classList.toggle('wait', !item[2]);
    el.innerHTML = `<div class="smc-title">${escapeHtml(item[0])}</div><div class="smc-value">${escapeHtml(item[1])}</div>`;
  });
  updateMultiTfUi();
}

// ═══════════════════════════════════════════════════════════
//  ENTRY SCORE ENGINE — Market Structure (wajib) + S&D + Trend H1/H4 + Candlestick
//  Menggantikan logika lama "semua indikator harus terpenuhi" dengan sistem scoring
//  fleksibel: hanya Market Structure yang jadi syarat mutlak, faktor lain menambah skor.
// ═══════════════════════════════════════════════════════════

// Deteksi swing high/low sederhana (metode fractal) dari candle OHLC, lalu klasifikasi
// struktur HH/HL (uptrend) atau LH/LL (downtrend), dan cek apakah closing terakhir
// menembus swing terakhir (BOS = melanjutkan struktur, CHoCH = membalik struktur).
function detectSwingStructure(candles) {
  if (!Array.isArray(candles) || candles.length < 10) {
    // Fallback: kalau candle OHLC broker/proxy belum tersedia, pakai trend-engine berbasis tick
    // sebagai proxy struktur (ditandai jelas sebagai proxy, bukan BOS/CHoCH asli dari candle).
    const trend = analyzeMarketTrend(lastWsPrice);
    const bosOk = ['BULLISH', 'BEARISH'].includes(trend.direction) && trend.strength >= 35;
    if (!bosOk) {
      return { valid: false, bias: 'UNKNOWN', bos: false, choch: false, side: 'WAIT', isProxy: true,
        reason: 'Data candle OHLC belum cukup, dan trend tick-proxy juga belum menunjukkan struktur yang jelas.' };
    }
    return { valid: true, bias: trend.direction, bos: true, choch: false, side: trend.side, isProxy: true,
      reason: `[Proxy tick — candle OHLC belum tersedia] BOS ${trend.direction} terdeteksi dari trend engine, strength ${trend.strength}%.` };
  }

  const lookback = 2;
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const win = candles.slice(i - lookback, i + lookback + 1);
    const h = candles[i].h, l = candles[i].l;
    if (Number.isFinite(h) && h === Math.max(...win.map(c => c.h))) swings.push({ type: 'high', index: i, price: h });
    if (Number.isFinite(l) && l === Math.min(...win.map(c => c.l))) swings.push({ type: 'low', index: i, price: l });
  }
  if (swings.length < 4) {
    return { valid: false, bias: 'UNKNOWN', bos: false, choch: false, side: 'WAIT', isProxy: false,
      reason: 'Swing point belum cukup terbentuk dari candle yang tersedia untuk menentukan struktur.' };
  }

  const highs = swings.filter(s => s.type === 'high').slice(-3);
  const lows = swings.filter(s => s.type === 'low').slice(-3);
  const lastClose = candles[candles.length - 1].c;

  let structureBias = 'UNKNOWN';
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
    const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
    const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
    if (hh && hl) structureBias = 'BULLISH';
    else if (lh && ll) structureBias = 'BEARISH';
  }

  const lastSwingHigh = highs[highs.length - 1] || null;
  const lastSwingLow = lows[lows.length - 1] || null;
  let bos = false, choch = false, side = 'WAIT';

  if (structureBias === 'BULLISH') {
    if (lastSwingHigh && lastClose > lastSwingHigh.price) { bos = true; side = 'BUY'; }
    else if (lastSwingLow && lastClose < lastSwingLow.price) { choch = true; side = 'SELL'; }
  } else if (structureBias === 'BEARISH') {
    if (lastSwingLow && lastClose < lastSwingLow.price) { bos = true; side = 'SELL'; }
    else if (lastSwingHigh && lastClose > lastSwingHigh.price) { choch = true; side = 'BUY'; }
  }

  const valid = bos || choch;
  let reason;
  if (!valid) {
    reason = structureBias === 'UNKNOWN'
      ? 'Struktur belum jelas — pola HH/HL (uptrend) atau LH/LL (downtrend) belum konsisten terbentuk.'
      : `Struktur ${structureBias} (HH/HL atau LH/LL) sudah terbentuk, tapi harga belum menembus swing terakhir untuk konfirmasi BOS/CHoCH.`;
  } else if (bos) {
    reason = `BOS ${side} terkonfirmasi — closing terakhir (${lastClose}) menembus swing ${side === 'BUY' ? 'high' : 'low'} sebelumnya (${side === 'BUY' ? lastSwingHigh.price : lastSwingLow.price}), melanjutkan struktur ${structureBias}.`;
  } else {
    reason = `CHoCH terdeteksi — struktur sebelumnya ${structureBias}, tapi closing terakhir (${lastClose}) menembus balik ke arah ${side}, indikasi potensi reversal.`;
  }

  return { valid, bias: structureBias, bos, choch, side, isProxy: false,
    lastSwingHigh: lastSwingHigh ? lastSwingHigh.price : null, lastSwingLow: lastSwingLow ? lastSwingLow.price : null, reason };
}

// Skor Supply & Demand / Support-Resistance: valid kalau harga ada di zona S&D yang sejalan
// dengan side, skor makin tinggi kalau makin dekat ke zona dan ada rejection candle.
function getSupplyDemandScore(side, price, smc, candles, weight) {
  if (side === 'WAIT' || !smc.smcSupplyDemand[2]) {
    return { score: 0, valid: false, reason: 'Belum ada zona supply/demand yang teridentifikasi sejalan dengan arah ini.' };
  }
  const m = getTradeMetrics(price);
  const dist = Math.abs(price - m.entry);
  const buffer = getEntryBuffer(price);
  const proximityScore = Math.max(0, 1 - Math.min(1, dist / (buffer * 6)));
  const rejection = candles && candles.length ? detectCandlestickConfirmation(candles, side).valid : false;
  const raw = 0.55 + proximityScore * 0.30 + (rejection ? 0.15 : 0);
  const score = Math.round(Math.min(1, raw) * weight);
  return {
    score, valid: true,
    reason: `Harga di zona ${side === 'BUY' ? 'Demand' : 'Supply'} (${formatPrice(m.entry)}), jarak ${dist.toFixed(2)} poin dari zona${rejection ? ', disertai rejection candle' : ''}.`
  };
}

// Konfluensi trend H1 & H4 — minimal salah satu searah sudah cukup menambah skor (tidak wajib keduanya).
function getTrendConfluenceScore(side, weight) {
  const tfs = getMultiTfTrends();
  const h1Aligned = side === 'BUY' ? tfs.H1.direction === 'BULLISH' : tfs.H1.direction === 'BEARISH';
  const h4Aligned = side === 'BUY' ? tfs.H4.direction === 'BULLISH' : tfs.H4.direction === 'BEARISH';
  const alignedCount = (h1Aligned ? 1 : 0) + (h4Aligned ? 1 : 0);
  const score = Math.round(weight * (alignedCount / 2));
  return {
    score, h1: tfs.H1.direction, h4: tfs.H4.direction, aligned: alignedCount > 0,
    reason: alignedCount === 0
      ? `Trend H1 (${tfs.H1.direction}) dan H4 (${tfs.H4.direction}) belum ada yang searah dengan ${side}.`
      : `Trend ${alignedCount === 2 ? 'H1 & H4 sama-sama' : (h1Aligned ? 'H1' : 'H4')} mendukung arah ${side}.`
  };
}

// Konfirmasi candlestick (opsional, tidak wajib): engulfing atau pin bar/rejection kuat.
function detectCandlestickConfirmation(candles, side) {
  if (!Array.isArray(candles) || candles.length < 2) return { valid: false, pattern: null, reason: 'Data candle belum cukup untuk cek pola candlestick.' };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (![last.o, last.h, last.l, last.c, prev.o, prev.c].every(Number.isFinite)) {
    return { valid: false, pattern: null, reason: 'Data OHLC candle terakhir tidak lengkap.' };
  }
  const body = Math.abs(last.c - last.o);
  const range = Math.max(1e-9, last.h - last.l);
  const upperWick = last.h - Math.max(last.c, last.o);
  const lowerWick = Math.min(last.c, last.o) - last.l;

  const bullishEngulf = last.c > last.o && prev.c < prev.o && last.c >= prev.o && last.o <= prev.c;
  const bearishEngulf = last.c < last.o && prev.c > prev.o && last.o >= prev.c && last.c <= prev.o;
  const bullishPin = lowerWick >= body * 2 && (lowerWick / range) >= 0.5 && last.c >= last.o;
  const bearishPin = upperWick >= body * 2 && (upperWick / range) >= 0.5 && last.c <= last.o;

  if (side === 'BUY' && (bullishEngulf || bullishPin)) {
    return { valid: true, pattern: bullishEngulf ? 'Bullish Engulfing' : 'Bullish Pin Bar / Rejection',
      reason: `Candle terakhir ${bullishEngulf ? 'bullish engulfing' : 'pin bar penolakan ke bawah'}, mendukung entry BUY.` };
  }
  if (side === 'SELL' && (bearishEngulf || bearishPin)) {
    return { valid: true, pattern: bearishEngulf ? 'Bearish Engulfing' : 'Bearish Pin Bar / Rejection',
      reason: `Candle terakhir ${bearishEngulf ? 'bearish engulfing' : 'pin bar penolakan ke atas'}, mendukung entry SELL.` };
  }
  return { valid: false, pattern: null, reason: 'Tidak ada pola candlestick konfirmasi di candle terakhir (opsional, tidak wajib).' };
}

// Fungsi utama: gabungkan semua faktor jadi satu Confidence Score (0-100) dengan
// Market Structure sebagai syarat wajib (gate). Kalau struktur tidak valid -> langsung NO TRADE.
function getEntryScoreAnalysis(price = lastWsPrice) {
  const st = getSettings();
  const w = { ...DEFAULT_SETTINGS.entryScoreWeights, ...(st.entryScoreWeights || {}) };
  const minScore = Number.isFinite(st.minConfidenceScore) ? st.minConfidenceScore : DEFAULT_SETTINGS.minConfidenceScore;
  const candles = (OHLC_CACHE.H1 && OHLC_CACHE.H1.length >= 10) ? OHLC_CACHE.H1 : (OHLC_CACHE.M15 || []);
  const structure = detectSwingStructure(candles);

  if (!structure.valid) {
    return {
      side: 'NO_TRADE', rawSide: 'WAIT', band: 'NO_TRADE', score: 0,
      structure,
      supplyDemand: { valid: false, score: 0, reason: 'Dilewati — Market Structure belum valid (syarat wajib).' },
      trend: { aligned: false, score: 0, h1: 'UNKNOWN', h4: 'UNKNOWN', reason: 'Dilewati — Market Structure belum valid (syarat wajib).' },
      candlestick: { valid: false, score: 0, pattern: null, reason: 'Dilewati — Market Structure belum valid (syarat wajib).' },
      weights: w, minScore,
      summary: `NO TRADE — Market Structure belum valid. ${structure.reason}`
    };
  }

  const side = structure.side;
  const smc = getSMCState();
  const sd = getSupplyDemandScore(side, price, smc, candles, w.supplyDemand);
  const trendC = getTrendConfluenceScore(side, w.trend);
  const candle = detectCandlestickConfirmation(candles, side);
  const candleScore = candle.valid ? w.candlestick : 0;
  const structureScore = w.structure;
  const total = Math.min(100, structureScore + sd.score + trendC.score + candleScore);

  let band = 'NO_TRADE';
  if (total >= 90) band = 'STRONG';
  else if (total >= 75) band = 'VALID_ENTRY';
  else if (total >= 60) band = 'AGGRESSIVE';
  if (total < minScore) band = 'NO_TRADE';

  const bandLabel = band === 'STRONG' ? `Strong ${side}` : band === 'VALID_ENTRY' ? 'Valid Entry' : band === 'AGGRESSIVE' ? 'Entry Agresif (risiko lebih tinggi)' : 'No Trade';

  return {
    side: band === 'NO_TRADE' ? 'NO_TRADE' : side, rawSide: side, band, score: total,
    structure,
    supplyDemand: sd,
    trend: trendC,
    candlestick: { valid: candle.valid, score: candleScore, pattern: candle.pattern, reason: candle.reason },
    weights: w, minScore,
    summary: band === 'NO_TRADE'
      ? `NO TRADE — total score ${total}/100 di bawah ambang minimum ${minScore}.`
      : `${side} — ${bandLabel}, score ${total}/100.`
  };
}

// Terapkan preset strategi (Scalping/Intraday/Swing) — mengubah bobot & ambang minimum sekaligus.
function applyStrategyPreset(name) {
  const preset = STRATEGY_PRESETS[name];
  if (!preset) { showToast(`Preset "${name}" tidak dikenal.`, 'error'); return; }
  const st = getSettings();
  st.strategyPreset = name;
  st.entryScoreWeights = { ...preset.weights };
  st.minConfidenceScore = preset.minConfidenceScore;
  appSettings = { ...appSettings, ...st };
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(appSettings));
  showToast(`Preset strategi "${name}" diterapkan (min score ${preset.minConfidenceScore}).`, 'success');
  addLog(`Strategy preset diubah ke "${name}": bobot=${JSON.stringify(preset.weights)}, minScore=${preset.minConfidenceScore}.`, 'info');
}
window.applyStrategyPreset = applyStrategyPreset;

function getConfidenceComponents(decision = currentPlanDecision) {
  const analysis = lastEntryScoreAnalysis || getEntryScoreAnalysis(lastWsPrice);
  const w = analysis.weights;
  return [
    { name: 'Market Structure (BOS/CHoCH)', value: analysis.structure.valid ? w.structure : 0, max: w.structure },
    { name: 'Supply & Demand / S-R', value: analysis.supplyDemand.score, max: w.supplyDemand },
    { name: 'Trend H1 & H4', value: analysis.trend.score, max: w.trend },
    { name: 'Candlestick Confirmation', value: analysis.candlestick.score, max: w.candlestick }
  ].map(c => ({ ...c, pct: Math.round((c.value / c.max) * 100) }));
}
function updateAIIntelligence(decision = currentPlanDecision) {
  if (!decision) return;
  const comps = getConfidenceComponents(decision);
  const totalRaw = comps.reduce((a,c)=>a+c.value,0);
  const total = usingSimulatedPrice ? Math.min(totalRaw, 20) : totalRaw;
  const reasons = buildAIReasons(decision);
  safeText('finalConf', `${Math.min(100, Math.round(total))}%`);
  safeText('finalConfl', `${Math.round(Object.values(getSMCState()).filter(v=>v[2]).length / 10 * 100)}%`);
  safeText('aiDecisionTitle', `Trade Decision: ${decision.state || decision.title}`);
  safeText('aiDecisionBadge', decision.code || 'XAUUSD MODEL');
  const list = document.getElementById('aiReasonList');
  if (list) list.innerHTML = reasons.map(r => `<div class="reason-item"><i class="fas ${r.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i><span>${escapeHtml(r.text)}</span></div>`).join('');
  const breakdown = document.getElementById('confidenceBreakdown');
  if (breakdown) breakdown.innerHTML = comps.map(c => `<div class="score-row"><span>${escapeHtml(c.name)}</span><div class="score-track"><div class="score-fill" style="width:${c.pct}%"></div></div><strong>${c.value}%</strong></div>`).join('') + `<div class="mt-2 text-right text-amber-400 font-bold mono">Total ${Math.min(100, Math.round(total))}%</div><div class="mt-1 text-right text-[10px] text-muted">SMC/DOM memakai proxy harga intrabar; validasi OHLC broker tetap diperlukan.</div>`;
}
function buildAIReasons(decision) {
  const m = getTradeMetrics(lastWsPrice);
  const dataOk = livePriceVerified && !usingSimulatedPrice && recentPrices.length >= MIN_TREND_SAMPLES;
  const analysis = lastEntryScoreAnalysis || getEntryScoreAnalysis(lastWsPrice);
  return [
    { ok:dataOk, text:dataOk ? `Live price verified dari ${lastDataSource}` : usingSimulatedPrice ? 'Harga simulasi aktif — sinyal entry diblokir' : `Data tren belum cukup (${recentPrices.length}/${MIN_TREND_SAMPLES} tick)` },
    { ok:analysis.structure.valid, text:`Market Structure (wajib): ${analysis.structure.reason}` },
    { ok:analysis.supplyDemand.valid, text:`Supply & Demand: ${analysis.supplyDemand.reason}` },
    { ok:analysis.trend.aligned, text:`Trend H1/H4: ${analysis.trend.reason}` },
    { ok:analysis.candlestick.valid, text:`Candlestick: ${analysis.candlestick.reason}` },
    { ok:calendarManualOverride || !highImpactNewsDetected, text: calendarManualOverride ? 'Override kalender ON (admin tanggung risiko news)' : calendarStatus === 'high_impact' ? ('High Impact News: ' + (highImpactNewsLabel || 'aktif')) : calendarStatus === 'verified' ? 'Calendar TERVERIFIKASI — tidak ada high-impact dekat' : calendarStatus === 'unavailable' ? 'Calendar offline — belum diverifikasi (AI tetap analisis harga)' : 'Calendar belum dicek' },
    { ok:dxyState.bias !== 'UNKNOWN', text:`DXY monitor: ${dxyState.bias} (${dxyState.source})` },
    { ok:getTradingSession().active, text:`Session checker: ${getTradingSession().name} / ${getTradingSession().risk}` },
    { ok:analysis.band !== 'NO_TRADE', text:`Kesimpulan: ${analysis.summary}` }
  ];
}

function getEnabledIndicators() {
  return Array.from(document.querySelectorAll('#indicatorControls input[type="checkbox"]')).filter(i => i.checked).map(i => i.dataset.indicator);
}
function onIndicatorChange() {
  if (chartMode === 'internal') renderInternalChart(lastWsPrice);
  else initTradingViewWidget();
  showToast('Indicator setting diperbarui', 'info');
}
function calculateEMA(values, period) {
  const k = 2 / (period + 1);
  let ema = values[0] || 0;
  return values.map((v, i) => {
    ema = i === 0 ? v : (v * k) + (ema * (1-k));
    return ema;
  });
}
function getTradingViewStudies() {
  const indicators = getEnabledIndicators();
  const studies = [];
  // Studies yang benar-benar didukung embed lite TradingView.
  // Catatan: panjang EMA spesifik (20/50/200) hanya presisi di chart internal (canvas),
  // di TradingView tampil sebagai MA Exponential tunggal.
  if (indicators.includes('ema20') || indicators.includes('ema50') || indicators.includes('ema200')) studies.push('MAExp@tv-basicstudies');
  if (indicators.includes('vwap')) studies.push('VWAP@tv-basicstudies');
  if (indicators.includes('atr')) studies.push('ATR@tv-basicstudies');
  if (indicators.includes('volume')) studies.push('Volume@tv-basicstudies');
  return studies;
}

function renderBacktestCharts() {
  const rows = getJournalHistory().filter(r => r.resultTrade && r.resultTrade !== 'OPEN');
  if (!rows.length) {
    // No demo curves — clear canvases
    ['equityCurveCanvas', 'profitCurveCanvas', 'drawdownCurveCanvas'].forEach((id) => {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width || 420, h = canvas.height || 160;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#060a13';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#64748b';
      ctx.font = '12px Space Grotesk, sans-serif';
      ctx.fillText('No closed trades in journal', 16, 28);
    });
    safeText('btWinRate', '--%');
    safeText('btProfitFactor', '--');
    safeText('btSharpe', '--');
    safeText('btAvgRR', '--');
    safeText('btMaxDD', '--%');
    safeText('btMonthlyProfit', '--');
    safeText('btWeeklyProfit', '--');
    safeText('btTradeDist', '--');
    safeText('btAvgHolding', '--');
    safeText('btWinBuySell', '--');
    return;
  }
  const wins = rows.filter(r => Number(r.pnl || 0) > 0).length;
  const losses = rows.length - wins;
  const winRate = (wins / rows.length) * 100;
  const grossWin = rows.reduce((a, r) => a + Math.max(0, Number(r.pnl || 0)), 0);
  const grossLoss = Math.abs(rows.reduce((a, r) => a + Math.min(0, Number(r.pnl || 0)), 0));
  const pf = grossLoss > 0 ? (grossWin / grossLoss) : (grossWin > 0 ? Infinity : 0);
  let equity = 10000;
  const equitySeries = [equity];
  const profitSeries = [0];
  const ddSeries = [0];
  let peak = equity;
  rows.forEach((r) => {
    equity += Number(r.pnl || 0);
    equitySeries.push(equity);
    profitSeries.push(equity - 10000);
    peak = Math.max(peak, equity);
    ddSeries.push(peak > 0 ? ((equity - peak) / peak) * 100 : 0);
  });
  drawMiniLineChart('equityCurveCanvas', equitySeries, '#22c55e');
  drawMiniLineChart('profitCurveCanvas', profitSeries, '#38bdf8');
  drawMiniLineChart('drawdownCurveCanvas', ddSeries, '#ef4444');
  safeText('btWinRate', `${winRate.toFixed(1)}%`);
  safeText('btProfitFactor', Number.isFinite(pf) ? pf.toFixed(2) : '∞');
  safeText('btTradeDist', `${wins}/${losses}`);
  safeText('btMaxDD', `${Math.abs(Math.min(...ddSeries)).toFixed(2)}%`);
  const month = new Date().toISOString().slice(0, 7);
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const monthPnL = rows.filter(r => String(r.savedAt || '').slice(0, 7) === month).reduce((a, r) => a + Number(r.pnl || 0), 0);
  const weekPnL = rows.filter(r => new Date(r.savedAt || 0).getTime() >= weekAgo).reduce((a, r) => a + Number(r.pnl || 0), 0);
  safeText('btMonthlyProfit', formatMoney(monthPnL));
  safeText('btWeeklyProfit', formatMoney(weekPnL));
}
function drawMiniLineChart(id, data, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(280, rect.width || 420), h = Math.max(120, rect.height || 160), dpr = window.devicePixelRatio || 1;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h); ctx.fillStyle='#060a13'; ctx.fillRect(0,0,w,h);
  const min = Math.min(...data), max = Math.max(...data), span = Math.max(max-min,1), pad=18;
  const pts = data.map((v,i)=>({x:pad+i*(w-pad*2)/(data.length-1), y:pad+(max-v)/span*(h-pad*2)}));
  ctx.strokeStyle='#1c2a4a'; ctx.lineWidth=1; for(let i=0;i<4;i++){const y=pad+i*(h-pad*2)/3;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke();}
  const grad = ctx.createLinearGradient(0,pad,0,h-pad); grad.addColorStop(0,color+'55'); grad.addColorStop(1,'transparent');
  ctx.beginPath(); ctx.moveTo(pts[0].x,h-pad); pts.forEach(p=>ctx.lineTo(p.x,p.y)); ctx.lineTo(pts[pts.length - 1].x, h-pad); ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
  ctx.beginPath(); pts.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.stroke();
}

function autoBackupJournal(silent = false) {
  const backup = { createdAt:new Date().toISOString(), settings:getSettings(), journal:getJournalHistory() };
  localStorage.setItem(STORAGE_KEYS.backup, JSON.stringify(backup));
  if (!silent) showToast('Backup lokal berhasil dibuat', 'success');
}
function restoreBackupJournal() {
  try {
    const backup = JSON.parse(localStorage.getItem(STORAGE_KEYS.backup) || '{}');
    if (!backup.journal) throw new Error('Backup tidak ditemukan');
    setJournalHistory(backup.journal);
    if (backup.settings) { appSettings = { ...DEFAULT_SETTINGS, ...backup.settings }; localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(appSettings)); loadSettingsToForm(); }
    updateDashboardSummary(); updateRiskManagement();
    showToast('Backup berhasil direstore', 'success');
  } catch (err) { showToast(`Restore gagal: ${err.message}`, 'error'); }
}
function exportJournalCSV() {
  const rows = getJournalHistory();
  const headers = ['savedAt','pair','entry','stopLoss','tp1','tp2','tp3','lotSize','confidence','trend','news','dom','aiExplanation','resultTrade','traderNotes'];
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n');
  downloadText('ai-trading-journal.csv', csv, 'text/csv');
}
function exportJournalExcel() {
  const rows = getJournalHistory();
  const cols = ['savedAt','pair','action','entry','stopLoss','tp1','tp2','tp3','lotSize','confidence','resultTrade','pnl','aiExplanation'];
  if (typeof XLSX === 'undefined') {
    // Fallback: CSV bila lib XLSX belum termuat (offline).
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    downloadText('ai-trading-journal.csv', csv, 'text/csv');
    showToast('Lib XLSX belum termuat — ekspor sebagai CSV.', 'info');
    return;
  }
  const aoa = [cols, ...rows.map(r => cols.map(c => r[c] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Journal');
  XLSX.writeFile(wb, 'ai-trading-journal.xlsx');
  addLog('Journal diekspor sebagai .xlsx.', 'success');
}
function exportJournalPDF() {
  const rows = getJournalHistory();
  const win = window.open('', '_blank');
  if (!win) return showToast('Popup diblokir browser', 'error');

  const doc = win.document;
  doc.open();
  doc.title = 'Trading Journal PDF';

  const style = doc.createElement('style');
  style.textContent = 'body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:18px}h2{margin:0 0 6px}table{border-collapse:collapse;width:100%;margin-top:14px}td,th{border:1px solid #ccc;padding:6px;font-size:11px;text-align:left}th{background:#f3f4f6}pre{font-size:11px;color:#555}';
  doc.head.appendChild(style);

  const title = doc.createElement('h2');
  title.textContent = 'Trading Journal XAUUSD';
  doc.body.appendChild(title);

  const stamp = doc.createElement('pre');
  stamp.textContent = new Date().toLocaleString('id-ID');
  doc.body.appendChild(stamp);

  const table = doc.createElement('table');
  const header = doc.createElement('tr');
  ['Date', 'Entry', 'SL', 'TP', 'Lot', 'Confidence', 'Status'].forEach((name) => {
    const th = doc.createElement('th');
    th.textContent = name;
    header.appendChild(th);
  });
  table.appendChild(header);

  rows.forEach((row) => {
    const tr = doc.createElement('tr');
    [
      row.savedAt || '',
      row.entry || '',
      row.stopLoss || '',
      `${row.tp1 || ''}/${row.tp2 || ''}/${row.tp3 || ''}`,
      row.lotSize || '',
      row.confidence || '',
      row.status || ''
    ].forEach((value) => {
      const td = doc.createElement('td');
      td.textContent = String(value);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  doc.body.appendChild(table);
  doc.close();

  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch (err) {
      addLog(`PDF print dialog gagal: ${err.message}`, 'error');
    }
  }, 300);
}
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
function importHistoryFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = reader.result;
      let rows;
      const headers = ['savedAt','pair','entry','stopLoss','tp1','tp2','tp3','lotSize','confidence','trend','news','dom','aiExplanation','resultTrade','traderNotes'];
      if (file.name.endsWith('.json')) {
        rows = JSON.parse(text);
      } else {
        const lines = text.split(/\r?\n/).filter(l => l.trim().length);
        const dataLines = lines[0] && lines[0].toLowerCase().replace(/[^a-z]/g, '').startsWith('savedat') ? lines.slice(1) : lines;
        rows = dataLines.map(line => {
          const vals = parseCsvLine(line);
          const obj = {};
          headers.forEach((h, i) => {
            const v = (vals[i] ?? '').trim();
            obj[h] = v === '' ? '' : (['entry','stopLoss','tp1','tp2','tp3','lotSize'].includes(h) ? Number(v) : v);
          });
          return obj;
        }).filter(r => r.savedAt || Number.isFinite(r.entry));
      }
      setJournalHistory(Array.isArray(rows) ? rows : []);
      updateDashboardSummary(); updateRiskManagement();
      showToast(`Import berhasil: ${Array.isArray(rows) ? rows.length : 0} baris.`, 'success');
    } catch (err) { showToast(`Import gagal: ${err.message}`, 'error'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}
function downloadText(filename, content, mime='text/plain') {
  const blob = new Blob([content], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

function getEventCountdown(dateText) {
  const t = Date.parse(dateText || '');
  if (!Number.isFinite(t)) return 'Manual check';
  const diff = t - Date.now();
  if (diff < -3600000) return 'Released';
  if (diff < 0) return 'Now';
  const mins = Math.floor(diff / 60000), days = Math.floor(mins/1440), hrs = Math.floor((mins%1440)/60), rem = mins%60;
  if (days > 0) return days === 1 ? 'Besok' : `${days} hari lagi`;
  if (hrs > 0) return `${hrs} jam ${rem} menit lagi`;
  return `${rem} menit lagi`;
}
function updateCalendarCountdowns() {
  document.querySelectorAll('[data-countdown-date]').forEach(el => { el.textContent = getEventCountdown(el.dataset.countdownDate); });
  if (nextCalendarEvent) safeText('calendarNextCountdownEl', getEventCountdown(nextCalendarEvent.date));
}

function buildTelegramMessage(payload) {
  const action = payload.action || payload.side || 'WAIT';
  return `${action} XAUUSD\nEntry: ${payload.entry}\nSL: ${payload.stopLoss}\nTP1: ${payload.tp1}\nTP2: ${payload.tp2}\nTP3: ${payload.tp3}\nLot: ${payload.lotSize}\nConfidence: ${payload.confidence}\nReason: ${payload.aiExplanation || payload.notes || ''}`;
}
async function sendTelegramAlert(payload) {
  const st = getSettings();
  if (!st.telegramToken || !st.telegramChatId) {
    setSystemStatus('telegram','warn','Setup');
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${encodeURIComponent(st.telegramToken)}/sendMessage`;
    const res = await fetchWithTimeout(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ chat_id:st.telegramChatId, text:buildTelegramMessage(payload) }) }, 10000);
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
    setSystemStatus('telegram','ok','Sent');
    addLog('Telegram alert terkirim.', 'success');
    return true;
  } catch (err) {
    setSystemStatus('telegram','bad','Error');
    addLog(`Telegram alert gagal: ${err.message}`, 'error');
    return false;
  }
}
function captureChartPlaceholder() {
  return chartMode === 'internal' ? 'Internal canvas chart active (client-side screenshot placeholder)' : `TradingView ${getTradingViewSymbol()}`;
}
function getSheetsRequestUrl() {
  const st = getSettings();
  const base = (st.sheetsUrl || GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
  const token = (st.sheetsToken || GOOGLE_SHEETS_TOKEN || '').trim();
  if (!base || !token) return null; // belum dikonfigurasi → skip sync (secure-by-default)
  return `${base}?token=${encodeURIComponent(token)}`;
}

window.addEventListener('DOMContentLoaded', () => {
  tickClock();
  if (!restoreLockedPlanState()) {
    setInitialPlan(lastWsPrice);
  }
  initTradingViewWidget();
  updatePriceDisplay(lastWsPrice, 0);
  switchTab('dashboard');
  updateConnectionBadge(false);
  initEnterpriseModules();
  registerPWAServiceWorker();
  updatePwaInstallButton();
  doConnect();
  // Mode manual aktif secara default (API kalender eksternal sering diblokir CORS di browser).
  // Tidak lagi auto-fetch saat startup; cukup render status manual. Tekan REFRESH CALENDAR jika ingin coba ambil feed otomatis.
  updateCalendarMonitorUI();
  updateNewsHardBlockUI();
});


window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPwaPrompt = event;
  updatePwaInstallButton(true);
  addLog('PWA install prompt tersedia.', 'success');
});

window.addEventListener('appinstalled', () => {
  deferredPwaPrompt = null;
  updatePwaInstallButton(false);
  showToast('AI Trading Signal berhasil di-install sebagai app.', 'success');
  addLog('PWA app installed.', 'success');
});

function isPwaStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updatePwaInstallButton(canInstall = Boolean(deferredPwaPrompt)) {
  const btn = document.getElementById('installPwaBtn');
  if (!btn) return;
  if (isPwaStandalone()) {
    btn.classList.add('hidden');
    return;
  }
  if (canInstall) btn.classList.remove('hidden');
}

async function installPWA() {
  if (isPwaStandalone()) {
    showToast('Aplikasi sudah berjalan dalam mode PWA.', 'info');
    return;
  }

  if (!deferredPwaPrompt) {
    showToast('Install prompt belum tersedia. Buka file via HTTPS/localhost, lalu gunakan menu browser: Install App / Add to Home Screen.', 'info');
    addLog('Install PWA belum tersedia. Service worker butuh HTTPS/localhost, bukan file://.', 'info');
    return;
  }

  deferredPwaPrompt.prompt();
  const choice = await deferredPwaPrompt.userChoice;
  addLog(`PWA install choice: ${choice.outcome}`, choice.outcome === 'accepted' ? 'success' : 'info');
  deferredPwaPrompt = null;
  updatePwaInstallButton(false);
}

function registerPWAServiceWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    // file:// and sandboxed Android WebView cannot use SW
    if (location.protocol === 'file:' || location.protocol === 'content:') return;
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  } catch (e) {
    /* ignore SW in restricted contexts */
  }
}


function openMobileModules() {
  const drawer = document.getElementById('mobileModuleDrawer');
  if (!drawer) return;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeMobileModules() {
  const drawer = document.getElementById('mobileModuleDrawer');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function goMobileModule(tabId) {
  closeMobileModules();
  switchTab(tabId);
  setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
}

function toggleSystemDetails() {
  document.body.classList.toggle('show-system-details');
}

function switchTab(tabId) {
  if (document.getElementById('mobileModuleDrawer')?.classList.contains('open')) closeMobileModules();
  
  const isDashboard = tabId === 'dashboard';
  const appHeader = document.getElementById('appHeader');
  const floatingGearBtn = document.getElementById('floatingGearBtn');

  if (appHeader) {
      if (isDashboard) appHeader.classList.remove('hidden');
      else appHeader.classList.add('hidden');
  }
  
  if (floatingGearBtn) {
      if (isDashboard) floatingGearBtn.classList.remove('hidden');
      else floatingGearBtn.classList.add('hidden');
  }

  
  // Breadcrumb update
  const breadcrumb = document.getElementById('breadcrumb');
  if (breadcrumb) {
      const btn = document.getElementById(`btn-${tabId}`);
      const title = btn ? btn.innerText.trim() : tabId;
      breadcrumb.innerHTML = `<span class="text-slate-500">Terminal</span> <i class="fas fa-chevron-right text-[10px] mx-2"></i> <span class="text-amber-400 font-bold">${title}</span>`;
  }
  
  // Tabs processing
  const tabs = ['dashboard', 'tradingplan', 'chartanalysis', 'marketmonitor', 'calendar', 'confluence', 'dom', 'sentiment', 'riskmatrix', 'smartanalyzer', 'backtest', 'journal', 'settings'];
  
  tabs.forEach(id => {
    const el = document.getElementById(`tab-${id}`);
    const btn = document.getElementById(`btn-${id}`);
    if (el) {
        el.classList.remove('active-section');
        el.classList.add('hidden');
    }
    if (btn) btn.classList.remove('active');
  });

  const activeEl = document.getElementById(`tab-${tabId}`);
  const activeBtn = document.getElementById(`btn-${tabId}`);
  
  if (activeEl) {
      activeEl.classList.remove('hidden');
      // Adding a small delay ensures CSS transition applies after display:block
      setTimeout(() => {
          activeEl.classList.add('active-section');
      }, 10);
  }
  if (activeBtn) activeBtn.classList.add('active');

  // Trigger special actions based on tab
  if (tabId === 'tradingplan') updateTradingPlanValues(lastWsPrice);
  if (tabId === 'dom') updateDomTable(lastWsPrice);
  if (tabId === 'confluence') updateSMCGrid();
  if (tabId === 'riskmatrix') updateRiskManagement();
  if (tabId === 'backtest') renderBacktestCharts();
  if (tabId === 'journal' && typeof renderJournalTable === 'function') renderJournalTable();
  if (tabId === 'settings') loadSettingsToForm();
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const normalizedType = ['success', 'error', 'info'].includes(type) ? type : 'info';
  const toast = document.createElement('div');
  toast.className = `toast ${normalizedType}`;

  const wrap = document.createElement('div');
  wrap.className = 'flex items-center gap-2';

  const icon = document.createElement('i');
  icon.className = normalizedType === 'error'
    ? 'fas fa-circle-exclamation text-red-500'
    : normalizedType === 'info'
      ? 'fas fa-circle-info text-sky-400'
      : 'fas fa-circle-check text-green-500';

  const span = document.createElement('span');
  span.textContent = message;

  wrap.appendChild(icon);
  wrap.appendChild(span);
  toast.appendChild(wrap);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}


function getChartFeedList() {
  const cfg = getSymbolConfig();
  return CHART_FEED_FALLBACKS[currentSymbol] || [cfg.tv];
}

function getTradingViewSymbol() {
  const feeds = getChartFeedList();
  return feeds[chartFeedIndex % feeds.length] || getSymbolConfig().tv;
}

function updateChartFeedBadge(tvSymbol = getTradingViewSymbol()) {
  const badge = document.getElementById('tvFeedBadge');
  if (!badge) return;
  badge.innerText = chartMode === 'internal' ? 'MODE: CHART HP' : `TV: ${tvSymbol}`;
  badge.title = chartMode === 'internal' ? 'Internal mobile chart fallback' : `TradingView symbol: ${tvSymbol}`;
}

function getTradingViewEmbedUrl(tvSymbol) {
  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  const params = new URLSearchParams({
    frameElementId: 'tv_chart_container',
    symbol: tvSymbol,
    interval: currentRes,
    hidesidetoolbar: '1',
    hidetoptoolbar: isMobile ? '1' : '0',
    symboledit: '1',
    saveimage: '0',
    toolbarbg: '#111a2e',
    studies: JSON.stringify(getTradingViewStudies()),
    theme: 'dark',
    style: '1',
    timezone: 'Asia/Jakarta',
    withdateranges: isMobile ? '0' : '1',
    hideideas: '1',
    locale: 'id',
    showpopupbutton: '1',
    popup_width: '1000',
    popup_height: '650'
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

function cycleChartFeed() {
  const feeds = getChartFeedList();
  chartFeedIndex = (chartFeedIndex + 1) % feeds.length;
  chartMode = 'tradingview';
  const tvSymbol = getTradingViewSymbol();
  initTradingViewWidget();
  showToast(`Feed chart diganti ke ${tvSymbol}`, 'info');
  addLog(`TradingView feed diganti ke ${tvSymbol}.`, 'info');
}

function openTradingViewChart() {
  const tvSymbol = getTradingViewSymbol();
  const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  addLog(`Open TradingView full chart: ${tvSymbol}`, 'info');
}

function showInternalChart() {
  chartMode = 'internal';
  renderInternalChart(lastWsPrice);
  updateChartFeedBadge();
  showToast('Chart HP internal aktif. Ini fallback jika TradingView diblokir/tidak tampil di HP.', 'info');
}

function buildInternalSeries(price = lastWsPrice) {
  const source = recentPrices.filter(v => Number.isFinite(v) && v > 0);
  if (source.length >= 2) return source.slice(-60);
  // REAL-ONLY: no synthetic sine wave. Flat line at last known price if any.
  const p = Number.isFinite(price) && price > 0 ? price : null;
  if (!p) return [];
  return [p, p];
}

function renderInternalChart(price = lastWsPrice) {
  const widgetEl = document.getElementById('tradingview_widget');
  if (!widgetEl) return;
  const cfg = getSymbolConfig();
  const series = buildInternalSeries(price);

  widgetEl.innerHTML = `
    <div class="h-full w-full rounded-lg overflow-hidden bg-slate-950 border border-slate-800 relative">
      <div class="chart-floating-actions">
        <span class="badge badge-gold mono">CANVAS CHART HP</span>
        <span class="badge badge-cyan mono">XAUUSD</span>
        <button class="btn btn-outline" onclick="showTradingViewChart()">KEMBALI TV</button>
      </div>
      <canvas id="internalChartCanvas" class="chart-canvas" aria-label="Smooth internal XAUUSD chart"></canvas>
    </div>`;

  requestAnimationFrame(() => drawInternalChartCanvas(series, cfg));
}

function drawInternalChartCanvas(series, cfg = getSymbolConfig()) {
  const canvas = document.getElementById('internalChartCanvas');
  if (!canvas) return;
  if (!series || series.length < 2) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1,0,0,1,0,0);
      ctx.fillStyle = '#060a13';
      ctx.fillRect(0, 0, canvas.width || 900, canvas.height || 460);
      ctx.fillStyle = '#64748b';
      ctx.font = '13px Space Grotesk, sans-serif';
      ctx.fillText('Menunggu tick live XAUUSD…', 24, 40);
    }
    return;
  }
  if (internalChartFrame) cancelAnimationFrame(internalChartFrame);

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || 900);
  const height = Math.max(240, rect.height || 460);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const padL = 44;
  const padR = 58;
  const padT = 58;
  const padB = 38;
  const minP = Math.min(...series);
  const maxP = Math.max(...series);
  const span = Math.max(maxP - minP, 0.01);
  const points = series.map((v, i) => ({
    x: padL + (i / Math.max(series.length - 1, 1)) * (width - padL - padR),
    y: padT + ((maxP - v) / span) * (height - padT - padB),
    v
  }));
  const up = points[points.length - 1].v >= points[0].v;
  const lineColor = up ? '#22c55e' : '#ef4444';

  function pathSmooth(pts) {
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 2; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    const n = pts.length;
    if (n > 2) ctx.quadraticCurveTo(pts[n - 2].x, pts[n - 2].y, pts[n - 1].x, pts[n - 1].y);
    else if (n === 2) ctx.lineTo(pts[1].x, pts[1].y);
  }

  function draw(progress = 1) {
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#060a13');
    bg.addColorStop(1, '#0f172a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.font = '11px JetBrains Mono, monospace';
    ctx.strokeStyle = '#1c2a4a';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    for (let i = 0; i <= 4; i++) {
      const y = padT + i * ((height - padT - padB) / 4);
      const val = maxP - i * (span / 4);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      ctx.fillText(formatPrice(val, cfg.decimals), width - padR + 8, y + 4);
    }


    const indicators = getEnabledIndicators();
    if (indicators.includes('asia')) { ctx.fillStyle='rgba(56,189,248,.05)'; ctx.fillRect(padL, padT, (width-padL-padR)*0.28, height-padT-padB); }
    if (indicators.includes('london')) { ctx.fillStyle='rgba(212,160,23,.055)'; ctx.fillRect(padL+(width-padL-padR)*0.32, padT, (width-padL-padR)*0.30, height-padT-padB); }
    if (indicators.includes('ny')) { ctx.fillStyle='rgba(34,197,94,.045)'; ctx.fillRect(padL+(width-padL-padR)*0.66, padT, (width-padL-padR)*0.30, height-padT-padB); }
    if (indicators.includes('volume')) {
      const maxVol = Math.max(...series.map((v,i)=> Math.abs(v - (series[i-1] || v))));
      series.forEach((v,i)=>{
        const diff = Math.abs(v - (series[i-1] || v));
        const barH = Math.max(2, (diff / Math.max(maxVol, .01)) * 34);
        const x = padL + (i / Math.max(series.length - 1, 1)) * (width - padL - padR);
        ctx.fillStyle = v >= (series[i-1] || v) ? 'rgba(34,197,94,.22)' : 'rgba(239,68,68,.22)';
        ctx.fillRect(x-2, height-padB-barH, 4, barH);
      });
    }
    if (indicators.includes('ohl')) {
      const openY = points[0].y, highY = padT, lowY = height-padB;
      [['Open',openY,'#d4a017'],['High',highY,'#22c55e'],['Low',lowY,'#ef4444']].forEach(([label,y,c])=>{
        ctx.strokeStyle = c; ctx.setLineDash([4,5]); ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(width-padR,y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = c; ctx.fillText(label, padL+4, y-4);
      });
    }

    const revealW = (width - padL - padR) * progress;
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT - 10, revealW, height - padT - padB + 20);
    ctx.clip();

    const areaGrad = ctx.createLinearGradient(0, padT, 0, height - padB);
    areaGrad.addColorStop(0, up ? 'rgba(34,197,94,.26)' : 'rgba(239,68,68,.24)');
    areaGrad.addColorStop(1, 'rgba(6,10,19,0)');
    ctx.beginPath();
    ctx.moveTo(points[0].x, height - padB);
    pathSmooth(points);
    ctx.lineTo(points[points.length - 1].x, height - padB);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    ctx.beginPath();
    pathSmooth(points);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = lineColor;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    function drawIndicatorLine(values, color, widthLine = 1.6) {
      const indicatorPts = values.map((v,i)=>({
        x: padL + (i / Math.max(values.length - 1, 1)) * (width - padL - padR),
        y: padT + ((maxP - v) / span) * (height - padT - padB)
      }));
      ctx.beginPath();
      indicatorPts.forEach((p,i)=> i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
      ctx.strokeStyle = color; ctx.lineWidth = widthLine; ctx.shadowBlur = 0; ctx.stroke();
    }
    if (indicators.includes('ema20')) drawIndicatorLine(calculateEMA(series, 20), '#f59e0b', 1.8);
    if (indicators.includes('ema50')) drawIndicatorLine(calculateEMA(series, 50), '#38bdf8', 1.6);
    if (indicators.includes('ema200')) drawIndicatorLine(calculateEMA(series, 200), '#a855f7', 1.5);
    if (indicators.includes('vwap')) {
      const avg = series.reduce((a,b)=>a+b,0)/series.length;
      drawIndicatorLine(series.map(()=>avg), '#e2e8f0', 1.2);
    }
    if (indicators.includes('atr')) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText(`ATR logic SL $${GOLD_PLAN.slDistance.toFixed(2)} / TP $${GOLD_PLAN.tp1Distance.toFixed(0)}-$${GOLD_PLAN.tp3Distance.toFixed(0)}`, padL, height - 10);
    }

    ctx.restore();

    const last = points[points.length - 1];
    if (progress >= 0.98) {
      ctx.beginPath();
      ctx.arc(last.x, last.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.font = 'bold 13px JetBrains Mono, monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`${cfg.display} ${formatPrice(last.v, cfg.decimals)}`, padL, 26);
      ctx.fillStyle = '#d4a017';
      ctx.fillText('Gold ATR Plan: Entry -$4.5 | SL -$8 | TP +$12/+25/+45', padL, 45);
    }
  }

  const start = performance.now();
  function animate(now) {
    const progress = Math.min(1, (now - start) / 650);
    draw(progress);
    if (progress < 1) internalChartFrame = requestAnimationFrame(animate);
  }
  internalChartFrame = requestAnimationFrame(animate);
}

function showTradingViewChart() {
  chartMode = 'tradingview';
  initTradingViewWidget();
}

function initTradingViewWidget() {
  const widgetEl = document.getElementById('tradingview_widget');
  if (!widgetEl) return;
  widgetEl.innerHTML = '';

  const cfg = getSymbolConfig();
  const tvSymbol = getTradingViewSymbol();
  safeText('chSym', cfg.display);
  updateChartFeedBadge(tvSymbol);

  const container = document.createElement('div');
  container.id = 'tv_chart_container';
  container.style.height = '100%';
  container.style.width = '100%';
  container.style.position = 'relative';
  widgetEl.appendChild(container);

  const iframe = document.createElement('iframe');
  iframe.className = 'tv-iframe';
  iframe.title = `TradingView chart ${tvSymbol}`;
  iframe.src = getTradingViewEmbedUrl(tvSymbol);
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.style.display = 'block';
  iframe.setAttribute('allowfullscreen', 'true');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('referrerpolicy', 'origin');
  iframe.setAttribute('scrolling', 'no');
  iframe.addEventListener('load', () => setSystemStatus('tradingview', 'ok', 'Ready'));
  iframe.addEventListener('error', () => setSystemStatus('tradingview', 'bad', 'Blocked'));
  container.appendChild(iframe);
  setSystemStatus('tradingview', 'warn', 'Loading');

  const help = document.createElement('div');
  help.className = 'chart-help-banner hidden absolute left-2 right-2 bottom-2 z-10 text-[10px] text-muted bg-black/70 border border-slate-700 rounded-lg px-3 py-2';
  help.innerHTML = 'Jika chart TradingView tidak tampil di HP/Brave, klik <b>GANTI FEED</b>, <b>BUKA FULL</b>, atau <b>CHART HP</b>.';
  container.appendChild(help);
}

function updateConnectionBadge(isConnected) {
  const badge = document.getElementById('connBadge');
  if (badge) {
    badge.className = `badge ${isConnected ? 'badge-green' : 'badge-red'} mono`;
    badge.innerHTML = `<i class="fas fa-circle text-[8px]" id="connDot"></i> ${isConnected ? 'LIVE' : 'OFFLINE'}`;
  }
  const radar = document.getElementById('radarBadge');
  if (radar) {
    if (isConnected) {
      radar.className = 'badge badge-cyan mono';
      radar.innerHTML = '<i class="fas fa-satellite-dish radar-icon"></i> SCANNING';
    } else {
      radar.className = 'badge badge-orange mono';
      radar.innerHTML = '<i class="fas fa-satellite-dish"></i> IDLE';
    }
  }
}

function doConnect() {
  connected = true;
  updateConnectionBadge(true);
  priceSocketRetries = 0;
  if ('Notification' in window && Notification.permission === 'default') {
    requestBrowserNotifyPermission();
  }

  // HTTP poll safety-net: SELALU jalan & otomatis skip saat WebSocket aktif,
  // sehingga harga tetap mengalir walau WS gagal/gangguan.
  if (livePriceInterval) clearInterval(livePriceInterval);
  livePriceInterval = setInterval(function () {
    if (connected && !wsModeActive) fetchRealLivePrice();
  }, 3000);
  fetchRealLivePrice();

  const useWs = getSettings().useWs !== false;
  const wsOk = useWs ? connectPriceSocket() : false;
  if (wsOk) {
    showToast('Menghubungkan WebSocket…', 'info');
    addLog('Live stream: WebSocket preferred (HTTP poll sebagai cadangan).', 'success');
  } else {
    showToast('Live polling HTTP aktif', 'success');
    addLog(useWs ? 'Live stream: HTTP poll 3s (WebSocket tidak tersedia di proxy ini).' : 'Live stream: HTTP poll 3s (WebSocket dimatikan di Settings).', 'success');
  }
}

function doDisconnect() {
  connected = false;
  updateConnectionBadge(false);
  closePriceSocket();
  if (livePriceInterval) {
    clearInterval(livePriceInterval);
    livePriceInterval = null;
  }
  showToast('Live stream dihentikan', 'info');
  addLog('Live stream dihentikan.', 'info');
}


function updateNewsHardBlockUI() {
  newsHardBlockActive = Boolean(highImpactNewsDetected && !calendarManualOverride);
  document.querySelectorAll('[data-generate-signal="1"]').forEach((btn) => {
    btn.disabled = newsHardBlockActive;
    btn.classList.toggle('news-disabled', newsHardBlockActive);
    btn.title = newsHardBlockActive ? 'News Hard-Block aktif: tunggu rilis penting selesai.' : '';
  });
}

function checkBreakEvenSuggestion(price = lastWsPrice) {
  const m = getTradeMetrics(price);
  const el = document.getElementById('tpBreakEvenStatus');
  if (!el || !(m.side === 'BUY' || m.side === 'SELL')) {
    if (el) { el.innerText = 'Waiting'; el.className = 'be-wait'; }
    return;
  }
  const floatingDistance = m.side === 'BUY' ? price - m.entry : m.entry - price;
  const beTrig = getDynamicPlanDistances(price).breakEvenTrigger;
  if (floatingDistance >= beTrig) {
    el.innerText = `MOVE SL TO BE @ ${formatPrice(m.entry, m.cfg.decimals)}`;
    el.className = 'be-ready';
    if (!breakEvenSuggested) {
      breakEvenSuggested = true;
      showToast(`Auto Break-Even: floating +$${floatingDistance.toFixed(2)}. Geser SL ke entry ${formatPrice(m.entry)}.`, 'success');
      addLog(`Break-Even suggested for ${m.side}: SL -> ${formatPrice(m.entry)}.`, 'success');
    }
  } else {
    el.innerText = `Waiting +$${beTrig.toFixed(2)} (${floatingDistance.toFixed(2)})`;
    el.className = 'be-wait';
  }
}

// ================= SETUP VALIDITY CHECK (manual close guidance) =================
// Menilai apakah setup yang sudah di-lock masih layak ditunggu sampai TP,
// atau momentumnya sudah melemah/berbalik sehingga lebih baik ditutup manual.
function getSetupValidation(price = lastWsPrice) {
  const d = getSymbolConfig().decimals;
  if (lockedTradeSide !== 'BUY' && lockedTradeSide !== 'SELL') {
    return { status: 'NONE', tone: 'orange', badge: 'BELUM ADA SETUP', title: 'Belum Ada Setup Terkunci', detail: 'Belum ada posisi yang di-lock. Tekan GENERATE SIGNAL dan tunggu status ENTRY VALID agar plan terkunci.', recommendation: 'Tunggu entry terkunci sebelum cek validasi.' };
  }
  if (!Number.isFinite(lockedEntryPrice) || !Number.isFinite(lockedSL)) {
    return { status: 'NONE', tone: 'orange', badge: 'DATA BELUM SIAP', title: 'Data Plan Belum Lengkap', detail: 'Entry/SL belum tersedia untuk dievaluasi.', recommendation: 'Coba lagi setelah harga live masuk.' };
  }

  const m = getTradeMetrics(price);
  const tp1Dist = Math.abs(m.tp1 - lockedEntryPrice) || 1;
  const progress = lockedTradeSide === 'BUY' ? (price - lockedEntryPrice) : (lockedEntryPrice - price);
  const progressPct = progress / tp1Dist;
  bestFavorProgress = Math.max(bestFavorProgress, progressPct);

  const slHit = lockedTradeSide === 'BUY' ? price <= lockedSL : price >= lockedSL;
  const trend = analyzeMarketTrend(price);
  const trendAgainst = trend.side !== 'WAIT' && trend.side !== lockedTradeSide;
  const floatingUsd = progress; // dalam satuan harga (poin), sejalan dengan tampilan lain di app
  const distToSl = Math.abs(price - lockedSL);

  if (slHit) {
    return {
      status: 'INVALID', tone: 'red', badge: '🔴 TIDAK VALID', title: '🔴 SETUP TIDAK VALID — SL TERTEMBUS',
      detail: `Harga (${formatPrice(price, d)}) sudah melewati level Stop Loss ${formatPrice(lockedSL, d)}. Setup ${lockedTradeSide} ini sudah rusak.`,
      recommendation: 'Tutup posisi manual sekarang jika masih terbuka di broker, jangan tunggu TP.'
    };
  }

  if (progressPct >= 1) {
    return {
      status: 'TP1_HIT', tone: 'green', badge: '🟢 TP1 TERCAPAI', title: '🟢 TP1 SUDAH TERCAPAI',
      detail: `Harga sudah mencapai/lewat area TP1 (${formatPrice(m.tp1, d)}). Floating +${floatingUsd.toFixed(2)} poin dari entry ${formatPrice(lockedEntryPrice, d)}.`,
      recommendation: 'Pertimbangkan partial close di TP1 dan geser SL mengikuti (trailing) untuk kunci profit sisanya menuju TP2/TP3.'
    };
  }

  if (bestFavorProgress >= 0.25 && progressPct <= 0.05) {
    return {
      status: 'WEAK', tone: 'orange', badge: '⚠️ MOMENTUM MELEMAH', title: '⚠️ SETUP MELEMAH — SEMPAT PROFIT, KINI BALIK KE ENTRY',
      detail: `Harga sempat bergerak ${(bestFavorProgress * 100).toFixed(0)}% menuju TP1 tapi sekarang balik ke dekat area entry (progress saat ini ${(progressPct * 100).toFixed(0)}%). Ini pola gagal lanjut (failed breakout) — indikasi TP1 kemungkinan tidak tercapai dalam waktu dekat.`,
      recommendation: 'Pertimbangkan tutup manual untuk kunci breakeven/kerugian kecil, atau perketat SL ke area entry, daripada menunggu sampai kena SL penuh.'
    };
  }

  if (trendAgainst && progressPct < 0.15) {
    return {
      status: 'WEAK', tone: 'orange', badge: '⚠️ TREN BERBALIK', title: '⚠️ SETUP MELEMAH — TREN JANGKA PENDEK BERBALIK ARAH',
      detail: `Tren jangka pendek saat ini terbaca ${trend.direction} (${trend.reason || ''}), berlawanan dengan posisi ${lockedTradeSide} yang terkunci. Jarak ke SL: ${distToSl.toFixed(2)} poin.`,
      recommendation: 'Pantau ketat 1-2 candle berikutnya. Jika tren tetap berlawanan, pertimbangkan tutup manual sebelum harga mendekati SL.'
    };
  }

  if (progressPct < 0) {
    return {
      status: 'CAUTION', tone: 'orange', badge: '🟠 BERGERAK MELAWAN', title: '🟠 HARGA BERGERAK MELAWAN ARAH ENTRY',
      detail: `Harga masih ${Math.abs(progress).toFixed(2)} poin di sisi berlawanan dari entry ${formatPrice(lockedEntryPrice, d)}, belum menyentuh SL (${formatPrice(lockedSL, d)}).`,
      recommendation: 'Belum wajib close manual, tapi waspada. Cek ulang beberapa menit lagi kalau belum ada perbaikan arah.'
    };
  }

  return {
    status: 'ON_TRACK', tone: 'green', badge: '🟢 MASIH VALID', title: '🟢 SETUP MASIH VALID MENUJU TP',
    detail: `Progress ${Math.max(0, progressPct * 100).toFixed(0)}% menuju TP1 (${formatPrice(m.tp1, d)}), tren jangka pendek (${trend.direction}) masih mendukung arah ${lockedTradeSide}.`,
    recommendation: 'Lanjutkan monitor, belum ada alasan untuk close manual.'
  };
}

// Badge ringan yang auto-update tiap tick (tanpa toast/log, biar tidak spam).
function updateSetupValidityBadge(price = lastWsPrice) {
  const el = document.getElementById('tpValidityBadge');
  if (!el) return;
  if (lockedTradeSide !== 'BUY' && lockedTradeSide !== 'SELL') {
    el.innerText = '--';
    el.className = 'text-muted';
    return;
  }
  const v = getSetupValidation(price);
  el.innerText = v.badge;
  el.className = v.tone === 'red' ? 'text-red-400 font-bold' : v.tone === 'green' ? 'text-emerald-400 font-bold' : 'text-orange-400 font-bold';
}

// Dipanggil tombol "CEK VALIDASI SETUP" — pengecekan mendalam + rekomendasi eksplisit.
function checkSetupValidation() {
  const v = getSetupValidation(lastWsPrice);
  updateSetupValidityBadge(lastWsPrice);
  const detailEl = document.getElementById('tpValidityDetail');
  if (detailEl) {
    detailEl.innerHTML = `<strong>${v.title}</strong><br>${v.detail}<br><span class="text-amber-300">Rekomendasi: ${v.recommendation}</span>`;
    detailEl.className = v.tone === 'red' ? 'text-[11px] text-red-300 mt-1' : v.tone === 'green' ? 'text-[11px] text-emerald-300 mt-1' : 'text-[11px] text-orange-300 mt-1';
  }
  const toastType = v.tone === 'red' ? 'error' : v.tone === 'green' ? 'success' : 'info';
  showToast(`${v.badge}: ${v.recommendation}`, toastType);
  addLog(`Cek Validasi Setup: ${v.status} — ${v.recommendation}`, v.tone === 'red' ? 'error' : v.tone === 'orange' ? 'info' : 'success');

  if (v.tone !== 'green' && v.status !== 'NONE') {
    const st = getSettings();
    if (st.telegramToken && st.telegramChatId) {
      sendTelegramAlert({
        action: `CEK VALIDASI: ${v.badge}`,
        entry: formatPrice(lockedEntryPrice),
        stopLoss: formatPrice(lockedSL),
        tp1: '-', tp2: '-', tp3: '-', lotSize: '-',
        confidence: '-',
        aiExplanation: `${v.title}. ${v.detail} Rekomendasi: ${v.recommendation}`
      }).catch(() => {});
    }
  }
}

// Tutup setup aktif secara manual (mis. sudah ditutup di broker) — dicatat ke journal dengan PnL riil,
// lalu setup direset ke WAIT supaya sistem bisa mencari/mengunci plan baru.
function closeSetupManual() {
  if (lockedTradeSide !== 'BUY' && lockedTradeSide !== 'SELL') {
    showToast('Tidak ada setup aktif untuk ditutup.', 'info');
    return;
  }
  const price = lastWsPrice;
  const confirmMsg = `Tutup manual setup ${lockedTradeSide} @ ${formatPrice(lockedEntryPrice)} pada harga sekarang ${formatPrice(price)}?\n\nSetup akan dibatalkan dan dicatat ke journal. Tindakan ini tidak bisa dibatalkan.`;
  if (!window.confirm(confirmMsg)) return;

  if (currentOpenTradeId) {
    const rows = getJournalHistory();
    const row = rows.find(r => r.tradeId === currentOpenTradeId && r.resultTrade === 'OPEN');
    if (row) {
      const entry = Number(row.entry);
      const lot = Number(row.lotSize) || GOLD_PLAN.minLot;
      const pnl = (lockedTradeSide === 'BUY' ? (price - entry) : (entry - price)) * lot * GOLD_PLAN.contractSize;
      const result = pnl >= 0 ? 'CLOSED MANUAL (WIN)' : 'CLOSED MANUAL (LOSS)';
      updateJournalRow(currentOpenTradeId, { resultTrade: result, pnl: Number(pnl.toFixed(2)), exitPrice: price, closedAt: new Date().toISOString(), traderNotes: 'Ditutup manual oleh trader (bukan TP/SL otomatis).' });
      showToast(`Setup ditutup manual: ${result} (PnL ${formatMoney(pnl)}).`, pnl >= 0 ? 'success' : 'error');
      addLog(`Setup ditutup manual oleh trader: ${result} @ ${formatPrice(price)}, PnL ${formatMoney(pnl)}.`, pnl >= 0 ? 'success' : 'error');

      const st = getSettings();
      if (st.notifyTelegramOnLock !== false && st.telegramToken && st.telegramChatId) {
        sendTelegramAlert({
          action: `TUTUP MANUAL: ${result}`, entry: formatPrice(entry), stopLoss: formatPrice(lockedSL),
          tp1: '-', tp2: '-', tp3: '-', lotSize: lot.toFixed(2), confidence: '-',
          aiExplanation: `Setup ${lockedTradeSide} ditutup manual oleh trader di ${formatPrice(price)}. PnL: ${formatMoney(pnl)}.`
        }).catch(() => {});
      }
    }
    currentOpenTradeId = null;
  } else {
    showToast('Setup dibatalkan (belum sempat tercatat sebagai trade OPEN).', 'info');
  }

  lockedTradeSide = 'WAIT';
  lockedEntryPrice = null;
  lockedSL = null;
  lockedOrderType = 'NO TRADE';
  bestFavorProgress = 0;
  breakEvenSuggested = false;
  lastNotifiedLockCode = null;
  entryTriggered = false;
  entryTouchLog = [];
  entryZoneInsidePrev = false;
  updateEntryTouchLogUi();

  const detailEl = document.getElementById('tpValidityDetail');
  if (detailEl) {
    detailEl.innerHTML = 'Setup dibatalkan manual. Tekan GENERATE SIGNAL untuk mencari plan baru.';
    detailEl.className = 'text-[11px] text-muted mt-1';
  }
  updateSetupValidityBadge(price);
  applyTradingReadiness(price);
  updateTradingPlanValues(price);
  saveLockedPlanState();
}



function updatePriceDisplay(price, pctChange) {
  const cfg = getSymbolConfig();
  lastPctChange = Number.isFinite(pctChange) ? pctChange : 0;
  const chgEl = document.getElementById('chChg');
  // Hanya simpan & tampilkan harga yang sudah terverifikasi live (bukan seed internal).
  if (!livePriceVerified || !Number.isFinite(price) || price <= 0) {
    safeText('chPrice', '—');
    if (chgEl) { chgEl.innerText = '--%'; chgEl.className = 'badge mono text-[10px] badge-orange'; }
  } else {
    recentPrices.push(price);
    if (recentPrices.length > 48) recentPrices.shift();
    safeText('chPrice', formatPrice(price, cfg.decimals));
    if (chgEl) {
      const sign = pctChange >= 0 ? '+' : '';
      chgEl.innerText = sign + pctChange.toFixed(2) + '%';
      chgEl.className = 'badge mono text-[10px] ' + (pctChange >= 0 ? 'badge-green' : 'badge-red');
    }
  }
  pendingPriceUi = price;
  if (priceUiTimer) return;
  priceUiTimer = setTimeout(function () {
    priceUiTimer = null;
    const p = pendingPriceUi;
    updateDomTable(p);
    updateTradingPlanValues(p);
    checkBreakEvenSuggestion(p);
    updateSetupValidityBadge(p);
    checkOpenTradeOutcome(p);
    updateDashboardSummary();
    updateRiskManagement();
    updateSMCGrid();
    updateMultiTfUi();
    if (chartMode === 'internal') renderInternalChart(p);
  }, UI_DEBOUNCE_MS);
}

function getTradeMetrics(price = lastWsPrice) {
  const cfg = getSymbolConfig();
  const trend = analyzeMarketTrend(price);
  const derivedSide = deriveTradeSide(trend);
  const side = lockedTradeSide !== 'WAIT' ? lockedTradeSide : derivedSide;
  const dyn = getDynamicPlanDistances(price);
  const plan = lockedTradeSide !== 'WAIT'
    ? {
        entry: lockedEntryPrice,
        sl: lockedSL,
        tp1: lockedTradeSide === 'BUY' ? lockedEntryPrice + dyn.tp1Distance : lockedEntryPrice - dyn.tp1Distance,
        tp2: lockedTradeSide === 'BUY' ? lockedEntryPrice + dyn.tp2Distance : lockedEntryPrice - dyn.tp2Distance,
        tp3: lockedTradeSide === 'BUY' ? lockedEntryPrice + dyn.tp3Distance : lockedEntryPrice - dyn.tp3Distance,
        orderType: getOrderType(lockedTradeSide, lockedEntryPrice, price),
        orderMode: lockedOrderType && lockedOrderType.includes('STOP') ? 'BREAKOUT' : 'RETRACEMENT',
        narrative: getOrderNarrative(getOrderType(lockedTradeSide, lockedEntryPrice, price)),
        atr: dyn.atr
      }
    : calculateDirectionalPlan(price, side, trend);
  const entry = Number.isFinite(plan.entry) ? plan.entry : price;
  const sl = Number.isFinite(plan.sl) ? plan.sl : price;
  const tp1 = Number.isFinite(plan.tp1) ? plan.tp1 : price;
  const tp2 = Number.isFinite(plan.tp2) ? plan.tp2 : price;
  const tp3 = Number.isFinite(plan.tp3) ? plan.tp3 : price;
  const orderType = plan.orderType || getOrderType(side, entry, price);
  const acc = Math.max(0, parseFloat(document.getElementById('accSize')?.value) || 10000);
  const risk = Math.min(100, Math.max(0, parseFloat(document.getElementById('riskPct')?.value) || 1));
  const riskAmt = acc * (risk / 100);
  const slDist = side === 'WAIT' ? dyn.slDistance : Math.max(Math.abs(entry - sl), dyn.slDistance * 0.85);
  const rawLot = riskAmt / (slDist * GOLD_PLAN.contractSize);
  const lotSize = Math.min(GOLD_PLAN.maxLot, Math.max(GOLD_PLAN.minLot, rawLot));
  const lotCapped = rawLot > GOLD_PLAN.maxLot;
  const rr = (tp) => side === 'WAIT' ? 0 : Math.abs((tp - entry) / (entry - sl));
  const bias = side === 'BUY' ? 'Bullish' : side === 'SELL' ? 'Bearish' : 'Neutral / Wait';
  return { cfg, side, action: side, bias, trend, orderType, orderMode: plan.orderMode || 'NONE', orderNarrative: plan.narrative || getOrderNarrative(orderType), entry, sl, tp1, tp2, tp3, acc, risk, riskAmt, slDist, rawLot, lotSize, lotCapped, rr };
}

function isSidewaysMarket(price = lastWsPrice) {
  if (!Number.isFinite(price) || recentPrices.length < MIN_TREND_SAMPLES) return false;
  const samples = getPriceSamples(price);
  const maxP = Math.max(...samples);
  const minP = Math.min(...samples);
  const rangePct = ((maxP - minP) / Math.max(price, 1)) * 100;
  return rangePct < SIDEWAYS_RANGE_PCT;
}

function getEntryBuffer(price = lastWsPrice) {
  return Math.max(0.55, price * 0.00018);
}

// Mencatat "sentuhan" baru tiap kali harga MASUK zona entry (dengan jeda anti-spam: harga harus
// keluar zona minimal 2x buffer dulu sebelum re-entry berikutnya dihitung sentuhan baru, supaya
// harga yang cuma gonjang-ganjing tipis di pinggir zona tidak membuat log membengkak).
function trackEntryTouch(price, inEntryZoneNow, buffer) {
  if (lockedTradeSide !== 'BUY' && lockedTradeSide !== 'SELL') return;
  if (inEntryZoneNow) {
    if (!entryZoneInsidePrev) {
      entryTriggered = true;
      entryTouchLog.push({ index: entryTouchLog.length + 1, price, time: new Date().toISOString() });
      if (entryTouchLog.length > 50) entryTouchLog.shift();
      updateEntryTouchLogUi();
      saveLockedPlanState();
    }
    entryZoneInsidePrev = true;
  } else if (Math.abs(price - lockedEntryPrice) > buffer * 2) {
    entryZoneInsidePrev = false;
  }
}

function updateEntryTouchLogUi() {
  const countEl = document.getElementById('entryTouchCount');
  const listEl = document.getElementById('entryTouchLogList');
  if (countEl) countEl.textContent = `(${entryTouchLog.length})`;
  if (!listEl) return;
  if (!entryTouchLog.length) {
    listEl.innerHTML = 'Belum ada sentuhan entry sejak plan ini dikunci.';
    return;
  }
  const cfg = getSymbolConfig();
  listEl.innerHTML = entryTouchLog.slice().reverse().map((t) => {
    const time = new Date(t.time);
    const timeStr = isNaN(time.getTime()) ? '--' : time.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    return `<div class="flex justify-between"><span class="text-emerald-400">Valid #${t.index}</span><span class="mono">${formatPrice(t.price, cfg.decimals)} — ${timeStr}</span></div>`;
  }).join('');
}
window.updateEntryTouchLogUi = updateEntryTouchLogUi;

function assessTradingReadiness(price = lastWsPrice) {
  const m = getTradeMetrics(price);
  const d = m.cfg.decimals;
  if (!isForexMarketOpen()) {
    const reopen = getMarketReopenInfo();
    return { code:'MARKET_CLOSED', tone:'orange', action:'NO TRADE', side:m.side, setup:'NO TRADE / MARKET LIBUR', state:'MARKET CLOSED', title:'🟠 MARKET LIBUR (WEEKEND)', badge:'MARKET CLOSED', signal:'🟠 MARKET LIBUR', final:'🟠 MARKET LIBUR', reason:`Pasar forex/logam sedang tutup (weekend). Buka lagi sekitar ${reopen.toLocaleString('id-ID', { weekday:'long', hour:'2-digit', minute:'2-digit', timeZoneName:'short' })}. Entry tidak digenerate sampai market buka.` };
  }
  const buffer = getEntryBuffer(price);
  const entryUpper = m.entry + buffer;
  const entryLower = m.entry - buffer;
  const inEntryZoneNow = price >= entryLower && price <= entryUpper;
  trackEntryTouch(price, inEntryZoneNow, buffer);
  if (!connected) return { code:'NO_TRADE', tone:'orange', action:'NO TRADE', side:m.side, setup:'NO TRADE / DATA OFFLINE', state:'NO TRADE', title:'🟠 NO TRADE - DATA OFFLINE', badge:'LIVE DATA REQUIRED', signal:'🟠 NO TRADE', final:'🟠 NO TRADE', reason:'Live stream sedang OFFLINE. Hindari eksekusi sampai harga/data tervalidasi kembali.' };
  if (usingSimulatedPrice) return { code:'NO_TRADE_OFFLINE', tone:'orange', action:'NO TRADE', side:m.side, setup:'NO TRADE / LIVE FEED OFFLINE', state:'NO TRADE', title:'🟠 NO TRADE - LIVE FEED OFFLINE', badge:'LIVE PRICE REQUIRED', signal:'🟠 NO TRADE / OFFLINE', final:'🟠 NO TRADE', reason:'Feed harga live tidak tersedia. Mode simulasi dinonaktifkan (CLEAN-125). Entry diblokir sampai API live terverifikasi.' };
  if (recentPrices.length < MIN_TREND_SAMPLES) return { code:'NO_TRADE_WARMUP', tone:'orange', action:'NO TRADE', side:m.side, setup:'NO TRADE / DATA WARMUP', state:'NO TRADE', title:'🟠 NO TRADE - DATA WARMUP', badge:'TREND DATA REQUIRED', signal:'🟠 NO TRADE / WARMUP', final:'🟠 NO TRADE', reason:`Belum cukup tick live untuk analisis tren (${recentPrices.length}/${MIN_TREND_SAMPLES}). Tunggu data valid.` };
  // [CALENDAR FIX] API kalender gagal BUKAN alasan mengunci AI. Hanya High Impact News
  // TERVERIFIKASI yang menahan entry — dan tetap bisa di-override admin.
  if (highImpactNewsDetected && !calendarManualOverride) return { code:'WAIT_NEWS', tone:'orange', action:'WAIT NEWS', side:m.side, setup:'WAIT NEWS / HIGH IMPACT', state:'WAIT NEWS', title:'🟠 WAIT NEWS - HIGH IMPACT', badge:'NEWS FILTER ACTIVE', signal:'🟠 WAIT NEWS', final:'🟠 WAIT NEWS', reason:`High-impact news terverifikasi: ${highImpactNewsLabel || 'event penting'}. Entry ditahan sampai risiko mereda (atau aktifkan Manual Override).` };
  if (m.side === 'WAIT') return { code:'NO_TRADE_NO_TREND', tone:'orange', action:'NO TRADE', side:m.side, setup:'NO TRADE / NO TREND EDGE', state:'NO TRADE', title:'🟠 NO TRADE - NO TREND EDGE', badge:'NO DIRECTIONAL EDGE', signal:'🟠 NO TRADE', final:'🟠 NO TRADE', reason:`Trend engine belum memberikan arah BUY/SELL yang valid: ${m.trend.reason}` };
  if (isSidewaysMarket(price)) return { code:'WAIT_BREAKOUT', tone:'orange', action:'WAIT BREAKOUT', side:m.side, setup:`WAIT BREAKOUT / ${m.orderType}`, state:'WAIT BREAKOUT', title:`🟠 WAIT BREAKOUT - ${m.orderType}`, badge:'RANGE TOO TIGHT', signal:'🟠 WAIT BREAKOUT', final:'🟠 WAIT BREAKOUT', reason:`Range harga terlalu sempit secara persentase (<${SIDEWAYS_RANGE_PCT}%). Tunggu breakout/rejection.` };
  const invalid = m.side === 'BUY' ? price <= m.sl : price >= m.sl;
  if (invalid) return { code:'ENTRY_INVALID', tone:'red', action:'NO TRADE', side:m.side, setup:'ENTRY INVALID / SETUP BROKEN', state:'ENTRY INVALID', title:'🔴 ENTRY INVALID', badge:'REPLAN REQUIRED', signal:'🔴 ENTRY INVALID', final:'🔴 ENTRY INVALID', reason:`Harga sudah melewati area SL ${formatPrice(m.sl, d)} untuk setup ${m.orderType}. Setup lama invalid, tunggu plan baru.` };

  if (inEntryZoneNow) {
    const isMarketNow = m.orderType === 'BUY NOW' || m.orderType === 'SELL NOW';
    return {
      code: 'ENTRY_VALID',
      tone: 'green',
      action: m.side,
      side: m.side,
      setup: isMarketNow ? m.orderType : `${m.orderType} READY`,
      state: 'ENTRY VALID',
      title: isMarketNow ? `🟢 ${m.orderType} - EKSEKUSI MARKET` : `🟢 ENTRY VALID - ${m.orderType}`,
      badge: isMarketNow ? 'MARKET EXECUTION' : 'ENTRY ZONE VALID',
      signal: `${m.side === 'BUY' ? '🟢 BUY' : '🔴 SELL'} SIGNAL (${m.orderType})`,
      final: `🟢 ENTRY VALID ${m.orderType}`,
      reason: isMarketNow
        ? `Harga ${formatPrice(price, d)} sudah tepat di level entry ${formatPrice(m.entry, d)}. ${m.orderNarrative}`
        : `Harga berada di area entry ${formatPrice(m.entry, d)} ± ${formatPrice(buffer, d)} untuk ${m.orderType}. ${m.orderNarrative}`
    };
  }

  // Sudah pernah tersentuh entry sebelumnya (SL belum kena — sudah dicek di atas). Status tetap
  // ditampilkan sebagai ENTRY VALID (bukan balik ke WAIT BREAKOUT/PULLBACK) sampai user klik
  // Tutup Manual, supaya tidak membingungkan trader yang sudah eksekusi berdasarkan sinyal NOW.
  if (entryTriggered) {
    return {
      code: 'ENTRY_VALID_HOLD',
      tone: 'green',
      action: m.side,
      side: m.side,
      setup: `${m.orderType} (SUDAH TERSENTUH)`,
      state: 'ENTRY VALID',
      title: `🟢 ENTRY VALID - ${m.orderType} (bertahan sejak tersentuh)`,
      badge: 'SETUP MASIH BERLAKU',
      signal: `${m.side === 'BUY' ? '🟢 BUY' : '🔴 SELL'} SIGNAL (${m.orderType})`,
      final: `🟢 ENTRY VALID ${m.orderType}`,
      reason: `Entry ${formatPrice(m.entry, d)} sudah tersentuh ${entryTouchLog.length}x sejak plan ini dikunci. Status tetap berlaku sampai SL kena atau Anda klik Tutup Manual.`
    };
  }

  const waitingBreakout = (m.orderType === 'BUY STOP' && price < entryLower) || (m.orderType === 'SELL STOP' && price > entryUpper);
  if (waitingBreakout) return { code:'WAIT_BREAKOUT', tone:'orange', action:'WAIT BREAKOUT', side:m.side, setup:`WAIT BREAKOUT (${m.orderType})`, state:'WAIT BREAKOUT', title:`🟠 WAIT BREAKOUT - ${m.orderType}`, badge:'NO MARKET EXECUTION', signal:'🟠 WAIT BREAKOUT', final:'🟠 WAIT BREAKOUT', reason:`${m.orderType}: entry ${formatPrice(m.entry, d)} belum tersentuh. ${m.orderNarrative}` };

  const waitingPullback = (m.orderType === 'BUY LIMIT' && price > entryUpper) || (m.orderType === 'SELL LIMIT' && price < entryLower);
  if (waitingPullback) return { code:'WAIT_PULLBACK', tone:'orange', action:'WAIT PULLBACK', side:m.side, setup:`WAIT PULLBACK (${m.orderType})`, state:'WAIT PULLBACK', title:`⏳ WAIT PULLBACK - ${m.orderType}`, badge:'NO MARKET EXECUTION', signal:'🟠 WAIT PULLBACK', final:'🟠 WAIT PULLBACK', reason:`${m.orderType}: harga ${formatPrice(price, d)} belum masuk entry ${formatPrice(m.entry, d)}. ${m.orderNarrative}` };

  return { code:'WAIT_RECHECK', tone:'orange', action:'WAIT RECHECK', side:m.side, setup:`WAIT RECHECK / ${m.orderType}`, state:'WAIT RECHECK', title:`🟠 WAIT RECHECK - ${m.orderType}`, badge:'ENTRY PASSED', signal:'🟠 WAIT RECHECK', final:'🟠 WAIT RECHECK', reason:`Harga sudah melewati entry ${formatPrice(m.entry, d)} untuk ${m.orderType}. Hindari chasing; tunggu konfirmasi ulang atau plan baru.` };
}


function requestBrowserNotifyPermission() {
  if (!('Notification' in window)) {
    showToast('Browser ini tidak mendukung Notification API', 'info');
    return Promise.resolve(false);
  }
  if (Notification.permission === 'granted') {
    showToast('Notifikasi browser sudah diizinkan', 'success');
    return Promise.resolve(true);
  }
  if (Notification.permission === 'denied') {
    showToast('Notifikasi diblokir. Aktifkan di pengaturan browser.', 'error');
    return Promise.resolve(false);
  }
  return Notification.requestPermission().then((perm) => {
    const ok = perm === 'granted';
    showToast(ok ? 'Notifikasi browser diizinkan' : 'Izin notifikasi ditolak', ok ? 'success' : 'info');
    notifyPermissionAsked = true;
    return ok;
  }).catch(() => false);
}

function playLockSound() {
  const st = getSettings();
  if (st.notifySound === false) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02 + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28 + i * 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + 0.35 + i * 0.1);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch (err) {
    addLog(`Sound alert gagal: ${err.message}`, 'error');
  }
}

function showBrowserLockNotification(decision, metrics) {
  const st = getSettings();
  if (st.notifyBrowser === false) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') {
    if (!notifyPermissionAsked && Notification.permission === 'default') {
      requestBrowserNotifyPermission();
    }
    return;
  }
  const side = metrics?.side || decision.side || '—';
  const entry = metrics ? formatPrice(metrics.entry) : '—';
  const sl = metrics ? formatPrice(metrics.sl) : '—';
  const title = `AI LOCKED: ${side} XAUUSD`;
  const body = `${decision.title || decision.state}\nEntry ${entry} | SL ${sl}\n${decision.badge || ''}`.trim();
  try {
    const n = new Notification(title, {
      body,
      tag: 'xau-execution-lock',
      renotify: true,
      silent: false,
      requireInteraction: true
    });
    n.onclick = () => {
      window.focus();
      document.getElementById('tradingPlanCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      n.close();
    };
    setTimeout(() => n.close(), 20000);
  } catch (err) {
    addLog(`Browser notification gagal: ${err.message}`, 'error');
  }
}

async function notifyExecutionLocked(decision) {
  if (!decision || decision.code !== 'ENTRY_VALID' || decision.tone !== 'green') return;
  // debounce: same lock code already notified
  const fingerprint = `${decision.code}|${lockedTradeSide}|${Number(lockedEntryPrice).toFixed(2)}|${Number(lockedSL).toFixed(2)}`;
  if (lastNotifiedLockCode === fingerprint) return;
  lastNotifiedLockCode = fingerprint;

  const metrics = getTradeMetrics(lastWsPrice);
  const msg = `EXECUTION LOCKED: ${metrics.side} ${metrics.orderType || ''} @ ${formatPrice(metrics.entry)} | SL ${formatPrice(metrics.sl)}`;

  showToast(msg, 'success');
  addLog(msg, 'success');
  playLockSound();
  showBrowserLockNotification(decision, metrics);

  // pulse monitor card
  const planCard = document.getElementById('tradingPlanCard');
  if (planCard) {
    planCard.style.boxShadow = '0 0 0 2px rgba(34,197,94,.7), 0 18px 48px rgba(34,197,94,.25)';
    setTimeout(() => { planCard.style.boxShadow = ''; }, 1800);
  }

  const st = getSettings();
  if (st.notifyTelegramOnLock !== false && st.telegramToken && st.telegramChatId) {
    try {
      await sendTelegramAlert({
        action: metrics.side,
        entry: formatPrice(metrics.entry),
        stopLoss: formatPrice(metrics.sl),
        tp1: formatPrice(metrics.tp1),
        tp2: formatPrice(metrics.tp2),
        tp3: formatPrice(metrics.tp3),
        lotSize: metrics.lotSize?.toFixed?.(2) || metrics.lotSize,
        confidence: document.getElementById('finalConf')?.innerText || '--',
        aiExplanation: `EXECUTION LOCKED — ${decision.title}. ${decision.reason || ''}`
      });
    } catch (err) {
      addLog(`Telegram lock alert gagal: ${err.message}`, 'error');
    }
  }

  autoRecordLockedTrade();
}

function onDecisionChanged(decision) {
  const prev = lastDecisionCode;
  lastDecisionCode = decision?.code || null;
  if (!decision) return;
  // Reset notify fingerprint when leaving lock state so re-lock can alert again
  if (decision.code !== 'ENTRY_VALID') {
    if (prev === 'ENTRY_VALID') lastNotifiedLockCode = null;
    return;
  }
  if (prev !== 'ENTRY_VALID') {
    notifyExecutionLocked(decision);
  }
}

function applyTradingReadiness(price = lastWsPrice) {
  const decision = assessTradingReadiness(price);
  currentPlanDecision = decision;

  const toneClass = decision.tone === 'green'
    ? { text: 'text-emerald-400', badge: 'badge-green', border: 'var(--green)', bg: 'linear-gradient(135deg,#111a2e 0%,#0f261c 100%)' }
    : decision.tone === 'red'
      ? { text: 'text-red-400', badge: 'badge-red', border: 'var(--red)', bg: 'linear-gradient(135deg,#111a2e 0%,#2a1111 100%)' }
      : { text: 'text-orange-400', badge: 'badge-orange', border: 'var(--orange)', bg: 'linear-gradient(135deg,#111a2e 0%,#2a1b0f 100%)' };

  const statusBox = document.getElementById('tpExecutionStatusBox');
  if (statusBox) statusBox.className = `mb-4 p-3 rounded-lg border ${decision.tone === 'green' ? 'border-emerald-500/40 bg-emerald-950/20' : decision.tone === 'red' ? 'border-red-500/40 bg-red-950/20' : 'border-orange-500/40 bg-orange-950/20'}`;
  const titleEl = document.getElementById('tpExecutionStatusTitle');
  if (titleEl) {
    titleEl.innerText = decision.title;
    titleEl.className = `text-sm font-bold mono ${toneClass.text}`;
  }
  const badgeEl = document.getElementById('tpExecutionStatusBadge');
  if (badgeEl) {
    badgeEl.innerText = decision.badge;
    badgeEl.className = `badge ${toneClass.badge} mono`;
  }
  safeText('tpExecutionStatusReason', decision.reason);

  const setupEl = document.getElementById('tpSetupType');
  if (setupEl) {
    setupEl.innerText = decision.setup;
    setupEl.className = `text-base font-bold ${toneClass.text}`;
  }
  const execEl = document.getElementById('tpExecutionState');
  if (execEl) {
    execEl.innerText = decision.state;
    execEl.className = decision.tone === 'green' ? 'text-emerald-400' : decision.tone === 'red' ? 'text-red-400' : 'text-orange-400';
  }

  const planCard = document.getElementById('tradingPlanCard');
  if (planCard) {
    planCard.style.border = `2px solid ${toneClass.border}`;
    planCard.style.background = toneClass.bg;
  }

  const lockBadge = document.getElementById('tpLockBadge');
  if (lockBadge) {
    lockBadge.className = `badge ${toneClass.badge} mono px-3 py-1 text-xs`;
    lockBadge.innerHTML = `<i class="fas ${decision.tone === 'green' ? 'fa-lock' : 'fa-pause'} mr-1"></i> ${decision.tone === 'green' ? 'LOCKED BY AI' : 'WAIT BY AI'}`;
  }

  const autoBadge = document.getElementById('aiAutoLockBadge');
  if (autoBadge) {
    autoBadge.className = `badge ${toneClass.badge} mono`;
    autoBadge.innerText = decision.tone === 'green' ? 'STATUS: SECURED & VALIDATED' : 'STATUS: WAIT FILTER ACTIVE';
  }

  safeText('finalStatus', decision.final);
  safeText('aiAutoLockRec', decision.reason);
  safeText('signalBadgeText', decision.signal);

  const signalBox = document.getElementById('signalCardBox');
  const sideForColor = decision.side || getTradeMetrics(lastWsPrice).side;
  if (signalBox) signalBox.className = sideForColor === 'SELL' ? 'signal-card sell' : sideForColor === 'BUY' ? 'signal-card buy' : 'signal-card wait';
  updateAIIntelligence(decision);
  onDecisionChanged(decision);

  // Mini-preview di Dashboard (kartu ringkas, bukan full plan) — supaya Dashboard cuma jadi pintu masuk ke tab Plan.
  const dashBadge = document.getElementById('dashPlanStatusBadge');
  if (dashBadge) {
    dashBadge.innerText = decision.badge;
    dashBadge.className = `badge ${toneClass.badge} mono`;
  }
  const dashTitle = document.getElementById('dashPlanStatusTitle');
  if (dashTitle) {
    dashTitle.innerText = decision.title;
    dashTitle.className = `text-sm font-bold mono ${toneClass.text}`;
  }
  safeText('dashPlanStatusReason', decision.reason);

  return decision;
}

function refreshTradingReadiness() {
  const decision = applyTradingReadiness(lastWsPrice);
  showToast(`${decision.title}: ${decision.reason}`, decision.tone === 'green' ? 'success' : 'info');
  addLog(`AI readiness: ${decision.code} - ${decision.reason}`, decision.tone === 'green' ? 'success' : 'info');
}

function updateTradingPlanValues(price) {
  const m = getTradeMetrics(price);
  const d = m.cfg.decimals;
  const hasActionableSide = m.side === 'BUY' || m.side === 'SELL';
  // Hanya tampilkan harga live bila feed sudah terverifikasi — bukan seed internal.
  const live = livePriceVerified && Number.isFinite(price) && price > 0;
  const rr1 = hasActionableSide ? m.rr(m.tp1).toFixed(1) : '0.0';
  const rr2 = hasActionableSide ? m.rr(m.tp2).toFixed(1) : '0.0';
  const rr3 = hasActionableSide ? m.rr(m.tp3).toFixed(1) : '0.0';

  safeText('tpPair', m.cfg.display);
  safeText('tpBias', live ? m.bias : 'WAIT');
  const biasEl = document.getElementById('tpBias');
  if (biasEl) biasEl.className = m.side === 'BUY' ? 'text-green-400' : m.side === 'SELL' ? 'text-red-400' : 'text-orange-400';

  const previewDecision = assessTradingReadiness(price);
  const entryLabel = !hasActionableSide
    ? 'Reference Price:'
    : previewDecision.code === 'ENTRY_VALID'
      ? 'Locked Entry:'
      : previewDecision.code === 'WAIT_PULLBACK'
        ? `Pending Entry (${m.orderType}):`
        : previewDecision.code === 'WAIT_NEWS'
          ? `Planned Entry (${m.orderType} Paused):`
          : previewDecision.code === 'ENTRY_INVALID'
            ? 'Invalid Entry:'
            : `Recheck Level (${m.orderType}):`;
  safeText('tpEntryLabel', entryLabel);
  safeText('tpEntryPrice', (hasActionableSide && live) ? formatPrice(m.entry, d) : (live ? formatPrice(price, d) : '—'));
  safeText('tpStopLoss', (hasActionableSide && live) ? `SL: ${formatPrice(m.sl, d)} (-${m.slDist.toFixed(d > 3 ? 5 : 2)} pts)` : (live ? 'SL: N/A - no actionable setup' : 'SL: —'));
  safeText('tpRiskAmt', `$${m.riskAmt.toFixed(2)} (${m.risk}%)`);
  safeText('tpLotSize', (hasActionableSide && live) ? `${m.lotSize.toFixed(2)} Lot${m.lotCapped ? ' (CAP)' : ''}` : 'N/A');
  safeText('tpTier1', (hasActionableSide && live) ? `${formatPrice(m.tp1, d)} (1:${rr1})` : 'N/A - wait for valid trend');
  safeText('tpTier2', (hasActionableSide && live) ? `${formatPrice(m.tp2, d)} (1:${rr2})` : 'N/A - wait for valid trend');
  safeText('tpTier3', (hasActionableSide && live) ? `${formatPrice(m.tp3, d)} (1:${rr3})` : 'N/A - wait for valid trend');

  // Keep dashboard signal card synchronized with the locked plan.
  safeText('sigEntry', (hasActionableSide && live) ? formatPrice(m.entry, d) : 'N/A');
  safeText('sigSl', (hasActionableSide && live) ? formatPrice(m.sl, d) : 'N/A');
  safeText('posLot', (hasActionableSide && live) ? `${m.lotSize.toFixed(2)} Lot${m.lotCapped ? ' (CAP)' : ''}` : 'N/A');
  safeText('sigRR', (hasActionableSide && live) ? `1 : ${m.rr(m.tp1).toFixed(2)}` : 'N/A');
  applyTradingReadiness(price);
}

function updateDomTable(price) {
  const cfg = getSymbolConfig();
  const d = cfg.decimals;
  const domContainer = document.getElementById('domTableContainer');
  if (domContainer) {
    if (!livePriceVerified || usingSimulatedPrice) {
      domContainer.innerHTML = `<div class="p-3 rounded bg-slate-900 text-muted text-center text-xs">DOM Level-2 tidak tersedia. Hubungkan feed order book broker untuk data bid/ask nyata. Harga referensi: ${escapeHtml(formatPrice(price, d))}</div>`;
    } else {
      domContainer.innerHTML = `<div class="dom-row dom-current flex justify-between font-bold text-amber-300"><span>Last ${escapeHtml(formatPrice(price, d))}</span><span class="text-[10px] text-muted">No L2 feed connected</span></div>
        <div class="p-2 text-[10px] text-muted">Order book depth membutuhkan API broker / DOM provider. Modul ini tidak menampilkan data palsu.</div>`;
    }
  }
  safeText('obSupplyZone', 'Menunggu feed order block / struktur dari broker');
  safeText('obDemandZone', 'Menunggu feed order block / struktur dari broker');
}

function updatePositionCalc() {
  const acc = Math.max(0, parseFloat(document.getElementById('accSize')?.value) || 10000);
  const risk = Math.min(100, Math.max(0, parseFloat(document.getElementById('riskPct')?.value) || 1));
  const riskAmt = acc * (risk / 100);
  safeText('posRisk', `$${riskAmt.toFixed(2)}`);
  updateTradingPlanValues(lastWsPrice);
}


async function quickGenerateSignal() {
  if (newsHardBlockActive) { showToast('News Hard-Block aktif. Tunggu rilis berita penting selesai.', 'error'); return; }
  try {
    if (!connected) doConnect();
    await fetchRealLivePrice();
  } catch (err) {
    addLog(`Quick generate live refresh warning: ${err.message}`, 'error');
  }
  generateSignal();
  switchTab('tradingplan');
  setTimeout(() => {
    const target = document.getElementById('tradingPlanCard') || document.getElementById('tab-tradingplan');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function generateSignal() {
  if (newsHardBlockActive) {
    showToast('News Hard-Block aktif. Generate signal dinonaktifkan sampai rilis penting selesai atau admin override.', 'error');
    return;
  }
  const cfg = getSymbolConfig();
  setInitialPlan(lastWsPrice);
  updateTradingPlanValues(lastWsPrice);
  updateDomTable(lastWsPrice);
  const decision = applyTradingReadiness(lastWsPrice);
  const confText = document.getElementById('finalConf')?.innerText || '--';
  if (decision.action === 'BUY' || decision.action === 'SELL') showToast(`Signal ${cfg.display} ${decision.action} tervalidasi & dikunci`, 'success');
  else showToast(`${decision.title}. Tidak ada eksekusi sampai filter valid.`, 'info');
  addLog(`Generate signal ${cfg.display}: ${decision.code}. Side ${getTradeMetrics(lastWsPrice).side}. Entry ${formatPrice(lockedEntryPrice)} / SL ${formatPrice(lockedSL)} / confidence ${confText}.`, decision.tone === 'green' ? 'success' : 'info');
  updateDashboardSummary();
}

async function checkRealEconomicCalendar(silent) {
  const tbody = document.getElementById('calendarTableBody');
  calendarStatus = 'updating';
  calendarRetryCount = 0;
  updateCalendarMonitorUI();
  setSystemStatus('calendar', 'warn', 'Fetching');
  if (tbody) tbody.innerHTML = getCalendarLoadingRows();
  if (!silent) showToast('Memvalidasi kalender USD high-impact…', 'info');
  const srcList = (getProxyBase() ? 'proxy → ' : '') + CALENDAR_SOURCES.map(s => s.name).join(', ');
  addLog('[CALENDAR] Request start — sources: ' + srcList, 'info');

  const t0 = performance.now();
  const result = await fetchCalendarEventsWithFallback();
  const elapsedMs = Math.round(performance.now() - t0);
  addLog('[CALENDAR] Selesai ' + elapsedMs + 'ms — online=' + result.online + ', source=' + result.source + ', events=' + result.events.length + ', retries=' + calendarRetryCount, result.online ? 'success' : 'error');

  const filtered = result.events
    .filter(isGoldUsdHighImpactEvent)
    .sort((a, b) => (Date.parse(a.date || '') || 0) - (Date.parse(b.date || '') || 0))
    .slice(0, 10);

  const highEvent = result.online ? filtered.find(isHighImpactEventSoon) : null;
  highImpactNewsDetected = Boolean(highEvent);
  highImpactNewsLabel = highEvent ? `${highEvent.currency || ''} ${highEvent.title || highEvent.event || ''} ${highEvent.date || ''}`.trim() : '';
  nextHighImpactNews = filtered.length ? (filtered.find(e => (Date.parse(e.date || '') || Infinity) >= Date.now()) || filtered[0]) : null;
  // [CALENDAR FIX] offline = informational, BUKAN pengunci AI.
  newsRiskUnknown = !result.online;
  calendarValidated = Boolean(result.online);
  nextCalendarEvent = nextHighImpactNews || (filtered.find(e => (Date.parse(e.date || '') || Infinity) >= Date.now() - 3600000) || filtered[0] || null);

  if (result.online && highImpactNewsDetected) calendarStatus = 'high_impact';
  else if (result.online) calendarStatus = 'verified';
  else calendarStatus = 'unavailable';

  setCalendarApiState(result.online, result.source, new Date(), nextCalendarEvent);
  applyTradingReadiness(lastWsPrice);
  updateNewsHardBlockUI();
  addLog('[CALENDAR] Validasi: ' + (result.online ? (highImpactNewsDetected ? 'HIGH IMPACT terdeteksi → WAIT NEWS' : 'TERVERIFIKASI, tanpa high-impact → AI lanjut') : 'OFFLINE → AI tetap analisis harga (kalender belum diverifikasi)'), result.online ? (highImpactNewsDetected ? 'info' : 'success') : 'error');

  if (tbody) {
    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td class="p-3 text-amber-400">${escapeHtml(new Date().toLocaleDateString('id-ID'))}</td>
          <td class="p-3"><span class="badge badge-blue">USD</span></td>
          <td class="p-3 font-semibold">${result.online ? 'Tidak ada USD High Impact (NFP/CPI/FOMC) pekan ini' : 'Data kalender tidak tersedia — menampilkan cache bila ada'}</td>
          <td class="p-3"><span class="badge ${result.online ? 'badge-green' : 'badge-orange'}">${result.online ? 'CLEAR' : 'OFFLINE'}</span></td>
          <td class="p-3">--</td><td class="p-3">--</td><td class="p-3">--</td>
          <td class="p-3 text-amber-400">${result.online ? 'Clear' : 'Refresh'}</td>
        </tr>`;
    } else {
      tbody.innerHTML = filtered.map(e => renderCalendarRow(e, result.online)).join('');
    }
  }

  if (calendarStatus === 'high_impact') {
    setSystemStatus('calendar', 'bad', 'High Impact');
    if (!silent) showToast('High Impact News aktif: ' + highImpactNewsLabel + ' — WAIT NEWS', 'info');
  } else if (calendarStatus === 'verified') {
    setSystemStatus('calendar', 'ok', 'Verified');
    if (!silent) showToast('Calendar TERVERIFIKASI — tidak ada high-impact news dekat. AI lanjut normal.', 'success');
  } else {
    setSystemStatus('calendar', 'warn', calendarManualOverride ? 'Override' : 'Offline');
    if (!silent) showToast('Calendar offline — AI tetap menganalisis harga (kalender belum diverifikasi).', 'info');
    addLog('[CALENDAR] Cache terakhir: ' + (calendarLastUpdatedAt ? calendarLastUpdatedAt.toLocaleString('id-ID') : 'belum pernah') + '. Tekan Refresh Calendar untuk mencoba lagi.', 'info');
  }
  updateCalendarCountdowns();
}

async function fetchCalendarEventsWithFallback() {
  // 1) Cache segar (TTL) → pakai + refresh di background
  try {
    const cached = JSON.parse(localStorage.getItem(CALENDAR_CACHE_KEY) || 'null');
    if (cached && cached.events && cached.events.length && (Date.now() - cached.savedAt) < CALENDAR_CACHE_TTL_MS) {
      addLog('[CALENDAR] Cache hit (' + cached.source + ', age ' + Math.round((Date.now() - cached.savedAt) / 1000) + 's) → background refresh', 'info');
      setTimeout(refreshCalendarCacheBackground, 150);
      return { online: true, source: cached.source + ' (cache)', events: cached.events };
    }
  } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); }

  // 2) Proxy (jika dikonfigurasi)
  const proxied = proxyUrl('/calendar');
  if (proxied) {
    const t = performance.now();
    try {
      const response = await fetchWithTimeout(proxied, { cache: 'no-store' }, 12000);
      addLog('[CALENDAR] proxy ' + proxied + ' → HTTP ' + response.status + ' (' + Math.round(performance.now() - t) + 'ms)', 'info');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data.online && Array.isArray(data.events) && data.events.length) {
        localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), source: data.source, events: data.events }));
        return { online: true, source: 'proxy:' + data.source, events: data.events };
      }
      calendarRetryCount++; addLog('[CALENDAR] proxy respons kosong/invalid (events=0)', 'error');
    } catch (err) {
      calendarRetryCount++; addLog('[CALENDAR] proxy gagal: ' + err.message + ' (' + proxied + ')', 'error');
    }
  }

  // 3) Sumber publik langsung
  const results = await Promise.all(CALENDAR_SOURCES.map(async function (source) {
    const t = performance.now();
    try {
      const response = await fetchWithTimeout(source.url, { cache: 'no-store' }, 10000);
      addLog('[CALENDAR] ' + source.name + ' → HTTP ' + response.status + ' (' + Math.round(performance.now() - t) + 'ms)', 'info');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      const events = normalizeCalendarEvents(data, source);
      addLog('[CALENDAR] ' + source.name + ' parsed ' + events.length + ' events', 'info');
      if (events.length) return { ok: true, source: source.name, events: events };
      return { ok: false, error: source.name + ': empty' };
    } catch (err) {
      calendarRetryCount++; addLog('[CALENDAR] ' + source.name + ' gagal: ' + err.message, 'error');
      return { ok: false, error: source.name + ': ' + err.message };
    }
  }));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.ok) {
      localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), source: r.source, events: r.events }));
      return { online: true, source: r.source, events: r.events };
    }
  }

  // 4) Semua gagal → pakai cache kedaluwarsa (online=false, tampilan saja)
  try {
    const cached = JSON.parse(localStorage.getItem(CALENDAR_CACHE_KEY) || 'null');
    if (cached && cached.events && cached.events.length) {
      addLog('[CALENDAR] Semua source offline — pakai cache kedaluwarsa (' + cached.source + ', age ' + Math.round((Date.now() - cached.savedAt) / 1000) + 's)', 'error');
      return { online: false, source: cached.source + ' (stale cache)', events: cached.events };
    }
  } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); }
  return { online: false, source: 'All sources offline', events: [] };
}
async function refreshCalendarCacheBackground() {
  try {
    const proxied = proxyUrl('/calendar');
    if (!proxied) return;
    const response = await fetchWithTimeout(proxied, { cache: 'no-store' }, 12000);
    if (!response.ok) return;
    const data = await response.json();
    if (data.online && data.events && data.events.length) {
      localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), source: data.source, events: data.events }));
    }
  } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); }
}

function normalizeCalendarEvents(data, source) {
  const arr = Array.isArray(data) ? data : [];
  if (source.parser === 'tradingEconomics') {
    return arr.map(e => ({
      date: e.Date || e.date || e.LastUpdate || e.CalendarReference || '',
      currency: e.Currency || (String(e.Country || '').toLowerCase().includes('united states') ? 'USD' : ''),
      title: e.Event || e.Category || e.title || e.event || '',
      impact: Number(e.Importance) >= 3 || String(e.Importance || '').toLowerCase().includes('high') ? 'High' : (e.Importance || e.impact || ''),
      actual: e.Actual ?? e.actual ?? '',
      forecast: e.Forecast ?? e.forecast ?? '',
      previous: e.Previous ?? e.previous ?? '',
      source: source.name
    })).filter(e => e.title || e.currency || e.date);
  }

  return arr.map(e => ({
    date: e.date || e.datetime || e.time || '',
    currency: e.currency || e.Currency || '',
    title: e.title || e.event || e.Event || '',
    impact: e.impact || e.Impact || '',
    actual: e.actual ?? e.Actual ?? '',
    forecast: e.forecast ?? e.Forecast ?? '',
    previous: e.previous ?? e.Previous ?? '',
    source: source.name
  })).filter(e => e.title || e.currency || e.date);
}

function renderCalendarRow(e, apiOnline = true) {
  const isFallback = !apiOnline || String(e.title || '').toLowerCase().includes('fallback');
  const impactClass = isFallback ? 'badge-orange' : 'badge-red';
  return `
    <tr title="Source: ${escapeHtml(e.source || '--')}">
      <td class="p-3 text-amber-400">${escapeHtml(formatCalendarDate(e.date))}</td>
      <td class="p-3"><span class="badge badge-blue">USD</span></td>
      <td class="p-3 font-semibold">${escapeHtml(e.title || e.event || '--')}</td>
      <td class="p-3"><span class="badge ${impactClass}">${isFallback ? 'FALLBACK' : 'HIGH'}</span></td>
      <td class="p-3">${escapeHtml(e.actual || '--')}</td>
      <td class="p-3">${escapeHtml(e.forecast || '--')}</td>
      <td class="p-3">${escapeHtml(e.previous || '--')}</td>
      <td class="p-3 text-amber-400" data-countdown-date="${escapeHtml(e.date || '')}">${escapeHtml(getEventCountdown(e.date))}</td>
    </tr>`;
}

function getCalendarLoadingRows() {
  return `
    <tr>
      <td class="p-3 text-amber-400">Loading</td>
      <td class="p-3"><span class="badge badge-blue">USD</span></td>
      <td class="p-3 font-semibold"><span class="loading-dot"></span> <span class="loading-dot"></span> <span class="loading-dot"></span> Mengambil calendar feed...</td>
      <td class="p-3"><span class="badge badge-orange">FETCHING</span></td>
      <td class="p-3">--</td><td class="p-3">--</td><td class="p-3">--</td><td class="p-3 text-amber-400">--</td>
    </tr>`;
}

function formatCalendarDate(value) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return value || '--';
  return new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function setCalendarApiState(online, source, updatedAt = new Date(), nextEvent = null) {
  calendarApiOnline = Boolean(online);
  calendarSourceName = source || (online ? 'Online' : 'Offline');
  calendarLastUpdatedAt = updatedAt;
  nextCalendarEvent = nextEvent || nextCalendarEvent;
  updateCalendarMonitorUI();
}

function calendarStatusInfo() {
  if (calendarManualOverride) return { emoji: '🟠', text: 'OVERRIDE (admin)', state: 'warn' };
  switch (calendarStatus) {
    case 'verified': return { emoji: '🟢', text: 'CALENDAR VERIFIED', state: 'ok' };
    case 'updating': return { emoji: '🟡', text: 'CALENDAR UPDATING', state: 'warn' };
    case 'high_impact': return { emoji: '🔴', text: 'HIGH IMPACT NEWS ACTIVE', state: 'bad' };
    case 'unavailable': return { emoji: '🟠', text: 'NEWS UNAVAILABLE', state: 'warn' };
    default: return { emoji: '⚪', text: 'NOT CHECKED', state: 'warn' };
  }
}
function updateCalendarMonitorUI() {
  const info = calendarStatusInfo();
  const retryTxt = calendarRetryCount > 0 ? ' · retry ' + calendarRetryCount : '';
  safeText('calendarApiStatusEl', info.emoji + ' ' + info.text + retryTxt);
  safeText('calendarSourceEl', calendarSourceName || '--');
  safeText('calendarLastUpdateEl', calendarLastUpdatedAt ? calendarLastUpdatedAt.toLocaleTimeString('id-ID') : '--');
  const nxt = nextHighImpactNews || nextCalendarEvent;
  safeText('calendarNextEventEl', nxt ? ((nxt.title || nxt.event || '--') + (nxt.currency ? ' (' + nxt.currency + ')' : '')) : (calendarValidated ? 'Tidak ada' : '--'));
  safeText('calendarNextCountdownEl', nxt ? getEventCountdown(nxt.date) : (calendarValidated ? '—' : '--'));

  const btn = document.getElementById('calendarOverrideBtn');
  if (btn) {
    btn.classList.toggle('manual-override-active', calendarManualOverride);
    btn.innerHTML = `<i class="fas fa-user-shield"></i> MANUAL OVERRIDE: ${calendarManualOverride ? 'ON' : 'OFF'}`;
  }
}

function toggleCalendarManualOverride(forceState) {
  calendarManualOverride = typeof forceState === 'boolean' ? forceState : !calendarManualOverride;
  // Override = admin menanggung risiko news. Tidak lagi mengubah newsRiskUnknown
  // (offline tetap informational; AI diblok HANYA oleh high-impact tERVERIFIKASI tanpa override).
  if (calendarManualOverride) {
    showToast('Manual Override ON — risiko news ditanggung admin.', 'info');
    addLog('[CALENDAR] Manual override ON.', 'info');
  } else {
    showToast('Manual Override OFF — gunakan hasil validasi kalender.', 'info');
    addLog('[CALENDAR] Manual override OFF.', 'info');
  }
  updateCalendarMonitorUI();
  updateNewsHardBlockUI();
  applyTradingReadiness(lastWsPrice);
}

function isGoldUsdHighImpactEvent(event) {
  const currency = String(event.currency || '').toUpperCase();
  const impact = String(event.impact || '').toLowerCase();
  const title = String(event.title || event.event || '').toUpperCase();
  const isHigh = impact.includes('high') || impact.includes('red') || impact.includes('3');
  const keywords = [
    'NFP', 'NON-FARM', 'NONFARM', 'NON FARM',
    'CPI', 'CONSUMER PRICE', 'INFLATION RATE',
    'FOMC', 'FED INTEREST RATE', 'FEDERAL FUNDS', 'INTEREST RATE DECISION', 'FOMC STATEMENT', 'FOMC PRESS'
  ];
  return currency === 'USD' && isHigh && keywords.some(k => title.includes(k));
}

function isHighImpactEventSoon(event) {
  if (!isGoldUsdHighImpactEvent(event)) return false;
  const rawDate = event.date || event.datetime || event.time || '';
  const eventTime = Date.parse(rawDate);
  if (!Number.isFinite(eventTime)) return true;

  const now = Date.now();
  const diffMs = eventTime - now;
  const fourHours = 4 * 60 * 60 * 1000;
  const oneHourAgo = -1 * 60 * 60 * 1000;
  return diffMs >= oneHourAgo && diffMs <= fourHours;
}

function escapeHtml(value) {
  return String(value ?? '--')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateTradeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildTradingPlanPayload() {
  const price = lastWsPrice;
  const m = getTradeMetrics(price);
  const d = m.cfg.decimals;
  const decision = currentPlanDecision || assessTradingReadiness(price);
  const hasActionableSide = m.side === 'BUY' || m.side === 'SELL';
  const aiExplanation = buildAIReasons(decision).map(r => `${r.ok ? '✔' : '⚠'} ${r.text}`).join(' | ');
  return {
    tradeId: generateTradeId(),
    date: new Date().toLocaleDateString('id-ID'),
    time: new Date().toLocaleTimeString('id-ID'),
    timestamp: new Date().toISOString(),
    pair: m.cfg.display,
    action: m.side,
    orderType: m.orderType,
    bias: m.bias,
    setupType: document.getElementById('tpSetupType')?.innerText || 'ENTRY PLAN XAUUSD',
    entry: hasActionableSide ? Number(m.entry.toFixed(d)) : '',
    stopLoss: hasActionableSide ? Number(m.sl.toFixed(d)) : '',
    tp1: hasActionableSide ? Number(m.tp1.toFixed(d)) : '',
    tp2: hasActionableSide ? Number(m.tp2.toFixed(d)) : '',
    tp3: hasActionableSide ? Number(m.tp3.toFixed(d)) : '',
    riskPct: Number(m.risk),
    riskAmount: Number(m.riskAmt.toFixed(2)),
    lotSize: hasActionableSide ? Number(m.lotSize.toFixed(2)) : '',
    confidence: document.getElementById('finalConf')?.innerText || '',
    confluence: document.getElementById('finalConfl')?.innerText || '',
    trend: `${m.trend.label} | strength ${m.trend.strength}% | ${m.trend.reason}`,
    news: highImpactNewsDetected ? `WAIT NEWS: ${highImpactNewsLabel}` : (calendarValidated ? 'USD High Impact Clear (verified)' : (calendarManualOverride ? 'Override ON' : 'Calendar unverified (offline)')),
    dom: m.side === 'BUY' ? (lastPctChange >= 0 ? 'Buyer momentum proxy aligned' : 'Buyer momentum proxy weak') : m.side === 'SELL' ? (lastPctChange <= 0 ? 'Seller momentum proxy aligned' : 'Seller momentum proxy weak') : 'No directional DOM proxy',
    aiExplanation,
    screenshotChart: captureChartPlaceholder(),
    resultTrade: 'OPEN',
    traderNotes: '',
    status: decision.title || document.getElementById('finalStatus')?.innerText || 'READY TO TRADE',
    notes: `${decision.reason || 'No readiness note'} | Auto-saved saat Entry Locked pada ${new Date().toLocaleString('id-ID')}`
  };
}

// Sinkron ke Google Sheets di background, tidak blocking dan tidak spam toast (dipakai otomatis saat lock).
async function syncPlanToSheetsSilent(payload) {
  const requestUrl = getSheetsRequestUrl();
  if (!requestUrl) {
    setSystemStatus('sheets', 'warn', 'Setup');
    return; // Sheets belum dikonfigurasi — journal tetap tersimpan lokal (secure-by-default)
  }
  try {
    await fetchWithTimeout(requestUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    }, 12000);
    setSystemStatus('sheets', 'ok', 'Synced');
    addLog(`Trade ${payload.action} @ ${payload.entry} auto-synced ke Google Sheets.`, 'success');
  } catch (err) {
    setSystemStatus('sheets', 'bad', 'Error');
    addLog(`Auto-sync ke Google Sheets gagal: ${err.message}. Trade tetap tersimpan di journal lokal.`, 'error');
  }
}

function updateJournalRow(tradeId, patch) {
  const rows = getJournalHistory();
  const idx = rows.findIndex(r => r.tradeId === tradeId);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch };
  setJournalHistory(rows);
  updateDashboardSummary();
  updateRiskManagement();
  if (typeof renderBacktestCharts === 'function') { try { renderBacktestCharts(); } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); } }
  return rows[idx];
}

// Dipanggil tiap kali status berubah jadi ENTRY VALID (lock baru): otomatis simpan sebagai trade OPEN.
function autoRecordLockedTrade() {
  // Kalau ada trade sebelumnya yang masih OPEN (mis. plan diganti/auto-renew sebelum kena TP/SL), tandai CANCELLED biar tidak nyangkut selamanya.
  if (currentOpenTradeId) {
    updateJournalRow(currentOpenTradeId, { resultTrade: 'CANCELLED', closedAt: new Date().toISOString(), traderNotes: 'Plan diperbarui/auto-renew sebelum TP/SL tercapai.' });
    currentOpenTradeId = null;
  }
  const payload = buildTradingPlanPayload();
  recordJournal(payload);
  currentOpenTradeId = payload.tradeId;
  saveLockedPlanState();
  addLog(`Trade otomatis tercatat di journal: ${payload.action} @ ${payload.entry} (SL ${payload.stopLoss} / TP1 ${payload.tp1}).`, 'success');
  syncPlanToSheetsSilent(payload);
}

// Dipanggil tiap tick: cek apakah trade OPEN yang sedang dipantau sudah kena TP1/TP2/TP3 atau SL,
// lalu tutup secara PARSIAL sesuai tier (TP1=50%, TP2=30%, TP3=20% sisanya). SL menutup sisa.
function checkOpenTradeOutcome(price = lastWsPrice) {
  if (!currentOpenTradeId || !Number.isFinite(price)) return;
  const rows = getJournalHistory();
  const row = rows.find(r => r.tradeId === currentOpenTradeId && r.resultTrade === 'OPEN');
  if (!row) { currentOpenTradeId = null; return; }

  const side = row.action;
  const entry = Number(row.entry), sl = Number(row.stopLoss);
  const tp1 = Number(row.tp1), tp2 = Number(row.tp2), tp3 = Number(row.tp3);
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || (side !== 'BUY' && side !== 'SELL')) return;

  const totalLot = Number(row.lotSize) || GOLD_PLAN.minLot;
  const closedLot = Number(row.closedLot) || 0;
  const remaining = totalLot - closedLot;
  if (remaining <= 0.0001) {
    updateJournalRow(currentOpenTradeId, { resultTrade: 'WIN (FULL TP)' });
    currentOpenTradeId = null;
    saveLockedPlanState();
    return;
  }

  const slHit = side === 'BUY' ? price <= sl : price >= sl;
  const tp3Hit = Number.isFinite(tp3) && (side === 'BUY' ? price >= tp3 : price <= tp3);
  const tp2Hit = Number.isFinite(tp2) && (side === 'BUY' ? price >= tp2 : price <= tp2);
  const tp1Hit = Number.isFinite(tp1) && (side === 'BUY' ? price >= tp1 : price <= tp1);

  // Target kumulatif lot yang harus tertutup per tier: TP1=50%, TP2=80%, TP3/SL=100%.
  let targetCum = null, exitPrice = null, tier = null;
  if (slHit) { targetCum = 1.0; exitPrice = sl; tier = 'SL'; }
  else if (tp3Hit) { targetCum = 1.0; exitPrice = tp3; tier = 'TP3'; }
  else if (tp2Hit) { targetCum = 0.80; exitPrice = tp2; tier = 'TP2'; }
  else if (tp1Hit) { targetCum = 0.50; exitPrice = tp1; tier = 'TP1'; }
  if (targetCum === null) return;

  const targetClosedLot = totalLot * targetCum;
  if (closedLot >= targetClosedLot - 0.0001) return; // tier ini sudah tertutup, tunggu tier berikutnya
  const closeLot = Math.min(remaining, targetClosedLot - closedLot);
  const valueAt = (side === 'BUY' ? (exitPrice - entry) : (entry - exitPrice)) * GOLD_PLAN.contractSize;
  const realized = valueAt * closeLot;
  const accPnl = Number(row.pnl) || 0;
  const newClosedLot = closedLot + closeLot;
  const fullyClosed = newClosedLot >= totalLot * 0.999;
  const newPnl = accPnl + realized;

  const patch = {
    closedLot: Number(newClosedLot.toFixed(2)),
    pnl: Number(newPnl.toFixed(2)),
    exitPrice: fullyClosed ? exitPrice : (Number(row.exitPrice) || exitPrice),
    closedAt: fullyClosed ? new Date().toISOString() : (row.closedAt || '')
  };

  let label;
  if (tier === 'SL') {
    patch.resultTrade = newPnl >= 0 ? 'CLOSED (SL, BE+)' : 'LOSS (SL)';
    label = `${newPnl >= 0 ? '🟠' : '🔴'} SL — sisa ${closeLot.toFixed(2)} lot @ ${formatPrice(sl)}`;
  } else {
    patch.resultTrade = fullyClosed ? 'WIN (FULL TP)' : 'OPEN';
    label = `🟢 PARTIAL ${tier} — ${closeLot.toFixed(2)} lot @ ${formatPrice(exitPrice)} (+${formatMoney(realized)})`;
  }

  updateJournalRow(currentOpenTradeId, patch);

  if (fullyClosed || tier === 'SL') {
    addLog(`Trade ditutup penuh: ${label} | Total PnL ${formatMoney(newPnl)}.`, newPnl >= 0 ? 'success' : 'error');
    showToast(`${label} | Total PnL ${formatMoney(newPnl)}.`, newPnl >= 0 ? 'success' : 'error');
    currentOpenTradeId = null;
    saveLockedPlanState();
  } else {
    addLog(`Partial ${tier}: ${label}. Sisa ${Number((totalLot - newClosedLot).toFixed(2))} lot masih OPEN.`, 'success');
    showToast(`${label}. Sisa lot masih dipantau.`, 'info');
    saveLockedPlanState();
  }

  const st = getSettings();
  if (st.notifyTelegramOnLock !== false && st.telegramToken && st.telegramChatId) {
    sendTelegramAlert({
      action: label, entry: formatPrice(entry), stopLoss: formatPrice(sl),
      tp1: formatPrice(tp1), tp2: formatPrice(tp2), tp3: formatPrice(tp3),
      lotSize: totalLot.toFixed(2), confidence: '-',
      aiExplanation: `Trade ${side} ${tier}: ${closeLot.toFixed(2)} lot @ ${formatPrice(exitPrice)}. PnL akumulatif: ${formatMoney(newPnl)}.`
    }).catch(() => {});
  }
}



function runSmartSheetAnalysis() {
  showToast('Menjalankan Smart Technical Analysis...', 'success');
  setTimeout(() => {
    const cfg = getSymbolConfig();
    const output = document.getElementById('smartAnalyzerOutput');
    if (!output) return;
    output.innerHTML = `
      <div class="p-3 rounded bg-slate-900 border border-emerald-500/35 space-y-2">
        <div class="flex justify-between text-emerald-400 font-bold"><span>Status: BERHASIL</span><span>Confidence: ${document.getElementById('finalConf')?.innerText || '—'}</span></div>
        <div>• Pair aktif: ${escapeHtml(cfg.display)} @ ${escapeHtml(formatPrice(lastWsPrice))}</div>
        <div>• Trend Engine: ${escapeHtml(analyzeMarketTrend(lastWsPrice).label)} / Strength ${escapeHtml(String(analyzeMarketTrend(lastWsPrice).strength))}%</div>
        <div>• SMC Proxy: ${escapeHtml(getSMCState().smcOrderBlock[1])} di ${escapeHtml(formatPrice(lastWsPrice))}</div>
        <div>• Sheets Sync: endpoint Google Sheets aktif; plan dapat tersimpan ke TradingPlanLog.</div>
      </div>
    `;
    showToast('Smart Analyzer selesai dijalankan!', 'success');
    addLog('Smart Analyzer selesai.', 'success');
  }, 800);
}

function showSpreadsheetModal() {
  const st = getSettings();
  showToast(st.sheetsUrl ? 'Google Sheets endpoint aktif. Tombol Simpan Plan akan mengirim ke TradingPlanLog.' : 'Google Sheets belum dikonfigurasi. Isi URL di Settings.', st.sheetsUrl ? 'success' : 'info');
}

async function testTelegramAlert() {
  const m = getTradeMetrics(lastWsPrice);
  const payload = {
    action: m.side,
    entry: formatPrice(m.entry),
    stopLoss: formatPrice(m.sl),
    tp1: formatPrice(m.tp1),
    tp2: formatPrice(m.tp2),
    tp3: formatPrice(m.tp3),
    lotSize: m.lotSize.toFixed(2),
    confidence: document.getElementById('finalConf')?.innerText || '--',
    aiExplanation: 'Test alert from AI Trading Signal XAUUSD'
  };
  const ok = await sendTelegramAlert(payload);
  showToast(ok ? 'Test Telegram alert terkirim.' : 'Telegram belum terkirim. Cek Bot Token & Chat ID di Settings.', ok ? 'success' : 'info');
}


(function () {
  'use strict';

  // ─────────────── DOM CACHE (kurangi query berulang) ───────────────
  const $ = function (id) { return document.getElementById(id); };
  const has = function (id) { return $(id) !== null; };

  // ─────────────── UTIL ───────────────
  function fmtPrice(v) { return (typeof formatPrice === 'function') ? formatPrice(v) : '--'; }
  function fmtMoney(v) { return (typeof formatMoney === 'function') ? formatMoney(v) : '$0.00'; }
  function safeSet(id, txt) { const e = $(id); if (e) e.innerText = txt; }
  function setHTML(id, html) { const e = $(id); if (e) e.innerHTML = html; }
  function throttle(fn, ms) {
    let t = 0, lastArgs;
    return function () {
      const now = Date.now(), self = this, args = arguments;
      lastArgs = args;
      if (now - t >= ms) { t = now; fn.apply(self, args); }
    };
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function msToHMS(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '--:--';
    const s = Math.floor(ms / 1000);
    return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
  }
  function escapeHtmlLocal(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─────────────── STATE PRO (lokal) ───────────────
  const VALIDITY_MS = 15 * 60 * 1000; // validity window entry
  let entryValidSince = 0;
  let journalFilter = 'all';
  let connStart = 0, lastConn = false;
  let notifFlags = { nearEntry: false, weekend: false, biasSide: '' };

  // ─────────────── DATA READERS (dari inti) ───────────────
  function readCore() {
    try {
      const price = (typeof lastWsPrice !== 'undefined') ? lastWsPrice : NaN;
      const decision = (typeof currentPlanDecision !== 'undefined' && currentPlanDecision) || (typeof assessTradingReadiness === 'function' ? assessTradingReadiness(price) : null);
      const metrics = (typeof getTradeMetrics === 'function') ? getTradeMetrics(price) : null;
      const trend = (typeof analyzeMarketTrend === 'function') ? analyzeMarketTrend(price) : null;
      const session = (typeof getTradingSession === 'function') ? getTradingSession() : null;
      const dataOk = (typeof livePriceVerified !== 'undefined') && livePriceVerified && !(typeof usingSimulatedPrice !== 'undefined' && usingSimulatedPrice) && (typeof recentPrices !== 'undefined') && recentPrices.length >= (typeof MIN_TREND_SAMPLES !== 'undefined' ? MIN_TREND_SAMPLES : 12);
      return { price, decision, metrics, trend, session, dataOk };
    } catch (e) { return { price: NaN, decision: null, metrics: null, trend: null, session: null, dataOk: false }; }
  }

  // ─────────────── ENTRY GUIDANCE ───────────────
  function mapGuidance(code) {
    switch (code) {
      case 'ENTRY_VALID': return { label: 'ENTRY SEKARANG', tone: 'green', action: 'Eksekusi market/pending sesuai order type. Jangan menunda.' };
      case 'ENTRY_VALID_HOLD': return { label: 'SETUP MASIH BERLAKU', tone: 'green', action: 'Entry sudah pernah tersentuh — status tetap berlaku sampai SL kena atau Anda klik Tutup Manual.' };
      case 'WAIT_PULLBACK': return { label: 'TUNGGU LIMIT', tone: 'orange', action: 'Pasang limit & tunggu harga masuk zona entry.' };
      case 'WAIT_BREAKOUT': return { label: 'WAIT KONFIRMASI', tone: 'orange', action: 'Tunggu konfirmasi breakout/rejection sebelum entry.' };
      case 'ENTRY_INVALID': return { label: 'SETUP BATAL', tone: 'red', action: 'Setup invalid (SL terlewati). Tunggu plan baru.' };
      case 'WAIT_NEWS': return { label: 'WAIT KONFIRMASI', tone: 'orange', action: 'Tunggu high-impact news selesai dahulu.' };
      case 'WAIT_RECHECK': return { label: 'WAIT KONFIRMASI', tone: 'orange', action: 'Harga sudah lewat entry — jangan kejar, tunggu re-test.' };
      default: return { label: 'JANGAN ENTRY', tone: 'orange', action: 'Filter belum valid / data offline. Tidak entry.' };
    }
  }
  function renderEntryGuidance(core) {
    const card = $('entryGuidanceCard'); if (!card) return;
    const d = core.decision;
    const code = d ? d.code : 'NO_TRADE';
    const g = mapGuidance(code);
    card.className = 'guidance-card guidance-' + g.tone;
    const st = $('guidanceStatus');
    if (st) { st.innerText = g.label; st.style.color = g.tone === 'green' ? 'var(--green)' : g.tone === 'red' ? 'var(--red)' : 'var(--orange)'; }
    safeSet('guidanceReason', d ? d.reason : 'Menunggu data live & validasi filter.');
    safeSet('guidanceAction', g.action);

    // validity countdown
    const pill = $('validityPill');
    if (code === 'ENTRY_VALID' || code === 'ENTRY_VALID_HOLD') {
      if (!entryValidSince) entryValidSince = Date.now();
      const remain = Math.max(0, VALIDITY_MS - (Date.now() - entryValidSince));
      if (pill) {
        pill.className = 'validity-pill badge badge-green';
        const mins = Math.floor(remain / 60000), secs = Math.floor((remain % 60000) / 1000);
        pill.innerHTML = '<i class="fas fa-clock mr-1"></i> Valid ' + mins + 'm ' + pad2(secs) + 's';
      }
    } else {
      entryValidSince = 0;
      if (pill) { pill.className = 'validity-pill badge badge-orange'; pill.innerHTML = '<i class="fas fa-clock mr-1"></i> Valid —'; }
    }
  }

  // ─────────────── ENTRY CHECKLIST ───────────────
  // Disinkronkan dengan mesin scoring baru (getEntryScoreAnalysis): Market Structure jadi satu-satunya
  // syarat wajib (★), faktor lain (S&D, Trend, Candlestick) menambah Confidence Score, bukan syarat mutlak.
  function renderChecklist(core) {
    const grid = $('checklistGrid'); if (!grid) return;
    const { session, dataOk } = core;
    const newsClear = (typeof calendarManualOverride !== 'undefined' && calendarManualOverride) || !(typeof highImpactNewsDetected !== 'undefined' && highImpactNewsDetected);
    const analysis = (typeof lastEntryScoreAnalysis !== 'undefined' && lastEntryScoreAnalysis) || (typeof getEntryScoreAnalysis === 'function' ? getEntryScoreAnalysis() : null);
    const metrics = core.metrics;
    const items = [];
    const push = (label, pass, vital) => items.push({ label, pass, vital });

    push('Live Feed', !!(typeof connected !== 'undefined' && connected && dataOk), true);
    push('Market Structure (BOS/CHoCH)', !!(analysis && analysis.structure && analysis.structure.valid), true);
    push('Supply & Demand', !!(analysis && analysis.supplyDemand && analysis.supplyDemand.valid), false);
    push('Trend H1/H4', !!(analysis && analysis.trend && analysis.trend.aligned), false);
    push('Candlestick Confirmation', !!(analysis && analysis.candlestick && analysis.candlestick.valid), false);
    push('News Filter', !!newsClear, true);
    push('Session Aktif', !!(session && session.active), false);
    const rr1 = metrics && metrics.side !== 'WAIT' ? metrics.rr(metrics.tp1) : 0;
    push('Risk : Reward ≥ 1', !!(metrics && metrics.side !== 'WAIT' && rr1 >= 1), true);
    push('Spread', null, false); // butuh broker L2 → netral

    const passCount = items.filter(i => i.pass === true).length;
    safeSet('checklistScore', passCount + '/' + items.length);
    const scoreEl = $('checklistConfidenceScore');
    if (scoreEl && analysis) scoreEl.innerText = analysis.score + '/100 — ' + (analysis.band === 'NO_TRADE' ? 'No Trade' : analysis.band === 'STRONG' ? 'Strong' : analysis.band === 'VALID_ENTRY' ? 'Valid Entry' : 'Entry Agresif');
    grid.innerHTML = items.map(function (it) {
      const cls = it.pass === true ? 'check-pass' : it.pass === false ? 'check-fail' : 'check-warn';
      const icon = it.pass === true ? '<i class="fas fa-check"></i>' : it.pass === false ? '<i class="fas fa-xmark"></i>' : '<i class="fas fa-minus"></i>';
      const vit = it.vital ? ' <span style="color:var(--gold);font-size:9px">★</span>' : '';
      return '<div class="check-item ' + cls + '"><span class="ci-dot">' + icon + '</span><span>' + escapeHtmlLocal(it.label) + vit + '</span></div>';
    }).join('');
  }

  // ─────────────── Trade Decision BREAKDOWN ───────────────
  function renderAIBreakdown(core) {
    if (!has('aiBreakdownCard')) return;
    const d = core.decision;
    const m = core.metrics;
    const confTxt = $('finalConf') ? $('finalConf').innerText : '--';
    const confNum = Math.max(0, Math.min(100, parseInt(confTxt, 10) || 0));
    const gauge = $('aiConfGauge');
    if (gauge) gauge.style.setProperty('--p', confNum);
    safeSet('aiConfGaugeTxt', confNum + '%');
    safeSet('aiBdBias', m ? (m.side + ' · ' + m.bias) : 'WAIT');
    safeSet('aiBdRec', d ? d.title : 'Menunggu data live.');
    if (d) { const r = $('aiBdRec'); if (r) r.style.color = d.tone === 'green' ? 'var(--green)' : d.tone === 'red' ? 'var(--red)' : 'var(--orange)'; }
    safeSet('aiBdReason', d ? d.reason : '—');

    let pros = [], cons = [];
    try { if (typeof buildAIReasons === 'function' && d) { const all = buildAIReasons(d); pros = all.filter(r => r.ok); cons = all.filter(r => !r.ok); } } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); }
    const renderCol = function (arr, color, icon) {
      if (!arr.length) return '<div class="text-muted">Tidak ada.</div>';
      return arr.map(function (r) { return '<div class="pc-row"><i class="fas ' + icon + '" style="color:' + color + '"></i><span>' + escapeHtmlLocal(r.text) + '</span></div>'; }).join('');
    };
    setHTML('aiPros', renderCol(pros, 'var(--green)', 'fa-check'));
    setHTML('aiCons', renderCol(cons, 'var(--orange)', 'fa-triangle-exclamation'));
  }

  // ─────────────── SESSION MONITOR ───────────────
  const SESSIONS = [
    { name: 'Sydney', start: 21, end: 6 },
    { name: 'Tokyo', start: 0, end: 9 },
    { name: 'London', start: 7, end: 16 },
    { name: 'New York', start: 12, end: 21 }
  ];
  function sessionStatus(start, end) {
    const now = new Date();
    const h = now.getUTCHours() + now.getUTCMinutes() / 60;
    const wrap = start > end;
    const inside = wrap ? (h >= start || h < end) : (h >= start && h < end);
    // next boundary
    let nextMs = Infinity, nextLabel = '';
    for (let d = 0; d < 2; d++) {
      const open = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, start, 0, 0));
      const close = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, end, 0, 0));
      const cand = inside
        ? [{ at: close.getTime(), label: 'tutup' }]
        : [{ at: open.getTime(), label: 'buka' }];
      for (const c of cand) { if (c.at > Date.now() && c.at - Date.now() < nextMs) { nextMs = c.at - Date.now(); nextLabel = c.label; } }
    }
    return { inside, nextMs, nextLabel };
  }
  function renderSessionMonitor() {
    const grid = $('sessionGrid'); if (!grid) return;
    if (typeof isForexMarketOpen === 'function' && !isForexMarketOpen()) {
      const reopen = (typeof getMarketReopenInfo === 'function') ? getMarketReopenInfo() : null;
      const msLeft = reopen ? Math.max(0, reopen.getTime() - Date.now()) : 0;
      grid.innerHTML = SESSIONS.map(function (s) {
        return '<div class="session-card">' +
          '<div class="session-name">' + s.name + ' <span class="badge badge-orange mono text-[9px]">CLOSED</span></div>' +
          '<div class="session-countdown">🔜 Market libur — buka ' + msToHMS(msLeft) + '</div>' +
          '<div class="session-strength"><i style="width:0%"></i></div>' +
          '</div>';
      }).join('');
      return;
    }
    grid.innerHTML = SESSIONS.map(function (s) {
      const st = sessionStatus(s.start, s.end);
      const strength = st.inside ? 90 : 25;
      return '<div class="session-card ' + (st.inside ? 'live' : '') + '">' +
        '<div class="session-name">' + s.name + ' <span class="badge ' + (st.inside ? 'badge-green' : 'badge-orange') + ' mono text-[9px]">' + (st.inside ? 'OPEN' : 'CLOSED') + '</span></div>' +
        '<div class="session-countdown">' + (st.inside ? '⏳ ' : '🔜 ') + capitalize(st.nextLabel) + ' ' + msToHMS(st.nextMs) + '</div>' +
        '<div class="session-strength"><i style="width:' + strength + '%"></i></div>' +
        '</div>';
    }).join('');
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ─────────────── HEATMAP (jujur: hanya XAUUSD live + DXY) ───────────────
  function renderHeatmap(core) {
    const grid = $('heatmapGrid'); if (!grid) return;
    const cells = [];
    const live = (typeof livePriceVerified !== 'undefined') && livePriceVerified && Number.isFinite(core.price) && core.price > 0;
    const chg = (typeof lastPctChange !== 'undefined') ? lastPctChange : 0;
    cells.push(buildHeatCell('XAUUSD', live ? fmtPrice(core.price) : 'offline', live ? (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%' : 'no live', live ? chg : null));
    const dxy = (typeof dxyState !== 'undefined') ? dxyState : null;
    cells.push(buildHeatCell('DXY', dxy && dxy.value ? dxy.value.toFixed(2) : 'offline', dxy && dxy.value ? (dxy.changePct >= 0 ? '+' : '') + dxy.changePct.toFixed(2) + '%' : 'no feed', dxy && dxy.value ? dxy.changePct : null));
    ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'Silver', 'Oil', 'Crypto'].forEach(function (sym) {
      cells.push(buildHeatCell(sym, '—', 'no feed', null));
    });
    grid.innerHTML = cells.join('');
  }
  function buildHeatCell(sym, val, chg, chgNum) {
    const cls = chgNum === null ? 'hm-neutral' : (chgNum > 0 ? 'hm-up' : chgNum < 0 ? 'hm-dn' : 'hm-neutral');
    return '<div class="hm-cell ' + cls + '"><div class="hm-sym">' + sym + '</div><div class="hm-val">' + escapeHtmlLocal(val) + '</div><div class="hm-chg">' + escapeHtmlLocal(chg) + '</div></div>';
  }

  // ─────────────── RISK CALCULATOR ───────────────
  window.recalcRiskCalc = function () {
    const cs = (typeof GOLD_PLAN !== 'undefined' && GOLD_PLAN.contractSize) ? GOLD_PLAN.contractSize : 100;
    const acc = Math.max(0, parseFloat($('calcAcc') && $('calcAcc').value) || 0);
    const risk = Math.min(100, Math.max(0, parseFloat($('calcRisk') && $('calcRisk').value) || 0));
    const sl = Math.max(0.01, parseFloat($('calcSl') && $('calcSl').value) || 0);
    const tp = Math.max(0, parseFloat($('calcTp') && $('calcTp').value) || 0);
    const riskUsd = acc * (risk / 100);
    const lot = riskUsd / (sl * cs);
    const profit = tp * cs * lot;
    const rr = tp > 0 ? (tp / sl) : 0;
    safeSet('calcRiskUsd', fmtMoney(riskUsd));
    safeSet('calcLot', lot.toFixed(2) + ' lot');
    safeSet('calcProfit', fmtMoney(profit));
    safeSet('calcRR', '1 : ' + rr.toFixed(2));
    safeSet('calcContract', cs + ' / ' + fmtMoney(cs) + ' per poin per lot');
  };

  // ─────────────── TRADE JOURNAL TAB ───────────────
  function resultClass(resultTrade, pnl) {
    const r = String(resultTrade || '').toUpperCase();
    if (r === 'OPEN') return 'res-open';
    if (r.includes('WIN')) return 'res-win';
    if (r.includes('LOSS') || r.includes('SL')) return 'res-loss';
    if (Number(pnl) > 0) return 'res-win';
    if (Number(pnl) < 0) return 'res-loss';
    return 'res-other';
  }
  window.setJournalFilter = function (f) {
    journalFilter = f;
    document.querySelectorAll('[data-jrnfilter]').forEach(function (b) {
      b.classList.toggle('btn-gold', b.getAttribute('data-jrnfilter') === f);
      b.classList.toggle('btn-outline', b.getAttribute('data-jrnfilter') !== f);
    });
    window.renderJournalTable();
  };
  window.clearJournal = function () {
    if (typeof getJournalHistory !== 'function') return;
    if (!confirm('Hapus seluruh journal lokal? Tindakan ini tidak bisa dibatalkan.')) return;
    try { setJournalHistory([]); } catch (e) { console.warn("Peringatan tertangkap dan diabaikan:", e); }
    window.renderJournalTable();
    showToast('Journal direset.', 'info');
  };
  window.renderJournalTable = function () {
    if (!has('journalTableBody')) return;
    const rows = (typeof getJournalHistory === 'function') ? getJournalHistory() : [];
    const filtered = rows.filter(function (r) {
      if (journalFilter === 'all') return true;
      if (journalFilter === 'open') return r.resultTrade === 'OPEN';
      if (journalFilter === 'win') return /WIN/i.test(String(r.resultTrade || '')) || Number(r.pnl) > 0;
      if (journalFilter === 'loss') return /LOSS|SL/i.test(String(r.resultTrade || '')) || Number(r.pnl) < 0;
      return true;
    }).slice().reverse();

    // stats
    const closed = rows.filter(r => r.resultTrade && r.resultTrade !== 'OPEN');
    const wins = closed.filter(r => Number(r.pnl) > 0).length;
    const grossWin = closed.reduce((a, r) => a + Math.max(0, Number(r.pnl || 0)), 0);
    const grossLoss = Math.abs(closed.reduce((a, r) => a + Math.min(0, Number(r.pnl || 0)), 0));
    const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
    const net = rows.reduce((a, r) => a + Number(r.pnl || 0), 0);
    const rrs = closed.map(r => {
      const e = Number(r.entry), sl = Number(r.stopLoss), t1 = Number(r.tp1);
      if (!Number.isFinite(e) || !Number.isFinite(sl) || !Number.isFinite(t1) || e === sl) return null;
      return Math.abs((t1 - e) / (e - sl));
    }).filter(Number.isFinite);
    const avgRR = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0;
    safeSet('jrnTotal', rows.length);
    safeSet('jrnWinRate', closed.length ? ((wins / closed.length) * 100).toFixed(1) + '%' : '—');
    safeSet('jrnPF', Number.isFinite(pf) ? pf.toFixed(2) : '∞');
    safeSet('jrnNet', fmtMoney(net));
    safeSet('jrnAvgRR', avgRR ? avgRR.toFixed(2) : '—');

    const body = $('journalTableBody');
    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="10" class="p-4 text-center text-muted">' + (rows.length ? 'Tidak ada trade untuk filter ini.' : 'Belum ada trade. Journal terisi otomatis saat sinyal ENTRY VALID terkunci.') + '</td></tr>';
      return;
    }
    body.innerHTML = filtered.map(function (r) {
      const d = new Date(r.savedAt || Date.now());
      const side = r.action || '—';
      const sideColor = side === 'BUY' ? 'var(--green)' : side === 'SELL' ? 'var(--red)' : 'var(--text-muted)';
      const pnl = Number(r.pnl || 0);
      const rc = resultClass(r.resultTrade, pnl);
      const note = (r.aiExplanation || r.notes || '').toString();
      const shortNote = note.length > 60 ? note.slice(0, 60) + '…' : note;
      return '<tr>' +
        '<td>' + d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) + '</td>' +
        '<td>' + escapeHtmlLocal(r.pair || 'XAUUSD') + '</td>' +
        '<td style="color:' + sideColor + ';font-weight:700">' + escapeHtmlLocal(side) + '</td>' +
        '<td>' + escapeHtmlLocal(r.entry != null ? r.entry : '—') + '</td>' +
        '<td style="color:var(--red)">' + escapeHtmlLocal(r.stopLoss != null ? r.stopLoss : '—') + '</td>' +
        '<td>' + escapeHtmlLocal([r.tp1, r.tp2, r.tp3].filter(x => x != null && x !== '').join('/')) + '</td>' +
        '<td>' + escapeHtmlLocal(r.lotSize != null ? r.lotSize : '—') + '</td>' +
        '<td><span class="res-badge ' + rc + '">' + escapeHtmlLocal(r.resultTrade || 'OPEN') + '</span></td>' +
        '<td style="color:' + (pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--text-muted)') + ';font-weight:700">' + fmtMoney(pnl) + '</td>' +
        '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="' + escapeHtmlLocal(note) + '">' + escapeHtmlLocal(shortNote || '—') + '</td>' +
        '</tr>';
    }).join('');
  };

  // ─────────────── FLOATING MINI STATUS ───────────────
  function renderFloatingStatus(core) {
    const bar = $('floatingStatus'); if (!bar) return;
    if (window.matchMedia('(max-width: 900px)').matches) { bar.classList.remove('show'); return; }
    const d = core.decision, m = core.metrics;
    const show = !!(typeof connected !== 'undefined' && connected);
    bar.classList.toggle('show', show);
    if (!show) return;
    const live = (typeof livePriceVerified !== 'undefined') && livePriceVerified;
    safeSet('fsPair', 'XAUUSD');
    safeSet('fsSide', m ? m.side : 'WAIT');
    if ($('fsSide')) $('fsSide').style.color = m && m.side === 'BUY' ? 'var(--green)' : m && m.side === 'SELL' ? 'var(--red)' : 'var(--orange)';
    safeSet('fsEntry', (m && m.side !== 'WAIT' && live) ? fmtPrice(m.entry) : '—');
    safeSet('fsSl', (m && m.side !== 'WAIT' && live) ? fmtPrice(m.sl) : '—');
    safeSet('fsTp', (m && m.side !== 'WAIT' && live) ? fmtPrice(m.tp1) : '—');
    safeSet('fsConf', $('finalConf') ? $('finalConf').innerText : '—');
    safeSet('fsRun', connStart ? msToHMS(Date.now() - connStart) : '00:00');
  }

  // ─────────────── BOTTOM NAV ACTIVE ───────────────
  function updateBottomNav() {
    const active = document.querySelector('.tab-btn.active');
    const id = active ? active.id.replace('btn-', '') : '';
    
    // Map sub-modules to the 'modules' button
    const moduleGroup = ['chartanalysis', 'marketmonitor', 'confluence', 'dom', 'sentiment', 'riskmatrix', 'smartanalyzer', 'backtest', 'settings'];
    const activeBottomId = moduleGroup.includes(id) ? 'modules' : id;

    document.querySelectorAll('.bottom-nav button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-bn') === activeBottomId);
    });
  }

  // ─────────────── SMART NOTIFICATIONS (read-only) ───────────────
  function smartNotifications(core) {
    const d = core.decision, m = core.metrics, price = core.price;
    // dekat entry
    if (m && m.side !== 'WAIT' && Number.isFinite(price) && (typeof livePriceVerified !== 'undefined') && livePriceVerified) {
      const dist = Math.abs(price - m.entry);
      const near = dist <= ((typeof getEntryBuffer === 'function' ? getEntryBuffer(price) : 1) * 2);
      if (near && !notifFlags.nearEntry) { notifFlags.nearEntry = true; if (typeof showToast === 'function') showToast('Harga mendekati zona entry ' + m.side + ' (' + fmtPrice(m.entry) + ')', 'info'); }
      if (!near) notifFlags.nearEntry = false;
    } else { notifFlags.nearEntry = false; }
    // weekend / market tutup
    const now = new Date();
    const weekend = (typeof isForexMarketOpen === 'function') ? !isForexMarketOpen(now) : (now.getUTCDay() === 0 || now.getUTCDay() === 6);
    if (weekend && !notifFlags.weekend) { notifFlags.weekend = true; if (typeof showToast === 'function') showToast('Market forex/logam sedang TUTUP (weekend). Harga mungkin stagnan/beku sampai buka lagi.', 'info'); }
    if (!weekend) notifFlags.weekend = false;
    // bias berubah
    const curSide = m ? m.side : '';
    if (curSide && curSide !== notifFlags.biasSide) {
      if (notifFlags.biasSide && (curSide === 'BUY' || curSide === 'SELL')) {
        if (typeof addLog === 'function') addLog('AI bias berubah: ' + notifFlags.biasSide + ' → ' + curSide, 'info');
      }
      notifFlags.biasSide = curSide;
    }
  }

  // ─────────────── MASTER RENDER (throttled) ───────────────
  const renderAll = throttle(function () {
    const core = readCore();
    renderEntryGuidance(core);
    renderChecklist(core);
    renderAIBreakdown(core);
    renderHeatmap(core);
    renderFloatingStatus(core);
    updateBottomNav();
    smartNotifications(core);
    // connection timer
    const conn = (typeof connected !== 'undefined') && connected;
    if (conn && !lastConn) connStart = Date.now();
    if (!conn) connStart = 0;
    lastConn = conn;
  }, 1000);

  // ─────────────── HELP MODAL + KEYBOARD ───────────────
  const SHORTCUTS = [
    ['1', 'Dashboard'], ['2', 'Plan Monitor'], ['3', 'Trade Journal'], ['4', 'Economic Calendar'],
    ['5', 'Multi-TF Confluence'], ['6', 'Order Book / DOM'], ['7', 'MARKET SENTIMENT'], ['8', 'Risk Matrix'],
    ['9', 'Smart Analyzer'], ['0', 'Backtest'], ['G', 'Generate Signal'], ['C', 'Connect Live'],
    ['X', 'Disconnect'], ['J', 'Journal'], ['S', 'Settings'], ['?', 'Bantuan ini'], ['Esc', 'Tutup modal']
  ];
  function buildHelp() {
    const body = $('helpBody'); if (!body) return;
    body.innerHTML = SHORTCUTS.map(function (s) {
      return '<div class="flex items-center justify-between gap-3"><span class="text-muted">' + escapeHtmlLocal(s[1]) + '</span><span class="kbd">' + escapeHtmlLocal(s[0]) + '</span></div>';
    }).join('') + '<div class="mt-3 text-[10px] text-muted">Shortcut nonaktif saat mengetik di input.</div>';
  }
  window.openHelpModal = function () { const m = $('helpModal'); if (m) { m.classList.add('open'); buildHelp(); } };
  window.closeHelpModal = function () { const m = $('helpModal'); if (m) m.classList.remove('open'); };
  $('helpModal') && $('helpModal').addEventListener('click', function (e) { if (e.target === this) window.closeHelpModal(); });

  const TAB_KEYS = { '1': 'dashboard', '2': 'tradingplan', '3': 'journal', '4': 'calendar', '5': 'confluence', '6': 'dom', '7': 'sentiment', '8': 'riskmatrix', '9': 'smartanalyzer', '0': 'backtest' };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { window.closeHelpModal(); if (typeof closeMobileModules === 'function') closeMobileModules(); return; }
    if (k === '?') { e.preventDefault(); window.openHelpModal(); return; }
    if (TAB_KEYS[e.key]) { e.preventDefault(); if (typeof switchTab === 'function') switchTab(TAB_KEYS[e.key]); return; }
    if (k === 'g') { e.preventDefault(); if (typeof quickGenerateSignal === 'function') quickGenerateSignal(); return; }
    if (k === 'c') { e.preventDefault(); if (typeof doConnect === 'function') doConnect(); return; }
    if (k === 'x') { e.preventDefault(); if (typeof doDisconnect === 'function') doDisconnect(); return; }
    if (k === 'j') { e.preventDefault(); if (typeof switchTab === 'function') switchTab('journal'); return; }
    if (k === 's') { e.preventDefault(); if (typeof switchTab === 'function') switchTab('settings'); return; }
  });

  // FAB → generate
  $('fabGenerate') && $('fabGenerate').addEventListener('click', function () { if (typeof quickGenerateSignal === 'function') quickGenerateSignal(); });

  // show/hide floating status on scroll (desktop)
  window.addEventListener('scroll', throttle(function () { renderFloatingStatus(readCore()); }, 400), { passive: true });

  // pause saat tab tidak terlihat (hemat CPU)
  document.addEventListener('visibilitychange', function () { if (!document.hidden) renderAll(); });

  // ─────────────── INIT ───────────────
  function init() {
    try {
      window.recalcRiskCalc();
      window.renderJournalTable();
      renderSessionMonitor();
      // Kartu info collapsible: terbuka di desktop, tertutup di HP (ringankan scroll).
      const isMob = window.matchMedia('(max-width:900px)').matches;
      document.querySelectorAll('[data-pro-collapse]').forEach(function (d) { d.open = !isMob; });
      renderAll();
      setInterval(function () {
        renderSessionMonitor();
        renderAll();
      }, 1000);
      // a11y: label ikon-only buttons
      document.querySelectorAll('button.btn').forEach(function (b) {
        if (!b.getAttribute('aria-label') && b.innerText.trim() === '' && b.querySelector('i')) {
          b.setAttribute('aria-label', (b.getAttribute('title') || b.querySelector('i').className || 'button'));
        }
      });
    } catch (e) { if (typeof addLog === 'function') addLog('PRO module init warning: ' + e.message, 'error'); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();


