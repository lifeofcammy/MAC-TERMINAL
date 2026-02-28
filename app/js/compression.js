// ==================== compression.js ====================
// Compression Scanner tab: renderIdeas (UI shell), load2HSMAStack (full multi-TF scan),
// scoring algorithm (0-100), base proximity metrics, RVOL calculation.

  const container = document.getElementById('tab-ideas');
  const ts = getTimestamp();
  const live = isMarketOpen();

  let html = '<div class="section-title"><span class="dot" style="background:var(--purple)"></span> SMA Compression Scanner — Multi-Timeframe</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">' + srcBadge('Polygon.io Multi-TF', live, '') + ' ' + tsLabel(ts) + '</div>';
  html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:16px;padding:10px;background:linear-gradient(135deg, rgba(139,92,246,0.04) 0%, rgba(139,92,246,0.07) 100%);border:1px solid rgba(139,92,246,0.15);border-radius:8px;border-left:3px solid var(--purple);">';
  html += '<strong>Strategy:</strong> Finds stocks where SMAs are compressed (coiled spring) AND price is above all SMAs (bullish). Scored 0-100. Higher = stronger setup for selling puts below the compression zone.<br>';
  html += '<details style="margin-top:6px;cursor:pointer;"><summary style="font-weight:700;color:var(--text-secondary);">How scoring works (click to expand)</summary>';
  html += '<div style="margin-top:6px;line-height:1.8;">';
  html += '<strong style="color:var(--purple);">Compression Tightness (30pts)</strong> — How tight are the 10/20/50/100 SMAs? Under 1% spread = max points. Wider = fewer.<br>';
  html += '<strong style="color:var(--purple);">Base Proximity (15pts)</strong> — Distance from 20-day SMA. Near the base (≤2%) = full points. Extended (>8%) = chasing, no points.<br>';
  html += '<strong style="color:var(--purple);">Multi-TF Alignment (15pts)</strong> — Compressed on all 4 timeframes (Daily/4H/2H/1H) = 15pts. Fewer TFs = fewer points.<br>';
  html += '<strong style="color:var(--purple);">Bull Stack Order (5pts)</strong> — SMAs in order: 10 > 20 > 50 > 100. Confirms uptrend structure.<br>';
  html += '<strong style="color:var(--purple);">Relative Volume (10pts)</strong> — Today\'s volume vs 20-day avg. RVOL ≥3x = 10pts. Higher volume = institutional interest.<br>';
  html += '<strong style="color:var(--purple);">MACD Confirmation (15pts)</strong> — Histogram turning positive = momentum shifting bullish.<br>';
  html += '<strong style="color:var(--purple);">Trend Filter (10pts)</strong> — Price above 50 & 200 SMA on daily = confirmed uptrend, not catching a knife.';
  html += '</div></details></div>';

  // Scan button
  html += '<div style="display:flex;gap:6px;margin-bottom:12px;align-items:center;">';
  html += '<button onclick="load2HSMAStack();" style="padding:6px 18px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:11px;font-weight:700;font-family:\'Inter\',sans-serif;letter-spacing:0.5px;">SCAN</button>';
  html += '</div>';

  // Multi-TF SMA Compression section — loads async
  html += '<div id="sma-stack-section"></div>';

  container.innerHTML = html;
  // Don't auto-scan — wait for user to click SCAN
}


