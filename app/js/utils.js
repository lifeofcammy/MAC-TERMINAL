// ==================== utils.js ====================
// Utility functions: formatting helpers, timestamps, market hours check,
// scan abort system, tsLabel.

// ==================== UTILITIES ====================
function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET';
}

function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
function price(v) { return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function tsLabel(timestamp) {
  return `<span style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);">${timestamp}</span>`;
}

function isMarketOpen() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = et.getHours(), m = et.getMinutes(), d = et.getDay();
  return d > 0 && d < 6 && (h > 9 || (h === 9 && m >= 30)) && h < 16;
}

function getDataFreshnessLabel() {
  var now = new Date();
  var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var h = et.getHours(), m = et.getMinutes(), d = et.getDay();
  var isWeekday = d > 0 && d < 6;
  var marketOpen = isWeekday && (h > 9 || (h === 9 && m >= 30)) && h < 16;
  var afterHours = isWeekday && h >= 16;
  var preMarket = isWeekday && (h < 9 || (h === 9 && m < 30));
  var etTime = et.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',hour12:true});

  if(marketOpen) {
    return 'Real-time · as of ~' + etTime + ' ET';
  } else if(afterHours) {
    return 'Close prices (4:00 PM ET)';
  } else if(preMarket) {
    return 'Prior close (4:00 PM ET)';
  } else {
    return 'Last trading day close';
  }
}

// ==================== HTML ESCAPING ====================
// Escape all 5 dangerous characters for safe innerHTML injection.
// Use this for any user-provided or API-returned text inserted via innerHTML.
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

