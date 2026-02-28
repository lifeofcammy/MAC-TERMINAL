// ==================== vcp.js ====================
// VCP / Flag Scanner tab: renderVCP (UI shell), runVCPScan (Bollinger squeeze,
// range contraction, MA support, volume dry-up, proximity scoring).

// Detects Volatility Contraction Patterns (Qullamaggie style) and tight flags
// after strong momentum moves. Looks for:
// 1. Big prior move (20%+ in 40 sessions)
// 2. Bollinger Band width contracting (squeeze)
// 3. Price holding above rising 20 & 50 SMA
// 4. Volume drying up during consolidation
// 5. Tightening daily range (flag narrowing)

async function renderVCP() {
  const container = document.getElementById('tab-vcp');
  const ts = getTimestamp();
  const live = isMarketOpen();

  let html = '<div class="section-title"><span class="dot" style="background:var(--purple)"></span> VCP / Tight Flag Scanner</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">' + srcBadge('Polygon.io Daily', live, '') + ' ' + tsLabel(ts) + '</div>';

  html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:16px;padding:10px;background:linear-gradient(135deg, rgba(139,92,246,0.04) 0%, rgba(139,92,246,0.07) 100%);border:1px solid rgba(139,92,246,0.15);border-radius:8px;border-left:3px solid var(--purple);">';
  html += '<strong>Strategy:</strong> Finds stocks forming tight flags / volatility contraction patterns (VCPs) after strong momentum moves. Like the MU symmetrical triangle — price coils tighter after a big impulse, MAs converge underneath as support, then breakout.<br>';
  html += '<details style="margin-top:6px;cursor:pointer;"><summary style="font-weight:700;color:var(--text-secondary);">How scoring works (click to expand)</summary>';
  html += '<div style="margin-top:6px;line-height:1.8;">';
  html += '<strong style="color:var(--purple);">Prior Momentum (20pts)</strong> — 20%+ move in prior 40 sessions. Bigger move = stronger pattern. This is the "impulse" that creates the flag.<br>';
  html += '<strong style="color:var(--purple);">BB Squeeze (20pts)</strong> — Bollinger Band width contracting. Measures the "coiling spring" — tighter = more explosive breakout.<br>';
  html += '<strong style="color:var(--purple);">Range Contraction (15pts)</strong> — Recent 5-day range vs 20-day range. Tightening range = flag narrowing to apex.<br>';
  html += '<strong style="color:var(--purple);">MA Support (15pts)</strong> — Price above rising 20 & 50 SMA. MAs acting as dynamic support underneath = healthy consolidation.<br>';
  html += '<strong style="color:var(--purple);">Volume Dry-Up (15pts)</strong> — Recent volume declining vs average. Low volume in consolidation = sellers exhausted.<br>';
  html += '<strong style="color:var(--purple);">Proximity to Breakout (15pts)</strong> — How close price is to the top of the consolidation range. Closer = more imminent breakout.';
  html += '</div></details></div>';

  // Scan button only
  html += '<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;">';
  html += '<button onclick="runVCPScan()" style="padding:6px 18px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:11px;font-weight:700;font-family:\'Plus Jakarta Sans\',sans-serif;letter-spacing:0.5px;">SCAN</button>';
  html += '</div>';

  html += '<div id="vcp-scan-results"></div>';
  container.innerHTML = html;
  // Don't auto-scan — wait for user to click SCAN
}

