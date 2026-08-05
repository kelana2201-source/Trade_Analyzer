// modules/state.js — Single Unified State & Shared Configuration
// Mengurangi ketergantungan pada global variable terpisah menjadi satu objek AppState,
// lengkap dengan utilitas bersama (logger, toast, formatter, settings).

export const AppState = {
  symbol: 'XAUUSD',
  prices: {
    recent: [],
    lastWsPrice: NaN,
    lastPctChange: 0,
    usingSimulatedPrice: false,
    livePriceVerified: false,
    lastDataSource: 'offline',
    lastLatencyMs: 0,
    lastApiResponseMs: 0
  },
  tradingPlan: {
    lockedSide: 'WAIT',
    lockedEntry: null,
    lockedSL: null,
    lockedOrderType: 'NO TRADE',
    bestFavorProgress: 0,
    entryTriggered: false,
    entryTouchLog: [],
    entryZoneInsidePrev: false,
    lastNotifiedLockCode: null
  },
  market: {
    ohlcCache: { M15: [], H1: [], H4: [], D1: [], updatedAt: 0 },
    dxy: { price: null, changePct: 0, status: 'UNKNOWN', latencyMs: 0, updated: 0 },
    calendar: { status: 'idle', highImpactNewsDetected: false, highImpactNewsLabel: '', manualOverride: false, retryCount: 0 }
  },
  network: {
    connected: false,
    wsModeActive: false,
    wsHeartbeatMs: 0,
    reconnectAttempts: 0,
    lastPingMs: 0,
    lastConnStart: 0,
    heartbeatStatus: 'OK',
    lastHeartbeatTime: 0
  },
  telemetry: {
    logs: [],
    errorsCount: 0,
    warningsCount: 0,
    wsReconnects: 0,
    apiLatencyHistory: [],
    lastDiagnosticsRun: 0,
    diagnosticsReport: null
  }
};

export const STRATEGY_PRESETS = {
  scalping: { weights: { structure: 35, supplyDemand: 25, trend: 15, candlestick: 25 }, minConfidenceScore: 55 },
  intraday: { weights: { structure: 40, supplyDemand: 30, trend: 20, candlestick: 10 }, minConfidenceScore: 60 },
  swing:    { weights: { structure: 45, supplyDemand: 30, trend: 20, candlestick: 5  }, minConfidenceScore: 70 }
};

export const DEFAULT_SETTINGS = {
  sheetsUrl: '',
  sheetsToken: '',
  telegramToken: '',
  telegramChatId: '',
  notifyTelegramOnLock: true,
  useWs: true,
  proxyBaseUrl: 'https://xau-proxy.kelana2201.workers.dev',
  strategyPreset: 'intraday',
  entryScoreWeights: { ...STRATEGY_PRESETS.intraday.weights },
  minConfidenceScore: STRATEGY_PRESETS.intraday.minConfidenceScore,
  loggerEnabled: true,
  loggerLevel: 'DEBUG'
};

export const GOLD_PLAN = {
  slDistance: 8.0,
  tp1Distance: 9.0,
  tp2Distance: 18.0,
  tp3Distance: 32.0,
  minLot: 0.01,
  maxLot: 10.0,
  contractSize: 100,
  breakoutStrength: 58,
  breakoutMomentumPct: 0.035
};

export function getSettings() {
  try {
    const raw = localStorage.getItem('aiTradingSettings.v1');
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(newSt) {
  try {
    const toSave = { ...DEFAULT_SETTINGS, ...newSt };
    localStorage.setItem('aiTradingSettings.v1', JSON.stringify(toSave));
    return true;
  } catch (e) {
    return false;
  }
}

export function getSymbolConfig() {
  return { key: 'XAUUSD', display: 'XAUUSD', decimals: 2 };
}

export function formatPrice(price, decimals = 2) {
  const num = Number(price);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function escapeHtmlLocal(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

export function throttle(func, limit) {
  let lastFunc;
  let lastRan;
  return function (...args) {
    const context = this;
    if (!lastRan) {
      func.apply(context, args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(function () {
        if (Date.now() - lastRan >= limit) {
          func.apply(context, args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  };
}

export function setSystemStatus(mod, state, text) {
  const idMap = {
    broker: 'statusBroker',
    sheets: 'statusSheets',
    tv: 'statusTradingView',
    calendar: 'statusCalendar',
    telegram: 'statusTelegram',
    liveFeed: 'statusLiveFeed',
    ai: 'statusAI'
  };
  const el = document.getElementById(idMap[mod] || ('status' + mod));
  if (!el) return;
  const label = el.querySelector('strong')?.innerText || mod;
  const dotClass = state === 'ok' ? 'sys-ok' : state === 'warn' ? 'sys-warn' : 'sys-err';
  el.innerHTML = `<strong>${label}</strong><span class="flex items-center gap-2"><i class="sys-dot ${dotClass}"></i>${text}</span>`;
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  const bgClass = type === 'error' ? 'bg-red-950/90 border-red-500 text-red-200' :
                  type === 'success' ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200' :
                  'bg-slate-900/90 border-slate-600 text-slate-200';
  toast.className = `p-3 rounded-lg border text-xs shadow-lg backdrop-blur flex items-center gap-2 ${bgClass}`;
  const icon = type === 'error' ? '<i class="fas fa-triangle-exclamation text-red-400"></i>' :
               type === 'success' ? '<i class="fas fa-circle-check text-emerald-400"></i>' :
               '<i class="fas fa-circle-info text-cyan-400"></i>';
  toast.innerHTML = `${icon}<span>${escapeHtmlLocal(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s ease';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

export function addLog(message, level = 'info') {
  const logBox = document.getElementById('logBox');
  if (logBox) {
    const row = document.createElement('div');
    row.className = `log-line ${level === 'error' ? 'text-red-400' : level === 'success' ? 'text-emerald-400' : 'text-dim'}`;
    const nowStr = new Date().toLocaleTimeString('id-ID');
    row.innerText = `[${nowStr}] ${message}`;
    logBox.appendChild(row);
    if (logBox.childElementCount > 100) logBox.removeChild(logBox.firstElementChild);
    logBox.scrollTop = logBox.scrollHeight;
  }
  AppState.telemetry.logs.push({ time: Date.now(), level, message });
  if (AppState.telemetry.logs.length > 200) AppState.telemetry.logs.shift();
}

window.AppState = AppState;
window.getSettings = getSettings;
window.saveSettings = saveSettings;
window.addLog = addLog;
window.showToast = showToast;
window.formatPrice = formatPrice;
