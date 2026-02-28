// ==================== shakeout.js ====================
// Shakeout Reclaim Scanner: renderShakeout (UI shell), runShakeoutScan
// (detects stocks that undercut compressed SMAs and reclaimed with volume).

// ==================== SHAKEOUT RECLAIM SCANNER ====================
async function renderShakeout() {
  var el = document.getElementById('tab-shakeout');
  if (!el) return;
  var ts = getTimestamp();
  var live = isMarketOpen();

  var html = '';
  html += '<div class="section-title"><span class="dot" style="background:var(--purple)"></span> Shakeout Reclaim Scanner</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">' + srcBadge('Polygon.io Multi-TF', live, '') + ' ' + tsLabel(ts) + '</div>';

  html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:16px;padding:10px;background:linear-gradient(135deg, rgba(139,92,246,0.04) 0%, rgba(139,92,246,0.07) 100%);border:1px solid rgba(139,92,246,0.15);border-radius:8px;border-left:3px solid var(--purple);">';
  html += '<strong>Strategy:</strong> Finds stocks that undercut compressed SMAs and reclaimed with volume — the spring-loaded breakout pattern.<br>';
  html += '<details style="margin-top:6px;cursor:pointer;"><summary style="font-weight:700;color:var(--text-secondary);">How scoring works (click to expand)</summary>';
  html += '<div style="margin-top:6px;line-height:1.8;">';
  html += '<strong style="color:var(--purple);">Reclaim Strength (25pts)</strong> — Price popped back above ALL SMAs. Sweet spot is 0.2-1.5% above = max points. Too far above (>7%) = already moved.<br>';
  html += '<strong style="color:var(--purple);">Volume on Reclaim (20pts)</strong> — Reclaim bars volume vs 20-day avg. ≥2.5x = 20pts. Institutional buying on the reclaim.<br>';
  html += '<strong style="color:var(--purple);">Compression Tightness (20pts)</strong> — Tighter SMA cluster before shakeout = more stored energy. Under 1% spread = max.<br>';
  html += '<strong style="color:var(--purple);">Base Proximity (15pts)</strong> — How close to the 20-day SMA. Near base = hasn\'t run yet. Extended = late entry.<br>';
  html += '<strong style="color:var(--purple);">Multi-TF Confirmation (10pts)</strong> — Shakeout detected on 3+ timeframes = 10pts. More TFs = stronger signal.<br>';
  html += '<strong style="color:var(--purple);">MACD Confirmation (10pts)</strong> — MACD histogram turning positive = momentum confirming the reclaim.';
  html += '</div></details></div>';

  // Scan button
  html += '<div style="display:flex;gap:6px;margin-bottom:12px;align-items:center;">';
  html += '<button onclick="runShakeoutScan();" style="padding:6px 18px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:11px;font-weight:700;font-family:\'Inter\',sans-serif;letter-spacing:0.5px;">SCAN</button>';
  html += '</div>';

  html += '<div id="shk-results"></div>';
  el.innerHTML = html;
}

