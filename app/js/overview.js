// ==================== overview.js ====================
// Overview: Morning command center
// Layout (top to bottom):
// 1. Morning Mindset (collapsible, Today's Focus always visible)
// 2. Market Regime (auto with 10/20 SMA logic)
// 3. Market Snapshot (SPY/QQQ/IWM/DIA/VIX/DXY in one tight row)
// 4. Stock Breadth (Advancers/Decliners) — auto-refreshes every 15 min
// 5. Sector Heatmap (collapsible, color-coded)
// 6. Today's Catalysts + Themes (combined: econ calendar, headlines, themes)
// 7. Top Ideas (auto from scanners)
// 8. Watchlist (manual ticker entry)

// ==================== BREADTH AUTO-REFRESH ENGINE ====================
// Stores 15-min breadth readings — persisted to sessionStorage so page refreshes don't lose data
var _breadthHistory = [];
var _breadthInterval = null;
var _breadthLastUpdate = null;

// Global regime label for position sizing (read by chart.js)
window._currentRegime = 'Neutral';

// Restore breadth history from localStorage (persists across tab closes)
(function restoreBreadthHistory() {
  try {
    var key = 'mac_breadth_history_' + new Date().toISOString().split('T')[0];
    var raw = localStorage.getItem(key);
    // Also try sessionStorage for migration
    if (!raw) raw = sessionStorage.getItem(key);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.length > 0) {
        _breadthHistory = parsed.map(function(r) {
          r.time = new Date(r.time);
          return r;
        });
        _breadthLastUpdate = _breadthHistory[_breadthHistory.length - 1].time;
      }
    }
    // Clean up old days from localStorage
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('mac_breadth_history_') === 0 && k !== key) {
        localStorage.removeItem(k);
      }
    }
  } catch(e) {}
})();

function saveBreadthHistory() {
  try {
    var key = 'mac_breadth_history_' + new Date().toISOString().split('T')[0];
    localStorage.setItem(key, JSON.stringify(_breadthHistory));
  } catch(e) {}
}

// Fetch breadth data only (lightweight — just the snapshot)
async function fetchBreadthData() {
  var up=0, down=0, flat=0;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var allSnap = await polyGet('/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false');
      (allSnap.tickers || []).forEach(function(s) {
        if(!s || !s.prevDay || !s.prevDay.c) return;
        var p = s.day&&s.day.c&&s.day.c>0 ? s.day.c : s.prevDay.c;
        var prev = s.prevDay.c;
        if(!p || !prev || prev < 1 || (s.day&&s.day.v&&s.day.v < 10000)) return;
        var adPct = ((p-prev)/prev)*100;
        if(adPct > 0.01) up++;
        else if(adPct < -0.01) down++;
        else flat++;
      });
      break;
    } catch(e) {
      console.warn('Breadth refresh attempt ' + (attempt+1) + ' failed:', e);
      if (attempt === 0) await new Promise(function(r) { setTimeout(r, 2000); });
      else return null;
    }
  }
  var total = up + down + flat;
  if(total === 0) return null;
  return { up: up, down: down, flat: flat, total: total, pct: Math.round((up/total)*100) };
}

// Record a breadth reading into history
function recordBreadthReading(data) {
  if(!data) return;
  var now = new Date();
  // Skip if last reading was less than 2 minutes ago (avoid duplicates from concurrent calls)
  if (_breadthHistory.length > 0) {
    var lastTime = _breadthHistory[_breadthHistory.length - 1].time;
    if (now - lastTime < 2 * 60 * 1000) return;
  }
  _breadthHistory.push({
    time: now,
    pct: data.pct,
    up: data.up,
    down: data.down,
    flat: data.flat
  });
  _breadthLastUpdate = now;
  // Keep only last 20 readings (~5 hours)
  if(_breadthHistory.length > 20) _breadthHistory.shift();
  saveBreadthHistory();
}

// Render just the breadth card body (partial refresh — no full page reload)
function renderBreadthBody(data) {
  var el = document.getElementById('breadth-body');
  if(!el || !data) return;
  var pct = data.pct;
  var color = pct>=65?'var(--green)':pct>=40?'var(--amber)':'var(--red)';
  var greenW = (data.up/data.total)*100;
  var redW = (data.down/data.total)*100;
  var flatW = 100-greenW-redW;

  var html = '';
  html += '<div style="display:flex;justify-content:center;font-size:11px;color:var(--text-muted);margin-bottom:4px;">'+data.up.toLocaleString()+' advancing \xb7 '+data.down.toLocaleString()+' declining'+(data.flat>0?' \xb7 '+data.flat.toLocaleString()+' flat':'')+'</div>';
  // Footer: breadth % + last updated
  var updateLabel = _breadthLastUpdate ? _breadthLastUpdate.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'}) + ' ET' : getDataFreshnessLabel();
  html += '<div class="ov-breadth-footer" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:12px;color:var(--text-muted);">';
  html += '<span>Breadth: <span style="color:'+color+';font-weight:700;">'+pct+'%</span></span>';
  html += '<span style="font-size:11px;" id="breadth-updated-label">Updated '+updateLabel+'</span>';
  html += '</div>';
  // History timeline (if we have 2+ readings)
  html += renderBreadthTimeline();
  el.innerHTML = html;
  // Pulse animation on the updated label
  var lbl = document.getElementById('breadth-updated-label');
  if(lbl) { lbl.style.color='var(--blue)'; setTimeout(function(){ if(lbl) lbl.style.color='var(--text-muted)'; }, 1500); }
}