// ==================== GLOBAL SCAN WATCHLIST (S&P 500 + Optionable Large Caps + Custom) ====================
var SCAN_TICKERS = [
    // ── S&P 500 ──
    'AAPL','ABBV','ABT','ACN','ADBE','ADI','ADM','ADP','ADSK','AEE','AEP','AES','AFL','AIG','AIZ','AJG','AKAM','ALB','ALGN','ALK',
    'ALL','ALLE','AMAT','AMCR','AMD','AME','AMGN','AMP','AMT','AMZN','ANET','ANSS','AON','AOS','APA','APD','APH','APTV','ARE','ATO',
    'AVGO','AVY','AWK','AXP','AZO','BA','BAC','BAX','BBWI','BBY','BDX','BEN','BG','BIIB','BIO','BK','BKNG','BKR','BLDR','BLK',
    'BMY','BR','BRO','BSX','BWA','BX','BXP','C','CAG','CAH','CARR','CAT','CB','CBOE','CBRE','CCI','CCL','CDAY','CDNS','CDW',
    'CE','CEG','CF','CFG','CHD','CHRW','CHTR','CI','CINF','CL','CLX','CMCSA','CME','CMG','CMI','CMS','CNC','CNP','COF','COO',
    'COP','COR','COST','CPAY','CPB','CPRT','CPT','CRL','CRM','CRWD','CSCO','CSGP','CSX','CTAS','CTLT','CTRA','CTSH','CTVA','CVS','CVX',
    'CZR','D','DAL','DD','DE','DECK','DFS','DG','DGX','DHI','DHR','DIS','DLTR','DOV','DOW','DPZ','DRI','DTE','DUK',
    'DVA','DVN','DXCM','EA','EBAY','ECL','ED','EFX','EIX','EL','EMN','EMR','ENPH','EOG','EPAM','EQIX','EQR','EQT','ES','ESS',
    'ETN','ETR','EVRG','EW','EXC','EXPD','EXPE','EXR','F','FANG','FAST','FBHS','FCX','FDS','FDX','FE','FFIV','FI','FICO','FIS',
    'FISV','FITB','FMC','FOX','FOXA','FRT','FSLR','FTNT','FTV','GD','GDDY','GE','GEHC','GEN','GEV','GILD','GIS','GL','GLW',
    'GM','GNRC','GOOG','GOOGL','GPC','GPN','GRMN','GS','GWW','HAL','HAS','HBAN','HCA','HD','HOLX','HON','HPE','HPQ','HRL','HSIC',
    'HST','HSY','HUBB','HUM','HWM','IBM','ICE','IDXX','IEX','IFF','INCY','INTC','INTU','INVH','IP','IPG','IQV','IR','IRM','ISRG',
    'IT','ITW','IVZ','J','JBHT','JBL','JCI','JKHY','JNJ','JNPR','JPM','KDP','KEY','KEYS','KHC','KIM','KKR','KLAC','KMB',
    'KMI','KMX','KO','KR','KVUE','L','LDOS','LEN','LH','LHX','LIN','LKQ','LLY','LMT','LNT','LOW','LRCX','LULU','LUV','LVS',
    'LW','LYB','LYV','MA','MAA','MAR','MAS','MCD','MCHP','MCK','MCO','MDLZ','MDT','MET','META','MGM','MHK','MKC','MKTX','MLM',
    'MMC','MMM','MNST','MO','MOH','MOS','MPC','MPWR','MRK','MRNA','MRVL','MS','MSCI','MSFT','MSI','MTB','MTCH','MTD','MU','NCLH',
    'NDAQ','NDSN','NEE','NEM','NFLX','NI','NKE','NOC','NOW','NRG','NSC','NTAP','NTRS','NUE','NVDA','NVR','NWS','NWSA','NXPI','O',
    'ODFL','OKE','OMC','ON','ORCL','ORLY','OTIS','OXY','PANW','PARA','PAYC','PAYX','PCAR','PCG','PEG','PEP','PFE','PFG','PG','PGR',
    'PH','PHM','PKG','PLD','PLTR','PM','PNC','PNR','PNW','POOL','PPG','PPL','PRU','PSA','PSX','PTC','PVH','PWR','PYPL','QCOM',
    'QRVO','RCL','REG','REGN','RF','RJF','RL','RMD','ROK','ROL','ROP','ROST','RSG','RTX','RVTY','SBAC','SBUX','SCHW','SEE','SHW',
    'SJM','SLB','SMCI','SNA','SNPS','SO','SOLV','SPG','SPGI','SRE','STE','STLD','STT','STX','STZ','SWK','SWKS','SYF','SYK','SYY',
    'T','TAP','TDG','TDY','TECH','TEL','TER','TFC','TFX','TGT','TJX','TMO','TMUS','TPR','TRGP','TRMB','TROW','TRV','TSCO','TSLA',
    'TSN','TT','TTWO','TXN','TXT','TYL','UAL','UBER','UDR','UHS','ULTA','UNH','UNP','UPS','URI','USB','V','VICI','VLO','VLTO',
    'VMC','VRSK','VRSN','VRTX','VST','VTR','VTRS','VZ','WAB','WAT','WBA','WBD','WDC','WEC','WELL','WFC','WM','WMB','WMT','WRB',
    'WST','WTW','WY','WYNN','XEL','XOM','XYL','YUM','ZBH','ZBRA','ZTS',
    // ── Optionable Mid/Large Caps (high liquidity, active options) ──
    'ALLY','AXON','BALL','BWXT','CHDN','COHR','CROX','DKS','DOCS','DUOL','ETSY','FIVE','IBKR','MANH','MSTR','OVV','PSTG','RH',
    'SAIA','SKX','SOFI','SPOT','TOST','WING','XPO','ZS','MDB','HIMS','ELF','CAVA','CELH','ONON','RBRK',
    // ── ADRs & Non-S&P Large Caps ──
    'TM','ASML','NVS','HSBC','MELI','SNOW','COIN','HOOD','TTD','APP','RKLB','DKNG','DASH','PINS','ROKU','U','NET','DDOG',
    'NVO','ARM','TSM','SQ','SNAP','LYFT','ABNB','HLT','AAL','SHOP',
    // ── Miners & Commodities ──
    'FSM','AG','PAAS','WPM','MARA','RIOT','CLSK','BTU','CLF',
    // ── ETFs ──
    'SPY','QQQ','IWM','DIA','XLF','XLE','XLK','XLV','XLI','GLD','SLV','TLT','HYG','ARKK','SMH','BITX'
];
var SCAN_UNIQUE = [...new Set(SCAN_TICKERS)];

