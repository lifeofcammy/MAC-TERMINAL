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

// Restore breadth history from sessionStorage (survives page refreshes, clears on tab close)
(function restoreBreadthHistory() {
  try {
    var key = 'mac_breadth_history_' + new Date().toISOString().split('T')[0];
    var raw = sessionStorage.getItem(key);
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
  } catch(e) {}
})();

function saveBreadthHistory() {
  try {
    var key = 'mac_breadth_history_' + new Date().toISOString().split('T')[0];
    sessionStorage.setItem(key, JSON.stringify(_breadthHistory));
  } catch(e) {}
}

// Fetch breadth data only (lightweight — just the snapshot)
async function fetchBreadthData() {
  var up=0, down=0, flat=0;
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
  } catch(e) { console.warn('Breadth refresh failed:', e); return null; }
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
  html += '<div style="text-align:center;font-size:12px;color:var(--text-muted);margin-bottom:8px;">'+data.up+' advancing \xb7 '+data.down+' declining'+(data.flat>0?' \xb7 '+data.flat+' flat':'')+'</div>';
  // Bar
  html += '<div style="display:flex;height:20px;border-radius:6px;overflow:hidden;background:var(--bg-secondary);">';
  if(greenW>0) html += '<div style="width:'+greenW+'%;background:var(--green);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;">'+data.up+'</div>';
  if(flatW>0) html += '<div style="width:'+flatW+'%;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--text-muted);">'+data.flat+'</div>';
  if(redW>0) html += '<div style="width:'+redW+'%;background:var(--red);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;">'+data.down+'</div>';
  html += '</div>';
  // Footer: breadth % + last updated
  var updateLabel = _breadthLastUpdate ? _breadthLastUpdate.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'}) + ' ET' : getDataFreshnessLabel();
  html += '<div class="ov-breadth-footer" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:14px;color:var(--text-muted);">';
  html += '<span>Breadth: <span style="color:'+color+';font-weight:700;">'+pct+'%</span></span>';
  html += '<span style="font-size:12px;" id="breadth-updated-label">Updated '+updateLabel+'</span>';
  html += '</div>';
  // History timeline (if we have 2+ readings)
  html += renderBreadthTimeline();
  el.innerHTML = html;
  // Pulse animation on the updated label
  var lbl = document.getElementById('breadth-updated-label');
  if(lbl) { lbl.style.color='var(--blue)'; setTimeout(function(){ if(lbl) lbl.style.color='var(--text-muted)'; }, 1500); }
}

