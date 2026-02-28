// ==================== utils.js ====================
// Utility functions: formatting helpers, timestamps, market hours check,
// scan abort system, srcBadge, tsLabel.

// ==================== UTILITIES ====================
// ── SCAN ABORT SYSTEM ──
// Each scanner gets a cancellation token. Switching tabs or re-scanning aborts the prior run.
var _scanAbort = {
  compression: null,  // Compression Scans tab
  vcp: null,          // VCP / Flag Scanner tab
  shakeout: null,     // Shakeout Reclaim tab
  options: null       // Option Selling tab
};

function cancelScan(key) {
  if (_scanAbort[key]) { _scanAbort[key].cancelled = true; }
  _scanAbort[key] = { cancelled: false };
  return _scanAbort[key];
}

function isCancelled(token) {
  return token && token.cancelled;
}

function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET';
}

function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
function price(v) { return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function tsLabel(timestamp) {
  return `<span style="font-size:9px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;">${timestamp}</span>`;
}

function isMarketOpen() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = et.getHours(), m = et.getMinutes(), d = et.getDay();
  return d > 0 && d < 6 && (h > 9 || (h === 9 && m >= 30)) && h < 16;
}

