// ==================== account.js ====================
// Source badge helper (used by segments.js).

function srcBadge(source, isLive, delay) {
  const mktOpen = isMarketOpen();
  let color, bg, label;
  if (source.includes('Polygon')) {
    if (mktOpen) { color = 'var(--amber)'; bg = 'var(--amber-bg)'; label = '⏱ 15-MIN DELAYED'; }
    else { color = 'var(--text-muted)'; bg = 'rgba(100,116,139,0.1)'; label = '○ MKT CLOSED'; }
  } else if (source.includes('Alpha')) {
    color = 'var(--green)'; bg = 'var(--green-bg)'; label = '● LIVE';
  } else {
    color = 'var(--green)'; bg = 'var(--green-bg)'; label = '● LIVE';
  }
  return '<span style="font-size:12px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + bg + ';color:' + color + ';letter-spacing:.05em;margin-left:6px;">' + label + '</span>' +
         '<span style="font-size:12px;color:var(--text-muted);margin-left:4px;">via ' + source + '</span>';
}
