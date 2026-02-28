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

function getDataFreshnessLabel() {
  // Polygon free tier: 15-min delayed during market hours, end-of-day after close
  var now = new Date();
  var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var h = et.getHours(), m = et.getMinutes(), d = et.getDay();
  var isWeekday = d > 0 && d < 6;
  var marketOpen = isWeekday && (h > 9 || (h === 9 && m >= 30)) && h < 16;
  var afterHours = isWeekday && h >= 16;
  var preMarket = isWeekday && (h < 9 || (h === 9 && m < 30));
  var etTime = et.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',hour12:true});

  if(marketOpen) {
    return 'Data via Polygon · 15-min delay · as of ~' + etTime + ' ET';
  } else if(afterHours) {
    return 'Data via Polygon · Close prices (4:00 PM ET)';
  } else if(preMarket) {
    return 'Data via Polygon · Prior close (4:00 PM ET)';
  } else {
    // Weekend
    return 'Data via Polygon · Last trading day close';
  }
}