// Render the breadth trend chart — SVG line chart showing breadth % over the day
function renderBreadthTimeline() {
  if(_breadthHistory.length < 2) return '';
  var trendCollapsed = localStorage.getItem('mac_breadth_trend_collapsed') === 'true';
  var html = '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">';

  // Summary line: net direction — arrow at far left matching card header pattern
  var first = _breadthHistory[0].pct;
  var last = _breadthHistory[_breadthHistory.length-1].pct;
  var delta = last - first;
  var dirLabel = delta > 0 ? 'Expanding' : delta < 0 ? 'Contracting' : 'Flat';
  var dirColor = delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--text-muted)';
  var dirArrow = delta > 0 ? '\u25b2' : delta < 0 ? '\u25bc' : '\u25cf';

  html += '<div onclick="toggleBreadthTrend()" style="display:flex;align-items:center;cursor:pointer;user-select:none;gap:12px;margin:0 -20px;padding:6px 20px;">';
  html += '<span id="breadth-trend-arrow" style="flex-shrink:0;font-size:18px;color:var(--blue);">'+(trendCollapsed?'\u25b6':'\u25bc')+'</span>';
  html += '<span style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;flex:1;">Intraday Trend</span>';
  html += '<span style="font-size:13px;font-weight:800;color:'+dirColor+';flex-shrink:0;">'+dirArrow+' '+dirLabel+' ('+(delta>0?'+':'')+delta+'%)</span>';
  html += '</div>';
  html += '<div id="breadth-trend-body" style="'+(trendCollapsed?'display:none;':'')+'">';

  // SVG line chart — viewBox sized to avoid distortion with xMidYMid meet
  var W = 600; // viewBox width
  var H = 200; // viewBox height (proportional to 180px container)
  var padL = 8, padR = 8, padT = 28, padB = 24; // padding for labels
  var chartW = W - padL - padR;
  var chartH = H - padT - padB;

  // Find range
  var minPct = 100, maxPct = 0;
  _breadthHistory.forEach(function(r){ if(r.pct<minPct)minPct=r.pct; if(r.pct>maxPct)maxPct=r.pct; });
  // Ensure at least 10% range for visual clarity
  if(maxPct - minPct < 10){ var mid = (maxPct+minPct)/2; minPct = Math.max(0, mid-5); maxPct = Math.min(100, mid+5); }
  var range = maxPct - minPct || 1;

  // Build points
  var points = [];
  var n = _breadthHistory.length;
  _breadthHistory.forEach(function(r, i){
    var x = padL + (i / (n-1)) * chartW;
    var y = padT + (1 - (r.pct - minPct) / range) * chartH;
    points.push({x:x, y:y, pct:r.pct, time:r.time});
  });

  // Determine line color based on trend
  var lineColor = delta > 0 ? '#34D399' : delta < 0 ? '#FCA5A5' : '#94A3B8';
  var fillColor = delta > 0 ? 'rgba(52,211,153,0.15)' : delta < 0 ? 'rgba(252,165,165,0.15)' : 'rgba(148,163,184,0.1)';

  // Build SVG path
  var linePath = points.map(function(p,i){return (i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
  // Fill area under curve
  var areaPath = linePath + ' L'+points[points.length-1].x.toFixed(1)+','+(padT+chartH)+' L'+points[0].x.toFixed(1)+','+(padT+chartH)+' Z';

  html += '<div style="position:relative;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-secondary);padding:8px;height:180px;">';
  html += '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:100%;display:block;" preserveAspectRatio="xMidYMid meet">';
  // 50% line (neutral)
  if(minPct <= 50 && maxPct >= 50) {
    var y50 = padT + (1 - (50 - minPct) / range) * chartH;
    html += '<line x1="'+padL+'" y1="'+y50.toFixed(1)+'" x2="'+(padL+chartW)+'" y2="'+y50.toFixed(1)+'" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="8,8" opacity="0.5"/>';
    html += '<text x="'+(padL+6)+'" y="'+(y50-4).toFixed(1)+'" fill="var(--text-muted)" font-size="14" font-family="var(--font-mono)">50%</text>';
  }
  // Area fill
  html += '<path d="'+areaPath+'" fill="'+fillColor+'"/>';
  // Line
  html += '<path d="'+linePath+'" fill="none" stroke="'+lineColor+'" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
  // Data points
  points.forEach(function(p,i){
    var dotColor = i === points.length-1 ? lineColor : 'var(--text-muted)';
    var dotR = i === points.length-1 ? '5' : '4';
    html += '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+dotR+'" fill="'+dotColor+'"/>';
  });
  // Time labels (first and last)
  var timeOpts = {hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'};
  var firstTime = points[0].time.toLocaleTimeString('en-US',timeOpts).replace(' ','');
  var lastTime = points[points.length-1].time.toLocaleTimeString('en-US',timeOpts).replace(' ','');
  html += '<text x="'+padL+'" y="'+(H-2)+'" fill="var(--text-muted)" font-size="14" font-family="var(--font-mono)">'+firstTime+'</text>';
  html += '<text x="'+(padL+chartW)+'" y="'+(H-2)+'" fill="var(--text-muted)" font-size="14" font-family="var(--font-mono)" text-anchor="end">'+lastTime+'</text>';
  // Pct labels (first and last reading values)
  html += '<text x="'+(points[0].x+6).toFixed(1)+'" y="'+(points[0].y-6).toFixed(1)+'" fill="var(--text-muted)" font-size="14" font-family="var(--font-mono)">'+first+'%</text>';
  html += '<text x="'+(points[points.length-1].x-6).toFixed(1)+'" y="'+(points[points.length-1].y-6).toFixed(1)+'" fill="'+lineColor+'" font-size="15" font-weight="700" font-family="var(--font-mono)" text-anchor="end">'+last+'%</text>';
  html += '</svg>';
  html += '</div>';

  // Compact reading strip below chart
  html += '<div style="display:flex;gap:4px;margin-top:6px;overflow-x:auto;padding-bottom:2px;">';
  _breadthHistory.forEach(function(r, i){
    var t = r.time.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'});
    var chg = '';
    if(i > 0) {
      var d = r.pct - _breadthHistory[i-1].pct;
      chg = d > 0 ? ' +'+d : d < 0 ? ' '+d : '';
    }
    var bg = i === _breadthHistory.length-1 ? 'var(--blue-bg)' : 'var(--bg-card)';
    var border = i === _breadthHistory.length-1 ? 'var(--blue)' : 'var(--border)';
    html += '<div style="flex-shrink:0;padding:3px 6px;border-radius:4px;background:'+bg+';border:1px solid '+border+';font-size:10px;font-family:var(--font-mono);white-space:nowrap;">';
    html += '<span style="color:var(--text-muted);">'+t+'</span> ';
    html += '<span style="font-weight:700;color:var(--text-primary);">'+r.pct+'%</span>';
    if(chg) html += '<span style="color:'+(chg.indexOf('+')>=0?'var(--green)':'var(--red)')+';font-weight:700;">'+chg+'</span>';
    html += '</div>';
  });
  html += '</div>';

  html += '</div>'; // close breadth-trend-body
  html += '</div>';
  return html;
}

// ==================== RELATIVE ROTATION GRAPH (RRG) ====================
// Calculates RS-Ratio and RS-Momentum for each asset vs SPY benchmark
function calcRRGData(allAssets, spyBars, barsByTicker) {
  if (!spyBars || spyBars.length < 15) return [];
  var results = [];
  allAssets.forEach(function(asset) {
    var bars = barsByTicker[asset.etf];
    if (!bars || bars.length < 15) return;
    // Align bars to same length
    var len = Math.min(bars.length, spyBars.length);
    var assetBars = bars.slice(bars.length - len);
    var benchBars = spyBars.slice(spyBars.length - len);
    // Calculate raw RS (asset close / SPY close) for each day
    var rawRS = [];
    for (var i = 0; i < len; i++) {
      if (benchBars[i].c > 0) rawRS.push(assetBars[i].c / benchBars[i].c);
      else rawRS.push(0);
    }
    if (rawRS.length < 12) return;
    // Smooth RS with 10-period SMA
    var smoothRS = [];
    for (var i = 0; i < rawRS.length; i++) {
      if (i < 9) { smoothRS.push(null); continue; }
      var sum = 0;
      for (var j = i - 9; j <= i; j++) sum += rawRS[j];
      smoothRS.push(sum / 10);
    }
    // Normalize to 100 (current smoothed RS / first valid smoothed RS * 100)
    var firstValid = null;
    for (var i = 0; i < smoothRS.length; i++) {
      if (smoothRS[i] !== null) { firstValid = smoothRS[i]; break; }
    }
    if (!firstValid) return;
    var normRS = smoothRS.map(function(v) { return v !== null ? (v / firstValid) * 100 : null; });
    // RS-Momentum = 100 * (current normRS / normRS from 1 period ago)
    var trail = []; // last 5 valid data points for trailing path
    for (var i = normRS.length - 5; i < normRS.length; i++) {
      if (i < 1 || normRS[i] === null || normRS[i - 1] === null) continue;
      var mom = (normRS[i] / normRS[i - 1]) * 100;
      trail.push({ ratio: normRS[i], momentum: mom });
    }
    if (trail.length === 0) return;
    var latest = trail[trail.length - 1];
    results.push({
      etf: asset.etf,
      name: asset.name,
      short: asset.short || asset.name,
      ratio: latest.ratio,
      momentum: latest.momentum,
      trail: trail,
      isAssetClass: asset.isAsset || false
    });
  });
  return results;
}

// Render RRG as a canvas with 4 colored quadrants and trailing paths
function renderRRGCanvas(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || !window._rrgData || window._rrgData.length === 0) return;
  var data = window._rrgData;
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.parentElement.offsetWidth || 600;
  var h = Math.max(400, Math.round(w * 0.55));
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Colors based on theme
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var bgColor = isDark ? '#1a1a2e' : '#fafbfc';
  var gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  var axisColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
  var textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
  var labelBg = isDark ? 'rgba(26,26,46,0.85)' : 'rgba(250,251,252,0.85)';

  // Quadrant colors
  var qGreen = isDark ? 'rgba(52,211,153,0.10)' : 'rgba(52,211,153,0.12)';
  var qYellow = isDark ? 'rgba(245,158,11,0.10)' : 'rgba(245,158,11,0.12)';
  var qRed = isDark ? 'rgba(252,165,165,0.10)' : 'rgba(252,165,165,0.12)';
  var qBlue = isDark ? 'rgba(37,99,235,0.10)' : 'rgba(37,99,235,0.12)';

  // Padding for labels
  var pad = { top: 20, right: 20, bottom: 30, left: 40 };
  var plotW = w - pad.left - pad.right;
  var plotH = h - pad.top - pad.bottom;

  // Determine data range (center on 100,100)
  var minR = 100, maxR = 100, minM = 100, maxM = 100;
  data.forEach(function(d) {
    d.trail.forEach(function(t) {
      if (t.ratio < minR) minR = t.ratio;
      if (t.ratio > maxR) maxR = t.ratio;
      if (t.momentum < minM) minM = t.momentum;
      if (t.momentum > maxM) maxM = t.momentum;
    });
  });
  // Symmetric range around 100
  var rangeR = Math.max(maxR - 100, 100 - minR, 1.5) * 1.3;
  var rangeM = Math.max(maxM - 100, 100 - minM, 0.8) * 1.3;
  minR = 100 - rangeR; maxR = 100 + rangeR;
  minM = 100 - rangeM; maxM = 100 + rangeM;

  function xPos(ratio) { return pad.left + ((ratio - minR) / (maxR - minR)) * plotW; }
  function yPos(mom) { return pad.top + plotH - ((mom - minM) / (maxM - minM)) * plotH; }

  // Clear
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  // Draw 4 quadrant backgrounds
  var cx = xPos(100), cy = yPos(100);
  // Leading (top-right): green
  ctx.fillStyle = qGreen;
  ctx.fillRect(cx, pad.top, pad.left + plotW - cx, cy - pad.top);
  // Weakening (bottom-right): yellow
  ctx.fillStyle = qYellow;
  ctx.fillRect(cx, cy, pad.left + plotW - cx, pad.top + plotH - cy);
  // Lagging (bottom-left): red
  ctx.fillStyle = qRed;
  ctx.fillRect(pad.left, cy, cx - pad.left, pad.top + plotH - cy);
  // Improving (top-left): blue
  ctx.fillStyle = qBlue;
  ctx.fillRect(pad.left, pad.top, cx - pad.left, cy - pad.top);

  // Draw grid lines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (var i = 0; i <= 4; i++) {
    var gx = pad.left + (plotW / 4) * i;
    ctx.beginPath(); ctx.moveTo(gx, pad.top); ctx.lineTo(gx, pad.top + plotH); ctx.stroke();
    var gy = pad.top + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }

  // Draw center axes (100, 100)
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(cx, pad.top); ctx.lineTo(cx, pad.top + plotH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad.left, cy); ctx.lineTo(pad.left + plotW, cy); ctx.stroke();
  ctx.setLineDash([]);

  // Quadrant labels on canvas
  ctx.font = '700 12px Inter, sans-serif';
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = isDark ? 'rgba(52,211,153,1)' : 'rgba(16,185,129,1)';
  ctx.textAlign = 'right';
  ctx.fillText('Leading', pad.left + plotW - 4, pad.top + 14);
  ctx.fillStyle = isDark ? 'rgba(245,158,11,1)' : 'rgba(217,119,6,1)';
  ctx.fillText('Weakening', pad.left + plotW - 4, pad.top + plotH - 4);
  ctx.fillStyle = isDark ? 'rgba(252,165,165,1)' : 'rgba(239,68,68,1)';
  ctx.textAlign = 'left';
  ctx.fillText('Lagging', pad.left + 4, pad.top + plotH - 4);
  ctx.fillStyle = isDark ? 'rgba(96,165,250,1)' : 'rgba(37,99,235,1)';
  ctx.fillText('Improving', pad.left + 4, pad.top + 14);
  ctx.globalAlpha = 1;

  // Axis labels
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.fillText('RS-Ratio \u2192', w / 2, h - 4);
  ctx.save();
  ctx.translate(10, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('RS-Momentum \u2192', 0, 0);
  ctx.restore();

  // Dot colors for sectors vs asset classes
  var sectorColor = isDark ? '#60a5fa' : '#2563eb';
  var assetColor = isDark ? '#f59e0b' : '#d97706';

  // Draw trailing paths + arrow pointers for each asset
  var placedLabels = []; // For collision avoidance
  data.forEach(function(d) {
    var color = d.isAssetClass ? assetColor : sectorColor;
    // Trail line
    if (d.trail.length > 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      for (var i = 0; i < d.trail.length; i++) {
        var px = xPos(d.trail[i].ratio), py = yPos(d.trail[i].momentum);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Small dots for trail points (not the latest)
      for (var i = 0; i < d.trail.length - 1; i++) {
        var px = xPos(d.trail[i].ratio), py = yPos(d.trail[i].momentum);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.15 + (i / d.trail.length) * 0.35;
        ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Latest point — directional arrow pointer
    var last = d.trail[d.trail.length - 1];
    var lx = xPos(last.ratio), ly = yPos(last.momentum);
    d._canvasXY = { x: lx, y: ly }; // Store for click detection
    // Calculate direction angle from previous point
    var angle = 0;
    if (d.trail.length >= 2) {
      var prev = d.trail[d.trail.length - 2];
      var dx = xPos(last.ratio) - xPos(prev.ratio);
      var dy = yPos(last.momentum) - yPos(prev.momentum);
      angle = Math.atan2(dy, dx);
    }
    // Draw arrow pointer (triangle pointing in direction of movement)
    var arrowLen = 14, arrowW = 7;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(arrowLen, 0); // tip
    ctx.lineTo(-arrowLen * 0.5, -arrowW);
    ctx.lineTo(-arrowLen * 0.2, 0);
    ctx.lineTo(-arrowLen * 0.5, arrowW);
    ctx.closePath();
    ctx.fill();
    // Outline
    ctx.strokeStyle = isDark ? '#1a1a2e' : '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    // Clickable circle at arrow tip
    var tipX = lx + Math.cos(angle) * arrowLen;
    var tipY = ly + Math.sin(angle) * arrowLen;
    d._tipXY = { x: tipX, y: tipY };
    ctx.beginPath();
    ctx.arc(tipX, tipY, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = isDark ? '#1a1a2e' : '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  // Draw ETF labels next to each dot
  ctx.font = '700 12px Inter, sans-serif';
  ctx.textAlign = 'left';
  data.forEach(function(d) {
    if (!d._canvasXY) return;
    var lx = d._canvasXY.x, ly = d._canvasXY.y;
    var color = d.isAssetClass ? assetColor : sectorColor;
    var textW = ctx.measureText(d.etf).width;
    ctx.fillStyle = labelBg;
    ctx.fillRect(lx + 16, ly - 9, textW + 6, 15);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fillText(d.etf, lx + 19, ly + 3);
    ctx.globalAlpha = 1;
  });
}

// ==================== REGIME + BREADTH COMBINED REFRESH ====================
// Refreshes both cards in one pass — shares index snapshot data
async function refreshRegimeAndBreadth() {
  console.log('[Auto-Refresh] Updating regime + breadth...');
  try {
    // 1. Fetch all data in parallel — snapshots, bars, sectors, breadth
    var refreshResults = await Promise.all([
      getSnapshots(['SPY','QQQ','IWM','DIA','VIXY','UUP']),
      getDailyBars('SPY', 30).catch(function(){return [];}),
      getDailyBars('QQQ', 30).catch(function(){return [];}),
      getDailyBars('IWM', 30).catch(function(){return [];}),
      getDailyBars('DIA', 30).catch(function(){return [];}),
      getSnapshots(['XLK','SMH','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP']),
      fetchBreadthData()
    ]);
    var snap = refreshResults[0];
    var spyBars = refreshResults[1], qqqBars = refreshResults[2], iwmBars = refreshResults[3], diaBars = refreshResults[4];
    var sectorSnap = refreshResults[5];
    var breadthDataResult = refreshResults[6];

    function livePrice(ticker) {
      var s = snap[ticker];
      if(!s) return { price:0, pct:0 };
      var p = s.day&&s.day.c&&s.day.c>0 ? s.day.c : (s.prevDay&&s.prevDay.c ? s.prevDay.c : (s.lastTrade?s.lastTrade.p:0));
      var prev = s.prevDay ? s.prevDay.c : p;
      return { price: p, pct: prev>0 ? ((p-prev)/prev)*100 : 0 };
    }
    var spyLive=livePrice('SPY'), qqqLive=livePrice('QQQ'), iwmLive=livePrice('IWM'), diaLive=livePrice('DIA'), vixyLive=livePrice('VIXY');

    function calcSMA(bars, period) {
      if(!bars||bars.length<period) return null;
      var cl=bars.map(function(b){return b.c;}); var ln=cl.length;
      var sum=0; for(var i=ln-period;i<ln;i++) sum+=cl[i]; return sum/period;
    }

    // 3. Calculate SMA positions
    var indexes = [
      {name:'SPY', price:spyLive.price, pct:spyLive.pct, s10:calcSMA(spyBars,10), s20:calcSMA(spyBars,20)},
      {name:'QQQ', price:qqqLive.price, pct:qqqLive.pct, s10:calcSMA(qqqBars,10), s20:calcSMA(qqqBars,20)},
      {name:'IWM', price:iwmLive.price, pct:iwmLive.pct, s10:calcSMA(iwmBars,10), s20:calcSMA(iwmBars,20)},
      {name:'DIA', price:diaLive.price, pct:diaLive.pct, s10:calcSMA(diaBars,10), s20:calcSMA(diaBars,20)}
    ];
    indexes.forEach(function(idx) {
      idx.a10 = idx.s10!==null && idx.price>idx.s10;
      idx.a20 = idx.s20!==null && idx.price>idx.s20;
    });

    var idxAboveBoth=0, idxBelowBoth=0, idxMixed=0;
    indexes.forEach(function(idx) {
      if(idx.s10===null) return;
      if(idx.a10&&idx.a20) idxAboveBoth++;
      else if(!idx.a10&&!idx.a20) idxBelowBoth++;
      else idxMixed++;
    });

    var avgPct = (spyLive.pct+qqqLive.pct+iwmLive.pct+diaLive.pct)/4;

    // 4. Sector breadth (sectorSnap already fetched in parallel above)
    var sectorETFs = ['XLK','SMH','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP'];
    var sectorsUp=0, sectorsDown=0;
    sectorETFs.forEach(function(etf) {
      var s = sectorSnap[etf]; if(!s) return;
      var p = s.day&&s.day.c&&s.day.c>0 ? s.day.c : (s.prevDay&&s.prevDay.c||0);
      var prev = s.prevDay ? s.prevDay.c : p;
      var chg = prev>0 ? ((p-prev)/prev)*100 : 0;
      if(chg>0) sectorsUp++; else if(chg<0) sectorsDown++;
    });
    var breadthPct = Math.round((sectorsUp/sectorETFs.length)*100);

    // 5. VIX context
    var vixPct = vixyLive.pct;
    var vixNote = '';
    if(Math.abs(vixPct)>5) vixNote='VIX '+(vixPct>0?'spiking +':'dropping ')+Math.abs(vixPct).toFixed(1)+'% \u2014 '+(vixPct>0?'fear elevated.':'fear fading.');
    else if(Math.abs(vixPct)>2) vixNote='VIX '+(vixPct>0?'rising +':'easing ')+Math.abs(vixPct).toFixed(1)+'%.';
    else vixNote='VIX stable.';

    // 6. Index notes
    var indexNotes = indexes.map(function(idx) {
      var smaStatus = idx.a10&&idx.a20 ? 'above both SMAs' : (!idx.a10&&!idx.a20 ? 'below both SMAs' : 'between SMAs');
      return idx.name+' '+(idx.pct>=0?'+':'')+idx.pct.toFixed(1)+'% ('+smaStatus+')';
    }).join(' \xb7 ');

    // 7. Econ event check
    var hasHighImpactEvent=false, eventName='';
    try {
      var td=new Date();var dw=td.getDay();var mon=new Date(td);mon.setDate(td.getDate()-(dw===0?6:dw-1));
      var calKey='mac_econ_cal_auto_'+mon.toISOString().split('T')[0];
      var calData=localStorage.getItem(calKey);
      if(calData){
        var parsed=JSON.parse(calData);
        var todayStr=td.toISOString().split('T')[0];
        var todayEvents=(parsed.events&&parsed.events[todayStr])||[];
        var allTitles=todayEvents.map(function(ev){return (ev.title||'').toLowerCase();}).join(' ');
        if(/cpi|fomc|fed fund|interest rate|nonfarm|payroll|gdp|pce/.test(allTitles)){
          hasHighImpactEvent=true;
          if(/cpi/.test(allTitles))eventName='CPI';
          else if(/fomc|fed fund|interest rate/.test(allTitles))eventName='FOMC/Fed';
          else if(/nonfarm|payroll/.test(allTitles))eventName='NFP';
          else if(/gdp/.test(allTitles))eventName='GDP';
          else if(/pce/.test(allTitles))eventName='PCE';
          else eventName='major data';
        }
      }
    } catch(e){}

    // 8. Regime decision
    var regimeLabel='Chop', regimeColor='var(--amber)', regimeDetail='', regimeAction='';
    if(hasHighImpactEvent&&!isMarketOpen()){
      regimeLabel='Wait for '+eventName; regimeColor='var(--purple)';
      regimeAction='Sit on hands. Wait for data reaction before entering.';
      regimeDetail=eventName+' data expected \u2014 wait for the reaction before entering.';
    }
    else if(avgPct>0.8&&breadthPct>=65&&idxAboveBoth>=3){
      regimeLabel='Bullish'; regimeColor='var(--green)';
      regimeAction='Full size. Breakouts and momentum plays. Be aggressive on A+ setups.';
      regimeDetail=idxAboveBoth+'/4 indexes above 10 & 20 SMA. '+sectorsUp+'/'+sectorETFs.length+' sectors green. '+vixNote+'\n'+indexNotes;
    }
    else if(avgPct<-0.8&&breadthPct<=35&&idxBelowBoth>=3){
      regimeLabel='Bearish'; regimeColor='var(--red)';
      regimeAction='Reduce size or sit out. Cash is a position. Only short setups or hedges.';
      regimeDetail=idxBelowBoth+'/4 indexes below 10 & 20 SMA. '+sectorsDown+'/'+sectorETFs.length+' sectors red. '+vixNote+'\n'+indexNotes;
    }
    else if(Math.abs(avgPct)<0.3&&idxMixed>=2){
      regimeLabel='Chop'; regimeColor='var(--amber)';
      regimeAction='Sit on hands. No clean direction. Wait for a trend to develop.';
      regimeDetail='Narrow range, mixed signals. '+idxAboveBoth+'/4 above both SMAs, '+idxBelowBoth+'/4 below both, '+idxMixed+'/4 mixed. '+vixNote+'\n'+indexNotes;
    }
    else if(avgPct>0.3||idxAboveBoth>=3){
      regimeLabel='Slightly Bullish'; regimeColor='var(--green)';
      regimeAction='Selective longs only. Half size. Stick to your best setups.';
      regimeDetail=idxAboveBoth+'/4 indexes above both SMAs. '+sectorsUp+'/'+sectorETFs.length+' sectors positive. '+vixNote+'\n'+indexNotes;
    }
    else if(avgPct<-0.3||idxBelowBoth>=3){
      regimeLabel='Slightly Bearish'; regimeColor='var(--red)';
      regimeAction='Reduce size. Be cautious. Take profits quickly on any longs.';
      regimeDetail=idxBelowBoth+'/4 indexes below both SMAs. '+sectorsDown+'/'+sectorETFs.length+' sectors negative. '+vixNote+'\n'+indexNotes;
    }
    else{
      regimeLabel='Chop'; regimeColor='var(--amber)';
      regimeAction='Sit on hands. Mixed signals. A+ setups only, small size.';
      regimeDetail='Mixed signals across indexes. '+idxAboveBoth+' above both SMAs, '+idxBelowBoth+' below both. '+vixNote+'\n'+indexNotes;
    }
    if(hasHighImpactEvent&&isMarketOpen()) regimeAction+=' \u26a0 '+eventName+' today \u2014 expect volatility.';
    window._currentRegime = regimeLabel;
    window._indexData = indexes;

    // 9. Render regime body
    var regimeBody = document.getElementById('regime-body');
    if(regimeBody) {
      var rHtml = '';
      rHtml += '<div style="text-align:center;margin-bottom:10px;">';
      rHtml += '<div style="font-family:var(--font-display);font-size:28px;font-weight:700;color:'+regimeColor+';letter-spacing:0.02em;">'+regimeLabel+'</div>';
      rHtml += '<div style="font-size:14px;font-weight:600;color:var(--text-secondary);margin-top:4px;">'+regimeAction+'</div>';
      rHtml += '</div>';
      rHtml += '<div style="font-size:14px;color:var(--text-muted);line-height:1.4;">'+regimeDetail.replace(/\n/g,'<br>')+'</div>';
      // SMA badges
      rHtml += '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">';
      indexes.forEach(function(idx) {
        if(idx.s10===null) return;
        var both = idx.a10 && idx.a20;
        var neither = !idx.a10 && !idx.a20;
        var smaColor = both ? 'var(--green)' : neither ? 'var(--red)' : 'var(--amber)';
        var smaLabel = both ? 'Above Both' : neither ? 'Below Both' : 'Mixed';
        rHtml += '<span style="font-size:12px;font-weight:700;padding:2px 6px;border-radius:3px;background:'+smaColor+'15;color:'+smaColor+';font-family:var(--font-mono);">'+idx.name+' '+smaLabel+'</span>';
      });
      rHtml += '</div>';
      // Updated timestamp
      var regimeTime = new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'});
      rHtml += '<div style="font-size:12px;color:var(--text-muted);margin-top:6px;" id="regime-updated-label">Updated '+regimeTime+' ET</div>';
      rHtml += '</div>';
      regimeBody.innerHTML = rHtml;
      // Pulse
      var rLbl = document.getElementById('regime-updated-label');
      if(rLbl) { rLbl.style.color='var(--blue)'; setTimeout(function(){ if(rLbl) rLbl.style.color='var(--text-muted)'; }, 1500); }
    }

    // 10. Also refresh breadth (already fetched in parallel above)
    if(breadthDataResult) {
      recordBreadthReading(breadthDataResult);
      renderBreadthBody(breadthDataResult);
    }

    // 11. Update the Market Snapshot card prices too
    var snapBody = document.getElementById('snapshot-body');
    if(snapBody) {
      var snapItems = [
        {ticker:'SPY',label:'S&P 500',data:spyLive},
        {ticker:'QQQ',label:'Nasdaq',data:qqqLive},
        {ticker:'IWM',label:'Russell',data:iwmLive},
        {ticker:'DIA',label:'Dow',data:diaLive},
        {ticker:'VIXY',label:'VIX Proxy',data:vixyLive},
        {ticker:'UUP',label:'Dollar (DXY)',data:livePrice('UUP')}
      ];
      var sHtml = '<div class="ov-snap-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;">';
      snapItems.forEach(function(idx) {
        var d=idx.data; var color=d.pct>=0?'var(--green)':'var(--red)';
        var bg=d.pct>=0?'rgba(16,185,129,0.04)':'rgba(239,68,68,0.04)';
        var borderC=d.pct>=0?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)';
        if(idx.ticker==='VIXY'){color=d.pct<=0?'var(--green)':'var(--red)';bg=d.pct<=0?'rgba(16,185,129,0.04)':'rgba(239,68,68,0.04)';borderC=d.pct<=0?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)';}
        sHtml += '<div style="background:'+bg+';border:1px solid '+borderC+';border-radius:12px;padding:12px 14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);">';
        sHtml += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">'+idx.label+'</div>';
        sHtml += '<div style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:var(--text-primary);">'+(d.price?'$'+price(d.price):'\u2014')+'</div>';
        sHtml += '<div style="font-size:14px;font-weight:700;color:'+color+';margin-top:2px;">'+pct(d.pct)+'</div>';
        sHtml += '</div>';
      });
      sHtml += '</div>';
      snapBody.innerHTML = sHtml;
    }

    console.log('[Auto-Refresh] Done. Regime: '+regimeLabel);
  } catch(e) {
    console.warn('[Auto-Refresh] Failed:', e);
  }
}

// Auto-refresh regime + breadth + snapshot every 15 minutes during market hours
function startBreadthAutoRefresh() {
  if(_breadthInterval) clearInterval(_breadthInterval);
  // Catch-up logic: if last reading is >14 min old, do an immediate refresh
  // This handles the case where the user refreshes the page — the interval resets,
  // but we check elapsed time and fire immediately if enough time has passed.
  if (_breadthHistory.length > 0) {
    var elapsed = Date.now() - _breadthHistory[_breadthHistory.length - 1].time.getTime();
    if (elapsed >= 14 * 60 * 1000) {
      console.log('[Auto-Refresh] Catch-up: last reading is ' + Math.round(elapsed/60000) + ' min old, refreshing now.');
      refreshRegimeAndBreadth();
    }
  }
  // If we only have 0-1 readings, do a fast first refresh after 3 minutes
  // so the direction bars show up quickly without waiting a full 15 min.
  if (_breadthHistory.length < 2) {
    var firstRefreshMs = 3 * 60 * 1000; // 3 minutes
    console.log('[Auto-Refresh] Fast first refresh in 3 min to build direction bars.');
    setTimeout(function() {
      if(!isMarketOpen()) return;
      refreshRegimeAndBreadth();
    }, firstRefreshMs);
  }
  _breadthInterval = setInterval(function() {
    if(!isMarketOpen()) return;
    refreshRegimeAndBreadth();
  }, 15 * 60 * 1000); // 15 minutes
}

// Stop auto-refresh (call when navigating away from overview)
function stopBreadthAutoRefresh() {
  if(_breadthInterval) { clearInterval(_breadthInterval); _breadthInterval = null; }
}

// ==================== RENDER: OVERVIEW ====================
async function renderOverview() {
  var container = document.getElementById('overview-main') || document.getElementById('tab-overview');
  if (!container) return;
  var ts = getTimestamp();
  var live = isMarketOpen();

  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:14px;">Loading Overview...</div>';

  // ── TICKERS TO FETCH ──
  var indexTickers = ['SPY','QQQ','IWM','DIA'];
  var extraTickers = ['VIXY','UUP']; // VIX proxy via VIXY ETF, DXY proxy via UUP
  var sectorETFs = [
    {etf:'XLK',name:'Technology',short:'Tech'},{etf:'SMH',name:'Semiconductors',short:'Semis'},
    {etf:'XLF',name:'Financials',short:'Finance'},{etf:'XLE',name:'Energy',short:'Energy'},
    {etf:'XLV',name:'Healthcare',short:'Health'},{etf:'XLY',name:'Consumer Disc.',short:'Consumer'},
    {etf:'XLI',name:'Industrials',short:'Industrial'},{etf:'XLRE',name:'Real Estate',short:'Real Est'},
    {etf:'XLU',name:'Utilities',short:'Utilities'},{etf:'XLB',name:'Materials',short:'Materials'},
    {etf:'XLC',name:'Comm. Services',short:'Comms'},{etf:'XLP',name:'Consumer Staples',short:'Staples'}
  ];

  // Subsector ETFs for each sector (click-to-expand)
  var subsectorMap = {
    'XLK': [{etf:'IGV',name:'Software'},{etf:'SKYY',name:'Cloud'},{etf:'HACK',name:'Cybersecurity'},{etf:'BOTZ',name:'AI & Robotics'}],
    'SMH': [{etf:'SOXX',name:'Broad Semis'},{etf:'PSI',name:'Semi Equipment'},{etf:'SOXQ',name:'Semiconductor'}],
    'XLF': [{etf:'KBE',name:'Banks'},{etf:'KIE',name:'Insurance'},{etf:'KRE',name:'Regional Banks'},{etf:'IAI',name:'Brokers'}],
    'XLE': [{etf:'XOP',name:'Oil & Gas E&P'},{etf:'OIH',name:'Oil Services'},{etf:'AMLP',name:'MLPs/Pipelines'}],
    'XLV': [{etf:'XBI',name:'Biotech'},{etf:'IBB',name:'Broad Biotech'},{etf:'IHI',name:'Med Devices'},{etf:'XHE',name:'Healthcare Equip'}],
    'XLY': [{etf:'XRT',name:'Retail'},{etf:'IBUY',name:'E-Commerce'},{etf:'BETZ',name:'Sports Betting'},{etf:'PEJ',name:'Leisure'}],
    'XLI': [{etf:'ITA',name:'Aerospace & Defense'},{etf:'XAR',name:'Defense'},{etf:'JETS',name:'Airlines'},{etf:'PAVE',name:'Infrastructure'}],
    'XLRE': [{etf:'VNQ',name:'Broad REITs'},{etf:'MORT',name:'Mortgage REITs'},{etf:'HOMZ',name:'Housing'}],
    'XLU': [{etf:'ICLN',name:'Clean Energy'},{etf:'TAN',name:'Solar'},{etf:'URNM',name:'Uranium'}],
    'XLB': [{etf:'GDX',name:'Gold Miners'},{etf:'SLV',name:'Silver'},{etf:'REMX',name:'Rare Earth'},{etf:'LIT',name:'Lithium'}],
    'XLC': [{etf:'SOCL',name:'Social Media'},{etf:'NERD',name:'Gaming/Esports'},{etf:'SUBZ',name:'Streaming'}],
    'XLP': [{etf:'PBJ',name:'Food & Beverage'},{etf:'XLP',name:'Staples Broad'}]
  };

  // Top stocks per sector for Trend Leaders (click-to-expand)
  var sectorStocks = {
    'XLK': ['AAPL','MSFT','CRM','ADBE','NOW','ORCL','INTU','CSCO','ACN','IBM','PLTR','CDNS','SNPS','FTNT','PANW'],
    'SMH': ['NVDA','AMD','AVGO','TSM','ASML','MRVL','ANET','MU','KLAC','LRCX','NXPI','ON','INTC','ARM','SMCI'],
    'XLF': ['JPM','GS','V','MA','BAC','BX','AXP','MS','SCHW','C','BK','PNC','USB','WFC','COF'],
    'XLE': ['XOM','CVX','COP','EOG','SLB','MPC','OXY','PSX','VLO','HAL','DVN','FANG','TRGP','OKE','WMB'],
    'XLV': ['LLY','UNH','JNJ','MRK','ABBV','TMO','ABT','AMGN','ISRG','GILD','VRTX','REGN','SYK','BSX','MDT'],
    'XLY': ['AMZN','TSLA','HD','MCD','NKE','LOW','SBUX','TJX','BKNG','CMG','LULU','ROST','DG','ABNB','DPZ'],
    'XLI': ['CAT','GE','HON','UNP','RTX','BA','DE','LMT','ETN','ITW','GD','CSX','NSC','URI','FDX'],
    'XLRE': ['PLD','AMT','EQIX','CCI','SPG','O','WELL','PSA','DLR','VICI','EQR','AVB','ARE','IRM','ESS'],
    'XLU': ['NEE','SO','DUK','CEG','AEP','D','SRE','EXC','XEL','ED','WEC','PEG','ES','AES','AWK'],
    'XLB': ['LIN','SHW','FCX','APD','NEM','ECL','VMC','MLM','NUE','DOW','DD','ALB','FMC','CF','MOS'],
    'XLC': ['META','GOOGL','NFLX','DIS','CMCSA','T','VZ','TMUS','EA','TTWO','CHTR','OMC','LYV','MTCH','WBD'],
    'XLP': ['PG','KO','PEP','COST','WMT','PM','MO','CL','KMB','GIS','SYY','KDP','KHC','HSY','MKC']
  };

  // Asset classes for RRG (Relative Rotation Graph)
  var rrgAssets = [
    {etf:'IBIT',name:'Bitcoin',short:'Bitcoin'},{etf:'TLT',name:'Bonds (20Y+)',short:'Bonds'},
    {etf:'HYG',name:'High Yield',short:'HiYield'},{etf:'EFA',name:'Intl Developed',short:'Intl Dev'},
    {etf:'EEM',name:'Emerging Mkts',short:'Emerging'},{etf:'GLD',name:'Gold',short:'Gold'}
  ];

  var snap = {}, sectorSnap = {}, sectorBars = {}, spyBars = [];
  var dataFreshness = getDataFreshnessLabel();
  var sectorTickers = sectorETFs.map(function(s){return s.etf;});
  var rrgTickers = rrgAssets.map(function(s){return s.etf;});

  // ── TIER 1: Fire all independent fetches in parallel ──
  try {
    var tier1 = await Promise.all([
      getSnapshots(indexTickers.concat(extraTickers)),
      getDailyBars('SPY', 30).catch(function(e) { return []; }),
      getSnapshots(sectorTickers.concat(rrgTickers)),
      polyGet('/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false').catch(function(e) { return { tickers: [] }; })
    ]);
    snap = tier1[0];
    spyBars = tier1[1];
    sectorSnap = tier1[2]; // Contains both sector + RRG asset snapshots
    var allSnap = tier1[3];
  } catch(e) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--red);padding:30px;">Failed to load data: '+escapeHtml(e.message)+'<br><span style="font-size:14px;color:var(--text-muted);">Check your Polygon API key (gear icon).</span></div>';
    return;
  }

  // ── TIER 2: Sector bars + index bars + RRG asset bars in parallel ──
  var barPromises = sectorTickers.map(function(t) {
    return getDailyBars(t, 30).then(function(bars) { return { ticker: t, bars: bars }; }).catch(function() { return { ticker: t, bars: [] }; });
  });
  // Also fetch QQQ/IWM/DIA bars for SMA calculation + weekend price fix
  ['QQQ','IWM','DIA'].forEach(function(t) {
    barPromises.push(getDailyBars(t, 30).then(function(bars) { return { ticker: t, bars: bars }; }).catch(function() { return { ticker: t, bars: [] }; }));
  });
  // RRG asset bars (30 bars for RS-Ratio smoothing)
  rrgTickers.forEach(function(t) {
    barPromises.push(getDailyBars(t, 30).then(function(bars) { return { ticker: t, bars: bars }; }).catch(function() { return { ticker: t, bars: [] }; }));
  });
  var allBarResults = await Promise.all(barPromises);
  var _barsByTicker = {};
  allBarResults.forEach(function(r) {
    if (sectorTickers.indexOf(r.ticker) >= 0) sectorBars[r.ticker] = r.bars;
    _barsByTicker[r.ticker] = r.bars;
  });

  // ── ADVANCERS / DECLINERS (from tier 1 breadth snapshot) ──
  var adStocksUp=0, adStocksDown=0, adStocksFlat=0;
  (allSnap.tickers || []).forEach(function(s) {
    // Filter: common stocks only, price > $1, volume > 10000
    if(!s || !s.prevDay || !s.prevDay.c) return;
    var p = s.day&&s.day.c&&s.day.c>0 ? s.day.c : s.prevDay.c;
    var prev = s.prevDay.c;
    if(!p || !prev || prev < 1 || (s.day&&s.day.v&&s.day.v < 10000)) return;
    var adPct = ((p-prev)/prev)*100;
    if(adPct > 0.01) adStocksUp++;
    else if(adPct < -0.01) adStocksDown++;
    else adStocksFlat++;
  });
  var adTotal = adStocksUp + adStocksDown + adStocksFlat;
  var adBreadthPct = adTotal>0 ? Math.round((adStocksUp/adTotal)*100) : 0;

  // ── HELPERS ──
  function getSnap(ticker) {
    var s = snap[ticker];
    if (!s) return {price:0,change:0,pct:0,vol:0,prevClose:0,high:0,low:0,vwap:0};
    var p = s.day&&s.day.c&&s.day.c>0 ? s.day.c : (s.prevDay&&s.prevDay.c ? s.prevDay.c : (s.lastTrade?s.lastTrade.p:0));
    var prev = s.prevDay ? s.prevDay.c : p;
    // On weekends/holidays: day.c and prevDay.c may be the same (both = Friday close)
    // Use spyBars (daily bars) for SPY to get proper last-day change if available
    if(!live && ticker==='SPY' && spyBars.length>=2){
      p = spyBars[spyBars.length-1].c;
      prev = spyBars[spyBars.length-2].c;
    }
    var chg = p - prev;
    var pctVal = prev>0 ? (chg/prev)*100 : 0;
    return {price:p, change:chg, pct:pctVal, vol:s.day?s.day.v:0, prevClose:prev, high:s.day?s.day.h:0, low:s.day?s.day.l:0, vwap:s.day?s.day.vw:0};
  }
  var spyData = getSnap('SPY');
  // Use pre-fetched bars for weekend price fix (no extra API calls)
  function fixSnapWithBars(ticker) {
    var base = getSnap(ticker);
    if(!live && base.pct===0 && _barsByTicker[ticker] && _barsByTicker[ticker].length>=2){
      var bars = _barsByTicker[ticker];
      base.price = bars[bars.length-1].c;
      base.prevClose = bars[bars.length-2].c;
      base.change = base.price - base.prevClose;
      base.pct = base.prevClose>0 ? (base.change/base.prevClose)*100 : 0;
    }
    return base;
  }
  var qqqData = fixSnapWithBars('QQQ');
  var iwmData = fixSnapWithBars('IWM');
  var diaData = fixSnapWithBars('DIA');
  var vixyData = getSnap('VIXY');

  // ── INDEX 10 & 20 SMAs (SPY, QQQ, IWM, DIA) ──
  function calcSMA(bars, period) {
    if(!bars||bars.length<period) return null;
    var cl=bars.map(function(b){return b.c;}); var ln=cl.length;
    var sum=0; for(var i=ln-period;i<ln;i++) sum+=cl[i]; return sum/period;
  }
  var spySma10=calcSMA(spyBars,10), spySma20=calcSMA(spyBars,20);
  var spyAbove10 = spySma10!==null && spyData.price>spySma10;
  var spyAbove20 = spySma20!==null && spyData.price>spySma20;
  var spyBelow10 = spySma10!==null && spyData.price<spySma10;
  var spyBelow20 = spySma20!==null && spyData.price<spySma20;

  // Use pre-fetched bars for QQQ, IWM, DIA SMAs (already in _barsByTicker from tier 2)
  var qqqBars = _barsByTicker['QQQ'] || [];
  var iwmBars = _barsByTicker['IWM'] || [];
  var diaBars = _barsByTicker['DIA'] || [];

  var qqqSma10=calcSMA(qqqBars,10),qqqSma20=calcSMA(qqqBars,20);
  var iwmSma10=calcSMA(iwmBars,10),iwmSma20=calcSMA(iwmBars,20);
  var diaSma10=calcSMA(diaBars,10),diaSma20=calcSMA(diaBars,20);

  var qqqAbove10=qqqSma10!==null&&qqqData.price>qqqSma10;
  var qqqAbove20=qqqSma20!==null&&qqqData.price>qqqSma20;
  var iwmAbove10=iwmSma10!==null&&iwmData.price>iwmSma10;
  var iwmAbove20=iwmSma20!==null&&iwmData.price>iwmSma20;
  var diaAbove10=diaSma10!==null&&diaData.price>diaSma10;
  var diaAbove20=diaSma20!==null&&diaData.price>diaSma20;

  // Count how many indexes are above both SMAs vs below both
  var idxAboveBoth=0, idxBelowBoth=0, idxMixed=0;
  var idxSmaDetails=[];
  [{name:'SPY',p:spyData.price,a10:spyAbove10,a20:spyAbove20,s10:spySma10,s20:spySma20},
   {name:'QQQ',p:qqqData.price,a10:qqqAbove10,a20:qqqAbove20,s10:qqqSma10,s20:qqqSma20},
   {name:'IWM',p:iwmData.price,a10:iwmAbove10,a20:iwmAbove20,s10:iwmSma10,s20:iwmSma20},
   {name:'DIA',p:diaData.price,a10:diaAbove10,a20:diaAbove20,s10:diaSma10,s20:diaSma20}].forEach(function(idx){
    if(idx.s10===null)return;
    if(idx.a10&&idx.a20){idxAboveBoth++;idxSmaDetails.push(idx.name+' above both');}
    else if(!idx.a10&&!idx.a20){idxBelowBoth++;idxSmaDetails.push(idx.name+' below both');}
    else{idxMixed++;idxSmaDetails.push(idx.name+' mixed');}
  });

  // VIX context
  var vixPct=vixyData.pct;
  var vixNote='';
  if(Math.abs(vixPct)>5)vixNote='VIX '+(vixPct>0?'spiking +':'dropping ')+Math.abs(vixPct).toFixed(1)+'% — '+(vixPct>0?'fear elevated.':'fear fading.');
  else if(Math.abs(vixPct)>2)vixNote='VIX '+(vixPct>0?'rising +':'easing ')+Math.abs(vixPct).toFixed(1)+'%.';
  else vixNote='VIX stable.';

  // ── SECTOR DATA ──
  var sectorData = sectorETFs.map(function(sec) {
    var s=sectorSnap[sec.etf]; var bars=sectorBars[sec.etf]||[];
    var p=0,prev=0,dayChg=0,weekPerf=0;
    if(s){
      // Use day.c if available (market open), otherwise use prevDay.c (last trading day close)
      p=s.day&&s.day.c&&s.day.c>0 ? s.day.c : (s.prevDay&&s.prevDay.c ? s.prevDay.c : (s.lastTrade?s.lastTrade.p:0));
      // For prev close: if market is open, prevDay.c is yesterday. If closed, use bars for prior day.
      if(live && s.prevDay && s.prevDay.c){
        prev = s.prevDay.c;
      } else if(bars.length>=2){
        // Market closed: compare last bar close to second-to-last bar close
        prev = bars[bars.length-2].c;
        p = bars[bars.length-1].c;
      } else if(s.prevDay && s.prevDay.c){
        prev = s.prevDay.c;
      } else {
        prev = p;
      }
      dayChg = prev>0 ? ((p-prev)/prev)*100 : 0;
    }
    if(bars.length>=5){var w5=bars[bars.length-5].c;var latest=bars[bars.length-1].c;weekPerf=w5>0?((latest-w5)/w5)*100:0;}
    return {etf:sec.etf,name:sec.name,price:p,dayChg:dayChg,weekPerf:weekPerf};
  });
  sectorData.sort(function(a,b){return b.dayChg-a.dayChg;});
  window._sectorData = sectorData;

  // ── BREADTH ──
  var sectorsUp = sectorData.filter(function(s){return s.dayChg>0;}).length;
  var sectorsDown = sectorData.filter(function(s){return s.dayChg<0;}).length;
  var sectorsFlat = sectorData.length - sectorsUp - sectorsDown;
  var breadthPct = Math.round((sectorsUp/sectorData.length)*100);

  // ════════════════════════════════════════════════════════════
  // BUILD HTML
  // ════════════════════════════════════════════════════════════
  var html = '';

  // ════ 1. MORNING MINDSET ════
  var mindsetRules = [
    "My job is execution, not prediction. Manage risk above all.",
    "Capital conservation before capital growth.",
    "I only trade my edge — nothing else exists.",
    "Losses are business expenses. One trade means nothing.",
    "I don't need to trade — I wait to be invited.",
    "I don't fight the tape, I align with it.",
    "Fall in love with the process, the outcome will figure itself out.",
    "Always have a stop loss. Cut losers fast, let winners run.",
    "Cash is a position. Avoid the chop.",
    "Discipline is built day in and day out."
  ];
  var todayIdx = Math.floor(Date.now()/(24*60*60*1000)) % mindsetRules.length;
  var dailyFocus = mindsetRules[todayIdx];
  var mindsetCollapsed = localStorage.getItem('mcc_mindset_collapsed')==='true';

  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;border-left:3px solid var(--amber);border-radius:14px;">';
  html += '<div onclick="toggleMindset()" style="display:flex;align-items:center;padding:10px 16px;cursor:pointer;user-select:none;gap:12px;">';
  html += '<span id="mindset-arrow" style="flex-shrink:0;font-size:18px;color:var(--blue);">'+(mindsetCollapsed?'▶':'▼')+'</span>';
  html += '<div style="flex:1;text-align:center;"><div class="step-header-box"><div style="font-size:14px;font-weight:800;color:var(--blue);margin-bottom:2px;">Step 1</div><div class="card-header-bar">Morning Mindset</div><div style="font-size:13px;color:var(--blue);font-weight:600;margin-top:2px;">Set your mental game before the market opens</div></div></div>';
  html += '<span style="width:20px;"></span>';
  html += '</div>';
  // Today's Focus — ALWAYS visible, centered under header
  html += '<div style="padding:0 16px 10px;text-align:center;"><div class="center-under-tagline" style="background:var(--bg-secondary);border:1px solid rgba(230,138,0,0.2);border-radius:6px;padding:10px 14px;display:inline-block;max-width:500px;">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;">Today\'s Focus</div>';
  html += '<div style="font-size:14px;font-weight:700;color:var(--text-primary);line-height:1.4;">'+dailyFocus+'</div>';
  html += '</div></div>';
  // Full rules — collapsible
  html += '<div id="mindset-body" style="'+(mindsetCollapsed?'display:none;':'')+'padding:0 16px 12px;">';
  html += '<div class="ov-mindset-cols" style="columns:2;column-gap:16px;">';
  mindsetRules.forEach(function(rule,i) {
    var isToday = i===todayIdx;
    html += '<div style="break-inside:avoid;padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:flex-start;'+(isToday?'background:var(--amber-bg);margin:0 -4px;padding:4px;border-radius:4px;':'')+'">';
    html += '<span style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);min-width:18px;">'+(i+1)+'.</span>';
    html += '<span style="font-size:14px;color:'+(isToday?'var(--amber)':'var(--text-primary)')+';line-height:1.4;font-weight:'+(isToday?'700':'500')+';">'+rule+'</span>';
    html += '</div>';
  });
  html += '</div></div></div>';

  // ════ 2. MARKET REGIME ════
  var regimeCollapsed = localStorage.getItem('mac_regime_collapsed')!=='false';
  var regimeLabel='Neutral',regimeColor='var(--text-muted)',regimeDetail='';
  var spyPct=spyData.pct, qqqPct=qqqData.pct, iwmPct=iwmData.pct, diaPct=diaData.pct;
  var avgPct=(spyPct+qqqPct+iwmPct+diaPct)/4;

  // High-impact econ event check (uses auto-fetched calendar)
  var hasHighImpactEvent=false, eventName='';
  try {
    var td=new Date();var dw=td.getDay();var mon=new Date(td);mon.setDate(td.getDate()-(dw===0?6:dw-1));
    var calKey='mac_econ_cal_auto_'+mon.toISOString().split('T')[0];
    var calData=localStorage.getItem(calKey);
    if(calData){
      var parsed=JSON.parse(calData);
      var todayStr=td.toISOString().split('T')[0];
      var todayEvents=(parsed.events&&parsed.events[todayStr])||[];
      // Check if any of today's high-impact events match key releases
      var allTitles=todayEvents.map(function(ev){return (ev.title||'').toLowerCase();}).join(' ');
      if(/cpi|fomc|fed fund|interest rate|nonfarm|payroll|gdp|pce/.test(allTitles)){
        hasHighImpactEvent=true;
        if(/cpi/.test(allTitles))eventName='CPI';
        else if(/fomc|fed fund|interest rate/.test(allTitles))eventName='FOMC/Fed';
        else if(/nonfarm|payroll/.test(allTitles))eventName='NFP';
        else if(/gdp/.test(allTitles))eventName='GDP';
        else if(/pce/.test(allTitles))eventName='PCE';
        else eventName='major data';
      }
    }
  } catch(e){}

  // Build index status summary for notes
  function buildIndexNotes(){
    var parts=[];
    [{name:'SPY',pct:spyPct,a10:spyAbove10,a20:spyAbove20},
     {name:'QQQ',pct:qqqPct,a10:qqqAbove10,a20:qqqAbove20},
     {name:'IWM',pct:iwmPct,a10:iwmAbove10,a20:iwmAbove20},
     {name:'DIA',pct:diaPct,a10:diaAbove10,a20:diaAbove20}].forEach(function(idx){
      var smaStatus=idx.a10&&idx.a20?'above both SMAs':(!idx.a10&&!idx.a20?'below both SMAs':'between SMAs');
      parts.push(idx.name+' '+(idx.pct>=0?'+':'')+idx.pct.toFixed(1)+'% ('+smaStatus+')');
    });
    return parts.join(' · ');
  }
  var indexNotes=buildIndexNotes();
  var vixLine=vixNote;

  // Regime decision using ALL indexes + VIX
  var regimeAction='';
  if(hasHighImpactEvent&&!live){
    regimeLabel='Wait for '+eventName;regimeColor='var(--purple)';
    regimeAction='Sit on hands. Wait for data reaction before entering.';
    regimeDetail=eventName+' data expected — wait for the reaction before entering.';
  }
  else if(avgPct>0.8&&breadthPct>=65&&idxAboveBoth>=3){
    regimeLabel='Bullish';regimeColor='var(--green)';
    regimeAction='Trending market — be aggressive. Full size on A+ breakouts and momentum plays. Let winners run.';
    regimeDetail=idxAboveBoth+'/4 indexes above 10 & 20 SMA. '+sectorsUp+'/'+sectorData.length+' sectors green. '+vixLine+'\n'+indexNotes;
  }
  else if(avgPct<-0.8&&breadthPct<=35&&idxBelowBoth>=3){
    regimeLabel='Bearish';regimeColor='var(--red)';
    regimeAction='Trending down — reduce size or sit out. Cash is a position. Only short setups or hedges.';
    regimeDetail=idxBelowBoth+'/4 indexes below 10 & 20 SMA. '+sectorsDown+'/'+sectorData.length+' sectors red. '+vixLine+'\n'+indexNotes;
  }
  else if(Math.abs(avgPct)<0.3&&idxMixed>=2){
    regimeLabel='Chop';regimeColor='var(--amber)';
    regimeAction='Choppy — trade level to level. Use support and resistance, take profits at levels, and keep size small. No swings.';
    regimeDetail='Narrow range, mixed signals. '+idxAboveBoth+'/4 above both SMAs, '+idxBelowBoth+'/4 below both, '+idxMixed+'/4 mixed. '+vixLine+'\n'+indexNotes;
  }
  else if(avgPct>0.3||idxAboveBoth>=3){
    regimeLabel='Slightly Bullish';regimeColor='var(--green)';
    regimeAction='Lean bullish — be selective with longs. Half size. Trade the trend but don\'t force it.';
    regimeDetail=idxAboveBoth+'/4 indexes above both SMAs. '+sectorsUp+'/'+sectorData.length+' sectors positive. '+vixLine+'\n'+indexNotes;
  }
  else if(avgPct<-0.3||idxBelowBoth>=3){
    regimeLabel='Slightly Bearish';regimeColor='var(--red)';
    regimeAction='Lean bearish — reduce size. Take profits quickly on longs, trade level to level.';
    regimeDetail=idxBelowBoth+'/4 indexes below both SMAs. '+sectorsDown+'/'+sectorData.length+' sectors negative. '+vixLine+'\n'+indexNotes;
  }
  else{
    regimeLabel='Chop';regimeColor='var(--amber)';
    regimeAction='Choppy — trade level to level. Support and resistance only, small size, quick profits. No swings.';
    regimeDetail='Mixed signals across indexes. '+idxAboveBoth+' above both SMAs, '+idxBelowBoth+' below both. '+vixLine+'\n'+indexNotes;
  }
  if(hasHighImpactEvent&&live) regimeAction+=' \u26a0 '+eventName+' today — expect volatility.';
  window._currentRegime = regimeLabel;

  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'regime\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;cursor:pointer;user-select:none;gap:12px;">';
  html += '<span id="regime-arrow" style="flex-shrink:0;font-size:18px;color:var(--blue);">'+(regimeCollapsed?'▶':'▼')+'</span>';
  html += '<div style="flex:1;text-align:center;"><div class="step-header-box"><div style="font-size:14px;font-weight:800;color:var(--blue);margin-bottom:2px;">Step 2</div><div class="card-header-bar">Market Outlook</div><div style="font-size:13px;color:var(--blue);font-weight:600;margin-top:2px;">Is the market risk-on or risk-off? This sets your aggression level.</div></div></div>';
  html += '<span style="width:20px;"></span>';
  html += '</div>';
  // Regime label — always visible, centered under header
  html += '<div style="text-align:center;padding:10px 20px;border-bottom:1px solid var(--border);">';
  html += '<div class="center-under-tagline" style="display:inline-block;max-width:600px;">';
  html += '<div style="font-family:var(--font-display);font-size:28px;font-weight:700;color:'+regimeColor+';letter-spacing:0.02em;">'+regimeLabel+'</div>';
  html += '<div style="font-size:14px;font-weight:600;color:var(--text-secondary);margin-top:4px;">'+regimeAction+'</div>';
  html += '</div></div>';
  html += '<div id="regime-body" style="'+(regimeCollapsed?'display:none;':'')+'padding:14px 20px;">';
  html += '<div style="font-size:14px;color:var(--text-muted);line-height:1.4;">'+regimeDetail.replace(/\n/g,'<br>')+'</div>';
  // Show all 4 indexes' SMA status
  var smaIndexes = [
    {name:'SPY',s10:spySma10,s20:spySma20,a10:spyAbove10,a20:spyAbove20},
    {name:'QQQ',s10:qqqSma10,s20:qqqSma20,a10:qqqAbove10,a20:qqqAbove20},
    {name:'IWM',s10:iwmSma10,s20:iwmSma20,a10:iwmAbove10,a20:iwmAbove20},
    {name:'DIA',s10:diaSma10,s20:diaSma20,a10:diaAbove10,a20:diaAbove20}
  ];
  var hasSmaData = smaIndexes.some(function(idx){return idx.s10!==null;});
  if(hasSmaData){
    html += '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">';
    smaIndexes.forEach(function(idx){
      if(idx.s10===null) return;
      var both = idx.a10 && idx.a20;
      var neither = !idx.a10 && !idx.a20;
      var smaColor = both ? 'var(--green)' : neither ? 'var(--red)' : 'var(--amber)';
      var smaLabel = both ? 'Above Both' : neither ? 'Below Both' : 'Mixed';
      html += '<span style="font-size:12px;font-weight:700;padding:2px 6px;border-radius:3px;background:'+smaColor+'15;color:'+smaColor+';font-family:var(--font-mono);">'+idx.name+' '+smaLabel+'</span>';
    });
    html += '</div>';
  }
  // Index snapshot grid (merged from Market Analysis)
  html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Index Snapshot</div>';
  html += '<div class="ov-snap-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;">';
  var snapItems = [
    {ticker:'SPY',label:'S&P 500',data:spyData},
    {ticker:'QQQ',label:'Nasdaq',data:qqqData},
    {ticker:'IWM',label:'Russell',data:iwmData},
    {ticker:'DIA',label:'Dow',data:diaData},
    {ticker:'VIXY',label:'VIX Proxy',data:vixyData},
    {ticker:'UUP',label:'Dollar (DXY)',data:getSnap('UUP')}
  ];
  snapItems.forEach(function(idx){
    var d=idx.data; var color=d.pct>=0?'var(--green)':'var(--red)';
    var bg=d.pct>=0?'rgba(52,211,153,0.04)':'rgba(252,165,165,0.04)';
    var borderC=d.pct>=0?'rgba(52,211,153,0.15)':'rgba(252,165,165,0.15)';
    if(idx.ticker==='VIXY'){color=d.pct<=0?'var(--green)':'var(--red)';bg=d.pct<=0?'rgba(52,211,153,0.04)':'rgba(252,165,165,0.04)';borderC=d.pct<=0?'rgba(52,211,153,0.15)':'rgba(252,165,165,0.15)';}
    html += '<div style="background:'+bg+';border:1px solid '+borderC+';border-radius:8px;padding:8px 6px;text-align:center;">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:0.03em;">'+idx.label+'</div>';
    html += '<div style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:var(--text-secondary);margin-top:1px;">'+(d.price?'$'+price(d.price):'—')+'</div>';
    html += '<div style="font-size:12px;font-weight:700;color:'+color+';margin-top:1px;">'+pct(d.pct)+'</div>';
    html += '</div>';
  });
  html += '</div></div>';
  // Updated timestamp for initial load
  var regimeInitTime = new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'});
  html += '<div style="font-size:12px;color:var(--text-muted);margin-top:6px;" id="regime-updated-label">Updated '+regimeInitTime+' ET</div>';
  html += '</div></div>';
  html += '</div>';

  // ════ 3. STOCK BREADTH (simple gauge — moved before snapshot) ════
  if(adTotal > 0) {
    recordBreadthReading({ up: adStocksUp, down: adStocksDown, flat: adStocksFlat, total: adTotal, pct: adBreadthPct });

    var breadthLabel = adBreadthPct >= 60 ? 'Broad Rally' : adBreadthPct <= 40 ? 'Broad Selling' : 'Narrow / Mixed';
    var breadthColor = adBreadthPct >= 60 ? 'var(--green)' : adBreadthPct <= 40 ? 'var(--red)' : 'var(--amber)';
    var breadthCollapsed = localStorage.getItem('mac_breadth_collapsed')==='true';
    html += '<div class="card" style="padding:0;margin-bottom:14px;overflow:hidden;">';
    html += '<div onclick="toggleBreadth()" style="display:flex;align-items:center;padding:10px 16px;cursor:pointer;user-select:none;gap:12px;">';
    html += '<span id="breadth-arrow" style="flex-shrink:0;font-size:18px;color:var(--blue);">'+(breadthCollapsed?'\u25b6':'\u25bc')+'</span>';
    html += '<div style="flex:1;text-align:center;"><div class="step-header-box"><div style="font-size:14px;font-weight:800;color:var(--blue);margin-bottom:2px;">Step 3</div><div class="card-header-bar">Stock Breadth</div><div style="font-size:13px;color:var(--blue);font-weight:600;margin-top:2px;">Is the move broad or narrow? Confirms if the regime call is real.</div></div></div>';
    html += '<span style="width:20px;"></span>';
    html += '</div>';
    html += '<div id="breadth-content" style="'+(breadthCollapsed?'display:none;':'')+'padding:0 20px 12px;">';
    // Gauge bar
    html += '<div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
    html += '<span style="font-size:12px;font-weight:700;color:var(--green);">'+adBreadthPct+'% Up</span>';
    html += '<span style="font-size:14px;font-weight:800;color:'+breadthColor+';">'+breadthLabel+'</span>';
    html += '<span style="font-size:12px;font-weight:700;color:var(--red);">'+(100-adBreadthPct)+'% Down</span>';
    html += '</div>';
    html += '<div style="height:8px;border-radius:4px;background:var(--red-bg);overflow:hidden;">';
    html += '<div style="height:100%;width:'+adBreadthPct+'%;background:var(--green);border-radius:4px;transition:width 0.3s;"></div>';
    html += '</div>';
    html += '</div>';
    html += '<div id="breadth-body" style="margin-top:8px;"></div>';
    html += '</div></div>';
  }

  // ════ 4. SECTOR ROTATION ════
  var heatmapCollapsed = localStorage.getItem('mac_heatmap_collapsed')==='true';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleHeatmap()" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;cursor:pointer;user-select:none;gap:12px;">';
  html += '<span id="heatmap-arrow" style="flex-shrink:0;font-size:18px;color:var(--blue);">'+(heatmapCollapsed?'\u25b6':'\u25bc')+'</span>';
  html += '<div style="flex:1;text-align:center;"><div class="step-header-box"><div style="font-size:14px;font-weight:800;color:var(--blue);margin-bottom:2px;">Step 4</div><div class="card-header-bar">Sector Rotation</div><div style="font-size:13px;color:var(--blue);font-weight:600;margin-top:2px;">Where is money flowing? Click a sector for details.</div></div></div>';
  html += '<span style="font-size:12px;color:var(--text-muted);font-family:var(--font-body);flex-shrink:0;">'+dataFreshness+'</span>';
  html += '</div>';
  html += '<div id="heatmap-body" style="'+(heatmapCollapsed?'display:none;':'')+'">';
  // Store maps globally for sector detail expansion
  window._subsectorMap = subsectorMap;
  window._sectorStocks = sectorStocks;

  // ── RELATIVE ROTATION GRAPH (RRG) ──
  var allRRGAssets = sectorETFs.map(function(s){ return {etf:s.etf, name:s.name, short:s.short, isAsset:false}; })
    .concat(rrgAssets.map(function(s){ return {etf:s.etf, name:s.name, short:s.short, isAsset:true}; }));
  var rrgData = calcRRGData(allRRGAssets, spyBars, _barsByTicker);
  window._rrgData = rrgData;

  html += '<div style="padding:10px 8px;">';
  if(!isMarketOpen()){
    html+='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.2);border-radius:8px;margin-bottom:10px;font-size:13px;color:var(--blue);">';
    html+='<span style="font-size:15px;flex-shrink:0;">&#128337;</span>';
    html+='<span>Showing last session\'s sector positioning. Live updates resume at market open.</span>';
    html+='</div>';
  }
  if(rrgData.length > 0) {
    html += '<div style="position:relative;"><canvas id="rrg-canvas" style="width:100%;border-radius:8px;"></canvas></div>';

    // ── SECTOR ROTATION TABLE (primary readable view) ──
    html += '<div style="margin-top:10px;border:1px solid var(--border);border-radius:8px;overflow:hidden;overflow-x:auto;-webkit-overflow-scrolling:touch;">';
    // Table header
    html += '<div style="display:grid;grid-template-columns:90px 1fr 56px 56px 50px;gap:0;padding:6px 12px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;min-width:360px;">';
    html += '<span>Quadrant</span><span>Sector</span><span>RS</span><span>Mom</span><span>Dir</span>';
    html += '</div>';
    // Sort by quadrant priority: Leading > Improving > Weakening > Lagging
    var qOrder = {leading:0, improving:1, weakening:2, lagging:3};
    var qColors = {leading:'#10B981', improving:'#2563EB', weakening:'#F59E0B', lagging:'#EF4444'};
    var qLabels = {leading:'Leading', improving:'Improving', weakening:'Weakening', lagging:'Lagging'};
    var tableRows = rrgData.map(function(d) {
      if(d.trail.length === 0) return null;
      var last = d.trail[d.trail.length-1];
      var r = last.ratio, m = last.momentum;
      var q = (r >= 100 && m >= 100) ? 'leading' : (r >= 100 && m < 100) ? 'weakening' : (r < 100 && m >= 100) ? 'improving' : 'lagging';
      // Direction: compare to previous point
      var dir = '\u25cf'; // neutral dot
      if(d.trail.length >= 2) {
        var prev = d.trail[d.trail.length-2];
        var rDelta = last.ratio - prev.ratio;
        var mDelta = last.momentum - prev.momentum;
        if(rDelta > 0 && mDelta > 0) dir = '\u2197'; // ↗ improving
        else if(rDelta > 0 && mDelta <= 0) dir = '\u2198'; // ↘ weakening
        else if(rDelta <= 0 && mDelta > 0) dir = '\u2196'; // ↖ recovering
        else dir = '\u2199'; // ↙ deteriorating
      }
      return {d:d, q:q, rs:r, mom:m, dir:dir};
    }).filter(function(x){return x;});
    tableRows.sort(function(a,b) { return (qOrder[a.q]||9) - (qOrder[b.q]||9) || b.mom - a.mom; });
    tableRows.forEach(function(row, idx) {
      var d = row.d;
      var qc = qColors[row.q];
      var clickAttr = d.isAssetClass ? 'onclick="openTVChart(\'' + d.etf + '\')"' : 'onclick="showRRGSectorDetail(\'' + d.etf + '\')"';
      var rsColor = row.rs >= 100 ? 'var(--green)' : 'var(--red)';
      var momColor = row.mom >= 100 ? 'var(--green)' : 'var(--red)';
      html += '<div ' + clickAttr + ' style="display:grid;grid-template-columns:90px 1fr 56px 56px 50px;gap:0;padding:7px 12px;border-bottom:1px solid var(--border);font-size:12px;align-items:center;cursor:pointer;min-width:360px;' + (idx % 2 === 1 ? 'background:var(--bg-secondary);' : '') + '" title="Click for details">';
      // Quadrant badge
      html += '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:'+qc+'15;color:'+qc+';border:1px solid '+qc+'30;white-space:nowrap;">'+qLabels[row.q]+'</span>';
      // Sector name + ETF
      var tickerTitle = d.isAssetClass ? 'Click for chart' : 'Click for sector details';
      html += '<span style="display:flex;align-items:center;gap:4px;"><span class="ticker-link" style="font-size:12px;" title="' + tickerTitle + '">' + d.etf + '</span><span style="font-size:11px;color:var(--text-muted);">' + (d.short || d.name) + '</span></span>';
      // RS ratio
      html += '<span style="font-family:var(--font-mono);font-weight:700;color:'+rsColor+';">'+row.rs.toFixed(1)+'</span>';
      // Momentum
      html += '<span style="font-family:var(--font-mono);font-weight:700;color:'+momColor+';">'+row.mom.toFixed(1)+'</span>';
      // Direction arrow
      html += '<span style="font-size:16px;text-align:center;">'+row.dir+'</span>';
      html += '</div>';
    });
    html += '</div>';

    // Quadrant filter pills
    html += '<div style="display:flex;justify-content:center;gap:6px;margin-top:8px;flex-wrap:wrap;">';
    var qPillStyle = 'padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;user-select:none;';
    html += '<div onclick="showRRGQuadrant(\'leading\')" style="' + qPillStyle + 'background:rgba(16,185,129,0.1);color:rgba(16,185,129,0.85);border:1px solid rgba(16,185,129,0.2);" title="Click to see Leading sectors">Leading</div>';
    html += '<div onclick="showRRGQuadrant(\'improving\')" style="' + qPillStyle + 'background:rgba(37,99,235,0.1);color:rgba(37,99,235,0.85);border:1px solid rgba(37,99,235,0.2);" title="Click to see Improving sectors">Improving</div>';
    html += '<div onclick="showRRGQuadrant(\'weakening\')" style="' + qPillStyle + 'background:rgba(245,158,11,0.1);color:rgba(217,119,6,0.85);border:1px solid rgba(245,158,11,0.2);" title="Click to see Weakening sectors">Weakening</div>';
    html += '<div onclick="showRRGQuadrant(\'lagging\')" style="' + qPillStyle + 'background:rgba(239,68,68,0.1);color:rgba(239,68,68,0.85);border:1px solid rgba(239,68,68,0.2);" title="Click to see Lagging sectors">Lagging</div>';
    html += '</div>';

    // Legend
    html += '<div style="display:flex;justify-content:center;gap:16px;margin-top:6px;font-size:11px;">';
    html += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--blue);"></span><span style="color:var(--text-muted);">Sectors</span></span>';
    html += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--amber);"></span><span style="color:var(--text-muted);">Asset Classes</span></span>';
    html += '<span style="color:var(--text-muted);">\u2197 Improving \u2198 Weakening \u2196 Recovering \u2199 Deteriorating</span>';
    html += '</div>';
  } else {
    html += '<div style="text-align:center;padding:12px;font-size:12px;color:var(--text-muted);">Insufficient data for RRG (need 15+ trading days)</div>';
  }
  html += '</div>';

  // Sector detail panel (populated on click)
  html += '<div id="rrg-sector-detail" style="display:none;border-top:1px solid var(--border);padding:12px 14px;"></div>';

  html += '</div></div>'; // close heatmap-body, close card

  // ════ 6. TODAY'S CATALYSTS + THEMES ════
  var catalystsCollapsed = localStorage.getItem('mac_catalysts_collapsed')!=='false';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'catalysts\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;cursor:pointer;user-select:none;gap:12px;">';
  html += '<span id="catalysts-arrow" style="flex-shrink:0;font-size:18px;color:var(--blue);">'+(catalystsCollapsed?'\u25b6':'\u25bc')+'</span>';
  html += '<div style="flex:1;text-align:center;"><div class="step-header-box"><div style="font-size:14px;font-weight:800;color:var(--blue);margin-bottom:2px;">Step 5</div><div class="card-header-bar">Catalysts & Themes</div><div style="font-size:13px;color:var(--blue);font-weight:600;margin-top:2px;">What events and narratives are driving today\'s price action?</div></div></div>';
  html += '<span style="font-size:12px;color:var(--text-muted);flex-shrink:0;">'+tsLabel(ts)+'</span>';
  html += '</div>';
  html += '<div id="catalysts-body" style="'+(catalystsCollapsed?'display:none;':'')+'">';
  // Econ calendar
  html += '<div style="padding:10px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Economic Calendar</div>';
  html += '<div id="econ-cal-grid" style="font-size:12px;color:var(--text-muted);">Loading...</div>';
  html += '</div>';
  // ════ TODAY'S THEMES (inside Catalysts card) ════
  var _themesEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var _themesPreMarket = (_themesEt.getDay() >= 1 && _themesEt.getDay() <= 5 && (_themesEt.getHours() < 9 || (_themesEt.getHours() === 9 && _themesEt.getMinutes() < 30)));
  html += '<div style="padding:10px 16px;border-top:1px solid var(--border);">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;">Today\'s Themes</div>';
  if(!_themesPreMarket){html += '<button id="generate-themes-btn" onclick="generateThemes()" class="refresh-btn" style="padding:4px 10px;font-size:12px;">Scan</button>';}
  html += '</div>';
  html += '<div id="themes-content">';
  var cachedThemes=null;
  try{var themeKey='mac_themes_'+new Date().toISOString().split('T')[0];var themeData=localStorage.getItem(themeKey);if(themeData)cachedThemes=JSON.parse(themeData);}catch(e){}
  if(cachedThemes&&cachedThemes.movers){html+=renderThemesHTML(cachedThemes,cachedThemes.ts);}
  else if(cachedThemes&&cachedThemes.themes){html+=renderLegacyThemesHTML(cachedThemes.themes,cachedThemes.ts);}
  else if(_themesPreMarket){
    // Look back to previous trading day's cached themes
    var _prevThemes=null,_prevLabel='';
    try{
      var _ptd=new Date(_themesEt);_ptd.setDate(_ptd.getDate()-1);
      while(_ptd.getDay()===0||_ptd.getDay()===6)_ptd.setDate(_ptd.getDate()-1);
      var _ptdKey='mac_themes_'+_ptd.getFullYear()+'-'+String(_ptd.getMonth()+1).padStart(2,'0')+'-'+String(_ptd.getDate()).padStart(2,'0');
      var _ptdRaw=localStorage.getItem(_ptdKey);
      if(_ptdRaw){_prevThemes=JSON.parse(_ptdRaw);_prevLabel=_ptd.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}
    }catch(e){}
    if(_prevThemes&&(_prevThemes.movers||_prevThemes.themes)){
      html+='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(210,153,34,0.08);border:1px solid rgba(210,153,34,0.25);border-radius:8px;margin-bottom:10px;font-size:13px;color:#d29922;">';
      html+='<span style="font-size:15px;flex-shrink:0;">&#9202;</span>';
      html+='<span>Showing <span style="background:rgba(210,153,34,0.15);padding:2px 8px;border-radius:4px;font-weight:700;white-space:nowrap;">'+_prevLabel+'</span> themes &mdash; today\'s scan available after market open (9:30 AM ET)</span>';
      html+='</div>';
      if(_prevThemes.movers){html+=renderThemesHTML(_prevThemes,_prevThemes.ts);}
      else{html+=renderLegacyThemesHTML(_prevThemes.themes,_prevThemes.ts);}
    }else{
      html+='<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:12px 0;">Themes available after market open (9:30 AM ET). Live price data is needed to identify today\'s movers.</div>';
    }
  }
  else{html += '<div style="font-size:14px;color:var(--text-muted);">'+(window._currentSession?'Auto-loading themes...':'Log in to auto-generate themes.')+'</div>';}
  html += '</div></div>';
  html += '</div>'; // close catalysts-body
  html += '</div>'; // close Catalysts+Themes card

  // ════ 7. TOP IDEAS (from scanners) ════
  var ideasCollapsed = localStorage.getItem('mac_ideas_collapsed')!=='false';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'ideas\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;cursor:pointer;user-select:none;gap:12px;">';
  html += '<span id="ideas-arrow" style="flex-shrink:0;font-size:18px;color:var(--blue);">'+(ideasCollapsed?'\u25b6':'\u25bc')+'</span>';
  html += '<div style="flex:1;text-align:center;"><div class="step-header-box"><div style="font-size:14px;font-weight:800;color:var(--blue);margin-bottom:2px;">Step 6</div><div class="card-header-bar">Top Ideas</div><div style="font-size:13px;color:var(--blue);font-weight:600;margin-top:2px;">Highest-scored setups from today\'s scan. Your shortlist.</div></div></div>';
  html += '<span style="width:20px;"></span>';
  html += '</div>';
  html += '<div id="ideas-body" style="'+(ideasCollapsed?'display:none;':'')+'">';
  html += '<div id="top-ideas-content" style="padding:12px 16px;">';
  var cachedIdeas=null;
  try{var ideaKey='mac_top_ideas_'+new Date().toISOString().split('T')[0];var ideaData=localStorage.getItem(ideaKey);if(ideaData)cachedIdeas=JSON.parse(ideaData);}catch(e){}
  if(cachedIdeas&&cachedIdeas.ideas&&cachedIdeas.ideas.length>0){html+=renderTopIdeasHTML(cachedIdeas.ideas,cachedIdeas.ts);}
  else{
    if(isMarketOpen()){
      html += '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">Scanning for top setups...</div>';
    } else {
      html += '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">Top ideas populate automatically during market hours (9:30 AM – 4:00 PM ET).</div>';
    }
  }
  html += '</div></div></div>';

  // ════ 8. AFTER THE BELL ════
  var recapCollapsed = localStorage.getItem('mac_recap_collapsed')!=='false';
  // Determine the last completed trading session date
  var _recapSessionDate = (function() {
    var now = new Date();
    var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var h = et.getHours(), dow = et.getDay();
    // Before 4 PM ET on a weekday, use previous trading day
    if (dow >= 1 && dow <= 5 && h < 16) et.setDate(et.getDate() - 1);
    // Roll past weekends
    while (et.getDay() === 0 || et.getDay() === 6) et.setDate(et.getDate() - 1);
    return et;
  })();
  var recapDateKey = _recapSessionDate.getFullYear() + '-' + String(_recapSessionDate.getMonth()+1).padStart(2,'0') + '-' + String(_recapSessionDate.getDate()).padStart(2,'0');
  var recapDateLabel = _recapSessionDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  var cachedRecap = null;
  try { var rr = localStorage.getItem('mac_recap_'+recapDateKey); if(rr) cachedRecap = JSON.parse(rr); } catch(e) {}
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'recap\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;cursor:pointer;user-select:none;gap:12px;">';
  html += '<span id="recap-arrow" style="flex-shrink:0;font-size:18px;color:var(--blue);">'+(recapCollapsed?'\u25b6':'\u25bc')+'</span>';
  html += '<div style="flex:1;text-align:center;"><div class="step-header-box"><div style="font-size:14px;font-weight:800;color:var(--blue);margin-bottom:2px;">Step 7</div><div class="card-header-bar">After the Bell</div><div style="font-size:13px;color:var(--blue);font-weight:600;margin-top:2px;">'+recapDateLabel+' \u2014 Session recap + tomorrow\'s watchlist.</div></div></div>';
  html += '<span style="width:20px;"></span>';
  html += '</div>';
  html += '<div id="recap-body" style="'+(recapCollapsed?'display:none;':'')+'padding:12px 16px;">';
  if (cachedRecap) {
    html += renderRecapHTML(cachedRecap);
  } else {
    var etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var isAfterClose = etNow.getHours() >= 16 || etNow.getDay() === 0 || etNow.getDay() === 6;
    html += '<div id="recap-content" style="text-align:center;padding:16px;">';
    if (isAfterClose) {
      html += '<button onclick="generateRecap()" class="refresh-btn" style="padding:8px 20px;font-size:13px;">Generate Recap</button>';
      html += '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">'+recapDateLabel+' session</div>';
    } else {
      html += '<div style="font-size:13px;color:var(--text-muted);">No recap generated for '+recapDateLabel+'. Recaps can be generated after market close (4 PM ET).</div>';
    }
    html += '</div>';
  }
  html += '</div></div>';

  container.innerHTML = html;

  // ════ WATCHLIST SIDEBAR ════
  renderWatchlistSidebar();
  // Render RRG canvas (must be after innerHTML so canvas element exists)
  if(window._rrgData && window._rrgData.length > 0) {
    setTimeout(function(){
      renderRRGCanvas('rrg-canvas');
      var rrgEl = document.getElementById('rrg-canvas');
      if(rrgEl) {
        rrgEl.style.cursor = 'default';
        // Hover tooltip: show full ETF name
        rrgEl.addEventListener('mousemove', function(e){
          var rect = rrgEl.getBoundingClientRect();
          var mx = e.clientX - rect.left, my = e.clientY - rect.top;
          var hovered = null, minDist = 25;
          (window._rrgData||[]).forEach(function(d){
            // Check circle at tip first
            if(d._tipXY) {
              var dx = mx - d._tipXY.x, dy = my - d._tipXY.y;
              var dist = Math.sqrt(dx*dx + dy*dy);
              if(dist < 12){ hovered = d; minDist = dist; }
            }
            // Then check dot
            if(!hovered && d._canvasXY) {
              var dx = mx - d._canvasXY.x, dy = my - d._canvasXY.y;
              var dist = Math.sqrt(dx*dx + dy*dy);
              if(dist < minDist){ hovered = d; minDist = dist; }
            }
          });
          if(hovered) {
            rrgEl.style.cursor = 'pointer';
            rrgEl.title = hovered.etf + ' ' + (hovered.short || hovered.name);
          } else {
            rrgEl.style.cursor = 'default';
            rrgEl.title = '';
          }
        });
        // Click handler: circle opens sector detail popup, dot opens chart
        rrgEl.addEventListener('click', function(e){
          var rect = rrgEl.getBoundingClientRect();
          var mx = e.clientX - rect.left, my = e.clientY - rect.top;
          // First check if click is on a circle (tip)
          var circleHit = null;
          (window._rrgData||[]).forEach(function(d){
            if(!d._tipXY) return;
            var dx = mx - d._tipXY.x, dy = my - d._tipXY.y;
            if(Math.sqrt(dx*dx + dy*dy) < 12) circleHit = d;
          });
          if(circleHit) {
            // Sectors → sector popup with subsectors; asset classes → chart
            if(circleHit.isAssetClass) { openTVChart(circleHit.etf); }
            else { showRRGSectorPopup(circleHit); }
            return;
          }
          // Then check dots (labels / arrow body)
          var closest = null, minDist = 20;
          (window._rrgData||[]).forEach(function(d){
            if(!d._canvasXY) return;
            var dx = mx - d._canvasXY.x, dy = my - d._canvasXY.y;
            var dist = Math.sqrt(dx*dx + dy*dy);
            if(dist < minDist){ minDist = dist; closest = d; }
          });
          if(closest) {
            // Sectors → sector popup with subsectors; asset classes → chart
            if(closest.isAssetClass) { openTVChart(closest.etf); }
            else { showRRGSectorPopup(closest); }
          }
        });
      }
    }, 50);
  }
  loadEconCalendar();
  // Load watchlist live prices async
  loadWatchlistPrices();
  // Render initial breadth card body (uses recordBreadthReading data from above)
  if(adTotal > 0) {
    renderBreadthBody({ up: adStocksUp, down: adStocksDown, flat: adStocksFlat, total: adTotal, pct: adBreadthPct });
  }
  // Start 15-min auto-refresh for breadth (only during market hours)
  if(live) {
    startBreadthAutoRefresh();
  }
  // Start auto-scan for Top Ideas (runs every 15 min)
  startTopIdeasAutoScan();
  // Auto-generate themes if no cache and user is logged in (skip pre-market)
  if(!cachedThemes && !_themesPreMarket && window._currentSession){
    setTimeout(function(){ generateThemes(); }, 500);
  }
}

// ==================== WATCHLIST SIDEBAR ====================
function renderWatchlistSidebar() {
  var sidebar = document.getElementById('watchlist-sidebar');
  if (!sidebar) return;
  var wList = getWatchlist();
  var html = '';
  // Account size box
  var savedAcct = localStorage.getItem('mac_account_size') || '';
  html += '<div style="display:flex;align-items:center;gap:8px;background:var(--bg-secondary);border:1.5px solid var(--blue);border-radius:10px;padding:8px 14px;margin-bottom:8px;">';
  html += '<label style="font-size:14px;color:var(--blue);white-space:nowrap;font-weight:700;">Acct $</label>';
  html += '<input id="header-account-input" type="number" placeholder="Enter size" min="0" step="1000" value="' + (savedAcct ? savedAcct : '') + '"';
  html += ' style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-family:var(--font-mono);font-size:15px;text-align:right;-moz-appearance:textfield;box-sizing:border-box;"';
  html += ' title="Your account size — used for position sizing" onchange="saveHeaderAccount()" />';
  html += '</div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin:-4px 0 8px 2px;line-height:1.3;">Customizes position sizes, entries, stops & targets across all setups.</div>';
  html += '<div class="card" style="padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 14px;border-bottom:1px solid var(--border);text-align:center;">';
  html += '<div style="font-size:14px;font-weight:800;color:var(--text-primary);">Watchlist</div>';
  html += '</div>';
  // Add form (vertical for narrow sidebar)
  html += '<div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:6px;">';
  html += '<div style="display:flex;gap:6px;">';
  html += '<input type="text" id="wl-ticker-input" placeholder="TICKER" maxlength="5" style="flex:1;min-width:0;background:var(--bg-secondary);border:1.5px solid var(--blue);border-radius:5px;padding:6px 8px;font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--text-primary);text-transform:uppercase;box-sizing:border-box;" onkeydown="if(event.key===\'Enter\'){addToWatchlist();refreshWatchlistUI();}" />';
  html += '<button onclick="addToWatchlist();refreshWatchlistUI();" class="refresh-btn" style="padding:6px 10px;font-size:12px;">+</button>';
  html += '</div>';
  html += '<input type="text" id="wl-note-input" placeholder="Notes..." style="width:100%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:13px;color:var(--text-primary);box-sizing:border-box;" onkeydown="if(event.key===\'Enter\'){addToWatchlist();refreshWatchlistUI();}" />';
  html += '</div>';
  // Watchlist items
  html += '<div id="watchlist-content" style="padding:8px 10px;">';
  html += _renderWatchlistItems(wList);
  html += '</div>';
  // Clear all button
  if(wList.length>0) {
    html += '<div style="padding:8px 12px;border-top:1px solid var(--border);text-align:center;">';
    html += '<button onclick="clearWatchlist();refreshWatchlistUI();" class="refresh-btn" style="padding:4px 10px;font-size:12px;width:100%;">Clear All</button>';
    html += '</div>';
  }
  html += '</div>';
  sidebar.innerHTML = html;
}

function _renderWatchlistItems(wList) {
  if(wList.length===0) {
    return '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px;">No tickers yet.</div>';
  }
  var html = '<div style="display:flex;flex-direction:column;gap:6px;">';
  wList.forEach(function(item){
    html += '<div class="wl-card-'+item.ticker+'" style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;border-left:3px solid var(--blue);position:relative;">';
    html += '<button onclick="removeFromWatchlist(\''+item.ticker+'\');refreshWatchlistUI();" style="position:absolute;top:4px;right:6px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;">\u00d7</button>';
    html += '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;flex-wrap:wrap;">';
    html += '<span class="ticker-link" style="font-size:13px;" title="Click for chart" onclick="event.stopPropagation();openTVChart(\''+item.ticker+'\');">'+item.ticker+'</span>';
    html += '<span class="wl-price-'+item.ticker+'" style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:var(--text-muted);">...</span>';
    html += '</div>';
    if(item.note) html += '<div style="font-size:12px;color:var(--text-secondary);line-height:1.3;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+item.note.replace(/</g,'&lt;')+'</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// Partial refresh — re-renders sidebar watchlist items without full rebuild
function refreshWatchlistUI() {
  var sidebar = document.getElementById('watchlist-sidebar');
  if (sidebar) {
    renderWatchlistSidebar();
    loadWatchlistPrices();
  }
  var input = document.getElementById('wl-ticker-input');
  if (input) input.focus();
}

// ==================== WATCHLIST PRICE LOADER ====================
async function loadWatchlistPrices() {
  var list = getWatchlist();
  if(list.length===0) return;
  var tickers = list.map(function(x){return x.ticker;});
  try {
    var snap = await getSnapshots(tickers);
    tickers.forEach(function(t){
      var el = document.querySelector('.wl-price-'+t);
      if(!el) return;
      var s = snap[t];
      if(!s){el.textContent='N/A';return;}
      var p = s.day&&s.day.c ? s.day.c : (s.lastTrade?s.lastTrade.p:0);
      var prev = s.prevDay ? s.prevDay.c : p;
      var pctVal = prev>0 ? ((p-prev)/prev)*100 : 0;
      var color = pctVal>=0 ? 'var(--green)' : 'var(--red)';
      el.innerHTML = '$'+price(p)+' <span style="color:'+color+';font-size:14px;">'+pct(pctVal)+'</span>';
      el.style.color = 'var(--text-primary)';
    });
  } catch(e){}
}

// ==================== TOGGLES ====================
// Generic card toggle — works for any card with id='<name>-body' and id='<name>-arrow'
// displayType defaults to 'block'; pass 'flex' for flex-layout bodies
var _cardDisplayType = {regime:'flex'};
function toggleCard(name) {
  var body=document.getElementById(name+'-body'),arrow=document.getElementById(name+'-arrow');
  if(!body)return;var h=body.style.display==='none';
  var dt=_cardDisplayType[name]||'block';
  body.style.display=h?dt:'none';
  if(arrow)arrow.textContent=h?'▼':'▶';
  try{localStorage.setItem('mac_'+name+'_collapsed',h?'false':'true');}catch(e){}
}
function toggleHeatmap(){
  toggleCard('heatmap');
  // Re-render RRG canvas after expanding so it picks up the correct width
  var body = document.getElementById('heatmap-body');
  if(body && body.style.display !== 'none' && window._rrgData && window._rrgData.length > 0) {
    setTimeout(function(){ renderRRGCanvas('rrg-canvas'); }, 50);
  }
}

function toggleBreadthTrend(){
  var body=document.getElementById('breadth-trend-body'),arrow=document.getElementById('breadth-trend-arrow');
  if(!body)return;
  var hidden=body.style.display==='none';
  body.style.display=hidden?'':'none';
  if(arrow)arrow.textContent=hidden?'\u25bc':'\u25b6';
  try{localStorage.setItem('mac_breadth_trend_collapsed',hidden?'false':'true');}catch(e){}
}

// Show sectors in a specific RRG quadrant
function showRRGQuadrant(quadrant) {
  var data = window._rrgData;
  if (!data || data.length === 0) return;
  var sectors = data.filter(function(d) {
    if (d.trail.length === 0) return false;
    var last = d.trail[d.trail.length - 1];
    var r = last.ratio, m = last.momentum;
    if (quadrant === 'leading') return r >= 100 && m >= 100;
    if (quadrant === 'weakening') return r >= 100 && m < 100;
    if (quadrant === 'lagging') return r < 100 && m < 100;
    if (quadrant === 'improving') return r < 100 && m >= 100;
    return false;
  });
  var colors = { leading: '#10B981', weakening: '#F59E0B', lagging: '#EF4444', improving: '#2563EB' };
  var titles = { leading: 'Leading', weakening: 'Weakening', lagging: 'Lagging', improving: 'Improving' };
  var descs = { leading: 'Strong relative strength & rising momentum. These sectors are outperforming and accelerating.', weakening: 'Strong relative strength but momentum is fading. Watch for rotation out.', lagging: 'Weak relative strength & falling momentum. Underperformers to avoid.', improving: 'Weak relative strength but momentum is building. Early rotation candidates.' };
  var c = colors[quadrant];

  var html = '';
  // Backdrop
  html += '<div onclick="closeRRGQuadrantPopup()" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;"></div>';
  // Modal
  html += '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--bg-primary);border:2px solid ' + c + ';border-radius:14px;padding:24px 28px;width:90vw;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">';
  // Close button
  html += '<button onclick="closeRRGQuadrantPopup()" style="position:absolute;top:10px;right:14px;background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer;">&times;</button>';
  // Header
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
  html += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + c + ';"></span>';
  html += '<span style="font-size:20px;font-weight:800;font-family:var(--font-display);color:' + c + ';">' + titles[quadrant] + ' Quadrant</span>';
  html += '</div>';
  html += '<div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.4;">' + descs[quadrant] + '</div>';

  if (sectors.length === 0) {
    html += '<div style="font-size:13px;color:var(--text-muted);padding:12px 0;">No sectors currently in this quadrant.</div>';
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    sectors.forEach(function(d) {
      var last = d.trail[d.trail.length - 1];
      var label = d.etf + ' ' + (d.short || d.name);
      var clickAttr = d.isAssetClass ? 'onclick="closeRRGQuadrantPopup();openTVChart(\'' + d.etf + '\')"' : 'onclick="closeRRGQuadrantPopup();showRRGSectorDetail(\'' + d.etf + '\')"';
      html += '<div ' + clickAttr + ' style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-secondary);border-left:3px solid ' + c + ';border-radius:8px;cursor:pointer;" title="Click for details">';
      html += '<span style="font-size:14px;font-weight:700;font-family:var(--font-mono);">' + label + '</span>';
      html += '<span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">RS ' + last.ratio.toFixed(1) + ' / Mom ' + last.momentum.toFixed(1) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // Remove old popup if exists, create new
  var existing = document.getElementById('rrg-quadrant-popup');
  if (existing) existing.remove();
  var popup = document.createElement('div');
  popup.id = 'rrg-quadrant-popup';
  popup.innerHTML = html;
  document.body.appendChild(popup);
}

function closeRRGQuadrantPopup() {
  var el = document.getElementById('rrg-quadrant-popup');
  if (el) el.remove();
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeRRGQuadrantPopup();
});

// ==================== RRG SECTOR POPUP (circle click → modal with subsectors + leaders) ====================
async function showRRGSectorPopup(d) {
  // Remove existing popup
  var existing = document.getElementById('rrg-sector-popup');
  if(existing) existing.remove();

  var sectorEtf = d.etf;
  var secInfo = null;
  (window._sectorData || []).forEach(function(s) { if(s.etf === sectorEtf) secInfo = s; });
  var subs = (window._subsectorMap || {})[sectorEtf] || [];
  var stocks = (window._sectorStocks || {})[sectorEtf] || [];
  var sectorName = d.short || d.name || (secInfo ? secInfo.name : sectorEtf);

  // RRG info
  var last = d.trail.length ? d.trail[d.trail.length-1] : null;
  var rs = last ? last.ratio : 0, mom = last ? last.momentum : 0;
  var q = (rs>=100&&mom>=100)?'Leading':(rs>=100&&mom<100)?'Weakening':(rs<100&&mom>=100)?'Improving':'Lagging';
  var qc = q==='Leading'?'#10B981':q==='Improving'?'#2563EB':q==='Weakening'?'#F59E0B':'#EF4444';

  var wrap = document.createElement('div');
  wrap.id = 'rrg-sector-popup';
  // Backdrop
  var bd = '<div onclick="document.getElementById(\'rrg-sector-popup\').remove()" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;"></div>';
  // Modal
  var m = '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px;width:90vw;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">';
  // Header
  m += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">';
  m += '<div style="display:flex;align-items:center;gap:10px;">';
  m += '<span class="ticker-link" style="font-size:16px;" title="Click for chart" onclick="openTVChart(\''+sectorEtf+'\')">'+sectorEtf+'</span>';
  m += '<span style="font-size:16px;font-weight:700;color:var(--text-primary);">'+sectorName+'</span>';
  m += '</div>';
  m += '<button onclick="document.getElementById(\'rrg-sector-popup\').remove()" style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer;">\u2715</button>';
  m += '</div>';
  // Quadrant + RS/Mom
  m += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">';
  m += '<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;background:'+qc+'15;color:'+qc+';border:1px solid '+qc+'30;">'+q+'</span>';
  m += '<span style="font-size:13px;font-family:var(--font-mono);color:var(--text-secondary);">RS '+rs.toFixed(1)+' / Mom '+mom.toFixed(1)+'</span>';
  if(secInfo) {
    var dc = secInfo.dayChg>=0?'var(--green)':'var(--red)';
    m += '<span style="font-size:13px;font-weight:800;font-family:var(--font-mono);color:'+dc+';">'+(secInfo.dayChg>=0?'+':'')+secInfo.dayChg.toFixed(1)+'%</span>';
  }
  m += '</div>';
  // Loading
  m += '<div id="rrg-popup-body" style="font-size:13px;color:var(--text-muted);text-align:center;padding:16px;">Loading sector data...</div>';
  m += '</div>';
  wrap.innerHTML = bd + m;
  document.body.appendChild(wrap);
  // Escape to close
  function _escClose(e){ if(e.key==='Escape'){ var p=document.getElementById('rrg-sector-popup'); if(p) p.remove(); document.removeEventListener('keydown',_escClose); }}
  document.addEventListener('keydown', _escClose);

  // Load data
  try {
    var bodyHtml = '';
    // Subsectors
    if(subs.length > 0) {
      var subTickers = subs.map(function(s){return s.etf;});
      var subSnap = await getSnapshots(subTickers);
      var subResults = [];
      for(var i=0;i<subs.length;i++){
        var sub=subs[i], s=subSnap[sub.etf];
        var p=0,prev=0,pctVal=0;
        if(s){ p=s.day&&s.day.c&&s.day.c>0?s.day.c:(s.prevDay&&s.prevDay.c?s.prevDay.c:(s.lastTrade?s.lastTrade.p:0)); prev=s.prevDay?s.prevDay.c:p; if(prev>0) pctVal=((p-prev)/prev)*100; }
        subResults.push({etf:sub.etf,name:sub.name,pct:pctVal});
      }
      subResults.sort(function(a,b){return b.pct-a.pct;});
      bodyHtml += '<div style="margin-bottom:12px;">';
      bodyHtml += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Subsectors</div>';
      subResults.forEach(function(r){
        var color=r.pct>=0?'var(--green)':'var(--red)';
        var bg=r.pct>=0?'var(--green-bg)':'var(--red-bg)';
        bodyHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-radius:5px;background:'+bg+';margin-bottom:2px;">';
        bodyHtml += '<div><span class="ticker-link" style="font-size:13px;" title="Click for chart" onclick="openTVChart(\''+r.etf+'\')">'+r.etf+'</span> <span style="font-size:12px;color:var(--text-muted);">'+r.name+'</span></div>';
        bodyHtml += '<span style="font-size:13px;font-weight:800;font-family:var(--font-mono);color:'+color+';">'+(r.pct>=0?'+':'')+r.pct.toFixed(1)+'%</span>';
        bodyHtml += '</div>';
      });
      bodyHtml += '</div>';
    }
    // Top stocks
    if(stocks.length > 0) {
      var stockSnap = {};
      for(var bi=0;bi<stocks.length;bi+=15){ try{Object.assign(stockSnap,await getSnapshots(stocks.slice(bi,bi+15)));}catch(e){} }
      var leaders = [];
      for(var si=0;si<stocks.length;si++){
        var t=stocks[si],ss=stockSnap[t]; if(!ss)continue;
        var pr=ss.day&&ss.day.c&&ss.day.c>0?ss.day.c:(ss.prevDay&&ss.prevDay.c?ss.prevDay.c:(ss.lastTrade?ss.lastTrade.p:0));
        var pv=ss.prevDay?ss.prevDay.c:pr;
        var dayPct=pv>0?((pr-pv)/pv)*100:0;
        var vol=ss.day?ss.day.v:0; var prevVol=ss.prevDay?ss.prevDay.v:0; var volVsAvg=prevVol>0?(vol/prevVol):0;
        leaders.push({ticker:t,price:pr,dayPct:dayPct,vol:vol,volVsAvg:volVsAvg});
      }
      leaders.sort(function(a,b){return b.dayPct-a.dayPct;});
      var topLeaders = leaders.slice(0,8);
      if(topLeaders.length > 0) {
        bodyHtml += '<div>';
        bodyHtml += '<div style="font-size:12px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Top Stocks</div>';
        bodyHtml += '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 10px;font-size:11px;font-weight:700;color:var(--text-muted);padding:0 10px 4px;text-transform:uppercase;">';
        bodyHtml += '<span>Ticker</span><span style="text-align:right;">Price</span><span style="text-align:right;">Day %</span><span style="text-align:right;">Vol</span></div>';
        topLeaders.forEach(function(l){
          var c=l.dayPct>=0?'var(--green)':'var(--red)'; var bg=l.dayPct>=0?'var(--green-bg)':'var(--red-bg)';
          var volStr=l.vol>=1e6?(l.vol/1e6).toFixed(1)+'M':l.vol>=1e3?(l.vol/1e3).toFixed(0)+'K':l.vol.toString();
          bodyHtml += '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 10px;padding:5px 10px;border-radius:5px;background:'+bg+';align-items:center;margin-bottom:2px;">';
          bodyHtml += '<span class="ticker-link" style="font-size:13px;" title="Click for chart" onclick="openTVChart(\''+l.ticker+'\')">'+l.ticker+'</span>';
          bodyHtml += '<span style="font-size:13px;font-family:var(--font-mono);color:var(--text-secondary);text-align:right;">$'+l.price.toFixed(2)+'</span>';
          bodyHtml += '<span style="font-size:13px;font-weight:800;font-family:var(--font-mono);color:'+c+';text-align:right;">'+(l.dayPct>=0?'+':'')+l.dayPct.toFixed(1)+'%</span>';
          bodyHtml += '<span style="font-size:13px;font-family:var(--font-mono);color:var(--text-muted);text-align:right;">'+volStr+'</span>';
          bodyHtml += '</div>';
        });
        bodyHtml += '</div>';
      }
    }
    var bodyEl = document.getElementById('rrg-popup-body');
    if(bodyEl) bodyEl.innerHTML = bodyHtml || '<div style="padding:10px;color:var(--text-muted);">No data available for this sector</div>';
  } catch(e) {
    var bodyEl = document.getElementById('rrg-popup-body');
    if(bodyEl) bodyEl.innerHTML = '<div style="color:var(--red);">Failed to load sector data</div>';
  }
}

// ==================== RRG SECTOR DETAIL (click dot → show subsectors + leaders) ====================
var _rrgDetailEtf = null;
var _rrgDetailCache = {};
async function showRRGSectorDetail(sectorEtf) {
  var el = document.getElementById('rrg-sector-detail');
  if (!el) return;
  // Toggle off if same sector clicked again
  if (_rrgDetailEtf === sectorEtf && el.style.display !== 'none') {
    el.style.display = 'none';
    _rrgDetailEtf = null;
    return;
  }
  _rrgDetailEtf = sectorEtf;
  el.style.display = 'block';

  // Find sector info from global data
  var secInfo = null;
  (window._sectorData || []).forEach(function(s) { if (s.etf === sectorEtf) secInfo = s; });
  var subs = (window._subsectorMap || {})[sectorEtf] || [];
  var stocks = (window._sectorStocks || {})[sectorEtf] || [];

  // Header with sector name + performance
  var pctColor = secInfo && secInfo.dayChg >= 0 ? 'var(--green)' : 'var(--red)';
  var wkColor = secInfo && secInfo.weekPerf >= 0 ? 'var(--green)' : 'var(--red)';
  var headerHtml = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
  headerHtml += '<div style="display:flex;align-items:center;gap:8px;">';
  headerHtml += '<span class="ticker-link" style="font-size:14px;" title="Click for chart" onclick="openTVChart(\'' + sectorEtf + '\')">' + sectorEtf + '</span>';
  headerHtml += '<span style="font-size:14px;font-weight:600;color:var(--text-secondary);">' + (secInfo ? secInfo.name : '') + '</span>';
  headerHtml += '</div>';
  headerHtml += '<div style="display:flex;align-items:center;gap:12px;">';
  if (secInfo) {
    headerHtml += '<span style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:' + pctColor + ';">' + (secInfo.dayChg >= 0 ? '+' : '') + secInfo.dayChg.toFixed(1) + '%</span>';
    headerHtml += '<span style="font-size:12px;color:' + wkColor + ';">Wk: ' + (secInfo.weekPerf >= 0 ? '+' : '') + secInfo.weekPerf.toFixed(1) + '%</span>';
  }
  headerHtml += '<button onclick="document.getElementById(\'rrg-sector-detail\').style.display=\'none\'" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:0 4px;">\u2715</button>';
  headerHtml += '</div></div>';

  // Check cache
  if (_rrgDetailCache[sectorEtf]) {
    el.innerHTML = headerHtml + _rrgDetailCache[sectorEtf];
    return;
  }

  el.innerHTML = headerHtml + '<div style="text-align:center;padding:10px;font-size:12px;color:var(--text-muted);">Loading sector data...</div>';

  try {
    var html = '';

    // ── SUBSECTOR ETFs ──
    if (subs.length > 0) {
      var subTickers = subs.map(function(s) { return s.etf; });
      var subSnap = await getSnapshots(subTickers);
      var subResults = [];
      for (var i = 0; i < subs.length; i++) {
        var sub = subs[i];
        var s = subSnap[sub.etf];
        var p = 0, prev = 0, pctVal = 0;
        if (s) {
          p = s.day && s.day.c && s.day.c > 0 ? s.day.c : (s.prevDay && s.prevDay.c ? s.prevDay.c : (s.lastTrade ? s.lastTrade.p : 0));
          prev = s.prevDay ? s.prevDay.c : p;
          if (prev > 0) pctVal = ((p - prev) / prev) * 100;
        }
        subResults.push({ etf: sub.etf, name: sub.name, pct: pctVal });
      }
      subResults.sort(function(a, b) { return b.pct - a.pct; });

      html += '<div style="margin-bottom:10px;">';
      html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Subsectors</div>';
      html += '<div style="display:grid;gap:3px;">';
      subResults.forEach(function(r) {
        var color = r.pct >= 0 ? 'var(--green)' : 'var(--red)';
        var bg = r.pct >= 0 ? 'var(--green-bg)' : 'var(--red-bg)';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;border-radius:5px;background:' + bg + ';">';
        html += '<div style="font-size:13px;"><span class="ticker-link" style="font-size:13px;" title="Click for chart" onclick="openTVChart(\'' + r.etf + '\')">' + r.etf + '</span> <span style="color:var(--text-muted);">' + r.name + '</span></div>';
        html += '<span style="font-size:13px;font-weight:800;font-family:var(--font-mono);color:' + color + ';">' + (r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + '%</span>';
        html += '</div>';
      });
      html += '</div></div>';
    }

    // ── TREND LEADERS ──
    if (stocks.length > 0) {
      var stockSnap = {};
      for (var bi = 0; bi < stocks.length; bi += 15) {
        try { Object.assign(stockSnap, await getSnapshots(stocks.slice(bi, bi + 15))); } catch(e) {}
      }
      var leaders = [];
      for (var si = 0; si < stocks.length; si++) {
        var t = stocks[si];
        var ss = stockSnap[t];
        if (!ss) continue;
        var pr = ss.day && ss.day.c && ss.day.c > 0 ? ss.day.c : (ss.prevDay && ss.prevDay.c ? ss.prevDay.c : (ss.lastTrade ? ss.lastTrade.p : 0));
        var pv = ss.prevDay ? ss.prevDay.c : pr;
        var dayPct = pv > 0 ? ((pr - pv) / pv) * 100 : 0;
        var vol = ss.day ? ss.day.v : 0;
        var prevVol = ss.prevDay ? ss.prevDay.v : 0;
        var volVsAvg = prevVol > 0 ? (vol / prevVol) : 0;
        leaders.push({ ticker: t, price: pr, dayPct: dayPct, vol: vol, volVsAvg: volVsAvg });
      }
      leaders.sort(function(a, b) { return b.dayPct - a.dayPct; });
      var topLeaders = leaders.slice(0, 5);

      if (topLeaders.length > 0) {
        html += '<div>';
        html += '<div style="font-size:12px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Trend Leaders</div>';
        html += '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 10px;font-size:12px;font-weight:700;color:var(--text-muted);padding:0 10px 3px;text-transform:uppercase;letter-spacing:.03em;">';
        html += '<span>Ticker</span><span style="text-align:right;">Price</span><span style="text-align:right;">Day %</span><span style="text-align:right;">Vol</span>';
        html += '</div>';
        topLeaders.forEach(function(l) {
          var c = l.dayPct >= 0 ? 'var(--green)' : 'var(--red)';
          var bg = l.dayPct >= 0 ? 'var(--green-bg)' : 'var(--red-bg)';
          var volStr = l.vol >= 1000000 ? (l.vol / 1000000).toFixed(1) + 'M' : l.vol >= 1000 ? (l.vol / 1000).toFixed(0) + 'K' : l.vol.toString();
          var volColor = l.volVsAvg >= 1.5 ? 'var(--blue)' : 'var(--text-muted)';
          html += '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 10px;padding:5px 10px;border-radius:5px;background:' + bg + ';align-items:center;">';
          html += '<span class="ticker-link" style="font-size:13px;" title="Click for chart" onclick="openTVChart(\'' + l.ticker + '\')">' + l.ticker + '</span>';
          html += '<span style="font-size:13px;font-family:var(--font-mono);color:var(--text-secondary);text-align:right;">$' + l.price.toFixed(2) + '</span>';
          html += '<span style="font-size:13px;font-weight:800;font-family:var(--font-mono);color:' + c + ';text-align:right;">' + (l.dayPct >= 0 ? '+' : '') + l.dayPct.toFixed(1) + '%</span>';
          html += '<span style="font-size:13px;font-family:var(--font-mono);color:' + volColor + ';text-align:right;">' + volStr + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }
    }

    _rrgDetailCache[sectorEtf] = html || '<div style="padding:6px;font-size:12px;color:var(--text-muted);text-align:center;">No data available</div>';
    el.innerHTML = headerHtml + _rrgDetailCache[sectorEtf];
  } catch (e) {
    el.innerHTML = headerHtml + '<div style="padding:6px;font-size:12px;color:var(--red);">Failed to load sector data</div>';
  }
}

// Subsector expand/collapse (legacy — kept for compatibility)
var _subsectorLoaded = {};
async function toggleSubsectors(sectorEtf) {
  var el = document.getElementById('subsector-' + sectorEtf);
  if (!el) return;
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  if (_subsectorLoaded[sectorEtf]) return;

  var subs = (window._subsectorMap || {})[sectorEtf] || [];
  var stocks = (window._sectorStocks || {})[sectorEtf] || [];
  if (subs.length === 0 && stocks.length === 0) { el.style.display = 'none'; return; }

  el.innerHTML = '<div style="padding:8px 4px;font-size:12px;color:var(--text-muted);text-align:center;">Loading sector data...</div>';

  try {
    var html = '';

    // ── SUBSECTOR ETFs ──
    if (subs.length > 0) {
      var subTickers = subs.map(function(s) { return s.etf; });
      var subSnap = await getSnapshots(subTickers);
      var subResults = [];
      for (var i = 0; i < subs.length; i++) {
        var sub = subs[i];
        var s = subSnap[sub.etf];
        var p = 0, prev = 0, pctVal = 0;
        if (s) {
          p = s.day && s.day.c && s.day.c > 0 ? s.day.c : (s.prevDay && s.prevDay.c ? s.prevDay.c : (s.lastTrade ? s.lastTrade.p : 0));
          prev = s.prevDay ? s.prevDay.c : p;
          if (prev > 0) pctVal = ((p - prev) / prev) * 100;
        }
        subResults.push({ etf: sub.etf, name: sub.name, pct: pctVal });
      }
      subResults.sort(function(a, b) { return b.pct - a.pct; });

      html += '<div style="padding:6px 6px 2px;">';
      html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Subsectors</div>';
      html += '<div style="display:grid;gap:2px;">';
      subResults.forEach(function(r) {
        var color = r.pct >= 0 ? 'var(--green)' : 'var(--red)';
        var bg = r.pct >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-radius:4px;background:' + bg + ';">';
        html += '<div style="font-size:12px;"><span style="font-weight:800;font-family:var(--font-mono);color:var(--text-primary);">' + r.etf + '</span> <span style="color:var(--text-muted);">' + r.name + '</span></div>';
        html += '<span style="font-size:12px;font-weight:800;font-family:var(--font-mono);color:' + color + ';">' + (r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + '%</span>';
        html += '</div>';
      });
      html += '</div></div>';
    }

    // ── TREND LEADERS (top stocks in sector) ──
    if (stocks.length > 0) {
      // Fetch snapshots + 20-day bars for RS calculation
      var stockSnap = {};
      for (var bi = 0; bi < stocks.length; bi += 15) {
        try { Object.assign(stockSnap, await getSnapshots(stocks.slice(bi, bi + 15))); } catch(e) {}
      }
      // Also get SPY for relative strength
      var spyRef = stockSnap['SPY'] || null;
      if (!spyRef) { try { var spyS = await getSnapshots(['SPY']); spyRef = spyS['SPY']; } catch(e) {} }

      var leaders = [];
      for (var si = 0; si < stocks.length; si++) {
        var t = stocks[si];
        var ss = stockSnap[t];
        if (!ss) continue;
        var pr = ss.day && ss.day.c && ss.day.c > 0 ? ss.day.c : (ss.prevDay && ss.prevDay.c ? ss.prevDay.c : (ss.lastTrade ? ss.lastTrade.p : 0));
        var pv = ss.prevDay ? ss.prevDay.c : pr;
        var dayPct = pv > 0 ? ((pr - pv) / pv) * 100 : 0;
        var vol = ss.day ? ss.day.v : 0;
        // Volume vs avg (simple: use prevDay volume as rough proxy)
        var prevVol = ss.prevDay ? ss.prevDay.v : 0;
        var volVsAvg = prevVol > 0 ? (vol / prevVol) : 0;
        leaders.push({ ticker: t, price: pr, dayPct: dayPct, vol: vol, volVsAvg: volVsAvg });
      }
      // Sort by day % change descending (best performers first)
      leaders.sort(function(a, b) { return b.dayPct - a.dayPct; });
      var topLeaders = leaders.slice(0, 5);

      if (topLeaders.length > 0) {
        html += '<div style="padding:6px 6px 4px;">';
        html += '<div style="font-size:12px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Trend Leaders</div>';
        // Table header
        html += '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 8px;font-size:12px;font-weight:700;color:var(--text-muted);padding:0 8px 2px;text-transform:uppercase;letter-spacing:.03em;">';
        html += '<span>Ticker</span><span style="text-align:right;">Price</span><span style="text-align:right;">Day %</span><span style="text-align:right;">Vol</span>';
        html += '</div>';
        // Rows
        topLeaders.forEach(function(l) {
          var c = l.dayPct >= 0 ? 'var(--green)' : 'var(--red)';
          var bg = l.dayPct >= 0 ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)';
          var volStr = l.vol >= 1000000 ? (l.vol / 1000000).toFixed(1) + 'M' : l.vol >= 1000 ? (l.vol / 1000).toFixed(0) + 'K' : l.vol.toString();
          var volColor = l.volVsAvg >= 1.5 ? 'var(--blue)' : 'var(--text-muted)';
          html += '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 8px;padding:4px 8px;border-radius:4px;background:' + bg + ';align-items:center;">';
          html += '<span style="font-size:12px;font-weight:800;font-family:var(--font-mono);color:var(--text-primary);">' + l.ticker + '</span>';
          html += '<span style="font-size:12px;font-family:var(--font-mono);color:var(--text-secondary);text-align:right;">$' + l.price.toFixed(2) + '</span>';
          html += '<span style="font-size:12px;font-weight:800;font-family:var(--font-mono);color:' + c + ';text-align:right;">' + (l.dayPct >= 0 ? '+' : '') + l.dayPct.toFixed(1) + '%</span>';
          html += '<span style="font-size:12px;font-family:var(--font-mono);color:' + volColor + ';text-align:right;">' + volStr + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }
    }

    el.innerHTML = html || '<div style="padding:6px;font-size:12px;color:var(--text-muted);text-align:center;">No data available</div>';
    _subsectorLoaded[sectorEtf] = true;
  } catch (e) {
    el.innerHTML = '<div style="padding:6px 4px;font-size:12px;color:var(--red);">Failed to load sector data</div>';
  }
}
function toggleBreadth(){
  var body=document.getElementById('breadth-content'),arrow=document.getElementById('breadth-arrow');
  if(!body)return;var h=body.style.display==='none';body.style.display=h?'':'none';
  if(arrow)arrow.textContent=h?'\u25bc':'\u25b6';
  try{localStorage.setItem('mac_breadth_collapsed',h?'false':'true');}catch(e){}
}

function toggleMindset(){
  var body=document.getElementById('mindset-body'),arrow=document.getElementById('mindset-arrow');
  if(!body)return;var h=body.style.display==='none';body.style.display=h?'':'none';
  if(arrow)arrow.textContent=h?'▼':'▶';
  try{localStorage.setItem('mcc_mindset_collapsed',h?'false':'true');}catch(e){}
}

// ==================== RENDER THEMES HTML (new format: movers + why + industries) ====================
function renderThemesHTML(data, cacheTs) {
  var html='';var time=new Date(cacheTs).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">Updated '+time+'</div>';

  // Market narrative (if present)
  if(data.narrative){
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:12px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;border-left:3px solid var(--blue);">' + escapeHtml(data.narrative) + '</div>';
  }

  // ── INDUSTRY HEAT CHECK (show first for quick scan) ──
  if(data.industries && data.industries.length>0){
    html += '<div style="font-size:12px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Industry Heat Check</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">';
    data.industries.forEach(function(ind){
      var isUp=ind.direction==='up';
      var c=isUp?'var(--green)':'var(--red)';
      var bg=isUp?'rgba(16,185,129,0.06)':'rgba(239,68,68,0.06)';
      var arrow=isUp?'▲':'▼';
      html += '<div style="background:'+bg+';border:1px solid '+c+'20;border-radius:8px;padding:8px 12px;min-width:140px;flex:1;max-width:220px;">';
      html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">';
      html += '<span style="font-size:12px;color:'+c+';font-weight:800;">'+arrow+'</span>';
      html += '<span style="font-size:14px;font-weight:800;color:var(--text-primary);">'+escapeHtml(ind.name||'')+'</span>';
      html += '</div>';
      if(ind.tickers && ind.tickers.length>0){
        html += '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:3px;">';
        ind.tickers.forEach(function(t){html += '<span class="ticker-link" style="font-size:12px;" title="Click for chart" onclick="openTVChart(\''+escapeHtml(t)+'\');">'+escapeHtml(t)+'</span>';});
        html += '</div>';
      }
      if(ind.note) html += '<div style="font-size:14px;color:var(--text-muted);line-height:1.3;">'+escapeHtml(ind.note||'')+'</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  var movers = data.movers || [];
  var winners = movers.filter(function(m){return m.direction==='up';});
  var losers = movers.filter(function(m){return m.direction==='down';});

  // Helper: render sector/industry badge
  function sectorBadge(m){
    var s='';
    if(m.industry) s += '<span style="font-size:12px;font-weight:600;padding:1px 5px;border-radius:3px;background:rgba(124,58,237,0.08);color:var(--purple);margin-left:auto;">' + escapeHtml(m.industry||'') + '</span>';
    else if(m.sector) s += '<span style="font-size:12px;font-weight:600;padding:1px 5px;border-radius:3px;background:var(--bg-secondary);color:var(--text-muted);margin-left:auto;">' + escapeHtml(m.sector||'') + '</span>';
    return s;
  }

  // Winners
  if(winners.length>0){
    html += '<div style="font-size:12px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Winners</div>';
    html += '<div style="display:grid;gap:6px;margin-bottom:12px;">';
    winners.forEach(function(m){
      html += '<div style="background:rgba(16,185,129,0.04);box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);border-radius:12px;padding:12px 14px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
      html += '<span style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:var(--text-primary);">' + escapeHtml(m.ticker) + '</span>';
      html += '<span style="font-size:14px;font-weight:800;color:var(--green);font-family:var(--font-mono);">+' + Math.abs(m.pct).toFixed(1) + '%</span>';
      html += sectorBadge(m);
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;">' + escapeHtml(m.reason||'') + '</div>';
      if(m.tags && m.tags.length>0){
        html += '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;">';
        m.tags.forEach(function(tag){html += '<span style="font-size:12px;font-weight:600;padding:1px 5px;border-radius:3px;background:rgba(16,185,129,0.1);color:var(--green);">' + escapeHtml(tag) + '</span>';});
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Losers
  if(losers.length>0){
    html += '<div style="font-size:12px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Losers</div>';
    html += '<div style="display:grid;gap:6px;margin-bottom:8px;">';
    losers.forEach(function(m){
      html += '<div style="background:rgba(239,68,68,0.04);box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);border-radius:12px;padding:12px 14px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
      html += '<span style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:var(--text-primary);">' + escapeHtml(m.ticker) + '</span>';
      html += '<span style="font-size:14px;font-weight:800;color:var(--red);font-family:var(--font-mono);">' + (m.pct<0?'':'-') + Math.abs(m.pct).toFixed(1) + '%</span>';
      html += sectorBadge(m);
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;">' + escapeHtml(m.reason||'') + '</div>';
      if(m.tags && m.tags.length>0){
        html += '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;">';
        m.tags.forEach(function(tag){html += '<span style="font-size:12px;font-weight:600;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,0.08);color:var(--red);">' + escapeHtml(tag) + '</span>';});
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Theme groupings (if AI grouped them)
  if(data.themes && data.themes.length>0){
    html += '<div style="font-size:12px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;margin-top:4px;">Key Themes</div>';
    html += '<div style="display:grid;gap:6px;">';
    data.themes.forEach(function(theme,i){
      var colors=['var(--blue)','var(--purple)','var(--cyan)'];var bgs=['rgba(37,99,235,0.05)','rgba(124,58,237,0.05)','rgba(8,145,178,0.05)'];
      var c=colors[i%colors.length],bg=bgs[i%bgs.length];
      html += '<div style="background:'+bg+';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);border-radius:10px;padding:10px 14px;border-left:3px solid '+c+'">';
      html += '<div style="font-size:14px;font-weight:800;color:var(--text-primary);">'+escapeHtml(theme.title||'')+'</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.4;margin-top:2px;">'+escapeHtml(theme.description||'')+'</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  return html;
}

// Legacy renderer (for old cached data that has themes array only)
function renderLegacyThemesHTML(themes, cacheTs) {
  var html='';var time=new Date(cacheTs).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Generated '+time+'</div>';
  html += '<div style="display:grid;gap:8px;">';
  themes.forEach(function(theme,i){
    var colors=['var(--blue)','var(--purple)','var(--cyan)'];var bgs=['rgba(37,99,235,0.05)','rgba(124,58,237,0.05)','rgba(8,145,178,0.05)'];
    var c=colors[i%colors.length],bg=bgs[i%bgs.length];
    html += '<div style="background:'+bg+';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);border-radius:12px;padding:12px 14px;border-left:3px solid '+c+'">';
    html += '<div style="font-size:14px;font-weight:800;color:var(--text-primary);margin-bottom:3px;">'+escapeHtml(theme.title||'Theme '+(i+1))+'</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:5px;">'+escapeHtml(theme.description||'')+'</div>';
    if(theme.tickers&&theme.tickers.length>0){
      html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
      theme.tickers.forEach(function(t){html += '<span class="ticker-link" style="font-size:12px;" title="Click for chart" onclick="openTVChart(\''+escapeHtml(t)+'\');">'+escapeHtml(t)+'</span>';});
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';return html;
}

// ==================== RENDER TOP IDEAS HTML ====================
function renderTopIdeasHTML(ideas, cacheTs) {
  var html='';var time=new Date(cacheTs).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Last scan: '+time+'</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:8px;">';
  ideas.forEach(function(idea){
    var sc=idea.score>=80?'var(--green)':idea.score>=60?'var(--blue)':idea.score>=40?'var(--amber)':'var(--text-muted)';
    var sbg=idea.score>=80?'rgba(16,185,129,0.06)':idea.score>=60?'rgba(37,99,235,0.04)':'rgba(245,158,11,0.04)';
    html += '<div style="background:'+sbg+';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:12px;padding:14px 16px;border-left:3px solid '+sc+'">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += '<span class="ticker-link" style="font-size:14px;" title="Click for chart" onclick="event.stopPropagation();openTVChart(\''+idea.ticker+'\');">'+idea.ticker+'</span>';
    var _itl=idea.tickerType==='ETF'?'ETF':'Stock';var _itbg=idea.tickerType==='ETF'?'var(--amber-bg)':'var(--blue-bg)';var _itc=idea.tickerType==='ETF'?'var(--amber)':'var(--blue)';
    html += '<span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:'+_itbg+';color:'+_itc+';">'+_itl+'</span>';
    html += '<span style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:var(--text-secondary);">$'+(idea.price?idea.price.toFixed(2):'—')+'</span>';
    html += '</div>';
    html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:2px solid '+sc+';font-size:12px;font-weight:900;color:'+sc+';font-family:var(--font-mono);">'+idea.score+'</div>';
    html += '</div>';
    if(idea.source) html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">via '+idea.source+'</div>';
    if(idea.thesis) html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.4;margin-bottom:6px;">'+idea.thesis.replace(/</g,'&lt;')+'</div>';
    if(idea.industry||idea.atr||idea.mcap){
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;padding:4px 6px;background:var(--bg-secondary);border-radius:3px;">';
      if(idea.industry) html += '<span style="color:var(--text-muted);">'+idea.industry+'</span>';
      if(idea.atr) html += '<span style="color:var(--text-muted);">ATR <span style="font-family:var(--font-mono);font-weight:700;color:var(--text-secondary);padding:1px 5px;border:1px solid var(--border);border-radius:3px;">$'+idea.atr.toFixed(2)+'</span></span>';
      if(idea.mcap) html += '<span style="color:var(--text-muted);">Mkt Cap <span style="font-family:var(--font-mono);font-weight:700;color:var(--text-secondary);padding:1px 5px;border:1px solid var(--border);border-radius:3px;">'+(idea.mcap>=1e12?'$'+(idea.mcap/1e12).toFixed(1)+'T':idea.mcap>=1e9?'$'+(idea.mcap/1e9).toFixed(1)+'B':idea.mcap>=1e6?'$'+(idea.mcap/1e6).toFixed(0)+'M':'$'+idea.mcap)+'</span></span>';
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';return html;
}

// ==================== GENERATE THEMES (scan movers → news → AI explains WHY) ====================
async function generateThemes() {
  var btn=document.getElementById('generate-themes-btn'),el=document.getElementById('themes-content');
  if(!el)return;if(btn){btn.textContent='Scanning...';btn.disabled=true;}
  el.innerHTML='<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;"><span id="theme-progress">Finding biggest movers...</span></div>';

  if(!window._currentSession){el.innerHTML='<div style="padding:12px;text-align:center;color:var(--amber);font-size:12px;">Log in to generate themes.</div>';if(btn){btn.textContent='Scan';btn.disabled=false;}return;}

  try{
    // Step 1: Scan a universe of ~80 popular tickers for biggest % movers
    var universe=['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM','NFLX','COIN','SNOW','PLTR','DKNG','UBER','SQ','SHOP','NET','CRWD','MU','MRVL','ANET','PANW','NOW','ADBE','ORCL','LLY','UNH','JPM','GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA','MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML','WMT','COST','TGT','DIS','PYPL','INTC','DELL','PARA','DUOL','ZS','AXP','RIVN','LCID','NIO','BABA','JD','SE','GRAB','MELI','SPOT','RBLX','U','ABNB','DASH','TTD','ROKU','PINS','SNAP','LYFT','Z'];
    var allSnap={};var prog=document.getElementById('theme-progress');
    for(var bi=0;bi<universe.length;bi+=30){
      if(prog)prog.textContent='Fetching data... ('+(bi+1)+'/'+universe.length+')';
      try{Object.assign(allSnap,await getSnapshots(universe.slice(bi,bi+30)));}catch(e){}
    }

    // Step 2: Rank by absolute % change
    var ranked=[];
    universe.forEach(function(t){
      var s=allSnap[t];if(!s)return;
      var p=s.day&&s.day.c?s.day.c:(s.lastTrade?s.lastTrade.p:0);var prev=s.prevDay?s.prevDay.c:p;
      if(!p||!prev)return;
      var pctVal=((p-prev)/prev)*100;
      ranked.push({ticker:t,price:p,pct:pctVal,absPct:Math.abs(pctVal)});
    });
    ranked.sort(function(a,b){return b.absPct-a.absPct;});

    // Take top ~10 movers (mix of winners and losers)
    var topMovers=ranked.slice(0,12);
    if(topMovers.length===0){el.innerHTML='<div style="text-align:center;padding:14px;color:var(--text-muted);font-size:12px;">No significant movers found.</div>';if(btn){btn.textContent='Scan';btn.disabled=false;}return;}

    // Step 3: Fetch news for each mover ticker
    if(prog)prog.textContent='Fetching news for movers...';
    var moverNews={};
    for(var ni=0;ni<topMovers.length;ni++){
      try{var articles=await getPolygonNews([topMovers[ni].ticker],5);moverNews[topMovers[ni].ticker]=articles.map(function(a){return a.title||'';}).filter(function(t){return t.length>0;});}catch(e){moverNews[topMovers[ni].ticker]=[];}
    }

    // Also get general market news for broader context
    var generalNews=[];
    try{var gn=await getPolygonNews(null,15);generalNews=gn.map(function(a){return (a.title||'')+' ('+((a.tickers||[]).slice(0,3).join(', '))+')';}).filter(function(t){return t.length>2;});}catch(e){}

    // Step 4: Build structured payload for ai-proxy edge function
    var moverPayload=topMovers.map(function(m){
      return {ticker:m.ticker,pct:m.pct,close:m.price,newsHeadlines:moverNews[m.ticker]||[]};
    });

    // Get market context
    var marketCtx='';
    try{var idxSnap=await getSnapshots(['SPY','QQQ','IWM']);marketCtx=['SPY','QQQ','IWM'].map(function(t){var s=idxSnap[t];if(!s)return t+': N/A';var p=s.day&&s.day.c?s.day.c:0;var prev=s.prevDay?s.prevDay.c:p;return t+': $'+p.toFixed(2)+' ('+(prev>0?((p-prev)/prev*100>=0?'+':'')+((p-prev)/prev*100).toFixed(2)+'%':'N/A')+')';}).join(' | ');}catch(e){}

    if(prog)prog.textContent='AI analyzing movers...';

    // Step 5: Send structured task to ai-proxy (prompt built server-side)
    var data=await callAIProxy({task:'generate_themes',movers:moverPayload,marketContext:marketCtx,generalNews:generalNews.slice(0,8).join('\n')});
    var text=data.content&&data.content[0]?data.content[0].text:'';
    var jsonMatch=text.match(/\{[\s\S]*\}/);if(!jsonMatch)throw new Error('Parse failed');
    var result=JSON.parse(jsonMatch[0]);

    // Cache the result
    result.ts=Date.now();
    try{localStorage.setItem('mac_themes_'+new Date().toISOString().split('T')[0],JSON.stringify(result));}catch(e){}
    el.innerHTML=renderThemesHTML(result,Date.now());
  }catch(e){
    el.innerHTML='<div style="padding:10px;color:var(--red);font-size:14px;">Failed: '+escapeHtml(e.message)+'</div>';
  }
  if(btn){btn.textContent='Scan';btn.disabled=false;}
}

// ==================== QUICK SCAN ====================
async function runQuickScan() {
  var el=document.getElementById('top-ideas-content');
  if(!el)return;
  el.innerHTML='<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">Scanning top tickers... <span id="qs-progress"></span></div>';
  try{
    var qt=['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM','NFLX','COIN','SNOW','PLTR','DKNG','UBER','SQ','SHOP','NET','CRWD','MU','MRVL','ANET','PANW','NOW','ADBE','ORCL','LLY','UNH','JPM','GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA','MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML'];
    var allSnap={};for(var bi=0;bi<qt.length;bi+=30){try{Object.assign(allSnap,await getSnapshots(qt.slice(bi,bi+30)));}catch(e){}}
    var ideas=[];
    for(var qi=0;qi<qt.length;qi++){
      var ticker=qt[qi];var prog=document.getElementById('qs-progress');if(prog)prog.textContent=(qi+1)+'/'+qt.length;
      try{var bars=await getDailyBars(ticker,60);if(bars.length<20)continue;
        var s=allSnap[ticker];var p=0,prev=0;if(s){p=s.day&&s.day.c?s.day.c:(s.lastTrade?s.lastTrade.p:0);prev=s.prevDay?s.prevDay.c:p;}if(!p)continue;
        var closes=bars.map(function(b){return b.c;});var len=closes.length;
        function qSma(pd){if(len<pd)return null;var sm=0;for(var i=len-pd;i<len;i++)sm+=closes[i];return sm/pd;}
        var sma10=qSma(10),sma20=qSma(20),sma50=qSma(50);if(!sma10||!sma20)continue;
        var spread=Math.abs(sma10-sma20)/p*100;var aboveBoth=p>sma10&&p>sma20;var ext=((p-sma20)/sma20)*100;
        var rvol=null;if(bars.length>=21){var avgV=bars.slice(-21,-1).reduce(function(sum,b){return sum+(b.v||0);},0)/20;var tV=s&&s.day?s.day.v:0;if(avgV>0&&tV>0)rvol=tV/avgV;}
        var score=0;if(spread<=1)score+=30;else if(spread<=2)score+=22;else if(spread<=3)score+=15;else if(spread<=5)score+=8;else continue;
        if(aboveBoth)score+=15;if(sma50&&p>sma50)score+=10;
        if(ext<=2)score+=25;else if(ext<=4)score+=18;else if(ext<=6)score+=10;else if(ext<=8)score+=4;else score-=5;
        if(rvol){if(rvol>=2)score+=10;else if(rvol>=1.5)score+=7;else if(rvol>=1)score+=4;}
        var dayChg=prev>0?((p-prev)/prev)*100:0;if(dayChg>1)score+=5;else if(dayChg>0)score+=2;
        score=Math.round(Math.min(100,Math.max(0,score)));if(score<30)continue;
        var thesis='';if(spread<=2)thesis+='Tight compression ('+spread.toFixed(1)+'%). ';if(aboveBoth)thesis+='Above 10/20 SMA. ';if(ext<=3)thesis+='Near base ('+ext.toFixed(1)+'%). ';if(rvol&&rvol>=1.5)thesis+=rvol.toFixed(1)+'x volume. ';
        // ATR from bars
        var qAtr=null;if(bars.length>=15){var trS=0;for(var ai=bars.length-14;ai<bars.length;ai++){var tr=bars[ai].h-bars[ai].l;if(ai>0)tr=Math.max(tr,Math.abs(bars[ai].h-bars[ai-1].c),Math.abs(bars[ai].l-bars[ai-1].c));trS+=tr;}qAtr=Math.round((trS/14)*100)/100;}
        ideas.push({ticker:ticker,price:p,score:score,source:'Compression',thesis:thesis,atr:qAtr});
      }catch(e){continue;}
    }
    ideas.sort(function(a,b){return b.score-a.score;});ideas=ideas.slice(0,4);
    // Fetch industry + market cap for top ideas
    if(ideas.length>0){
      var detailPromises=ideas.map(function(idea){return polyGet('/v3/reference/tickers/'+idea.ticker).then(function(d){var r=d.results||{};return{ticker:idea.ticker,mc:r.market_cap||null,ind:r.sic_description||null,type:r.type||null};}).catch(function(){return{ticker:idea.ticker,mc:null,ind:null,type:null};});});
      var detailResults=await Promise.all(detailPromises);
      detailResults.forEach(function(r){var idea=ideas.find(function(i){return i.ticker===r.ticker;});if(idea){idea.mcap=r.mc;idea.industry=r.ind;idea.tickerType=r.type;}});
    }
    try{localStorage.setItem('mac_top_ideas_'+new Date().toISOString().split('T')[0],JSON.stringify({ideas:ideas,ts:Date.now()}));}catch(e){}
    el.innerHTML=ideas.length>0?renderTopIdeasHTML(ideas,Date.now()):'<div style="text-align:center;padding:14px;color:var(--text-muted);font-size:12px;">No strong setups found. Try full scanners.</div>';
  }catch(e){el.innerHTML='<div style="color:var(--red);font-size:12px;">Scan failed: '+escapeHtml(e.message)+'</div>';}
}

// Auto-scan Top Ideas every 15 min during market hours
var _topIdeasAutoTimer=null;
function startTopIdeasAutoScan(){
  if(_topIdeasAutoTimer)return;
  // Run initial scan if no fresh cache
  var ideaKey='mac_top_ideas_'+new Date().toISOString().split('T')[0];
  var cached=localStorage.getItem(ideaKey);
  var needsScan=!cached;
  if(cached){try{var d=JSON.parse(cached);if(Date.now()-d.ts>15*60*1000)needsScan=true;}catch(e){needsScan=true;}}
  if(needsScan)setTimeout(function(){runQuickScan();},2000);
  // Refresh every 15 min
  _topIdeasAutoTimer=setInterval(function(){
    var now=new Date();var h=now.getHours(),m=now.getMinutes();var et=h*60+m;
    // Only scan during extended market hours (9:00 AM - 4:30 PM ET approximation)
    if(et>=540&&et<=990) runQuickScan();
  },15*60*1000);
}

// ==================== ECONOMIC CALENDAR (auto-fetch) ====================
async function loadEconCalendar() {
  var el=document.getElementById('econ-cal-grid');if(!el)return;

  // Cache key: week-based, 4hr TTL
  var today=new Date();var dow=today.getDay();var monday=new Date(today);monday.setDate(today.getDate()-(dow===0?6:dow-1));
  var cacheKey='mac_econ_cal_auto_'+monday.toISOString().split('T')[0];
  var cached=null;
  try{var raw=localStorage.getItem(cacheKey);if(raw){cached=JSON.parse(raw);
    // Check 4hr TTL
    if(cached.ts && (Date.now()-cached.ts)<4*60*60*1000 && cached.events){
      renderAutoEconCal(el,cached.events,cached.ts);return;
    }
  }}catch(e){}

  el.innerHTML='<div style="font-size:12px;color:var(--text-muted);">Fetching calendar...</div>';

  try {
    // Fetch through Vercel rewrite to avoid CORS (same-origin request)
    var resp=await fetch('/api/econ-calendar');
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    var data=await resp.json();

    // Filter: USD only, Medium + High impact
    var events=data.filter(function(ev){
      return ev.country==='USD' && (ev.impact==='High' || ev.impact==='Medium');
    });

    // Group by day
    var grouped={};
    events.forEach(function(ev){
      var d=ev.date?ev.date.split('T')[0]:'Unknown';
      if(!grouped[d])grouped[d]=[];
      grouped[d].push(ev);
    });

    // Cache it
    var cacheData={events:grouped,ts:Date.now()};
    try{localStorage.setItem(cacheKey,JSON.stringify(cacheData));}catch(e){}

    renderAutoEconCal(el,grouped,Date.now());
  } catch(e) {
    el.innerHTML='<div style="font-size:14px;color:var(--red);">Failed to load calendar: '+escapeHtml(e.message)+'</div>';
  }
}

function renderAutoEconCal(el, grouped, ts) {
  var html='';
  var dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var _now=new Date();var today=_now.getFullYear()+'-'+String(_now.getMonth()+1).padStart(2,'0')+'-'+String(_now.getDate()).padStart(2,'0');
  var sortedDays=Object.keys(grouped).sort();

  if(sortedDays.length===0){
    el.innerHTML='<div style="font-size:12px;color:var(--text-muted);">No USD Medium/High impact events this week.</div>';
    return;
  }

  // Horizontal layout: days side by side
  var cols=sortedDays.length;
  html += '<div class="ov-econ-grid" style="display:grid;grid-template-columns:repeat('+cols+',1fr);gap:8px;">';

  sortedDays.forEach(function(day,idx){
    var dt=new Date(day+'T12:00:00');
    var dayLabel=dayNames[dt.getDay()]+' '+dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    var isToday=day===today;
    var altBg=idx%2===0?'var(--bg-secondary)':'var(--bg-card)';

    html += '<div style="min-width:0;background:'+(isToday?'var(--blue-bg)':altBg)+';border-radius:8px;padding:10px 8px;'+(isToday?'border:1px solid var(--blue);':'border:1px solid var(--border);')+'text-align:center;">';
    html += '<div style="font-size:12px;font-weight:700;color:'+(isToday?'var(--blue)':'var(--text-muted)')+';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;white-space:nowrap;">'+(isToday?'\u25CF ':'')+dayLabel+(isToday?' (Today)':'')+'</div>';

    grouped[day].forEach(function(ev){
      var isHigh=ev.impact==='High';
      var dot=isHigh?'var(--red)':'var(--amber)';
      var time='';
      if(ev.date){
        try{var evDate=new Date(ev.date);if(!isNaN(evDate.getTime())){time=evDate.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'});}}catch(e){}
      }

      html += '<div style="margin-bottom:8px;">';
      html += '<div style="display:flex;align-items:center;justify-content:center;gap:4px;">';
      html += '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:'+dot+';flex-shrink:0;"></span>';
      html += '<div style="color:var(--text-primary);font-weight:600;font-size:14px;line-height:1.3;">'+((ev.title||'').replace(/</g,'&lt;'))+'</div>';
      html += '</div>';
      if(time) html += '<div style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px;margin-top:2px;">'+time+' ET</div>';

      // Forecast / Previous
      var details=[];
      if(ev.forecast!==undefined&&ev.forecast!==null&&ev.forecast!=='') details.push('F: '+ev.forecast);
      if(ev.previous!==undefined&&ev.previous!==null&&ev.previous!=='') details.push('P: '+ev.previous);
      if(details.length>0) html += '<div style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px;margin-top:1px;">'+details.join(' \xb7 ')+'</div>';

      html += '</div>';
    });
    html += '</div>';
  });
  html += '</div>';

  html += '<div style="margin-top:6px;font-size:12px;color:var(--text-muted);">Updated '+new Date(ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})+'</div>';
  el.innerHTML=html;
}

// ==================== TODAY'S RECAP ====================

function renderRecapHTML(data) {
  var html = '';
  // Bias badge
  if (data.bias) {
    var bDir = (data.bias.direction || 'neutral').toLowerCase();
    var bColor = bDir === 'bullish' ? 'var(--green)' : bDir === 'bearish' ? 'var(--red)' : 'var(--amber)';
    var bBg = bDir === 'bullish' ? 'var(--green-bg)' : bDir === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">';
    html += '<span style="font-size:12px;font-weight:800;padding:4px 10px;border-radius:6px;background:'+bBg+';color:'+bColor+';text-transform:uppercase;letter-spacing:.06em;">'+bDir+'</span>';
    if (data.bias.keyLevel) html += '<span style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);">'+escapeHtml(data.bias.keyLevel)+'</span>';
    html += '</div>';
    if (data.bias.reasoning) html += '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;font-style:italic;">'+escapeHtml(data.bias.reasoning)+'</div>';
  }
  // Summary
  if (data.summary) {
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px;">'+escapeHtml(data.summary)+'</div>';
  }
  // Key movers
  if (data.movers && data.movers.length > 0) {
    html += '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">Key Movers</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">';
    data.movers.forEach(function(m) {
      var pctColor = m.pct >= 0 ? 'var(--green)' : 'var(--red)';
      html += '<div style="display:flex;align-items:baseline;gap:8px;font-size:13px;">';
      html += '<span style="font-weight:700;color:var(--text-primary);font-family:var(--font-mono);min-width:50px;">'+escapeHtml(m.ticker)+'</span>';
      html += '<span style="font-weight:700;color:'+pctColor+';font-family:var(--font-mono);min-width:50px;">'+(m.pct>=0?'+':'')+m.pct.toFixed(1)+'%</span>';
      if (m.volume) html += '<span style="color:var(--text-muted);font-size:11px;">'+escapeHtml(m.volume)+' vol</span>';
      html += '</div>';
      if (m.note) html += '<div style="font-size:12px;color:var(--text-muted);margin-left:0;margin-bottom:2px;line-height:1.4;">'+escapeHtml(m.note)+'</div>';
    });
    html += '</div>';
  }
  // Tomorrow's watchlist
  if (data.watchlist && data.watchlist.length > 0) {
    html += '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">Tomorrow\'s Watchlist</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
    data.watchlist.forEach(function(w) {
      var dirColor = w.direction === 'long' ? 'var(--green)' : w.direction === 'short' ? 'var(--red)' : 'var(--blue)';
      html += '<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:8px 12px;min-width:140px;flex:1;">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
      html += '<span style="font-weight:700;font-family:var(--font-mono);font-size:13px;color:var(--text-primary);">'+escapeHtml(w.ticker)+'</span>';
      html += '<span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:'+dirColor+'15;color:'+dirColor+';text-transform:uppercase;">'+escapeHtml(w.direction||'watch')+'</span>';
      html += '</div>';
      if (w.level) html += '<div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">'+escapeHtml(w.level)+'</div>';
      if (w.thesis) html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;line-height:1.3;">'+escapeHtml(w.thesis)+'</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  // Timestamp
  if (data.ts) {
    html += '<div style="font-size:11px;color:var(--text-muted);text-align:right;">Generated '+new Date(data.ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})+' ET</div>';
  }
  return html;
}

async function generateRecap() {
  var el = document.getElementById('recap-content');
  if (!el && document.getElementById('recap-body')) {
    el = document.getElementById('recap-body');
  }
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:20px;"><div style="font-size:13px;color:var(--text-muted);">Generating recap...</div><div style="margin-top:8px;height:3px;background:var(--bg-secondary);border-radius:2px;overflow:hidden;"><div style="width:60%;height:100%;background:var(--blue);border-radius:2px;animation:pulse 1.5s infinite;"></div></div></div>';

  try {
    // Build index data
    var idxData = window._indexData || [];
    var indicesStr = idxData.map(function(idx) {
      return idx.name + ': $' + idx.price.toFixed(2) + ' (' + (idx.pct>=0?'+':'') + idx.pct.toFixed(2) + '%)';
    }).join(' | ');
    if (!indicesStr) indicesStr = 'No index data available';

    // Build sector data
    var secData = window._sectorData || [];
    var sectorsStr = secData.map(function(s) {
      return s.name + ' (' + s.etf + '): ' + (s.dayChg>=0?'+':'') + s.dayChg.toFixed(2) + '%';
    }).join('\n');

    // Breadth
    var sectorsUp = secData.filter(function(s){return s.dayChg>0;}).length;
    var sectorsDown = secData.filter(function(s){return s.dayChg<0;}).length;
    var breadthStr = sectorsUp + '/' + secData.length + ' sectors green, ' + sectorsDown + '/' + secData.length + ' red. Regime: ' + (window._currentRegime || 'Unknown');

    // Determine the session date (last completed trading day)
    var _sd = (function() {
      var now = new Date();
      var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      var h = et.getHours(), dow = et.getDay();
      if (dow >= 1 && dow <= 5 && h < 16) et.setDate(et.getDate() - 1);
      while (et.getDay() === 0 || et.getDay() === 6) et.setDate(et.getDate() - 1);
      return et.getFullYear() + '-' + String(et.getMonth()+1).padStart(2,'0') + '-' + String(et.getDate()).padStart(2,'0');
    })();

    // Top movers from grouped daily (fetch via polygon-proxy)
    var moversStr = 'No mover data available';
    try {
      var gd = await polyGet('/v2/aggs/grouped/locale/us/market/stocks/' + _sd + '?adjusted=true');
      var bars = gd.results || [];
      var movers = [];
      bars.forEach(function(b) {
        if (!b.T || !b.c || !b.o || !b.v) return;
        if (b.T.length > 5 || b.T.indexOf('.') >= 0 || b.T.indexOf('-') >= 0) return;
        if (b.c < 10 || b.v < 1000000) return;
        var chg = ((b.c - b.o) / b.o) * 100;
        movers.push({ticker: b.T, pct: chg, price: b.c, vol: b.v});
      });
      movers.sort(function(a,b) { return Math.abs(b.pct) - Math.abs(a.pct); });
      var topMovers = movers.slice(0, 15);
      moversStr = topMovers.map(function(m) {
        var volStr = m.vol >= 1000000 ? (m.vol/1000000).toFixed(1) + 'M' : (m.vol/1000).toFixed(0) + 'K';
        return m.ticker + ' ' + (m.pct>=0?'+':'') + m.pct.toFixed(1) + '% ($' + m.price.toFixed(2) + ') Vol=' + volStr;
      }).join('\n');
    } catch(e) { /* grouped daily may not be available intraday */ }

    // Scanner setups
    var scannerStr = 'No scanner data available';
    try {
      var sr = localStorage.getItem('mac_scan_results');
      if (sr) {
        var scanData = JSON.parse(sr);
        var setups = scanData.setups || [];
        if (setups.length > 0) {
          scannerStr = setups.slice(0, 10).map(function(s) {
            return s.ticker + ' (' + (s.category||'SETUP') + ') Score=' + s.score + ' Entry=$' + (s.entryPrice||0).toFixed(2) + ' Target=$' + (s.targetPrice||0).toFixed(2);
          }).join('\n');
        }
      }
    } catch(e) {}

    var data = await callAIProxy({
      task: 'generate_recap',
      indices: indicesStr,
      breadth: breadthStr,
      sectors: sectorsStr,
      topMovers: moversStr,
      scannerSetups: scannerStr
    });

    // Parse response
    var text = data.content && data.content[0] ? data.content[0].text : '';
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');
    var recap = JSON.parse(jsonMatch[0]);
    recap.ts = Date.now();

    // Cache by session date
    try { localStorage.setItem('mac_recap_'+_sd, JSON.stringify(recap)); } catch(e) {}

    el.innerHTML = renderRecapHTML(recap);
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:16px;"><div style="color:var(--red);font-size:13px;">Failed to generate recap: '+escapeHtml(e.message)+'</div><button onclick="generateRecap()" class="refresh-btn" style="margin-top:8px;padding:6px 16px;font-size:12px;">Retry</button></div>';
  }
}