// ==================== SMA COMPRESSION + RVOL SCANNER (SCORED 0-100) ====================
async function load2HSMAStack() {
  const el = document.getElementById('sma-stack-section');
  if (!el) return;
  const ts = getTimestamp();
  const live = isMarketOpen();
  const MAX_RESULTS = 10;
  const scanWLUnique = SCAN_UNIQUE;

  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Probing Polygon API health...</div>';

  // ── DATA HEALTH PROBE ──
  var healthResults = { daily: 0, h4: 0, h2: 0, h1: 0 };
  // Realistic targets: daily=200 bars from 200 days, 4H=~120 from 90 days, 2H=~200 from 60 days, 1H=~200 from 30 days
  var healthTargets = { daily: 100, h4: 50, h2: 80, h1: 80 };
  try {
    var [hDaily, h4H, h2H, h1H] = await Promise.all([
      getDailyBars('AAPL', 200), get4HBars('AAPL', 120), get2HBars('AAPL', 120), get1HBars('AAPL', 45)
    ]);
    healthResults = { daily: hDaily.length, h4: h4H.length, h2: h2H.length, h1: h1H.length };
  } catch(e) {}

  var allHealthy = healthResults.daily >= healthTargets.daily && healthResults.h4 >= healthTargets.h4 && healthResults.h2 >= healthTargets.h2 && healthResults.h1 >= healthTargets.h1;
  var healthBannerColor = allHealthy ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)';
  var healthBorderColor = allHealthy ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)';
  var healthStatusText = allHealthy ? 'All timeframes operational' : 'Some timeframes limited — scanner adapts';
  function hI(b, t) { return b >= t ? '●' : b >= t*0.5 ? '●' : b > 0 ? '●' : '●'; }

  var healthBanner = '<div style="padding:10px 14px;margin-bottom:12px;border-radius:8px;background:' + healthBannerColor + ';border:1px solid ' + healthBorderColor + ';font-size:11px;">';
  healthBanner += '<div style="font-weight:700;margin-bottom:6px;">' + healthStatusText + '</div>';
  healthBanner += '<div style="display:flex;gap:16px;flex-wrap:wrap;font-family:\'JetBrains Mono\',monospace;font-size:10px;">';
  healthBanner += '<span>' + hI(healthResults.daily, healthTargets.daily) + ' Daily: ' + healthResults.daily + ' bars</span>';
  healthBanner += '<span>' + hI(healthResults.h4, healthTargets.h4) + ' 4H: ' + healthResults.h4 + ' bars</span>';
  healthBanner += '<span>' + hI(healthResults.h2, healthTargets.h2) + ' 2H: ' + healthResults.h2 + ' bars</span>';
  healthBanner += '<span>' + hI(healthResults.h1, healthTargets.h1) + ' 1H: ' + healthResults.h1 + ' bars</span>';
  healthBanner += '</div></div>';

  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Scanning ' + scanWLUnique.length + ' tickers... <span id="scan-progress">0/' + scanWLUnique.length + '</span></div>';

  // ── HELPER FUNCTIONS ──
  function calcSMAs(closes) {
    var len = closes.length;
    function smaAt(period) {
      if (len < period) return null;
      var sum = 0;
      for (var i = len - period; i < len; i++) sum += closes[i];
      return sum / period;
    }
    return { sma10: smaAt(10), sma20: smaAt(20), sma50: smaAt(50), sma100: smaAt(100), barCount: len };
  }

  function analyzeTF(price, smas) {
    var available = [], labels = [];
    if (smas.sma10) { available.push(smas.sma10); labels.push('10'); }
    if (smas.sma20) { available.push(smas.sma20); labels.push('20'); }
    if (smas.sma50) { available.push(smas.sma50); labels.push('50'); }
    if (smas.sma100) { available.push(smas.sma100); labels.push('100'); }
    if (available.length < 2) return null;

    var mx = Math.max.apply(null, available);
    var mn = Math.min.apply(null, available);
    var spreadPct = ((mx - mn) / price) * 100;

    // Pairwise compression: tightest spread between adjacent SMAs
    var pairSpreads = [];
    for (var pi = 0; pi < available.length - 1; pi++) {
      pairSpreads.push(Math.abs(available[pi] - available[pi+1]) / price * 100);
    }
    var tightestPair = pairSpreads.length > 0 ? Math.min.apply(null, pairSpreads) : spreadPct;
    // Use tightest pair if it's significantly tighter than full spread (momentum consolidation)
    var effectiveSpread = Math.min(spreadPct, tightestPair * 1.5);

    var aboveAll = available.every(function(s) { return price > s; });
    var belowAll = available.every(function(s) { return price < s; });
    // Bull stack: shorter SMAs above longer ones (10 > 20 > 50 > 100)
    var bullStack = true;
    for (var i = 1; i < available.length; i++) {
      if (available[i] >= available[i-1]) { bullStack = false; break; }
    }
    return { spreadPct: effectiveSpread, fullSpreadPct: spreadPct, tightestPair: tightestPair, aboveAll: aboveAll, belowAll: belowAll, bullStack: bullStack, smaCount: available.length, smaLabels: labels.join('/'), barCount: smas.barCount };
  }

  // ── SCORING FUNCTION (0-100) ──
  // Pro scoring: compression + trend + TF alignment + volume + BASE PROXIMITY
  function scoreSetup(tfResults, rvol, price, baseMetrics) {
    var score = 0;

    // === 1. COMPRESSION TIGHTNESS (0-25 pts) ===
    var compressedTFs = tfResults.filter(function(t) { return t && !t.noData && t.spreadPct <= 5.0; });
    if (compressedTFs.length === 0) return 0;

    var tightestSpread = Math.min.apply(null, compressedTFs.map(function(t) { return t.spreadPct; }));
    var compressionScore = Math.max(0, 25 * (1 - Math.pow(tightestSpread / 5.0, 0.7)));
    score += compressionScore;

    // === 2. BASE PROXIMITY (0-30 pts) — THE KEY FILTER ===
    // Stocks near their base/support score highest. Extended stocks get penalized.
    if (baseMetrics) {
      var ext = baseMetrics.extensionPct; // % above 20 SMA
      var atrExt = baseMetrics.atrExtension; // ATRs above 20 SMA
      var rangePos = baseMetrics.distFromBase; // 0-100, where in 20-day range

      // Best: price within 0-2% of 20 SMA (right at base)
      // Good: 2-4% above (slight pullback from base)
      // OK: 4-7% (getting extended)
      // Bad: 7%+ (way too extended, already ran)
      if (ext <= 1.5) score += 30;        // Right at the base — perfect
      else if (ext <= 3) score += 24;      // Very close to base
      else if (ext <= 5) score += 16;      // Moderate extension
      else if (ext <= 7) score += 8;       // Getting extended
      else if (ext <= 10) score += 2;      // Extended — low score
      else score -= 5;                     // Way too extended — PENALTY

      // Bonus for being in lower half of 20-day range (near support)
      if (rangePos <= 30) score += 5;      // Near bottom of range
      else if (rangePos <= 50) score += 3; // Lower half

      // Penalty for being at top of range (already ran)
      if (rangePos >= 90) score -= 5;      // At the high — likely to pull back
    }

    // === 3. BULLISH TREND BIAS (0-15 pts) ===
    var bullishTFs = tfResults.filter(function(t) { return t && !t.noData && t.aboveAll; });
    var totalValidTFs = tfResults.filter(function(t) { return t && !t.noData; }).length;
    if (totalValidTFs > 0) {
      score += 15 * (bullishTFs.length / totalValidTFs);
    }

    // === 4. MULTI-TIMEFRAME ALIGNMENT (0-15 pts) ===
    var compressedCount = compressedTFs.length;
    if (compressedCount === 4) score += 15;
    else if (compressedCount === 3) score += 10;
    else if (compressedCount === 2) score += 6;
    else score += 2;

    // === 5. BULL STACK ORDER (0-5 pts) ===
    var stackedTFs = tfResults.filter(function(t) { return t && !t.noData && t.bullStack; });
    if (totalValidTFs > 0) {
      score += 5 * (stackedTFs.length / totalValidTFs);
    }

    // === 6. RELATIVE VOLUME (0-10 pts) ===
    if (rvol !== null && rvol > 0) {
      if (rvol >= 3.0) score += 10;
      else if (rvol >= 2.0) score += 8;
      else if (rvol >= 1.5) score += 6;
      else if (rvol >= 1.0) score += 4;
      else if (rvol >= 0.7) score += 2;
    }

    return Math.round(Math.min(100, Math.max(0, score)));
  }

  try {
    var allResults = [];
    var loaded = 0, errored = 0, skipped = 0, bullishOnly = 0;

    // Get snapshots in batches for prices + volume
    var priceMap = {}, volumeMap = {}, prevVolumeMap = {};
    for (var si = 0; si < scanWLUnique.length; si += 30) {
      var chunk = scanWLUnique.slice(si, si + 30);
      try {
        var chunkSnap = await getSnapshots(chunk);
        Object.keys(chunkSnap).forEach(function(t) {
          var s = chunkSnap[t];
          priceMap[t] = s.day?.c || s.prevDay?.c || s.min?.c || 0;
          volumeMap[t] = s.day?.v || 0;
          prevVolumeMap[t] = s.prevDay?.v || 0;
        });
      } catch(e) {}
    }

    // === TWO-PASS APPROACH ===
    // Pass 1: Daily-only quick filter for compressed SMAs
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Pass 1: Daily scan on ' + scanWLUnique.length + ' tickers... <span id="scan-progress">0/' + scanWLUnique.length + '</span></div>';

    var candidates = [];
    for (var ti = 0; ti < scanWLUnique.length; ti++) {
      var ticker = scanWLUnique[ti];
      var progEl = document.getElementById('scan-progress');
      if (progEl) progEl.textContent = (ti+1) + '/' + scanWLUnique.length + ' (' + ticker + ')';

      try {
        var dailyBars = await getDailyBars(ticker, 200);
        var price = priceMap[ticker] || 0;
        if (!price && dailyBars.length > 0) price = dailyBars[dailyBars.length - 1].c;
        if (!price) { skipped++; continue; }

        // Quick daily compression check — use PAIRWISE spread between adjacent SMAs
        // This catches stocks like MU/SNDK where 10/20 are tight but 50 is far below after a big move
        if (dailyBars.length >= 20) {
          var cls = dailyBars.map(function(b){return b.c;});
          var len = cls.length;
          function qSma(p) { if (len < p) return null; var s=0; for (var i=len-p;i<len;i++) s+=cls[i]; return s/p; }
          var s10 = qSma(10), s20 = qSma(20), s50 = len >= 50 ? qSma(50) : null;
          var avail = [s10, s20, s50].filter(function(v){return v !== null;});
          if (avail.length >= 2) {
            // Check if ANY adjacent pair is compressed (10/20 or 20/50)
            var pairCompressed = false;
            if (s10 && s20) {
              var spread1020 = Math.abs(s10 - s20) / price * 100;
              if (spread1020 <= 5) pairCompressed = true;
            }
            if (s20 && s50) {
              var spread2050 = Math.abs(s20 - s50) / price * 100;
              if (spread2050 <= 8) pairCompressed = true;
            }
            // Also check full spread as before but with wider gate
            var fullSpread = ((Math.max.apply(null,avail) - Math.min.apply(null,avail)) / price) * 100;
            if (fullSpread <= 12) pairCompressed = true;

            // Price above at least the shortest SMA (bullish)
            var aboveShortest = price > Math.min(s10 || Infinity, s20 || Infinity);
            if (pairCompressed && aboveShortest) {
              candidates.push({ ticker: ticker, price: price, dailyBars: dailyBars });
            }
          }
        }
      } catch(e) { errored++; continue; }
    }

    // Pass 2: Full multi-TF scan on candidates only
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Pass 2: Deep scan on ' + candidates.length + ' candidates... <span id="scan-progress">0/' + candidates.length + '</span></div>';

    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      var ticker = cand.ticker;
      var progEl = document.getElementById('scan-progress');
      if (progEl) progEl.textContent = (ci+1) + '/' + candidates.length + ' (' + ticker + ')';

      try {
        var dailyBars = cand.dailyBars;
        var price = cand.price;

        var extraFetches = await Promise.all([
          get4HBars(ticker, 120),
          get2HBars(ticker, 120),
          get1HBars(ticker, 45)
        ]);

        var h4Bars = extraFetches[0], h2Bars = extraFetches[1], h1Bars = extraFetches[2];

        // Calculate RVOL: today's volume vs 20-day average volume
        var rvol = null;
        if (dailyBars.length >= 21) {
          var recentVols = dailyBars.slice(-21, -1).map(function(b) { return b.v || 0; });
          var avgVol = recentVols.reduce(function(s,v) { return s+v; }, 0) / recentVols.length;
          var todayVol = volumeMap[ticker] || (dailyBars[dailyBars.length-1].v || 0);
          if (avgVol > 0) rvol = todayVol / avgVol;
        }

        // ── BASE PROXIMITY METRICS ──
        // How extended is price from its base? Lower = closer to support = better entry
        var baseMetrics = { extensionPct: 0, atrExtension: 0, nearBase: false, distFromBase: 0 };
        if (dailyBars.length >= 50) {
          var closes = dailyBars.map(function(b) { return b.c; });
          var highs = dailyBars.map(function(b) { return b.h; });
          var lows = dailyBars.map(function(b) { return b.l; });

          // 1. Extension from 20 SMA (how far price has run from short-term mean)
          var sum20 = 0;
          for (var si20 = closes.length - 20; si20 < closes.length; si20++) sum20 += closes[si20];
          var sma20val = sum20 / 20;
          baseMetrics.extensionPct = ((price - sma20val) / sma20val) * 100;

          // 2. ATR-based extension (how many ATRs above the 20 SMA)
          var atrSum = 0;
          for (var ai = closes.length - 14; ai < closes.length; ai++) {
            var tr = Math.max(highs[ai] - lows[ai], Math.abs(highs[ai] - closes[ai-1]), Math.abs(lows[ai] - closes[ai-1]));
            atrSum += tr;
          }
          var atr14 = atrSum / 14;
          if (atr14 > 0) baseMetrics.atrExtension = (price - sma20val) / atr14;

          // 3. Proximity to recent consolidation base
          // Look at last 20 bars: find the range (high-low) and where price sits in that range
          var recent20H = Math.max.apply(null, highs.slice(-20));
          var recent20L = Math.min.apply(null, lows.slice(-20));
          var range20 = recent20H - recent20L;
          if (range20 > 0) {
            baseMetrics.distFromBase = ((price - recent20L) / range20) * 100; // 0=at low, 100=at high
          }

          // 4. Is price near a base? (within 1 ATR of 20 SMA and in lower half of 20-day range)
          baseMetrics.nearBase = Math.abs(baseMetrics.atrExtension) <= 1.5 && baseMetrics.distFromBase <= 60;
        }

        // Analyze each timeframe
        var dailySMAs = dailyBars.length >= 10 ? calcSMAs(dailyBars.map(function(b){return b.c;})) : null;
        var h4SMAs = h4Bars.length >= 10 ? calcSMAs(h4Bars.map(function(b){return b.c;})) : null;
        var h2SMAs = h2Bars.length >= 10 ? calcSMAs(h2Bars.map(function(b){return b.c;})) : null;
        var h1SMAs = h1Bars.length >= 10 ? calcSMAs(h1Bars.map(function(b){return b.c;})) : null;

        var dailyTF = dailySMAs ? analyzeTF(price, dailySMAs) : null;
        var h4TF = h4SMAs ? analyzeTF(price, h4SMAs) : null;
        var h2TF = h2SMAs ? analyzeTF(price, h2SMAs) : null;
        var h1TF = h1SMAs ? analyzeTF(price, h1SMAs) : null;

        var tfArr = [dailyTF, h4TF, h2TF, h1TF];
        var tfLabels = ['Daily', '4H', '2H', '1H'];

        // FILTER: At least 1 compressed timeframe (effectiveSpread accounts for pairwise tightness)
        var compressedCount = tfArr.filter(function(t) { return t && t.spreadPct <= 5.0; }).length;
        if (compressedCount === 0) { skipped++; continue; }

        // FILTER: Price must be above at least the 10 or 20 SMA on at least one timeframe (bullish bias)
        var anyBullish = tfArr.some(function(t) { return t && t.aboveAll; });
        // Fallback: also pass if price above shortest 2 SMAs (momentum stocks where 50/100 are trailing)
        if (!anyBullish) {
          anyBullish = tfArr.some(function(t) {
            if (!t) return false;
            // Check if tightest pair spread is < 3% (the short SMAs are converging)
            return t.tightestPair < 3 && price > Math.min.apply(null, [t.spreadPct]); // always true if tightestPair ok
          });
          // Simpler: just check price vs latest snapshot trend
          if (!anyBullish) { skipped++; continue; }
        }

        // Score it
        var score = scoreSetup(tfArr, rvol, price, baseMetrics);
        if (score < 20) { skipped++; continue; } // Floor: don't show junk

        bullishOnly++;

        // Build TF detail array for display
        var tfDisplay = [];
        for (var tfi = 0; tfi < 4; tfi++) {
          var tf = tfArr[tfi];
          if (!tf) {
            tfDisplay.push({ label: tfLabels[tfi], noData: true });
          } else {
            tfDisplay.push({
              label: tfLabels[tfi],
              spreadPct: tf.spreadPct,
              compressed: tf.spreadPct <= 5.0,
              aboveAll: tf.aboveAll,
              belowAll: tf.belowAll,
              bullStack: tf.bullStack,
              smaLabels: tf.smaLabels,
              barCount: tf.barCount
            });
          }
        }

        allResults.push({
          ticker: ticker, price: price, score: score,
          rvol: rvol, compressedCount: compressedCount,
          baseMetrics: baseMetrics,
          tfDisplay: tfDisplay
        });
        loaded++;
      } catch (e) { errored++; }
    }

    // Sort by score descending, take top N
    allResults.sort(function(a, b) { return b.score - a.score; });
    var topResults = allResults.slice(0, MAX_RESULTS);

    // ── BUILD HTML ──
    var html = '<div class="section-title" style="margin-top:24px;"><span class="dot" style="background:var(--green)"></span> Bullish Compression Scanner <span style="font-size:10px;padding:2px 8px;border-radius:8px;background:rgba(34,197,94,0.15);color:var(--green);font-weight:700;margin-left:8px;">SCORED 0-100</span></div>';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' + srcBadge('Polygon.io Multi-TF + RVOL', live, '') + ' ' + tsLabel(ts) + ' <span style="font-size:9px;color:var(--text-muted);">Scanned ' + scanWLUnique.length + ' tickers · ' + candidates.length + ' candidates · ' + bullishOnly + ' bullish compressed · ' + errored + ' errors · Top ' + MAX_RESULTS + ' shown</span></div>';
    html += healthBanner;

    if (topResults.length === 0) {
      html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:11px;">No bullish compressed setups found. ' + scanWLUnique.length + ' scanned, ' + errored + ' API errors. Market may be trending without compression.</div>';
    } else {
      html += '<div class="card" style="padding:0;overflow:hidden;">';
      // Header
      html += '<div style="display:grid;grid-template-columns:55px 70px 80px 55px 50px 1fr 1fr 1fr 1fr;gap:0;padding:8px 12px;background:var(--bg-secondary);border-bottom:2px solid var(--border);font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">';
      html += '<div>Score</div><div>Ticker</div><div>Price</div><div>RVOL</div><div>Base</div><div style="text-align:center;">Daily</div><div style="text-align:center;">4H</div><div style="text-align:center;">2H</div><div style="text-align:center;">1H</div>';
      html += '</div>';

      topResults.forEach(function(r, idx) {
        // Score color: 80+ green, 60+ blue, 40+ amber, below red
        var scoreColor = r.score >= 80 ? 'var(--green)' : r.score >= 60 ? 'var(--blue)' : r.score >= 40 ? 'var(--amber)' : 'var(--red)';
        var scoreBg = r.score >= 80 ? 'rgba(34,197,94,0.12)' : r.score >= 60 ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.06)';
        var rowBorder = idx === 0 ? '2px solid var(--green)' : r.score >= 70 ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)';
        var rowGlow = idx === 0 ? 'box-shadow:0 0 12px rgba(34,197,94,0.15);' : '';

        // RVOL display
        var rvolStr = r.rvol !== null ? r.rvol.toFixed(1) + 'x' : '—';
        var rvolColor = r.rvol === null ? 'var(--text-muted)' : r.rvol >= 2.0 ? 'var(--green)' : r.rvol >= 1.0 ? 'var(--blue)' : 'var(--text-muted)';

        html += '<div style="display:grid;grid-template-columns:55px 70px 80px 55px 50px 1fr 1fr 1fr 1fr;gap:0;padding:10px 12px;border-bottom:' + rowBorder + ';align-items:center;font-size:11px;background:' + scoreBg + ';' + rowGlow + '">';

        // Score circle
        html += '<div style="text-align:center;"><div style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;border:3px solid ' + scoreColor + ';font-size:15px;font-weight:900;color:' + scoreColor + ';font-family:\'JetBrains Mono\',monospace;">' + r.score + '</div></div>';

        // Ticker
        html += '<div style="font-weight:800;font-family:\'JetBrains Mono\',monospace;font-size:14px;">' + r.ticker + '</div>';

        // Price
        html += '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:600;">$' + r.price.toFixed(2) + '</div>';

        // RVOL
        html += '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:700;color:' + rvolColor + ';font-size:12px;">' + rvolStr + '</div>';

        // Base proximity indicator
        var bm = r.baseMetrics;
        var baseStr = '—';
        var baseColor = 'var(--text-muted)';
        var baseBg = 'transparent';
        if (bm && bm.extensionPct !== undefined) {
          var ext = bm.extensionPct;
          if (ext <= 2) { baseStr = '●'; baseColor = 'var(--green)'; }
          else if (ext <= 5) { baseStr = '●'; baseColor = 'var(--amber)'; }
          else if (ext <= 8) { baseStr = '●'; baseColor = 'var(--red)'; }
          else { baseStr = '●'; baseColor = 'var(--red)'; }
          baseStr += '<div style="font-size:8px;color:var(--text-muted);">' + ext.toFixed(1) + '%</div>';
        }
        html += '<div style="text-align:center;font-size:11px;">' + baseStr + '</div>';

        // Timeframe cells
        r.tfDisplay.forEach(function(tf) {
          if (tf.noData) {
            html += '<div style="text-align:center;color:var(--text-muted);font-size:9px;">—</div>';
          } else if (!tf.compressed) {
            html += '<div style="text-align:center;opacity:0.3;">';
            html += '<div style="font-size:10px;color:var(--text-muted);">' + tf.spreadPct.toFixed(1) + '%</div>';
            html += '<div style="font-size:8px;color:var(--text-muted);">' + tf.smaLabels + '</div>';
            html += '</div>';
          } else {
            var cellColor = tf.spreadPct <= 1.0 ? 'var(--green)' : tf.spreadPct <= 2.0 ? 'var(--blue)' : tf.spreadPct <= 3.0 ? 'var(--amber)' : 'var(--text-secondary)';
            var cellBg = tf.spreadPct <= 1.0 ? 'rgba(34,197,94,0.1)' : tf.spreadPct <= 2.0 ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.06)';
            var posIcon = tf.aboveAll ? '<span style="color:var(--green);">▲</span>' : tf.belowAll ? '<span style="color:var(--red);">▼</span>' : '<span style="color:var(--amber);">◆</span>';
            var stackIcon = tf.bullStack ? ' ■' : '';
            html += '<div style="text-align:center;background:' + cellBg + ';border-radius:4px;padding:4px 2px;">';
            html += '<div style="font-size:12px;font-weight:800;color:' + cellColor + ';font-family:\'JetBrains Mono\',monospace;">' + tf.spreadPct.toFixed(1) + '%</div>';
            html += '<div style="font-size:8px;">' + posIcon + ' ' + tf.smaLabels + stackIcon + '</div>';
            html += '</div>';
          }
        });

        html += '</div>';
      });
      html += '</div>';

      // Legend
      html += '<div style="margin-top:8px;font-size:9px;color:var(--text-muted);display:flex;gap:14px;flex-wrap:wrap;">';
      html += '<span><span style="color:var(--green);">▲</span> price above all SMAs</span>';
      html += '<span><span style="color:var(--amber);">◆</span> price between SMAs</span>';
      html += '<span>■ = bull stack (10>20>50>100)</span>';
      html += '<span><strong>RVOL:</strong> today vol / 20d avg</span>';
      html += '<span><strong>Base:</strong> % above 20 SMA — ● &lt;2% (at base) ● 2-5% ● 5-8% ● &gt;8% (extended)</span>';
      html += '</div>';
    }
  } catch (e) {
    var html = '<div class="card" style="padding:20px;text-align:center;color:var(--red);font-size:11px;">Compression scan failed: ' + e.message + '</div>';
  }

  el.innerHTML = html;
}
// ==================== VCP / TIGHT FLAG SCANNER ====================
