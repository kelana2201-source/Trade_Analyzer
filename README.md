# Institutional Trading Terminal v5.7.0 — Modular Architecture

Proyek ini telah dikembangkan dan direfactor menggunakan standar arsitektur modular (ES6 Modules) agar siap diskalakan dan kompatibel dengan bundler modern (Vite, Webpack, Rollup, esbuild).

## Struktur Modul (`/modules/`)

1. **`state.js` (Pusat State & Konfigurasi)**  
   - Menggantikan variabel global yang terdistribusikan menjadi satu objek terpusat `AppState`.
   - Menyediakan fungsi utilitas bersama: `getSettings()`, `saveSettings()`, `getSymbolConfig()`, `formatPrice()`, `showToast()`, `addLog()`, dan `throttle()`.

2. **`errors.js` (Global Error Handler & Telemetry Integration)**  
   - Mengelola pemantauan pengecualian runtime (`window.onerror`) dan janji asinkron (`unhandledrejection`).
   - Mencegah *crash* antarmuka dan memperbarui metrik `AppState.telemetry.errorsCount`.

3. **`websocket.js` (Institutional WebSocket Client)**  
   - **Heartbeat & Silence Detection**: Memantau keaktifan koneksi live tick setiap 5 detik. Jika tidak ada frame harga selama 25 detik, sistem memutus koneksi basi dan memulai re-connect.
   - **Exponential Backoff dengan Jitter**: Mengatur penundaan koneksi ulang dengan rumus eksponensial dinamis hingga maksimal 60 detik.

4. **`telemetry.js` (Telemetry Dashboard & System Diagnostics)**  
   - **Realtime Dashboard Chips**: Memperbarui indikator `WS Heartbeat`, `Reconnects`, `Runtime Errors`, dan `OHLC Cache`.
   - **System Diagnostics Self-Test (`runSystemDiagnostics()`)**: Melakukan pengujian mandiri 5 modul (LocalStorage, WS Stream, OHLC Cache, Runtime Stability, AI Engine) dan mencetak laporan bergaya terminal.

5. **`analytics.js` (Core Trading Engine & AI Analysis)**  
   - Berisi logika analisis teknikal institusional: `analyzeMarketTrend`, `detectSwingStructure`, `getSMCState`, `getSupplyDemandScore`, `getTrendConfluenceScore`, `detectCandlestickConfirmation`, `getEntryScoreAnalysis`, dan `getSetupValidation`.

6. **`ui.js` (DOM Rendering & Event Listeners)**  
   - Menangani perenderan antarmuka pengguna, navigasi tab, tabel DOM, jurnal, dan mengikat penangan event dari HTML ke global `window`.

## Kompatibilitas HTML Event (`onclick=`, `onchange=`, dll.)
Semua fungsi yang dipanggil melalui atribut HTML di `index.html` diekspos secara eksplisit ke objek global `window` sehingga seluruh tombol dan input berfungsi 100% baik saat di-load langsung maupun setelah dibundle.