async function runVCPScan() {
  const el = document.getElementById('vcp-scan-results');
  if (!el) return;
  const ts = getTimestamp();
  const live = isMarketOpen();
  const MAX_RESULTS = 10;

  const MIN_MOVE_PCT = 20;
  const MAX_BASE_DAYS = 30;

  const scanList = SCAN_UNIQUE;

  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Pass 1: Screening ' + scanList.length + ' tickers for momentum... <span id="vcp-progress">0/' + scanList.length + '</span></div>';

  // ── HELPER: Bollinger Band Width ──
  function calcBBWidth(closes, period, mult) {
    if (closes.length < period) return null;
    var slice = closes.slice(-period);
    var mean = slice.reduce(function(a,b){return a+b;},0) / period;
    var variance = slice.reduce(function(a,b){return a + (b-mean)*(b-mean);},0) / period;
    var stddev = Math.sqrt(variance);
    var upper = mean + mult * stddev;
    var lower = mean - mult * stddev;
    var width = mean > 0 ? ((upper - lower) / mean) * 100 : 0;
    return { width: width, upper: upper, lower: lower, mean: mean, stddev: stddev };
  }

  // ── HELPER: SMA ──
  function sma(arr, period) {
    if (arr.length < period) return null;
    var sum = 0;
    for (var i = arr.length - period; i < arr.length; i++) sum += arr[i];
    return sum / period;
  }

  // ── HELPER: Average True Range ──
  function calcATR(bars, period) {
    if (bars.length < period + 1) return null;
    var trs = [];
    for (var i = bars.length - period; i < bars.length; i++) {
      var tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i-1].c), Math.abs(bars[i].l - bars[i-1].c));
      trs.push(tr);
    }
    return trs.reduce(function(a,b){return a+b;},0) / trs.length;
  }

  try {
    var allResults = [];
    var errored = 0;

    // Get snapshot prices in batches
    var priceMap = {}, volumeMap = {};
    for (var si = 0; si < scanList.length; si += 30) {
      var chunk = scanList.slice(si, si + 30);
      try {
        var chunkSnap = await getSnapshots(chunk);
        Object.keys(chunkSnap).forEach(function(t) {
          var s = chunkSnap[t];
          priceMap[t] = s.day?.c || s.prevDay?.c || s.min?.c || 0;
          volumeMap[t] = s.day?.v || 0;
        });
      } catch(e) {}
    }

    // Pass 1: Daily bars, find momentum + compression candidates
    for (var ti = 0; ti < scanList.length; ti++) {
      var ticker = scanList[ti];
      var progEl = document.getElementById('vcp-progress');
      if (progEl) progEl.textContent = (ti+1) + '/' + scanList.length + ' (' + ticker + ')';

      try {
        var bars = await getDailyBars(ticker, 200);
        if (bars.length < 60) continue;

        var closes = bars.map(function(b){return b.c;});
        var highs = bars.map(function(b){return b.h;});
        var lows = bars.map(function(b){return b.l;});
        var vols = bars.map(function(b){return b.v;});
        var price = priceMap[ticker] || closes[closes.length - 1];
        if (!price || price <= 0) continue;

        // ── 1. PRIOR MOMENTUM: Find biggest move in trailing 60 sessions ──
        // Look back 60 bars, find the lowest close, measure move from there
        var lookback = Math.min(60, closes.length);
        var recentCloses = closes.slice(-lookback);
        var lowestClose = Math.min.apply(null, recentCloses);
        var highestClose = Math.max.apply(null, recentCloses);
        var moveFromLow = lowestClose > 0 ? ((highestClose - lowestClose) / lowestClose) * 100 : 0;

        // Where did the high occur? Must be before recent bars (not today)
        var highIdx = -1;
        for (var hi = closes.length - lookback; hi < closes.length; hi++) {
          if (closes[hi] === highestClose) { highIdx = hi; break; }
        }
        // The impulse high should be at least 5 bars ago (consolidating after the move)
        var barsSinceHigh = closes.length - 1 - highIdx;
        if (barsSinceHigh < 5 || barsSinceHigh > MAX_BASE_DAYS + 15) continue;
        if (moveFromLow < MIN_MOVE_PCT) continue;

        // ── 2. BOLLINGER BAND SQUEEZE ──
        var bbCurrent = calcBBWidth(closes, 20, 2);
        if (!bbCurrent) continue;

        // Compare current BB width to 40-bar lookback BB width
        var bbPast = calcBBWidth(closes.slice(0, -10), 20, 2);
        var bbSqueeze = 0; // 0-1, how much it squeezed
        if (bbPast && bbPast.width > 0) {
          bbSqueeze = Math.max(0, 1 - (bbCurrent.width / bbPast.width));
        }

        // ── 3. RANGE CONTRACTION (flag tightening) ──
        var recent5H = Math.max.apply(null, highs.slice(-5));
        var recent5L = Math.min.apply(null, lows.slice(-5));
        var recent5Range = price > 0 ? ((recent5H - recent5L) / price) * 100 : 999;

        var recent20H = Math.max.apply(null, highs.slice(-20));
        var recent20L = Math.min.apply(null, lows.slice(-20));
        var recent20Range = price > 0 ? ((recent20H - recent20L) / price) * 100 : 999;

        var rangeContraction = recent20Range > 0 ? (1 - recent5Range / recent20Range) : 0;
        rangeContraction = Math.max(0, Math.min(1, rangeContraction));

        // ── 4. MA SUPPORT ──
        var sma20 = sma(closes, 20);
        var sma50 = sma(closes, 50);
        var aboveSMA20 = sma20 && price > sma20;
        var aboveSMA50 = sma50 && price > sma50;

        // Are the SMAs rising?
        var sma20prev = closes.length >= 25 ? sma(closes.slice(0, -5), 20) : null;
        var sma50prev = closes.length >= 55 ? sma(closes.slice(0, -5), 50) : null;
        var sma20Rising = sma20 && sma20prev && sma20 > sma20prev;
        var sma50Rising = sma50 && sma50prev && sma50 > sma50prev;

        // Must be above at least the 20 SMA
        if (!aboveSMA20) continue;

        // ── 5. VOLUME DRY-UP ──
        var avgVol20 = sma(vols, 20);
        var avgVol5 = sma(vols.slice(-5), 5);
        var volDryUp = 0;
        if (avgVol20 && avgVol20 > 0 && avgVol5 !== null) {
          volDryUp = Math.max(0, 1 - (avgVol5 / avgVol20));
        }

        // ── 6. PROXIMITY TO BREAKOUT ──
        // How close is price to the top of consolidation range?
        var consolHigh = Math.max.apply(null, highs.slice(-barsSinceHigh));
        var consolLow = Math.min.apply(null, lows.slice(-barsSinceHigh));
        var consolRange = consolHigh - consolLow;
        var breakoutProx = consolRange > 0 ? ((price - consolLow) / consolRange) : 0.5;

        // ── GRADING (0-100) ──
        var grade = 0;

        // Prior Momentum (0-20)
        if (moveFromLow >= 50) grade += 20;
        else if (moveFromLow >= 40) grade += 17;
        else if (moveFromLow >= 30) grade += 14;
        else if (moveFromLow >= 20) grade += 10;
        else if (moveFromLow >= 15) grade += 6;

        // BB Squeeze (0-20)
        grade += Math.round(bbSqueeze * 20);

        // Range Contraction (0-15)
        grade += Math.round(rangeContraction * 15);

        // MA Support (0-15)
        if (aboveSMA20 && aboveSMA50 && sma20Rising && sma50Rising) grade += 15;
        else if (aboveSMA20 && aboveSMA50 && sma20Rising) grade += 12;
        else if (aboveSMA20 && aboveSMA50) grade += 9;
        else if (aboveSMA20 && sma20Rising) grade += 6;
        else if (aboveSMA20) grade += 3;

        // Volume Dry-Up (0-15)
        grade += Math.round(volDryUp * 15);

        // Breakout Proximity (0-15)
        grade += Math.round(breakoutProx * 15);

        if (grade < 30) continue; // Floor

        // Score color (0-100 numeric, matches compression scanner)
        var scoreColor = grade >= 80 ? 'var(--green)' : grade >= 60 ? 'var(--blue)' : grade >= 40 ? 'var(--amber)' : 'var(--red)';
        var scoreBg = grade >= 80 ? 'rgba(34,197,94,0.12)' : grade >= 60 ? 'rgba(59,130,246,0.08)' : grade >= 40 ? 'rgba(245,158,11,0.06)' : 'rgba(223,27,65,0.06)';

        // ATR for context
        var atr = calcATR(bars, 14) || 0;

        // Build mini sparkline data (last 30 bars)
        var sparkBars = bars.slice(-30);

        allResults.push({
          ticker: ticker, price: price, grade: grade, scoreColor: scoreColor, scoreBg: scoreBg,
          moveFromLow: moveFromLow, bbWidth: bbCurrent.width, bbSqueeze: bbSqueeze,
          rangeContraction: rangeContraction, recent5Range: recent5Range,
          aboveSMA20: aboveSMA20, aboveSMA50: aboveSMA50, sma20Rising: sma20Rising, sma50Rising: sma50Rising,
          sma20: sma20, sma50: sma50, volDryUp: volDryUp, breakoutProx: breakoutProx,
          barsSinceHigh: barsSinceHigh, consolHigh: consolHigh,
          atr: atr, sparkBars: sparkBars,
          bbUpper: bbCurrent.upper, bbLower: bbCurrent.lower, bbMean: bbCurrent.mean
        });

      } catch(e) { errored++; }
    }

    // Sort by grade
    allResults.sort(function(a,b){ return b.grade - a.grade; });
    var topResults = allResults.slice(0, MAX_RESULTS);

    // ── BUILD HTML ──
    var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">';
    html += '<span style="font-size:9px;color:var(--text-muted);">Scanned ' + scanList.length + ' tickers · ' + allResults.length + ' VCP setups found · ' + errored + ' errors · Top ' + MAX_RESULTS + ' shown</span></div>';

    if (topResults.length === 0) {
      html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:11px;">No VCP / tight flag setups found matching criteria. Try lowering the min move % or increasing max base days.</div>';
    } else {
      html += '<div class="card" style="padding:0;overflow:hidden;">';

      // Header row
      html += '<div class="vcp-row" style="background:var(--bg-secondary);border-bottom:2px solid var(--border);font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">';
      html += '<div>Score</div><div>Ticker</div><div>Price</div><div>Move</div><div>BB Squeeze</div><div>Vol Dry</div><div>Base</div><div style="text-align:center;">30d Chart + Bollinger Bands</div>';
      html += '</div>';

      topResults.forEach(function(r, idx) {
        var rowBg = idx === 0 ? r.scoreBg : idx < 3 ? 'rgba(154,106,255,0.02)' : 'transparent';
        var rowBorder = idx === 0 ? 'border-left:3px solid ' + r.scoreColor + ';' : '';
        var rowGlow = idx === 0 ? 'box-shadow:0 0 12px rgba(154,106,255,0.1);' : '';

        // MA support indicators
        var maIcons = '';
        if (r.aboveSMA20) maIcons += '<span style="color:var(--green);font-size:8px;" title="Above 20 SMA">20▲</span> ';
        if (r.aboveSMA50) maIcons += '<span style="color:var(--green);font-size:8px;" title="Above 50 SMA">50▲</span> ';
        if (r.sma20Rising) maIcons += '<span style="color:var(--cyan);font-size:8px;" title="20 SMA rising">↑</span>';

        // Breakout proximity bar
        var proxPct = Math.round(r.breakoutProx * 100);
        var proxColor = proxPct >= 80 ? 'var(--green)' : proxPct >= 60 ? 'var(--blue)' : proxPct >= 40 ? 'var(--amber)' : 'var(--text-muted)';

        // Mini sparkline chart with Bollinger Bands
        var chartSvg = '';
        if (r.sparkBars && r.sparkBars.length > 3) {
          var sb = r.sparkBars;
          var allH = sb.map(function(b){return b.h;});
          var allL = sb.map(function(b){return b.l;});
          // Include BB bands in the range calculation
          var chartMin = Math.min(Math.min.apply(null, allL), r.bbLower || Infinity);
          var chartMax = Math.max(Math.max.apply(null, allH), r.bbUpper || -Infinity);
          var chartRange = chartMax - chartMin || 1;
          var svgW = 260, svgH = 50;
          var candleW = Math.max(2, Math.floor((svgW - 4) / sb.length) - 1);
          var gap = 1;

          var svgContent = '';

          // Draw BB bands as a shaded area
          if (r.bbUpper && r.bbLower && r.bbMean) {
            // Calculate BB values for each bar position (approximate)
            var bbCloses = sb.map(function(b){return b.c;});
            var bbPoints = [];
            for (var bi = 0; bi < bbCloses.length; bi++) {
              if (bi >= 19) { // Need 20 bars for BB
                var bbSlice = bbCloses.slice(bi - 19, bi + 1);
                var bbMean = bbSlice.reduce(function(a,c){return a+c;}, 0) / 20;
                var bbVar = bbSlice.reduce(function(a,c){return a + (c-bbMean)*(c-bbMean);}, 0) / 20;
                var bbStd = Math.sqrt(bbVar);
                bbPoints.push({ x: 2 + bi * (candleW + gap) + candleW/2, upper: bbMean + 2*bbStd, lower: bbMean - 2*bbStd, mean: bbMean });
              }
            }
            if (bbPoints.length >= 2) {
              // Draw BB band fill
              var bbPath = 'M';
              bbPoints.forEach(function(p, i) {
                var y = svgH - 2 - ((p.upper - chartMin) / chartRange) * (svgH - 4);
                bbPath += (i===0?'':' L') + p.x.toFixed(1) + ' ' + y.toFixed(1);
              });
              for (var ri = bbPoints.length - 1; ri >= 0; ri--) {
                var y = svgH - 2 - ((bbPoints[ri].lower - chartMin) / chartRange) * (svgH - 4);
                bbPath += ' L' + bbPoints[ri].x.toFixed(1) + ' ' + y.toFixed(1);
              }
              bbPath += ' Z';
              svgContent += '<path d="' + bbPath + '" fill="rgba(154,106,255,0.08)" stroke="none"/>';

              // BB upper/lower lines
              var upperLine = 'M';
              var lowerLine = 'M';
              var meanLine = 'M';
              bbPoints.forEach(function(p, i) {
                var yU = svgH - 2 - ((p.upper - chartMin) / chartRange) * (svgH - 4);
                var yL = svgH - 2 - ((p.lower - chartMin) / chartRange) * (svgH - 4);
                var yM = svgH - 2 - ((p.mean - chartMin) / chartRange) * (svgH - 4);
                upperLine += (i===0?'':' L') + p.x.toFixed(1) + ' ' + yU.toFixed(1);
                lowerLine += (i===0?'':' L') + p.x.toFixed(1) + ' ' + yL.toFixed(1);
                meanLine += (i===0?'':' L') + p.x.toFixed(1) + ' ' + yM.toFixed(1);
              });
              svgContent += '<path d="' + upperLine + '" fill="none" stroke="rgba(154,106,255,0.3)" stroke-width="0.7" stroke-dasharray="2,2"/>';
              svgContent += '<path d="' + lowerLine + '" fill="none" stroke="rgba(154,106,255,0.3)" stroke-width="0.7" stroke-dasharray="2,2"/>';
              svgContent += '<path d="' + meanLine + '" fill="none" stroke="rgba(154,106,255,0.5)" stroke-width="0.7"/>';
            }
          }

          // Draw SMA lines
          if (r.sma20) {
            var sma20y = svgH - 2 - ((r.sma20 - chartMin) / chartRange) * (svgH - 4);
            svgContent += '<line x1="0" y1="' + sma20y.toFixed(1) + '" x2="' + svgW + '" y2="' + sma20y.toFixed(1) + '" stroke="var(--cyan)" stroke-width="0.8" opacity="0.6"/>';
          }
          if (r.sma50) {
            var sma50y = svgH - 2 - ((r.sma50 - chartMin) / chartRange) * (svgH - 4);
            svgContent += '<line x1="0" y1="' + sma50y.toFixed(1) + '" x2="' + svgW + '" y2="' + sma50y.toFixed(1) + '" stroke="var(--amber)" stroke-width="0.8" opacity="0.6"/>';
          }

          // Draw consolidation high line
          if (r.consolHigh) {
            var consolY = svgH - 2 - ((r.consolHigh - chartMin) / chartRange) * (svgH - 4);
            svgContent += '<line x1="0" y1="' + consolY.toFixed(1) + '" x2="' + svgW + '" y2="' + consolY.toFixed(1) + '" stroke="var(--red)" stroke-width="0.6" stroke-dasharray="3,3" opacity="0.5"/>';
          }

          // Draw candlesticks
          sb.forEach(function(b, ci) {
            var x = 2 + ci * (candleW + gap);
            var yH = svgH - 2 - ((b.h - chartMin) / chartRange) * (svgH - 4);
            var yL = svgH - 2 - ((b.l - chartMin) / chartRange) * (svgH - 4);
            var yO = svgH - 2 - ((b.o - chartMin) / chartRange) * (svgH - 4);
            var yC = svgH - 2 - ((b.c - chartMin) / chartRange) * (svgH - 4);
            var bull = b.c >= b.o;
            var color = bull ? '#00c853' : '#ff1744';
            var bodyTop = Math.min(yO, yC);
            var bodyH = Math.max(1, Math.abs(yC - yO));
            var wickX = x + candleW / 2;

            svgContent += '<line x1="' + wickX + '" y1="' + yH + '" x2="' + wickX + '" y2="' + yL + '" stroke="' + color + '" stroke-width="0.7" opacity="0.6"/>';
            svgContent += '<rect x="' + x + '" y="' + bodyTop + '" width="' + candleW + '" height="' + bodyH + '" fill="' + color + '" opacity="0.85" rx="0.3"/>';
          });

          chartSvg = '<svg width="' + svgW + '" height="' + svgH + '" viewBox="0 0 ' + svgW + ' ' + svgH + '" style="display:block;">' + svgContent + '</svg>';
        }

        html += '<div class="vcp-row" style="background:' + rowBg + ';' + rowBorder + rowGlow + '">';

        // Score circle
        html += '<div style="text-align:center;"><div style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;border:3px solid ' + r.scoreColor + ';font-size:15px;font-weight:900;color:' + r.scoreColor + ';font-family:\'JetBrains Mono\',monospace;">' + r.grade + '</div></div>';

        // Ticker
        html += '<div style="font-weight:800;font-family:\'JetBrains Mono\',monospace;font-size:14px;">' + r.ticker + '</div>';

        // Price + MA indicators
        html += '<div><div style="font-family:\'JetBrains Mono\',monospace;font-weight:600;font-size:12px;">$' + r.price.toFixed(2) + '</div>';
        html += '<div style="margin-top:2px;">' + maIcons + '</div></div>';

        // Move from low
        html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;color:var(--green);">+' + r.moveFromLow.toFixed(0) + '%</div>';

        // BB Squeeze
        var sqzPct = Math.round(r.bbSqueeze * 100);
        var sqzColor = sqzPct >= 40 ? 'var(--green)' : sqzPct >= 20 ? 'var(--blue)' : 'var(--text-muted)';
        html += '<div><div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;color:' + sqzColor + ';">' + sqzPct + '%</div>';
        html += '<div style="font-size:8px;color:var(--text-muted);">BW: ' + r.bbWidth.toFixed(1) + '%</div></div>';

        // Volume dry-up
        var dryPct = Math.round(r.volDryUp * 100);
        var dryColor = dryPct >= 30 ? 'var(--green)' : dryPct >= 10 ? 'var(--amber)' : 'var(--text-muted)';
        html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;color:' + dryColor + ';">' + dryPct + '%</div>';

        // Days in base + breakout proximity
        html += '<div>';
        html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:600;">' + r.barsSinceHigh + 'd</div>';
        html += '<div style="margin-top:3px;width:40px;height:4px;background:rgba(100,116,139,0.15);border-radius:2px;overflow:hidden;">';
        html += '<div style="width:' + proxPct + '%;height:100%;background:' + proxColor + ';border-radius:2px;"></div>';
        html += '</div>';
        html += '<div style="font-size:7px;color:var(--text-muted);margin-top:1px;">' + proxPct + '% to BO</div>';
        html += '</div>';

        // Sparkline chart
        html += '<div style="text-align:center;">' + chartSvg + '</div>';

        html += '</div>';
      });

      html += '</div>';

      // Legend
      html += '<div style="margin-top:10px;font-size:9px;color:var(--text-muted);display:flex;gap:14px;flex-wrap:wrap;">';
      html += '<span><span style="color:var(--green);">20▲ 50▲</span> above SMAs</span>';
      html += '<span><span style="color:var(--cyan);">↑</span> SMA rising</span>';
      html += '<span><strong>BB Squeeze:</strong> % contraction vs prior</span>';
      html += '<span><strong>Vol Dry:</strong> volume decline in consol</span>';
      html += '<span><strong>BO:</strong> breakout proximity</span>';
      html += '<span style="color:var(--cyan);">—</span> 20 SMA · <span style="color:var(--amber);">—</span> 50 SMA · <span style="color:rgba(154,106,255,0.5);">···</span> BB bands · <span style="color:var(--red);">---</span> consolidation high</span>';
      html += '</div>';

      // Position sizing helper
      html += '<div style="margin-top:16px;padding:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">';
      html += '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;">📐 Quick Sizing — Pick a setup:</div>';
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
      topResults.slice(0, 10).forEach(function(r) {
        var stopPrice = r.sma20 ? r.sma20 : r.price * 0.95;
        var sizing = calcPositionSize(r.price, stopPrice);
        if (sizing.shares > 0) {
          html += '<div style="padding:6px 10px;background:var(--purple-bg);border:1px solid rgba(154,106,255,0.2);border-radius:6px;font-size:9px;font-family:\'JetBrains Mono\',monospace;line-height:1.5;">';
          html += '<strong style="color:var(--purple);">' + r.ticker + '</strong> ';
          html += '<span style="color:var(--text-secondary);">' + sizing.shares + ' sh · $' + sizing.positionSize.toLocaleString('en-US',{maximumFractionDigits:0}) + '</span>';
          html += '<div style="color:var(--text-muted);">Stop: $' + stopPrice.toFixed(2) + ' (20 SMA)</div>';
          html += '</div>';
        }
      });
      html += '</div></div>';
    }

  } catch(e) {
    var html = '<div class="card" style="padding:20px;text-align:center;color:var(--red);font-size:11px;">VCP scan failed: ' + e.message + '</div>';
  }

  el.innerHTML = html;
}

// ==================== OPTIONS SELLING TAB ====================
