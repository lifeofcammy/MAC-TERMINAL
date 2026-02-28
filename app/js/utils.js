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


  const mktOpen = isMarketOpen();
  let color, bg, label;
  if (source.includes('Polygon')) {
    // Polygon Stocks Starter plan = 15-min delayed stocks & options
    if (mktOpen) { color = 'var(--amber)'; bg = 'var(--amber-bg)'; label = '⏱ 15-MIN DELAYED'; }
    else { color = 'var(--text-muted)'; bg = 'rgba(100,116,139,0.1)'; label = '○ MKT CLOSED'; }
  } else if (source.includes('Alpha')) {
    color = 'var(--green)'; bg = 'var(--green-bg)'; label = '● LIVE';
  } else {
    // Claude AI / web search — always live on demand
    color = 'var(--green)'; bg = 'var(--green-bg)'; label = '● LIVE';
  }
  return `<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:${bg};color:${color};letter-spacing:.05em;margin-left:6px;">${label}</span>
          <span style="font-size:9px;color:var(--text-muted);margin-left:4px;">via ${source}</span>`;
}

function tsLabel(timestamp) {
  return `<span style="font-size:9px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;">${timestamp}</span>`;
}

function isMarketOpen() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = et.getHours(), m = et.getMinutes(), d = et.getDay();
  return d > 0 && d < 6 && (h > 9 || (h === 9 && m >= 30)) && h < 16;
}