// Render the 15-min breadth direction timeline
// Each bar = green if breadth improved vs prior reading, red if it dropped
// Gives a quick visual: "is breadth expanding or contracting through the day?"
function renderBreadthTimeline() {
  if(_breadthHistory.length < 2) return '';
  var html = '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">';

  // Summary line: net direction
  var first = _breadthHistory[0].pct;
  var last = _breadthHistory[_breadthHistory.length-1].pct;
  var delta = last - first;
  var dirLabel = delta > 0 ? 'Expanding' : delta < 0 ? 'Contracting' : 'Flat';
  var dirColor = delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--text-muted)';
  var dirArrow = delta > 0 ? '\u25b2' : delta < 0 ? '\u25bc' : '\u25cf';

  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;">Breadth Direction</div>';
  html += '<span style="font-size:12px;font-weight:800;color:'+dirColor+';">'+dirArrow+' '+dirLabel+' ('+(delta>0?'+':'')+delta+'%)</span>';
  html += '</div>';

  // Direction bars: each bar is green (improving) or red (declining) vs previous
  // 26 slots = market hours 9:30-4:00 in 15-min intervals
  html += '<div style="display:flex;gap:2px;align-items:center;">';
  _breadthHistory.forEach(function(r, i) {
    var timeStr = r.time.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'});
    if(i === 0) {
      // First reading: neutral (no comparison)
      html += '<div style="flex:1;height:24px;border-radius:4px;background:var(--bg-secondary);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;min-width:0;" title="'+timeStr+': '+r.pct+'% (starting point)">';
      html += '<span style="font-size:12px;font-weight:700;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+r.pct+'</span>';
      html += '</div>';
    } else {
      var prev = _breadthHistory[i-1].pct;
      var diff = r.pct - prev;
      var barColor, barBg;
      if(diff > 0) { barColor = '#fff'; barBg = 'var(--green)'; }
      else if(diff < 0) { barColor = '#fff'; barBg = 'var(--red)'; }
      else { barColor = 'var(--text-muted)'; barBg = 'var(--bg-secondary)'; }
      var isLast = i === _breadthHistory.length - 1;
      html += '<div style="flex:1;height:24px;border-radius:4px;background:'+barBg+';display:flex;align-items:center;justify-content:center;min-width:0;opacity:'+(isLast?'1':'0.75')+';'+(isLast?'box-shadow:0 0 0 2px var(--bg-primary), 0 0 0 3px '+barBg+';':'')+'" title="'+timeStr+': '+r.pct+'% ('+(diff>0?'+':'')+diff+' vs prev)">';
      html += '<span style="font-size:12px;font-weight:800;color:'+barColor+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(diff>0?'+':'')+diff+'</span>';
      html += '</div>';
    }
  });
  html += '</div>';

  // Time labels + breadth values at edges
  html += '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-top:3px;">';
  var firstTime = _breadthHistory[0].time.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'});
  var lastTime = _breadthHistory[_breadthHistory.length-1].time.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'});
  html += '<span>'+firstTime+' ('+first+'%)</span>';
  html += '<span>'+lastTime+' ('+last+'%)</span>';
  html += '</div>';

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
  var w = canvas.parentElement.offsetWidth || 400;
  var h = 320;
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

  // Quadrant colors (very subtle)
  var qGreen = isDark ? 'rgba(52,211,153,0.06)' : 'rgba(52,211,153,0.08)';
  var qYellow = isDark ? 'rgba(245,158,11,0.06)' : 'rgba(245,158,11,0.08)';
  var qRed = isDark ? 'rgba(252,165,165,0.06)' : 'rgba(252,165,165,0.08)';
  var qBlue = isDark ? 'rgba(37,99,235,0.06)' : 'rgba(37,99,235,0.08)';

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

  // Quadrant labels
  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = isDark ? 'rgba(52,211,153,0.5)' : 'rgba(16,185,129,0.6)';
  ctx.textAlign = 'right';
  ctx.fillText('Leading', pad.left + plotW - 4, pad.top + 14);
  ctx.fillStyle = isDark ? 'rgba(245,158,11,0.5)' : 'rgba(217,119,6,0.6)';
  ctx.fillText('Weakening', pad.left + plotW - 4, pad.top + plotH - 4);
  ctx.fillStyle = isDark ? 'rgba(252,165,165,0.5)' : 'rgba(239,68,68,0.5)';
  ctx.textAlign = 'left';
  ctx.fillText('Lagging', pad.left + 4, pad.top + plotH - 4);
  ctx.fillStyle = isDark ? 'rgba(96,165,250,0.5)' : 'rgba(37,99,235,0.5)';
  ctx.fillText('Improving', pad.left + 4, pad.top + 14);

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

  // Draw trailing paths + dots for each asset
  data.forEach(function(d) {
    var color = d.isAssetClass ? assetColor : sectorColor;
    // Trail line
    if (d.trail.length > 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
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
        ctx.globalAlpha = 0.2 + (i / d.trail.length) * 0.4;
        ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Latest dot (bigger)
    var last = d.trail[d.trail.length - 1];
    var lx = xPos(last.ratio), ly = yPos(last.momentum);
    d._canvasXY = { x: lx, y: ly }; // Store for click detection
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
    // White ring
    ctx.strokeStyle = isDark ? '#1a1a2e' : '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.stroke();
    // Label
    ctx.font = '600 10px JetBrains Mono, monospace';
    ctx.fillStyle = labelBg;
    var tw = ctx.measureText(d.etf).width + 6;
    var lbx = lx + 6, lby = ly - 6;
    // Prevent label going off-screen
    if (lbx + tw > w - pad.right) lbx = lx - tw - 4;
    if (lby - 10 < pad.top) lby = ly + 14;
    ctx.fillRect(lbx - 2, lby - 10, tw, 13);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(d.etf, lbx + 1, lby);
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
    var regimeLabel='Neutral', regimeColor='var(--text-muted)', regimeDetail='';
    if(hasHighImpactEvent&&!isMarketOpen()){
      regimeLabel='Wait for '+eventName; regimeColor='var(--purple)';
      regimeDetail=eventName+' data expected \u2014 wait for the reaction before entering.';
    }
    else if(avgPct>0.8&&breadthPct>=65&&idxAboveBoth>=3){
      regimeLabel='Risk On'; regimeColor='var(--green)';
      regimeDetail='Broad strength. '+idxAboveBoth+'/4 indexes above 10 & 20 SMA. '+sectorsUp+'/'+sectorETFs.length+' sectors green. '+vixNote+'\n'+indexNotes;
    }
    else if(avgPct<-0.8&&breadthPct<=35&&idxBelowBoth>=3){
      regimeLabel='Risk Off'; regimeColor='var(--red)';
      regimeDetail='Broad weakness. '+idxBelowBoth+'/4 indexes below 10 & 20 SMA. '+sectorsDown+'/'+sectorETFs.length+' sectors red. '+vixNote+' Reduce size.\n'+indexNotes;
    }
    else if(Math.abs(avgPct)<0.3&&idxMixed>=2){
      regimeLabel='Choppy / Low Conviction'; regimeColor='var(--amber)';
      regimeDetail='Narrow range, mixed signals. '+idxAboveBoth+'/4 above both SMAs, '+idxBelowBoth+'/4 below both, '+idxMixed+'/4 mixed. '+vixNote+'\n'+indexNotes;
    }
    else if(avgPct>0.3||idxAboveBoth>=3){
      regimeLabel='Lean Bullish'; regimeColor='var(--green)';
      regimeDetail=idxAboveBoth+'/4 indexes above both SMAs. '+sectorsUp+'/'+sectorETFs.length+' sectors positive. '+vixNote+' Selective longs.\n'+indexNotes;
    }
    else if(avgPct<-0.3||idxBelowBoth>=3){
      regimeLabel='Lean Bearish'; regimeColor='var(--red)';
      regimeDetail=idxBelowBoth+'/4 indexes below both SMAs. '+sectorsDown+'/'+sectorETFs.length+' sectors negative. '+vixNote+' Cautious, reduce size.\n'+indexNotes;
    }
    else{
      regimeLabel='Neutral'; regimeColor='var(--text-muted)';
      regimeDetail='Mixed signals across indexes. '+idxAboveBoth+' above both SMAs, '+idxBelowBoth+' below both. '+vixNote+' A+ setups only.\n'+indexNotes;
    }
    if(hasHighImpactEvent&&isMarketOpen()) regimeDetail+=' \u26a0 '+eventName+' today \u2014 volatility expected.';
    window._currentRegime = regimeLabel;

    // 9. Render regime body
    var regimeBody = document.getElementById('regime-body');
    if(regimeBody) {
      var rHtml = '';
      rHtml += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+regimeColor+';margin-top:4px;flex-shrink:0;"></span>';
      rHtml += '<div style="min-width:0;flex:1;">';
      rHtml += '<div style="font-size:14px;font-weight:800;color:'+regimeColor+';">'+regimeLabel+'</div>';
      rHtml += '<div style="font-size:14px;color:var(--text-secondary);margin-top:2px;line-height:1.4;">'+regimeDetail.replace(/\n/g,'<br>')+'</div>';
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
  var container = document.getElementById('tab-overview');
  if (!container) return;
  var ts = getTimestamp();
  var live = isMarketOpen();

  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:14px;">Loading Overview...</div>';

  // ── TICKERS TO FETCH ──
  var indexTickers = ['SPY','QQQ','IWM','DIA'];
  var extraTickers = ['VIXY','UUP']; // VIX proxy via VIXY ETF, DXY proxy via UUP
  var sectorETFs = [
    {etf:'XLK',name:'Technology'},{etf:'SMH',name:'Semiconductors'},
    {etf:'XLF',name:'Financials'},{etf:'XLE',name:'Energy'},
    {etf:'XLV',name:'Healthcare'},{etf:'XLY',name:'Consumer Disc.'},
    {etf:'XLI',name:'Industrials'},{etf:'XLRE',name:'Real Estate'},
    {etf:'XLU',name:'Utilities'},{etf:'XLB',name:'Materials'},
    {etf:'XLC',name:'Comm. Services'},{etf:'XLP',name:'Consumer Staples'}
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
    {etf:'BITO',name:'Bitcoin'},{etf:'TLT',name:'Bonds (20Y+)'},
    {etf:'HYG',name:'High Yield'},{etf:'EFA',name:'Intl Developed'},
    {etf:'EEM',name:'Emerging Mkts'},{etf:'GLD',name:'Gold'}
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
  html += '<div onclick="toggleMindset()" style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:pointer;user-select:none;">';
  html += '<span style="width:20px;"></span>';
  html += '<div style="text-align:center;"><span class="card-header-bar">Morning Mindset</span><div style="font-size:12px;color:var(--text-muted);font-weight:500;margin-top:1px;">Set your mental game before the market opens</div></div>';
  html += '<span id="mindset-arrow" style="width:20px;text-align:right;font-size:12px;color:var(--text-muted);">'+(mindsetCollapsed?'▶':'▼')+'</span>';
  html += '</div>';
  // Today's Focus — ALWAYS visible
  html += '<div style="padding:0 16px 10px;"><div style="background:var(--bg-secondary);border:1px solid rgba(230,138,0,0.2);border-radius:6px;padding:10px 14px;">';
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
  if(hasHighImpactEvent&&!live){
    regimeLabel='Wait for '+eventName;regimeColor='var(--purple)';
    regimeDetail=eventName+' data expected — wait for the reaction before entering.';
  }
  else if(avgPct>0.8&&breadthPct>=65&&idxAboveBoth>=3){
    regimeLabel='Risk On';regimeColor='var(--green)';
    regimeDetail='Broad strength. '+idxAboveBoth+'/4 indexes above 10 & 20 SMA. '+sectorsUp+'/'+sectorData.length+' sectors green. '+vixLine+'\n'+indexNotes;
  }
  else if(avgPct<-0.8&&breadthPct<=35&&idxBelowBoth>=3){
    regimeLabel='Risk Off';regimeColor='var(--red)';
    regimeDetail='Broad weakness. '+idxBelowBoth+'/4 indexes below 10 & 20 SMA. '+sectorsDown+'/'+sectorData.length+' sectors red. '+vixLine+' Reduce size.\n'+indexNotes;
  }
  else if(Math.abs(avgPct)<0.3&&idxMixed>=2){
    regimeLabel='Choppy / Low Conviction';regimeColor='var(--amber)';
    regimeDetail='Narrow range, mixed signals. '+idxAboveBoth+'/4 above both SMAs, '+idxBelowBoth+'/4 below both, '+idxMixed+'/4 mixed. '+vixLine+'\n'+indexNotes;
  }
  else if(avgPct>0.3||idxAboveBoth>=3){
    regimeLabel='Lean Bullish';regimeColor='var(--green)';
    regimeDetail=idxAboveBoth+'/4 indexes above both SMAs. '+sectorsUp+'/'+sectorData.length+' sectors positive. '+vixLine+' Selective longs.\n'+indexNotes;
  }
  else if(avgPct<-0.3||idxBelowBoth>=3){
    regimeLabel='Lean Bearish';regimeColor='var(--red)';
    regimeDetail=idxBelowBoth+'/4 indexes below both SMAs. '+sectorsDown+'/'+sectorData.length+' sectors negative. '+vixLine+' Cautious, reduce size.\n'+indexNotes;
  }
  else{
    regimeLabel='Neutral';regimeColor='var(--text-muted)';
    regimeDetail='Mixed signals across indexes. '+idxAboveBoth+' above both SMAs, '+idxBelowBoth+' below both. '+vixLine+' A+ setups only.\n'+indexNotes;
  }
  if(hasHighImpactEvent&&live) regimeDetail+=' ⚠ '+eventName+' today — volatility expected.';
  window._currentRegime = regimeLabel;

  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'regime\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">';
  html += '<div style="flex:1;"></div>';
  html += '<div style="flex:none;text-align:center;"><div style="font-size:16px;font-weight:800;color:var(--blue);margin-bottom:4px;">Step 1</div><div class="card-header-bar">Market Regime</div><div style="font-size:14px;color:var(--blue);font-weight:600;margin-top:2px;">Is the market risk-on or risk-off? This sets your aggression level.</div></div>';
  html += '<div style="flex:1;display:flex;align-items:center;justify-content:flex-end;"><span id="regime-arrow" style="font-size:12px;color:var(--text-muted);">'+(regimeCollapsed?'▶':'▼')+'</span></div>';
  html += '</div>';
  html += '<div id="regime-body" style="'+(regimeCollapsed?'display:none;':'display:flex;')+'padding:14px 20px;align-items:flex-start;gap:12px;">';
  html += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+regimeColor+';margin-top:4px;flex-shrink:0;"></span>';
  html += '<div style="min-width:0;flex:1;">';
  html += '<div style="font-size:14px;font-weight:800;color:'+regimeColor+';">'+regimeLabel+'</div>';
  html += '<div style="font-size:14px;color:var(--text-secondary);margin-top:2px;line-height:1.4;">'+regimeDetail.replace(/\n/g,'<br>')+'</div>';
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
    html += '<div class="card" style="padding:0;margin-bottom:14px;overflow:hidden;">';
    html += '<div style="padding:12px 20px;">';
    html += '<div style="text-align:center;margin-bottom:4px;"><div style="font-size:16px;font-weight:800;color:var(--blue);margin-bottom:4px;">Step 2</div><div class="card-header-bar">Stock Breadth</div><div style="font-size:14px;color:var(--blue);font-weight:600;margin-top:2px;">Is the move broad or narrow? Confirms if the regime call is real.</div></div>';
    // Gauge bar
    html += '<div style="margin-top:10px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
    html += '<span style="font-size:12px;font-weight:700;color:var(--green);">'+adBreadthPct+'% Up</span>';
    html += '<span style="font-size:14px;font-weight:800;color:'+breadthColor+';">'+breadthLabel+'</span>';
    html += '<span style="font-size:12px;font-weight:700;color:var(--red);">'+(100-adBreadthPct)+'% Down</span>';
    html += '</div>';
    html += '<div style="height:8px;border-radius:4px;background:var(--red-bg);overflow:hidden;">';
    html += '<div style="height:100%;width:'+adBreadthPct+'%;background:var(--green);border-radius:4px;transition:width 0.3s;"></div>';
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text-muted);text-align:center;margin-top:4px;">'+adStocksUp.toLocaleString()+' advancing · '+adStocksDown.toLocaleString()+' declining · '+adStocksFlat.toLocaleString()+' flat</div>';
    html += '</div>';
    html += '</div></div>';
  }

  // ════ 4. MARKET ANALYSIS (renamed from Snapshot — smaller quotes) ════
  var snapshotCollapsed = localStorage.getItem('mac_snapshot_collapsed')!=='false';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'snapshot\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">';
  html += '<div style="flex:1;"></div>';
  html += '<div style="flex:none;text-align:center;"><div style="font-size:16px;font-weight:800;color:var(--blue);margin-bottom:4px;">Step 3</div><div class="card-header-bar">Market Analysis</div><div style="font-size:14px;color:var(--blue);font-weight:600;margin-top:2px;">How are the major indexes reacting? Now you know what to do.</div></div>';
  html += '<div style="flex:1;display:flex;align-items:center;justify-content:flex-end;gap:8px;"><span style="font-size:12px;color:var(--text-muted);font-family:var(--font-body);">'+dataFreshness+'</span><span id="snapshot-arrow" style="font-size:12px;color:var(--text-muted);">'+(snapshotCollapsed?'\u25b6':'\u25bc')+'</span></div>';
  html += '</div>';
  html += '<div id="snapshot-body" style="'+(snapshotCollapsed?'display:none;':'')+'padding:12px 16px;">';
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
  html += '</div>';
  html += '</div>';
  html += '</div>';

  // ════ 5. SECTOR HEATMAP (collapsible) ════
  var heatmapCollapsed = localStorage.getItem('mac_heatmap_collapsed')!=='false';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleHeatmap()" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">';
  html += '<div style="flex:1;"></div>';
  html += '<div style="flex:none;text-align:center;"><div style="font-size:16px;font-weight:800;color:var(--blue);margin-bottom:4px;">Step 4</div><div class="card-header-bar">Sector Heatmap</div><div style="font-size:14px;color:var(--blue);font-weight:600;margin-top:2px;">Where is money flowing? Find the strongest and weakest sectors.</div></div>';
  html += '<div style="flex:1;display:flex;align-items:center;justify-content:flex-end;gap:8px;"><span style="font-size:12px;color:var(--text-muted);font-family:var(--font-body);">'+dataFreshness+'</span><span id="heatmap-arrow" style="font-size:12px;color:var(--text-muted);">'+(heatmapCollapsed?'\u25b6':'\u25bc')+'</span></div>';
  html += '</div>';
  html += '<div id="heatmap-body" style="'+(heatmapCollapsed?'display:none;':'')+'">';
  // Store maps globally for the expand function
  window._subsectorMap = subsectorMap;
  window._sectorStocks = sectorStocks;

  html += '<div class="ov-heatmap-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:12px 14px;">';
  sectorData.forEach(function(sec){
    var chgColor,chgBg;
    if(sec.dayChg>1){chgColor='var(--text-primary)';chgBg='var(--green-bg)';}
    else if(sec.dayChg>0.3){chgColor='var(--text-primary)';chgBg='var(--green-bg)';}
    else if(sec.dayChg>0){chgColor='var(--text-primary)';chgBg='var(--green-bg)';}
    else if(sec.dayChg>-0.3){chgColor='var(--text-primary)';chgBg='var(--red-bg)';}
    else if(sec.dayChg>-1){chgColor='var(--text-primary)';chgBg='var(--red-bg)';}
    else{chgColor='var(--text-primary)';chgBg='var(--red-bg)';}
    var hasSubsectors = subsectorMap[sec.etf] && subsectorMap[sec.etf].length > 0;
    html += '<div style="cursor:'+(hasSubsectors?'pointer':'default')+';" '+(hasSubsectors?'onclick="toggleSubsectors(\''+sec.etf+'\')"':'')+'>';
    var pctColor = sec.dayChg >= 0 ? 'var(--green)' : 'var(--red)';
    var wkPctColor = sec.weekPerf >= 0 ? 'var(--green)' : 'var(--red)';
    html += '<div style="background:'+chgBg+';border-radius:6px;padding:10px;text-align:center;">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">'+sec.etf+'</div>';
    html += '<div style="font-size:12px;color:var(--text-muted);">'+sec.name+'</div>';
    html += '<div style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:'+pctColor+';margin-top:3px;">'+pct(sec.dayChg)+'</div>';
    html += '<div style="font-size:12px;color:'+wkPctColor+';opacity:0.8;margin-top:1px;">Wk: '+pct(sec.weekPerf)+'</div>';
    if(hasSubsectors) html += '<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">tap to expand</div>';
    html += '</div>';
    // Subsector expansion area (hidden by default)
    html += '<div id="subsector-'+sec.etf+'" style="display:none;"></div>';
    html += '</div>';
  });
  html += '</div>'; // close heatmap grid

  // ── RELATIVE ROTATION GRAPH (RRG) ──
  // Calculate RRG data for sectors + asset classes
  var allRRGAssets = sectorETFs.map(function(s){ return {etf:s.etf, name:s.name, isAsset:false}; })
    .concat(rrgAssets.map(function(s){ return {etf:s.etf, name:s.name, isAsset:true}; }));
  var rrgData = calcRRGData(allRRGAssets, spyBars, _barsByTicker);
  window._rrgData = rrgData;

  html += '<div style="padding:10px 14px;border-top:1px solid var(--border);">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;text-align:center;">Relative Rotation</div>';
  if(rrgData.length > 0) {
    html += '<div style="position:relative;"><canvas id="rrg-canvas" style="width:100%;border-radius:8px;"></canvas></div>';
    // Legend
    html += '<div style="display:flex;justify-content:center;gap:16px;margin-top:6px;font-size:12px;">';
    html += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--blue);"></span><span style="color:var(--text-muted);">Sectors</span></span>';
    html += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--amber);"></span><span style="color:var(--text-muted);">Asset Classes</span></span>';
    html += '</div>';
  } else {
    html += '<div style="text-align:center;padding:12px;font-size:12px;color:var(--text-muted);">Insufficient data for RRG (need 15+ trading days)</div>';
  }
  html += '<div style="font-size:12px;color:var(--text-muted);text-align:center;margin-top:4px;">Relative strength vs SPY \u2014 clockwise rotation through quadrants</div>';
  html += '</div>';

  html += '</div></div>'; // close heatmap-body, close card

  // ════ 6. TODAY'S CATALYSTS + THEMES ════
  var catalystsCollapsed = localStorage.getItem('mac_catalysts_collapsed')!=='false';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'catalysts\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">';
  html += '<div style="flex:1;"></div>';
  html += '<div style="flex:none;text-align:center;"><div style="font-size:16px;font-weight:800;color:var(--blue);margin-bottom:4px;">Step 5</div><div class="card-header-bar">Catalysts & Themes</div><div style="font-size:14px;color:var(--blue);font-weight:600;margin-top:2px;">What events and narratives are driving today\'s price action?</div></div>';
  html += '<div style="flex:1;display:flex;align-items:center;justify-content:flex-end;gap:8px;"><span style="font-size:12px;color:var(--text-muted);">'+tsLabel(ts)+'</span><span id="catalysts-arrow" style="font-size:12px;color:var(--text-muted);">'+(catalystsCollapsed?'\u25b6':'\u25bc')+'</span></div>';
  html += '</div>';
  html += '<div id="catalysts-body" style="'+(catalystsCollapsed?'display:none;':'')+'">';
  // Econ calendar
  html += '<div style="padding:10px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Economic Calendar</div>';
  html += '<div id="econ-cal-grid" style="font-size:12px;color:var(--text-muted);">Loading...</div>';
  html += '</div>';
  // ════ TODAY'S THEMES (inside Catalysts card) ════
  html += '<div style="padding:10px 16px;border-top:1px solid var(--border);">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;">Today\'s Themes</div>';
  html += '<button id="generate-themes-btn" onclick="generateThemes()" class="refresh-btn" style="padding:4px 10px;font-size:12px;">Scan</button>';
  html += '</div>';
  html += '<div id="themes-content">';
  var cachedThemes=null;
  try{var themeKey='mac_themes_'+new Date().toISOString().split('T')[0];var themeData=localStorage.getItem(themeKey);if(themeData)cachedThemes=JSON.parse(themeData);}catch(e){}
  if(cachedThemes&&cachedThemes.movers){html+=renderThemesHTML(cachedThemes,cachedThemes.ts);}
  else if(cachedThemes&&cachedThemes.themes){html+=renderLegacyThemesHTML(cachedThemes.themes,cachedThemes.ts);}
  else{html += '<div style="font-size:14px;color:var(--text-muted);">'+(window._currentSession?'Auto-loading themes...':'Log in to auto-generate themes.')+'</div>';}
  html += '</div></div>';
  html += '</div>'; // close catalysts-body
  html += '</div>'; // close Catalysts+Themes card

  // ════ 7. TOP IDEAS (from scanners) ════
  var ideasCollapsed = localStorage.getItem('mac_ideas_collapsed')!=='false';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'ideas\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">';
  html += '<div style="flex:1;"></div>';
  html += '<div style="flex:none;text-align:center;"><div style="font-size:16px;font-weight:800;color:var(--blue);margin-bottom:4px;">Step 6</div><div class="card-header-bar">Top Ideas</div><div style="font-size:14px;color:var(--blue);font-weight:600;margin-top:2px;">Highest-scored setups from today\'s scan. Your shortlist.</div></div>';
  html += '<div style="flex:1;display:flex;align-items:center;justify-content:flex-end;gap:8px;"><button onclick="event.stopPropagation();runQuickScan()" id="quick-scan-btn" class="refresh-btn" style="padding:4px 10px;font-size:12px;">Scan</button><span id="ideas-arrow" style="font-size:12px;color:var(--text-muted);">'+(ideasCollapsed?'\u25b6':'\u25bc')+'</span></div>';
  html += '</div>';
  html += '<div id="ideas-body" style="'+(ideasCollapsed?'display:none;':'')+'">';
  html += '<div id="top-ideas-content" style="padding:12px 16px;">';
  var cachedIdeas=null;
  try{var ideaKey='mac_top_ideas_'+new Date().toISOString().split('T')[0];var ideaData=localStorage.getItem(ideaKey);if(ideaData)cachedIdeas=JSON.parse(ideaData);}catch(e){}
  if(cachedIdeas&&cachedIdeas.ideas&&cachedIdeas.ideas.length>0){html+=renderTopIdeasHTML(cachedIdeas.ideas,cachedIdeas.ts);}
  else{html += '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">Click "Scan" to find today\'s top setups.</div>';}
  html += '</div></div></div>';

  // ════ 8. WATCHLIST ════
  var watchlistCollapsed = localStorage.getItem('mac_watchlist_collapsed')!=='false';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleCard(\'watchlist\')" style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">';
  html += '<div style="flex:1;"></div>';
  html += '<div style="flex:none;text-align:center;"><div class="card-header-bar">Watchlist</div><div style="font-size:14px;color:var(--blue);font-weight:600;margin-top:2px;">Your personal tickers with bias, notes, and live prices.</div></div>';
  var wList = getWatchlist();
  html += '<div style="flex:1;display:flex;justify-content:flex-end;align-items:center;gap:8px;">';
  if(wList.length>0) html += '<button onclick="event.stopPropagation();clearWatchlist();refreshWatchlistUI();" class="refresh-btn" style="padding:4px 10px;font-size:12px;">Clear All</button>';
  html += '<span id="watchlist-arrow" style="font-size:12px;color:var(--text-muted);">'+(watchlistCollapsed?'\u25b6':'\u25bc')+'</span>';
  html += '</div>';
  html += '</div>';
  html += '<div id="watchlist-body" style="'+(watchlistCollapsed?'display:none;':'')+'">';
  // Add form
  html += '<div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:center;flex-wrap:wrap;">';
  html += '<input type="text" id="wl-ticker-input" placeholder="TICKER" maxlength="5" style="width:70px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-family:var(--font-mono);font-size:14px;font-weight:700;color:var(--text-primary);text-transform:uppercase;" onkeydown="if(event.key===\'Enter\'){addToWatchlist();refreshWatchlistUI();}" />';
  html += '<select id="wl-bias-select" style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:5px 6px;font-size:14px;font-weight:600;color:var(--text-primary);">';
  html += '<option value="long">\u25b2 Long</option><option value="short">\u25bc Short</option><option value="watch">\u25cf Watch</option></select>';
  html += '<input type="text" id="wl-note-input" placeholder="Notes..." style="flex:1;min-width:120px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:14px;color:var(--text-primary);" onkeydown="if(event.key===\'Enter\'){addToWatchlist();refreshWatchlistUI();}" />';
  html += '<button onclick="addToWatchlist();refreshWatchlistUI();" class="refresh-btn" style="padding:6px 14px;font-size:12px;">+ Add</button>';
  html += '</div>';
  // Watchlist items
  html += '<div id="watchlist-content" style="padding:10px 16px;">';
  if(wList.length===0) {
    html += '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:14px;">No tickers. Add symbols above to track them.</div>';
  } else {
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;">';
    wList.forEach(function(item){
      var biasColor = item.bias==='long'?'var(--green)':item.bias==='short'?'var(--red)':'var(--amber)';
      var biasIcon = item.bias==='long'?'\u25b2':item.bias==='short'?'\u25bc':'\u25cf';
      html += '<div class="wl-card-'+item.ticker+'" style="box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:12px;padding:14px;border-left:3px solid '+biasColor+';position:relative;">';
      html += '<button onclick="removeFromWatchlist(\''+item.ticker+'\');refreshWatchlistUI();" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;">\u00d7</button>';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
      html += '<span style="font-size:14px;font-weight:800;font-family:var(--font-mono);cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px;" title="Click for chart" onclick="event.stopPropagation();openTVChart(\''+item.ticker+'\');">'+item.ticker+'</span>';
      html += '<span style="font-size:12px;font-weight:700;padding:1px 5px;border-radius:3px;background:'+biasColor+'15;color:'+biasColor+';">'+biasIcon+' '+item.bias.toUpperCase()+'</span>';
      html += '<span class="wl-price-'+item.ticker+'" style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:var(--text-muted);">Loading...</span>';
      html += '</div>';
      if(item.note) html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.3;font-style:italic;">'+item.note.replace(/</g,'&lt;')+'</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div></div></div>';

  container.innerHTML = html;
  // Render RRG canvas (must be after innerHTML so canvas element exists)
  if(window._rrgData && window._rrgData.length > 0) {
    setTimeout(function(){
      renderRRGCanvas('rrg-canvas');
      // Click handler: find nearest dot → open TradingView chart
      var rrgEl = document.getElementById('rrg-canvas');
      if(rrgEl) {
        rrgEl.style.cursor = 'pointer';
        rrgEl.title = 'Click a ticker to view chart';
        rrgEl.addEventListener('click', function(e){
          var rect = rrgEl.getBoundingClientRect();
          var mx = e.clientX - rect.left, my = e.clientY - rect.top;
          // Find closest dot
          var closest = null, minDist = 20; // 20px threshold
          (window._rrgData||[]).forEach(function(d){
            if(!d._canvasXY) return;
            var dx = mx - d._canvasXY.x, dy = my - d._canvasXY.y;
            var dist = Math.sqrt(dx*dx + dy*dy);
            if(dist < minDist){ minDist = dist; closest = d; }
          });
          if(closest && typeof openTVChart === 'function') openTVChart(closest.etf);
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
  // Auto-generate themes if no cache and user is logged in
  if(!cachedThemes && window._currentSession){
    setTimeout(function(){ generateThemes(); }, 500);
  }
}

// ==================== WATCHLIST PARTIAL REFRESH ====================
// Only re-renders the watchlist content + header buttons without reloading entire Overview
function refreshWatchlistUI() {
  var wList = getWatchlist();
  // Update content area
  var contentEl = document.getElementById('watchlist-content');
  if (contentEl) {
    var html = '';
    if (wList.length === 0) {
      html += '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:14px;">No tickers. Add symbols above to track them.</div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;">';
      wList.forEach(function(item) {
        var biasColor = item.bias==='long'?'var(--green)':item.bias==='short'?'var(--red)':'var(--amber)';
        var biasIcon = item.bias==='long'?'▲':item.bias==='short'?'▼':'●';
        html += '<div class="wl-card-'+item.ticker+'" style="box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:12px;padding:14px;border-left:3px solid '+biasColor+';position:relative;">';
        html += '<button onclick="removeFromWatchlist(\''+item.ticker+'\');refreshWatchlistUI();" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;">×</button>';
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
        html += '<span style="font-size:14px;font-weight:800;font-family:var(--font-mono);cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px;" title="Click for chart" onclick="event.stopPropagation();openTVChart(\''+item.ticker+'\');">'+item.ticker+'</span>';
        html += '<span style="font-size:12px;font-weight:700;padding:1px 5px;border-radius:3px;background:'+biasColor+'15;color:'+biasColor+';">'+biasIcon+' '+item.bias.toUpperCase()+'</span>';
        html += '<span class="wl-price-'+item.ticker+'" style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:var(--text-muted);">Loading...</span>';
        html += '</div>';
        if(item.note) html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.3;font-style:italic;">'+item.note.replace(/</g,'&lt;')+'</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    contentEl.innerHTML = html;
    loadWatchlistPrices();
  }
  // Re-focus the ticker input for quick consecutive adds
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
function toggleHeatmap(){toggleCard('heatmap');}

// Subsector expand/collapse — fetches subsector ETFs + top trending stocks
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
function toggleMindset(){
  var body=document.getElementById('mindset-body'),arrow=document.getElementById('mindset-arrow');
  if(!body)return;var h=body.style.display==='none';body.style.display=h?'':'none';
  if(arrow)arrow.textContent=h?'▼':'▶';
  try{localStorage.setItem('mcc_mindset_collapsed',h?'false':'true');}catch(e){}
}

// ==================== RENDER THEMES HTML (new format: movers + why + industries) ====================
function renderThemesHTML(data, cacheTs) {
  var html='';var time=new Date(cacheTs).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">Updated '+time+' · <a href="#" onclick="localStorage.removeItem(\'mac_themes_\'+new Date().toISOString().split(\'T\')[0]);generateThemes();return false;" style="color:var(--blue);text-decoration:none;">Refresh</a></div>';

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
        ind.tickers.forEach(function(t){html += '<span style="font-size:12px;font-weight:700;padding:1px 4px;border-radius:3px;background:var(--bg-secondary);color:var(--text-muted);font-family:var(--font-mono);cursor:pointer;" title="Click for chart" onclick="openTVChart(\''+escapeHtml(t)+'\');">'+escapeHtml(t)+'</span>';});
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
  html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Generated '+time+' · <a href="#" onclick="localStorage.removeItem(\'mac_themes_\'+new Date().toISOString().split(\'T\')[0]);renderOverview();return false;" style="color:var(--blue);text-decoration:none;">Refresh</a></div>';
  html += '<div style="display:grid;gap:8px;">';
  themes.forEach(function(theme,i){
    var colors=['var(--blue)','var(--purple)','var(--cyan)'];var bgs=['rgba(37,99,235,0.05)','rgba(124,58,237,0.05)','rgba(8,145,178,0.05)'];
    var c=colors[i%colors.length],bg=bgs[i%bgs.length];
    html += '<div style="background:'+bg+';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);border-radius:12px;padding:12px 14px;border-left:3px solid '+c+'">';
    html += '<div style="font-size:14px;font-weight:800;color:var(--text-primary);margin-bottom:3px;">'+escapeHtml(theme.title||'Theme '+(i+1))+'</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:5px;">'+escapeHtml(theme.description||'')+'</div>';
    if(theme.tickers&&theme.tickers.length>0){
      html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
      theme.tickers.forEach(function(t){html += '<span style="font-size:12px;font-weight:700;padding:2px 6px;border-radius:3px;background:'+c+'15;color:'+c+';font-family:var(--font-mono);cursor:pointer;" title="Click for chart" onclick="openTVChart(\''+escapeHtml(t)+'\');">'+escapeHtml(t)+'</span>';});
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
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;">';
  ideas.forEach(function(idea){
    var sc=idea.score>=80?'var(--green)':idea.score>=60?'var(--blue)':idea.score>=40?'var(--amber)':'var(--text-muted)';
    var sbg=idea.score>=80?'rgba(16,185,129,0.06)':idea.score>=60?'rgba(37,99,235,0.04)':'rgba(245,158,11,0.04)';
    html += '<div style="background:'+sbg+';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:12px;padding:14px 16px;border-left:3px solid '+sc+'">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += '<span style="font-size:14px;font-weight:800;font-family:var(--font-mono);cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px;" title="Click for chart" onclick="event.stopPropagation();openTVChart(\''+idea.ticker+'\');">'+idea.ticker+'</span>';
    html += '<span style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:var(--text-secondary);">$'+(idea.price?idea.price.toFixed(2):'—')+'</span>';
    html += '</div>';
    html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:2px solid '+sc+';font-size:12px;font-weight:900;color:'+sc+';font-family:var(--font-mono);">'+idea.score+'</div>';
    html += '</div>';
    if(idea.source) html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">via '+idea.source+'</div>';
    if(idea.thesis) html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.4;margin-bottom:6px;">'+idea.thesis.replace(/</g,'&lt;')+'</div>';
    if(idea.entry||idea.stop||idea.target){
      html += '<div style="display:flex;gap:8px;font-size:12px;font-family:var(--font-mono);padding:4px 6px;background:var(--bg-secondary);border-radius:3px;">';
      if(idea.entry) html += '<span style="color:var(--blue);">Entry $'+idea.entry+'</span>';
      if(idea.stop) html += '<span style="color:var(--red);">Stop $'+idea.stop+'</span>';
      if(idea.target) html += '<span style="color:var(--green);">Target $'+idea.target+'</span>';
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
      try{var articles=await getPolygonNews(topMovers[ni].ticker,5);moverNews[topMovers[ni].ticker]=articles.map(function(a){return a.title||'';}).filter(function(t){return t.length>0;});}catch(e){moverNews[topMovers[ni].ticker]=[];}
    }

    // Also get general market news for broader context
    var generalNews=[];
    try{var gn=await getPolygonNews(null,15);generalNews=gn.map(function(a){return (a.title||'')+' ('+((a.tickers||[]).slice(0,3).join(', '))+')';}).filter(function(t){return t.length>2;});}catch(e){}

    // Step 4: Build context for AI
    var moverContext=topMovers.map(function(m){
      var dir=m.pct>0?'UP':'DOWN';
      var tickerNews=moverNews[m.ticker]||[];
      var newsStr=tickerNews.length>0?'\n  Headlines: '+tickerNews.slice(0,3).join('; '):'\n  No specific headlines found.';
      return m.ticker+' '+dir+' '+m.pct.toFixed(1)+'% ($'+m.price.toFixed(2)+')'+newsStr;
    }).join('\n\n');

    // Get market context
    var marketCtx='';
    try{var idxSnap=await getSnapshots(['SPY','QQQ','IWM']);marketCtx=['SPY','QQQ','IWM'].map(function(t){var s=idxSnap[t];if(!s)return t+': N/A';var p=s.day&&s.day.c?s.day.c:0;var prev=s.prevDay?s.prevDay.c:p;return t+': $'+p.toFixed(2)+' ('+(prev>0?((p-prev)/prev*100>=0?'+':'')+((p-prev)/prev*100).toFixed(2)+'%':'N/A')+')';}).join(' | ');}catch(e){}

    if(prog)prog.textContent='AI analyzing movers...';

    // Step 5: Ask Claude to explain WHY each moved + industry breakdown
    var prompt='You are a professional market analyst. Here are today\'s biggest stock movers with their associated headlines.\n\nMarket Indices: '+marketCtx+'\n\nBiggest Movers:\n'+moverContext+'\n\nGeneral Headlines:\n'+generalNews.slice(0,8).join('\n')+'\n\nYour task:\n1. For each significant mover, write a 1-2 sentence explanation of WHY it moved (the catalyst). Include its SECTOR and specific INDUSTRY.\n2. Group the day\'s action into 2-3 overarching themes (e.g., "AI Infrastructure Boom", "Earnings Season Winners", "Macro Fears").\n3. Write a 1-sentence market narrative summary.\n4. Create an industry heat check — which specific industries are hot/cold today.\n\nReturn JSON ONLY in this exact format:\n{\n  "narrative": "One sentence market summary",\n  "movers": [\n    {"ticker": "DELL", "pct": 21.8, "direction": "up", "reason": "Crushed Q4 earnings...", "sector": "Technology", "industry": "Hardware/Servers", "tags": ["Earnings", "AI"]},\n    {"ticker": "DUOL", "pct": -14.0, "direction": "down", "reason": "Weak forward guidance...", "sector": "Technology", "industry": "EdTech/SaaS", "tags": ["Earnings"]}\n  ],\n  "themes": [\n    {"title": "AI Infrastructure Spending Accelerates", "description": "DELL and... drove gains as AI capex surges."}\n  ],\n  "industries": [\n    {"name": "Semiconductors", "direction": "up", "tickers": ["NVDA","AMD","AVGO"], "note": "AI chip demand driving broad strength"},\n    {"name": "Cybersecurity", "direction": "down", "tickers": ["CRWD","ZS"], "note": "AI disruption fears weighing"}\n  ]\n}\n\nRules:\n- Only include movers that moved >2% and have a clear catalyst.\n- "direction" must be "up" or "down".\n- "pct" should be the actual percentage change (positive number for up, negative for down).\n- "sector" is the broad GICS sector (Technology, Healthcare, Financials, etc.).\n- "industry" is the specific sub-industry (Semiconductors, Cybersecurity, SaaS, E-commerce, Biotech, etc.).\n- "tags" are short category labels like "Earnings", "M&A", "Guidance", "Macro", "AI", etc.\n- "industries" array: group movers by their specific industry, show direction and brief note. Include 3-6 industries.\n- Keep everything concise and trader-focused. No fluff.\n- Return ONLY the JSON object, no other text.';

    var data=await callAIProxy({model:'claude-sonnet-4-20250514',max_tokens:2048,messages:[{role:'user',content:prompt}]});
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
  var btn=document.getElementById('quick-scan-btn'),el=document.getElementById('top-ideas-content');
  if(!el)return;if(btn){btn.textContent='Scanning...';btn.disabled=true;}
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
        ideas.push({ticker:ticker,price:p,score:score,source:'Compression',thesis:thesis,entry:p.toFixed(2),stop:(sma20*0.98).toFixed(2),target:(p+(p-sma20*0.98)*2).toFixed(2)});
      }catch(e){continue;}
    }
    ideas.sort(function(a,b){return b.score-a.score;});ideas=ideas.slice(0,4);
    try{localStorage.setItem('mac_top_ideas_'+new Date().toISOString().split('T')[0],JSON.stringify({ideas:ideas,ts:Date.now()}));}catch(e){}
    el.innerHTML=ideas.length>0?renderTopIdeasHTML(ideas,Date.now()):'<div style="text-align:center;padding:14px;color:var(--text-muted);font-size:12px;">No strong setups found. Try full scanners.</div>';
  }catch(e){el.innerHTML='<div style="color:var(--red);font-size:12px;">Scan failed: '+escapeHtml(e.message)+'</div>';}
  if(btn){btn.textContent='Scan';btn.disabled=false;}
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

  html += '<div style="margin-top:6px;font-size:12px;color:var(--text-muted);">Updated '+new Date(ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})+' \xb7 <a href="#" onclick="localStorage.removeItem(\'mac_econ_cal_auto_\'+function(){var t=new Date(),d=t.getDay(),m=new Date(t);m.setDate(t.getDate()-(d===0?6:d-1));return m.toISOString().split(\'T\')[0];}());loadEconCalendar();return false;" style="color:var(--blue);text-decoration:none;">Refresh</a></div>';
  el.innerHTML=html;
}