async function runShakeoutScan() {
  var scanWLUnique = SCAN_UNIQUE;
  // ── SCAN ──
  var resEl = document.getElementById('shk-results');
  resEl.innerHTML = '<div style="padding:20px;text-align:center;">Scanning ' + scanWLUnique.length + ' tickers for shakeout reclaim... <span id="shk-progress">0/' + scanWLUnique.length + '</span></div>';

  function calcSMAsShk(closes) {
    var len = closes.length;
    function smaAt(p) { if (len < p) return null; var s=0; for (var i=len-p;i<len;i++) s+=closes[i]; return s/p; }
    return { sma10: smaAt(10), sma20: smaAt(20), sma50: smaAt(50), sma100: smaAt(100), barCount: len };
  }

  function calcMACD(closes) {
    if (closes.length < 35) return null;
    // EMA 12, EMA 26, Signal 9
    function ema(data, period) {
      var k = 2 / (period + 1);
      var vals = [data[0]];
      for (var i = 1; i < data.length; i++) vals.push(data[i] * k + vals[i-1] * (1-k));
      return vals;
    }
    var ema12 = ema(closes, 12);
    var ema26 = ema(closes, 26);
    var macdLine = ema12.map(function(v, i) { return v - ema26[i]; });
    var signal = ema(macdLine.slice(26), 9);
    var hist = [];
    for (var i = 0; i < signal.length; i++) hist.push(macdLine[26 + i] - signal[i]);
    return {
      histogram: hist,
      currentHist: hist.length > 0 ? hist[hist.length - 1] : 0,
      prevHist: hist.length > 1 ? hist[hist.length - 2] : 0,
      turningPositive: hist.length > 1 && hist[hist.length-1] > hist[hist.length-2] && hist[hist.length-1] > -0.5
    };
  }

  function detectShakeout(closes, highs, lows, volumes, price, smas) {
    // Need at least 2 SMAs
    var avail = [];
    if (smas.sma10) avail.push(smas.sma10);
    if (smas.sma20) avail.push(smas.sma20);
    if (smas.sma50) avail.push(smas.sma50);
    if (smas.sma100) avail.push(smas.sma100);
    if (avail.length < 2) return null;

    var smaMax = Math.max.apply(null, avail);
    var smaMin = Math.min.apply(null, avail);
    var smaMid = (smaMax + smaMin) / 2;
    var spreadPct = ((smaMax - smaMin) / price) * 100;

    // 1. Check compression — SMAs within 4%
    if (spreadPct > 5) return null; // slightly wider tolerance for shakeout

    // 2. Check for undercut: was price below the SMA cluster in last 5 bars?
    var len = closes.length;
    var hadUndercut = false;
    var undercutDepth = 0;
    var lookback = Math.min(7, len - 1);
    for (var i = len - lookback; i < len - 1; i++) {
      if (i < 0) continue;
      if (lows[i] < smaMin) {
        hadUndercut = true;
        var depth = ((smaMin - lows[i]) / smaMin) * 100;
        if (depth > undercutDepth) undercutDepth = depth;
      }
    }
    if (!hadUndercut) return null;

    // 3. Check reclaim: price is NOW above all SMAs
    var aboveAll = avail.every(function(s) { return price > s; });
    if (!aboveAll) return null;

    // 4. Volume on reclaim bars vs average
    var reclaimVol = 0, avgVol = 0;
    if (len >= 22) {
      var recentVols = volumes.slice(-21, -1);
      avgVol = recentVols.reduce(function(s,v){return s+v;},0) / recentVols.length;
      // Average volume of last 3 bars (reclaim period)
      reclaimVol = volumes.slice(-3).reduce(function(s,v){return s+v;},0) / 3;
    }
    var volRatio = avgVol > 0 ? reclaimVol / avgVol : 1;

    // 5. MACD
    var macd = calcMACD(closes);

    // 6. Reclaim strength — how far above the SMA cluster is price now
    var reclaimPct = ((price - smaMax) / smaMax) * 100;

    return {
      detected: true,
      spreadPct: spreadPct,
      undercutDepth: undercutDepth,
      reclaimPct: reclaimPct,
      volRatio: volRatio,
      macdTurning: macd ? macd.turningPositive : false,
      macdHist: macd ? macd.currentHist : 0,
      smaCount: avail.length,
      barCount: smas.barCount
    };
  }

  function scoreShakeout(tfResults, rvol, baseMetrics) {
    var score = 0;
    var detected = tfResults.filter(function(t) { return t && t.detected; });
    if (detected.length === 0) return 0;

    // Use the best (strongest) detection
    var best = detected.reduce(function(a,b) { return (a.reclaimPct > b.reclaimPct) ? a : b; });

    // === 1. RECLAIM STRENGTH (0-25 pts) ===
    // Clean reclaim just above SMAs = best. Too far above = chasing.
    var rp = best.reclaimPct;
    if (rp >= 0.2 && rp <= 1.5) score += 25;      // Perfect: just popped above
    else if (rp <= 3) score += 20;
    else if (rp <= 5) score += 12;
    else if (rp <= 7) score += 5;
    // > 7% above = already moved, no points

    // Undercut depth bonus — deeper shakeout = more trapped sellers = stronger spring
    if (best.undercutDepth >= 2) score += 3;
    else if (best.undercutDepth >= 1) score += 1;

    // === 2. VOLUME ON RECLAIM (0-20 pts) ===
    var vr = best.volRatio;
    if (vr >= 2.5) score += 20;
    else if (vr >= 1.8) score += 16;
    else if (vr >= 1.3) score += 12;
    else if (vr >= 1.0) score += 8;
    else if (vr >= 0.8) score += 4;

    // === 3. COMPRESSION TIGHTNESS (0-20 pts) ===
    var tightest = Math.min.apply(null, detected.map(function(t) { return t.spreadPct; }));
    score += Math.max(0, 20 * (1 - Math.pow(tightest / 5.0, 0.7)));

    // === 4. BASE PROXIMITY (0-15 pts) ===
    if (baseMetrics && baseMetrics.extensionPct !== undefined) {
      var ext = baseMetrics.extensionPct;
      if (ext <= 2) score += 15;
      else if (ext <= 4) score += 11;
      else if (ext <= 6) score += 7;
      else if (ext <= 8) score += 3;
    }

    // === 5. MULTI-TF CONFIRMATION (0-10 pts) ===
    if (detected.length >= 3) score += 10;
    else if (detected.length === 2) score += 6;
    else score += 2;

    // === 6. MACD CONFIRMATION (0-10 pts) ===
    var macdConfirmed = detected.some(function(t) { return t.macdTurning; });
    if (macdConfirmed) score += 10;
    else {
      // Partial credit if MACD histogram is just slightly negative but rising
      var bestMacd = detected.reduce(function(a,b) { return (a.macdHist > b.macdHist) ? a : b; });
      if (bestMacd.macdHist > -0.2) score += 5;
    }

    return Math.round(Math.min(100, Math.max(0, score)));
  }

  try {
    var allResults = [];
    var loaded = 0;

    // Get snapshots in batches
    var priceMap = {}, volumeMap = {};
    for (var si = 0; si < scanWLUnique.length; si += 30) {
      var chunk = scanWLUnique.slice(si, si + 30);
      try {
        var snap = await getSnapshots(chunk);
        Object.keys(snap).forEach(function(t) {
          var s = snap[t];
          priceMap[t] = s.day?.c || s.prevDay?.c || s.min?.c || 0;
          volumeMap[t] = s.day?.v || 0;
        });
      } catch(e) {}
    }

    // === TWO-PASS APPROACH ===
    // Pass 1: Quick daily-only scan to find candidates
    resEl.innerHTML = '<div style="padding:20px;text-align:center;">Pass 1: Quick daily scan on ' + scanWLUnique.length + ' tickers... <span id="shk-progress">0/' + scanWLUnique.length + '</span></div>';

    var candidates = [];
    for (var ti = 0; ti < scanWLUnique.length; ti++) {
      var ticker = scanWLUnique[ti];
      var prog = document.getElementById('shk-progress');
      if (prog) prog.textContent = (ti+1) + '/' + scanWLUnique.length + ' (' + ticker + ')';

      try {
        var dailyBars = await getDailyBars(ticker, 200);
        var price = priceMap[ticker] || 0;
        if (!price && dailyBars.length > 0) price = dailyBars[dailyBars.length - 1].c;
        if (!price) continue;

        // Quick daily check
        if (dailyBars.length >= 15) {
          var c = dailyBars.map(function(b){return b.c;});
          var h = dailyBars.map(function(b){return b.h;});
          var l = dailyBars.map(function(b){return b.l;});
          var v = dailyBars.map(function(b){return b.v||0;});
          var smas = calcSMAsShk(c);
          var dRes = detectShakeout(c, h, l, v, price, smas);
          if (dRes && dRes.detected) {
            candidates.push({ ticker: ticker, price: price, dailyBars: dailyBars, dailyRes: dRes });
            continue;
          }
        }

        // Also quick-check: are SMAs compressed at all? (potential shakeout on lower TFs)
        if (dailyBars.length >= 50) {
          var cls = dailyBars.map(function(b){return b.c;});
          var smasQ = calcSMAsShk(cls);
          var avail = [];
          if (smasQ.sma10) avail.push(smasQ.sma10);
          if (smasQ.sma20) avail.push(smasQ.sma20);
          if (smasQ.sma50) avail.push(smasQ.sma50);
          if (avail.length >= 2) {
            var spread = ((Math.max.apply(null,avail) - Math.min.apply(null,avail)) / price) * 100;
            if (spread <= 8) { // Wider tolerance for pass 1 — lower TFs may be tighter
              candidates.push({ ticker: ticker, price: price, dailyBars: dailyBars, dailyRes: null });
            }
          }
        }
      } catch(e) { continue; }
    }

    // Pass 2: Full multi-TF scan on candidates only
    resEl.innerHTML = '<div style="padding:20px;text-align:center;">Pass 2: Deep scan on ' + candidates.length + ' candidates... <span id="shk-progress">0/' + candidates.length + '</span></div>';

    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      var ticker = cand.ticker;
      var prog = document.getElementById('shk-progress');
      if (prog) prog.textContent = (ci+1) + '/' + candidates.length + ' (' + ticker + ')';

      try {
        var price = cand.price;
        var dailyBars = cand.dailyBars;

        // Fetch remaining timeframes
        var fetches = [
          get4HBars(ticker, 120),
          get2HBars(ticker, 120),
          get1HBars(ticker, 45)
        ];

        var results = await Promise.all(fetches);
        var h4Bars = results[0], h2Bars = results[1], h1Bars = results[2];
        if (!price) continue;

        // RVOL
        var rvol = null;
        if (dailyBars.length >= 21) {
          var rv = dailyBars.slice(-21, -1).map(function(b){return b.v||0;});
          var avgV = rv.reduce(function(s,v){return s+v;},0) / rv.length;
          var todayV = volumeMap[ticker] || (dailyBars[dailyBars.length-1].v || 0);
          if (avgV > 0) rvol = todayV / avgV;
        }

        // Base metrics
        var baseMetrics = { extensionPct: 0, distFromBase: 0 };
        if (dailyBars.length >= 50) {
          var cls = dailyBars.map(function(b){return b.c;});
          var hi = dailyBars.map(function(b){return b.h;});
          var lo = dailyBars.map(function(b){return b.l;});
          var s20 = 0; for (var j = cls.length-20; j < cls.length; j++) s20 += cls[j];
          s20 /= 20;
          baseMetrics.extensionPct = ((price - s20) / s20) * 100;
          var r20H = Math.max.apply(null, hi.slice(-20));
          var r20L = Math.min.apply(null, lo.slice(-20));
          if (r20H - r20L > 0) baseMetrics.distFromBase = ((price - r20L) / (r20H - r20L)) * 100;
        }

        // Detect shakeout on each timeframe
        function runDetect(bars) {
          if (bars.length < 15) return null;
          var c = bars.map(function(b){return b.c;});
          var h = bars.map(function(b){return b.h;});
          var l = bars.map(function(b){return b.l;});
          var v = bars.map(function(b){return b.v||0;});
          var smas = calcSMAsShk(c);
          return detectShakeout(c, h, l, v, price, smas);
        }

        var dRes = cand.dailyRes || runDetect(dailyBars);
        var h4Res = runDetect(h4Bars);
        var h2Res = runDetect(h2Bars);
        var h1Res = runDetect(h1Bars);

        var tfArr = [dRes, h4Res, h2Res, h1Res];
        var anyDetected = tfArr.some(function(t) { return t && t.detected; });
        if (!anyDetected) continue;

        var score = scoreShakeout(tfArr, rvol, baseMetrics);
        if (score < 15) continue;

        allResults.push({
          ticker: ticker, price: price, score: score, rvol: rvol,
          baseMetrics: baseMetrics,
          daily: dRes, h4: h4Res, h2: h2Res, h1: h1Res
        });

        loaded++;
      } catch(e) { continue; }
    }

    // Sort and limit
    allResults.sort(function(a,b) { return b.score - a.score; });
    allResults = allResults.slice(0, 10);

    if (allResults.length === 0) {
      resEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);"><div style="font-size:36px;margin-bottom:12px;">🔍</div><div style="font-weight:700;">No shakeout reclaim patterns detected right now</div><div style="font-size:10px;margin-top:6px;">This pattern is rarer than compression. Try enabling more timeframes or check back during volatile sessions.</div></div>';
      return;
    }

    // Render table
    var tHtml = '<div class="card" style="padding:0;overflow:hidden;">';
    tHtml += '<div style="display:grid;grid-template-columns:55px 70px 80px 55px 50px 1fr 1fr 1fr 1fr;gap:0;padding:8px 12px;background:var(--bg-secondary);border-bottom:2px solid var(--border);font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">';
    tHtml += '<div>Score</div><div>Ticker</div><div>Price</div><div>RVOL</div><div>Base</div>';
    tHtml += '<div style="text-align:center;">Daily</div><div style="text-align:center;">4H</div><div style="text-align:center;">2H</div><div style="text-align:center;">1H</div>';
    tHtml += '</div>';

    allResults.forEach(function(r, idx) {
      var sc = r.score;
      var scoreColor = sc >= 70 ? 'var(--green)' : sc >= 50 ? 'var(--blue)' : sc >= 35 ? 'var(--amber)' : 'var(--red)';
      var scoreBg = idx === 0 ? 'rgba(147,51,234,0.04)' : 'transparent';
      var rowBorder = '1px solid var(--border)';
      var rowGlow = idx === 0 ? 'border-left:3px solid var(--purple);' : '';

      tHtml += '<div style="display:grid;grid-template-columns:55px 70px 80px 55px 50px 1fr 1fr 1fr 1fr;gap:0;padding:10px 12px;border-bottom:' + rowBorder + ';align-items:center;font-size:11px;background:' + scoreBg + ';' + rowGlow + '">';

      // Score circle
      tHtml += '<div><div style="width:36px;height:36px;border-radius:50%;background:' + scoreColor + '18;border:2px solid ' + scoreColor + ';display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;font-family:\'JetBrains Mono\',monospace;color:' + scoreColor + ';">' + sc + '</div></div>';

      // Ticker
      tHtml += '<div style="font-weight:900;font-family:\'JetBrains Mono\',monospace;font-size:13px;">' + r.ticker + '</div>';

      // Price
      tHtml += '<div style="font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + r.price.toFixed(2) + '</div>';

      // RVOL
      var rvolStr = r.rvol !== null ? r.rvol.toFixed(1) + 'x' : '—';
      var rvolColor = !r.rvol ? 'var(--text-muted)' : r.rvol >= 2.0 ? 'var(--green)' : r.rvol >= 1.0 ? 'var(--blue)' : 'var(--text-muted)';
      tHtml += '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:700;color:' + rvolColor + ';font-size:12px;">' + rvolStr + '</div>';

      // Base
      var bm = r.baseMetrics;
      var baseStr = '—';
      if (bm && bm.extensionPct !== undefined) {
        var ext = bm.extensionPct;
        if (ext <= 2) baseStr = '●';
        else if (ext <= 5) baseStr = '●';
        else if (ext <= 8) baseStr = '●';
        else baseStr = '●';
        baseStr += '<div style="font-size:8px;color:var(--text-muted);">' + ext.toFixed(1) + '%</div>';
      }
      tHtml += '<div style="text-align:center;font-size:11px;">' + baseStr + '</div>';

      // Timeframe cells
      function tfCell(det, label) {
        if (!det || !det.detected) {
          return '<div style="text-align:center;padding:6px;opacity:0.25;font-size:9px;color:var(--text-muted);">—</div>';
        }
        var bg = 'rgba(147,51,234,0.08)';
        var cellHtml = '<div style="text-align:center;padding:6px 4px;background:' + bg + ';border-radius:4px;margin:0 2px;">';
        cellHtml += '<div style="font-size:10px;font-weight:700;color:var(--purple);">' + det.spreadPct.toFixed(1) + '%</div>';
        cellHtml += '<div style="font-size:8px;color:var(--text-muted);">↓' + det.undercutDepth.toFixed(1) + '% ↑' + det.reclaimPct.toFixed(1) + '%</div>';
        cellHtml += '<div style="font-size:8px;color:var(--text-muted);">';
        if (det.volRatio >= 1.3) cellHtml += '<span style="color:var(--green);">Vol ' + det.volRatio.toFixed(1) + 'x</span> ';
        if (det.macdTurning) cellHtml += '<span style="color:var(--green);">MACD✓</span>';
        cellHtml += '</div>';
        cellHtml += '<div style="font-size:7px;color:var(--text-muted);">' + det.barCount + 'b</div>';
        cellHtml += '</div>';
        return cellHtml;
      }

      tHtml += tfCell(r.daily, 'Daily');
      tHtml += tfCell(r.h4, '4H');
      tHtml += tfCell(r.h2, '2H');
      tHtml += tfCell(r.h1, '1H');

      tHtml += '</div>';
    });

    tHtml += '</div>';

    // Legend
    tHtml += '<div style="margin-top:8px;font-size:9px;color:var(--text-muted);display:flex;gap:14px;flex-wrap:wrap;">';
    tHtml += '<span>◆ = shakeout reclaim detected</span>';
    tHtml += '<span>↓ = undercut depth below SMAs</span>';
    tHtml += '<span>↑ = reclaim height above SMAs</span>';
    tHtml += '<span>Vol = volume ratio on reclaim</span>';
    tHtml += '<span>MACD✓ = histogram turning positive</span>';
    tHtml += '</div>';

    // Source + timestamp
    tHtml += '<div style="margin-top:6px;display:flex;justify-content:space-between;font-size:8px;color:var(--text-muted);">';
    tHtml += '<span>Source: <span style="font-weight:600;">Polygon.io</span> Multi-TF Bars + Snapshots · ' + allResults.length + ' patterns from ' + candidates.length + ' candidates (of ' + scanWLUnique.length + ' scanned)</span>';
    tHtml += '<span>' + new Date().toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'}) + '</span>';
    tHtml += '</div>';

    resEl.innerHTML = tHtml;

  } catch(e) {
    resEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red);">Error: Scanner error: ' + e.message + '</div>';
  }
}

// ==================== ANALYSIS CHAT ENGINE ====================
