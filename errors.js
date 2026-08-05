// modules/errors.js — Global Error Handler & Diagnostics Reporter
// Menangkap semua runtime exception (window.onerror) dan promise penolakan (unhandledrejection)
// agar tidak menghentikan eksekusi antarmuka dan tercatat di Telemetry Dashboard.

import { AppState, addLog, setSystemStatus } from './state.js';

export function initGlobalErrorHandlers() {
  window.onerror = function (message, source, lineno, colno, error) {
    const errDetail = `${message} (${source?.split('/').pop() || 'script'}:${lineno}:${colno})`;
    AppState.telemetry.errorsCount++;
    addLog(`[GLOBAL ERROR] ${errDetail}`, 'error');
    setSystemStatus('ai', 'warn', 'Recovered');
    updateTelemetryErrorDisplay();
    return true; // Mencegah console spam dan menjaga antarmuka tetap berjalan
  };

  window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason?.message || String(event.reason || 'Unhandled Promise Rejection');
    AppState.telemetry.errorsCount++;
    addLog(`[ASYNC ERROR] ${reason}`, 'error');
    setSystemStatus('ai', 'warn', 'Recovered');
    updateTelemetryErrorDisplay();
  });
}

export function updateTelemetryErrorDisplay() {
  const el = document.getElementById('runtimeErrorsEl');
  if (el) {
    el.textContent = String(AppState.telemetry.errorsCount);
    if (AppState.telemetry.errorsCount > 0) {
      el.className = 'telemetry-value text-amber-400 font-bold';
    }
  }
}
