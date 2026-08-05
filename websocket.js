// modules/websocket.js — Institutional WebSocket Client dengan Heartbeat & Exponential Backoff
// Menangani stream harga XAUUSD secara realtime, memantau keaktifan koneksi melalui heartbeat,
// dan melakukan koneksi ulang otomatis dengan penundaan eksponensial saat terputus.

import { AppState, addLog, setSystemStatus, getSettings } from './state.js';

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
const MAX_BACKOFF_MS = 60000;

export function initWebSocket(onPriceCallback) {
  startHeartbeatMonitor();
  return connectPriceSocket(onPriceCallback);
}

export function startHeartbeatMonitor() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    const el = document.getElementById('wsHeartbeatEl');
    if (!AppState.network.connected) {
      if (el) { el.textContent = 'OFFLINE'; el.className = 'telemetry-value text-red-400'; }
      return;
    }
    const elapsedSec = Math.round((Date.now() - AppState.network.lastHeartbeatTime) / 1000);
    if (elapsedSec > 25) {
      AppState.network.heartbeatStatus = 'SILENCE DETECTED';
      if (el) { el.textContent = `SILENT · ${elapsedSec}s`; el.className = 'telemetry-value text-amber-400 font-bold'; }
      addLog(`[WS HEARTBEAT] Tidak ada frame selama ${elapsedSec}d. Memulai re-connect...`, 'error');
      doDisconnect();
      scheduleExponentialReconnect();
    } else {
      AppState.network.heartbeatStatus = 'OK';
      if (el) { el.textContent = `OK · ${elapsedSec}s`; el.className = 'telemetry-value text-emerald-400'; }
    }
  }, 5000);
}

export function connectPriceSocket(onPriceCallback) {
  const st = getSettings();
  if (!st.useWs) {
    AppState.network.wsModeActive = false;
    return false;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return true;
  }

  try {
    const proxyBase = (st.proxyBaseUrl || '').trim().replace(/\/+$/, '');
    const wsUrl = proxyBase
      ? proxyBase.replace(/^http/, 'ws') + '/ws/xau'
      : 'wss://stream.binance.com:9443/ws/paxgusdt@kline_1m';

    ws = new WebSocket(wsUrl);
    AppState.network.lastConnStart = Date.now();
    AppState.network.lastHeartbeatTime = Date.now();

    ws.onopen = function () {
      AppState.network.connected = true;
      AppState.network.wsModeActive = true;
      AppState.network.reconnectAttempts = 0;
      AppState.network.lastHeartbeatTime = Date.now();
      setSystemStatus('liveFeed', 'ok', 'WebSocket Connected');
      addLog(`[WS] Berhasil terhubung ke stream (${wsUrl.split('/')[2]})`, 'success');
      updateWsTelemetryUI();
    };

    ws.onmessage = function (event) {
      try {
        AppState.network.lastHeartbeatTime = Date.now();
        const data = JSON.parse(event.data);
        const price = Number(data.price ?? data.k?.c ?? data.p);
        if (Number.isFinite(price) && price > 0) {
          if (typeof onPriceCallback === 'function') {
            onPriceCallback(price, 'ws:' + (data.source || 'stream'));
          }
        }
      } catch (err) {
        // Abaikan frame malformed
      }
    };

    ws.onerror = function () {
      setSystemStatus('liveFeed', 'warn', 'WS Error — Polling fallback');
    };

    ws.onclose = function () {
      AppState.network.connected = false;
      AppState.network.wsModeActive = false;
      setSystemStatus('liveFeed', 'warn', 'Disconnected');
      scheduleExponentialReconnect(onPriceCallback);
    };

    return true;
  } catch (err) {
    addLog(`[WS] Gagal membuka WebSocket: ${err.message}`, 'error');
    scheduleExponentialReconnect(onPriceCallback);
    return false;
  }
}

export function scheduleExponentialReconnect(onPriceCallback) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  AppState.network.reconnectAttempts++;
  AppState.telemetry.wsReconnects++;
  updateWsTelemetryUI();

  const attempt = AppState.network.reconnectAttempts;
  const backoffMs = Math.min(
    MAX_BACKOFF_MS,
    Math.round(1000 * Math.pow(1.8, attempt) + Math.random() * 500)
  );

  addLog(`[WS BACKOFF] Menjadwalkan koneksi ulang (#${attempt}) dalam ${(backoffMs / 1000).toFixed(1)} detik...`, 'info');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!AppState.network.connected) {
      connectPriceSocket(onPriceCallback);
    }
  }, backoffMs);
}

export function doDisconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    try { ws.close(); } catch (e) {}
    ws = null;
  }
  AppState.network.connected = false;
  AppState.network.wsModeActive = false;
  setSystemStatus('liveFeed', 'warn', 'Offline');
  addLog('[WS] Koneksi diputus secara manual/system.', 'info');
  updateWsTelemetryUI();
}

export function updateWsTelemetryUI() {
  const elRec = document.getElementById('wsReconnectsEl');
  if (elRec) {
    elRec.textContent = String(AppState.telemetry.wsReconnects);
    if (AppState.telemetry.wsReconnects > 0) {
      elRec.className = 'telemetry-value text-cyan-400';
    }
  }
}
