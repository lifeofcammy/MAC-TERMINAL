// ==================== scanner.js ====================
// Two-category setup scanner:
//   Category 1: EARLY BREAKOUTS — stocks compressing in a base, haven't broken out yet
//   Category 2: PULLBACK ENTRIES — stocks that ran, pulled back to support in an uptrend
//
// Layer 1: Universe builder — filters all US stocks to ~top 150 candidates
// Layer 2: Setup analysis — scores and categorizes into Early Breakouts vs Pullbacks
//
// Key change from old scanner: compression-first scoring, extension penalty,
// ETF filtering, and two distinct setup types.

// ==================== CONSTANTS ====================
var SCANNER_CACHE_KEY = 'mac_momentum_top100';
var SCANNER_RESULTS_KEY = 'mac_scan_results';

// Known ETF tickers to exclude (common ones that sneak through)
var KNOWN_ETFS = [
  'SPY','QQQ','IWM','DIA','VOO','VTI','VIXY','UUP','GLD','SLV','TLT','HYG','LQD',
  'XLK','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP','SMH',
  'EWJ','EWZ','EWY','EWG','EWH','EWA','EWT','EWC','EWU','EWS','EWW','EWQ',
  'FXI','MCHI','KWEB','INDA','VWO','EEM','EFA','IEMG','VEA','VGK',
  'ARKK','ARKW','ARKF','ARKG','ARKQ','ARKX',
  'SOXX','IGV','IBB','XBI','XOP','OIH','KRE','KBE','XRT','JETS','PAVE',
  'ITA','XAR','HACK','SKYY','BOTZ','ICLN','TAN','URNM','LIT','REMX',
  'SOXL','SOXS','TQQQ','SQQQ','UPRO','SPXU','LABU','LABD','UVXY','SVXY',
  'SPXL','SPXS','TNA','TZA','FAS','FAZ','NUGT','DUST','JNUG','JDST',
  'BND','AGG','IEF','SHY','VCSH','VCIT','BNDX','EMB','JNK','MUB',
  'VNQ','MORT','HOMZ','IYR','XLRE',
  'USO','UNG','DBA','DBC','PDBC','GSG','WEAT','CORN','CPER',
  'RSP','SPLG','SCHD','VIG','DVY','SDY','NOBL','VYM','HDV',
  'QLD','PSQ','SH','SDS','DOG','DXD','RWM','TWM',
  'IBIT','BITO','GBTC','ETHE','FBTC',
  'GDX','GDXJ','SIL','SILJ','PPLT','PALL','GLTR',
  'COWZ','DIVO','JEPI','JEPQ','XYLD','QYLD','RYLD',
  'AMLP','MLPA','SRVR','NERD','SOCL','SUBZ','BETZ','PEJ',
  'PBJ','MJ','YOLO','MSOS','POTX',
  'VXUS','ACWI','URTH','IOO','QMOM','VMOT',
  'PSI','FTEC','VGT','IYW','QTEC','FDN',
  'WOOD','MOO','SOIL','KARS','DRIV','SNSR',
  'LRNZ','EDUT','HERO','ESPO','GAMR',
  'FINX','IPAY','KBWB','IAI','HOMZ',
  'MEDI','IHI','IHF','GDNA','PTH',
  'ROBO','IRBO','THNQ','DTCR',
  'CIBR','BUG','IHAK','PSCE',
  'KBWY','SMLV','REET','SPRE',
  'HYEM','HYLS','BSJR','BSJS',
  'PICK','COPX','SLX','REMX','LIT',
  'BLOK','DAPP','LEGR','KOIN',
  'VFH','IYG','IAT','FTXO',
  'PFF','PGF','PFXF','FPE',
  'BNDW','GOVT','SCHO','SCHR',
  'ISTB','IUSB','TOTL','DFIP',
  'SHYG','USHY','FALN','ANGL',
  'VRIG','FLRN','FTSM','JPST',
  'NEAR','GSY','ICSH','MINT',
  'SVOL','ZIVB','PUTW','SIXS',
  'BAB','HYD','MUNI','VTEB',
  'EMLC','PCY','FEMB','EBND',
  'BWX','IGOV','ISHG','FLLA'
];

// ==================== UTILITY FUNCTIONS ====================
function isETF(ticker) {
  if (KNOWN_ETFS.indexOf(ticker) !== -1) return true;
  // Heuristic: ETFs tend to be 3-4 chars, all caps, no numbers
  if (ticker.length <= 4 && /^[A-Z]+$/.test(ticker)) {
    // Additional check: very common ETF-like patterns
    if (ticker.endsWith('X') || ticker.endsWith('Q') || ticker.endsWith('Y')) return false; // could be stock
  }
  return false;
}

function safeNum(val, def) {
  def = def === undefined ? 0 : def;
  var n = parseFloat(val);
  return isNaN(n) ? def : n;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ==================== LAYER 1: UNIVERSE BUILDER ====================
// Pulls top ~150 candidates from all US stocks
// Filters: price > $5, volume > 200k avg, not an ETF
// Sorts by a blend of RS + volume trend to get the strongest names

var _universeCache = null;
var _universeCacheTime = 0;
var UNIVERSE_CACHE_TTL = 15 * 60 * 1000; // 15 min

function buildUniverse(callback) {
  var now = Date.now();
  if (_universeCache && (now - _universeCacheTime) < UNIVERSE_CACHE_TTL) {
    callback(null, _universeCache);
    return;
  }

  // Use screener to get broad universe
  var params = {
    filters: [
      { left: 'Price', operation: 'greater', right: 5 },
      { left: 'Average Volume (10 day)', operation: 'greater', right: 200000 },
      { left: 'Exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
      { left: 'type', operation: 'equal', right: 'stock' }
    ],
    options: { lang: 'en' },
    symbols: {},
    columns: [
      'name', 'close', 'volume', 'Recommend.All', 'RSI', 'Mom', 'Perf.W', 'Perf.M',
      'Perf.3M', 'Perf.6M', 'Perf.YTD', 'Perf.Y', 'MACD.macd', 'MACD.signal',
      'EMA200', 'EMA50', 'EMA20', 'High.All', 'change_abs', 'change',
      'Average Volume (10 day)', 'Average Volume (3 month)', 'ATR', 'ADX',
      'Volatility.D', 'Volatility.W', 'BB.upper', 'BB.lower', 'BB.basis',
      'High.1M', 'Low.1M', 'High.3M', 'Low.3M', 'High.6M', 'Low.6M',
      'price_52_week_high', 'price_52_week_low'
    ],
    sort: { sortBy: 'Perf.6M', sortOrder: 'desc' },
    range: [0, 300]
  };

  TV.screener('america', params, function(err, result) {
    if (err || !result || !result.data) {
      callback(err || new Error('No screener data'), null);
      return;
    }

    var stocks = [];
    result.data.forEach(function(item) {
      var t = item.s ? item.s.replace('NASDAQ:', '').replace('NYSE:', '').replace('AMEX:', '') : '';
      if (!t) return;
      if (isETF(t)) return;
      var d = item.d || [];

      var price    = safeNum(d[1]);
      var volume   = safeNum(d[2]);
      var rs       = safeNum(d[3]);  // Recommend.All (-1 to +1)
      var rsi      = safeNum(d[4], 50);
      var mom      = safeNum(d[5]);
      var perfW    = safeNum(d[6]);
      var perfM    = safeNum(d[7]);
      var perf3M   = safeNum(d[8]);
      var perf6M   = safeNum(d[9]);
      var perfYTD  = safeNum(d[10]);
      var perfY    = safeNum(d[11]);
      var macdM    = safeNum(d[12]);
      var macdS    = safeNum(d[13]);
      var ema200   = safeNum(d[14]);
      var ema50    = safeNum(d[15]);
      var ema20    = safeNum(d[16]);
      var allHigh  = safeNum(d[17]);
      var chgAbs   = safeNum(d[18]);
      var chgPct   = safeNum(d[19]);
      var vol10    = safeNum(d[20]);
      var vol3m    = safeNum(d[21]);
      var atr      = safeNum(d[22]);
      var adx      = safeNum(d[23]);
      var volD     = safeNum(d[24]);
      var volW     = safeNum(d[25]);
      var bbU      = safeNum(d[26]);
      var bbL      = safeNum(d[27]);
      var bbB      = safeNum(d[28]);
      var h1m      = safeNum(d[29]);
      var l1m      = safeNum(d[30]);
      var h3m      = safeNum(d[31]);
      var l3m      = safeNum(d[32]);
      var h6m      = safeNum(d[33]);
      var l6m      = safeNum(d[34]);
      var h52      = safeNum(d[35]);
      var l52      = safeNum(d[36]);

      if (price < 5) return;
      if (vol10 < 200000) return;

      stocks.push({
        ticker: t,
        price: price,
        volume: volume,
        vol10: vol10,
        vol3m: vol3m,
        rs: rs,
        rsi: rsi,
        mom: mom,
        perfW: perfW,
        perfM: perfM,
        perf3M: perf3M,
        perf6M: perf6M,
        perfYTD: perfYTD,
        perfY: perfY,
        macdM: macdM,
        macdS: macdS,
        ema200: ema200,
        ema50: ema50,
        ema20: ema20,
        allHigh: allHigh,
        chgAbs: chgAbs,
        chgPct: chgPct,
        atr: atr,
        adx: adx,
        volD: volD,
        volW: volW,
        bbU: bbU,
        bbL: bbL,
        bbB: bbB,
        h1m: h1m,
        l1m: l1m,
        h3m: h3m,
        l3m: l3m,
        h6m: h6m,
        l6m: l6m,
        h52: h52,
        l52: l52
      });
    });

    // Sort by combined RS + momentum score, take top 150
    stocks.sort(function(a, b) {
      var scoreA = a.rs * 50 + clamp(a.perf3M, -50, 100) * 0.3 + clamp(a.perfM, -30, 60) * 0.2;
      var scoreB = b.rs * 50 + clamp(b.perf3M, -50, 100) * 0.3 + clamp(b.perfM, -30, 60) * 0.2;
      return scoreB - scoreA;
    });
    stocks = stocks.slice(0, 150);

    _universeCache = stocks;
    _universeCacheTime = now;
    callback(null, stocks);
  });
}

// ==================== LAYER 2: SETUP ANALYSIS ====================
// For each stock in universe, score and classify:
//   - EARLY BREAKOUT: tight base forming near highs, not yet broken
//   - PULLBACK: ran up, pulled back to EMA support, still in uptrend

function analyzeSetup(stock) {
  var p = stock.price;
  var ema20 = stock.ema20;
  var ema50 = stock.ema50;
  var ema200 = stock.ema200;
  var atr = stock.atr || (p * 0.02);
  var rsi = stock.rsi;
  var adx = stock.adx;
  var bbU = stock.bbU;
  var bbL = stock.bbL;
  var bbB = stock.bbB;
  var h52 = stock.h52 || stock.h6m || stock.h3m;
  var l52 = stock.l52 || stock.l6m || stock.l3m;
  var perf3M = stock.perf3M;
  var perfM = stock.perfM;
  var perfW = stock.perfW;

  // ---- UPTREND CHECK ----
  // Must be above EMA200 (or EMA50 if EMA200 unavailable)
  var aboveEma200 = ema200 > 0 ? p > ema200 * 0.97 : p > ema50 * 0.95;
  var ema50AboveEma200 = (ema200 > 0 && ema50 > 0) ? ema50 > ema200 * 0.98 : true;
  var inUptrend = aboveEma200 && ema50AboveEma200;

  // ---- COMPRESSION SCORE (0-40) ----
  // Tight price action = high score. Uses BB width and ATR/price ratio.
  var bbWidth = (bbB > 0 && p > 0) ? ((bbU - bbL) / bbB) : 0.1;
  // Normalize: bbWidth of 0.05 = very tight, 0.20+ = wide
  var compressionScore = 0;
  if (bbWidth <= 0.05) compressionScore = 40;
  else if (bbWidth <= 0.08) compressionScore = 35;
  else if (bbWidth <= 0.10) compressionScore = 28;
  else if (bbWidth <= 0.13) compressionScore = 20;
  else if (bbWidth <= 0.17) compressionScore = 12;
  else if (bbWidth <= 0.22) compressionScore = 5;
  else compressionScore = 0;

  // ATR/Price ratio bonus
  var atrRatio = (atr > 0 && p > 0) ? atr / p : 0.02;
  if (atrRatio < 0.015) compressionScore = Math.min(40, compressionScore + 5);
  else if (atrRatio < 0.025) compressionScore = Math.min(40, compressionScore + 2);

  // ---- PROXIMITY TO HIGH SCORE (0-25) ----
  // Near 52w high but not extended past it
  var highProx = 0;
  if (h52 > 0 && p > 0) {
    var distFromHigh = (h52 - p) / h52; // 0 = at high, 0.05 = 5% below
    if (distFromHigh >= 0 && distFromHigh <= 0.03) highProx = 25;       // within 3% of high
    else if (distFromHigh <= 0.06) highProx = 20;
    else if (distFromHigh <= 0.10) highProx = 14;
    else if (distFromHigh <= 0.15) highProx = 8;
    else if (distFromHigh <= 0.20) highProx = 3;
    else highProx = 0;
  }

  // ---- EXTENSION PENALTY (0 to -30) ----
  // If price already ran far above recent pivot, penalize (already broken out)
  var extensionPenalty = 0;
  var ext3M = (p > 0 && stock.h3m > 0) ? (p - stock.h3m) / stock.h3m : 0;
  // ext3M < 0 means below 3M high, ext3M > 0.10 means 10% above 3M high
  if (ext3M > 0.20) extensionPenalty = -30;
  else if (ext3M > 0.12) extensionPenalty = -18;
  else if (ext3M > 0.07) extensionPenalty = -8;
  // Small extension is OK (just broke out a bit)

  // ---- RS / MOMENTUM SCORE (0-20) ----
  var rsScore = 0;
  if (stock.rs >= 0.5) rsScore = 20;
  else if (stock.rs >= 0.3) rsScore = 15;
  else if (stock.rs >= 0.1) rsScore = 10;
  else if (stock.rs >= -0.1) rsScore = 5;
  else rsScore = 0;

  // ---- VOLUME TREND SCORE (0-10) ----
  var volScore = 0;
  if (stock.vol10 > 0 && stock.vol3m > 0) {
    var volRatio = stock.vol10 / stock.vol3m;
    if (volRatio >= 1.5) volScore = 10;
    else if (volRatio >= 1.2) volScore = 7;
    else if (volRatio >= 1.0) volScore = 4;
    else if (volRatio >= 0.8) volScore = 2;
    else volScore = 0;
  } else {
    volScore = 3; // neutral if no data
  }

  // ---- RSI ZONE SCORE (0-5) ----
  var rsiScore = 0;
  if (rsi >= 50 && rsi <= 70) rsiScore = 5;
  else if (rsi >= 45 && rsi < 50) rsiScore = 3;
  else if (rsi > 70 && rsi <= 80) rsiScore = 2; // getting hot
  else if (rsi > 80) rsiScore = -3; // overbought
  else rsiScore = 0;

  // ---- TOTAL EARLY BREAKOUT SCORE ----
  var breakoutScore = compressionScore + highProx + extensionPenalty + rsScore + volScore + rsiScore;
  breakoutScore = Math.max(0, breakoutScore);

  // ==================== PULLBACK SCORING ====================
  // Must be in uptrend, pulled back to EMA support, not too deep

  // ---- PULLBACK DEPTH SCORE (0-35) ----
  // Ideal: price dipped to EMA20 or EMA50 zone and is recovering
  var pullScore = 0;
  var near20 = ema20 > 0 ? Math.abs(p - ema20) / ema20 : 1;
  var near50 = ema50 > 0 ? Math.abs(p - ema50) / ema50 : 1;

  if (near20 <= 0.02) pullScore = 35;       // hugging EMA20
  else if (near20 <= 0.04) pullScore = 28;
  else if (near20 <= 0.07) pullScore = 20;
  else if (near50 <= 0.02) pullScore = 32;  // at EMA50
  else if (near50 <= 0.04) pullScore = 25;
  else if (near50 <= 0.07) pullScore = 18;
  else if (near50 <= 0.12) pullScore = 10;
  else pullScore = 0;

  // ---- RECENT PERFORMANCE (needed some prior run) (0-25) ----
  var priorRunScore = 0;
  if (perf3M >= 30) priorRunScore = 25;
  else if (perf3M >= 20) priorRunScore = 20;
  else if (perf3M >= 12) priorRunScore = 14;
  else if (perf3M >= 6) priorRunScore = 8;
  else if (perf3M >= 0) priorRunScore = 3;
  else priorRunScore = 0;

  // ---- PULLBACK MAGNITUDE (last week performance, negative = pulled back) (0-20) ----
  var pbMag = 0;
  if (perfW <= -3 && perfW >= -12) pbMag = 20; // healthy pullback
  else if (perfW <= -1 && perfW > -3) pbMag = 12; // shallow pullback
  else if (perfW <= -12 && perfW >= -20) pbMag = 8; // deep but recoverable
  else if (perfW > -1) pbMag = 3; // barely pulled back
  else pbMag = 0; // too deep

  // ---- MACD MOMENTUM (0-10) ----
  var macdScore = 0;
  var macdHist = stock.macdM - stock.macdS;
  if (macdHist > 0) macdScore = 10;  // bullish momentum
  else if (macdHist > -0.5 * atr) macdScore = 5; // slight negative, ok
  else macdScore = 0;

  // ---- TOTAL PULLBACK SCORE ----
  var pullbackScore = pullScore + priorRunScore + pbMag + macdScore + rsScore + rsiScore;
  pullbackScore = Math.max(0, pullbackScore);

  // ==================== CLASSIFICATION ====================
  var category = null;
  var finalScore = 0;
  var reason = '';

  // Must pass basic uptrend filter for either category
  if (!inUptrend) {
    return null; // skip stocks in downtrends
  }

  // Determine category by which score is higher (with minimums)
  var MIN_BREAKOUT = 35;
  var MIN_PULLBACK = 40;

  if (breakoutScore >= MIN_BREAKOUT || pullbackScore >= MIN_PULLBACK) {
    if (breakoutScore >= pullbackScore && breakoutScore >= MIN_BREAKOUT) {
      category = 'EARLY_BREAKOUT';
      finalScore = breakoutScore;
      reason = 'Compression:' + compressionScore + ' HighProx:' + highProx + ' RS:' + rsScore + ' Vol:' + volScore;
    } else if (pullbackScore >= MIN_PULLBACK) {
      category = 'PULLBACK';
      finalScore = pullbackScore;
      reason = 'Pull:' + pullScore + ' PriorRun:' + priorRunScore + ' PBMag:' + pbMag + ' MACD:' + macdScore;
    } else if (breakoutScore >= MIN_BREAKOUT) {
      category = 'EARLY_BREAKOUT';
      finalScore = breakoutScore;
      reason = 'Compression:' + compressionScore + ' HighProx:' + highProx + ' RS:' + rsScore + ' Vol:' + volScore;
    }
  }

  if (!category) return null;

  return {
    ticker: stock.ticker,
    category: category,
    score: finalScore,
    reason: reason,
    price: stock.price,
    rsi: stock.rsi,
    adx: stock.adx,
    atr: stock.atr,
    ema20: stock.ema20,
    ema50: stock.ema50,
    ema200: stock.ema200,
    perf3M: stock.perf3M,
    perfM: stock.perfM,
    perfW: stock.perfW,
    bbWidth: bbWidth
  };
}

// ==================== MAIN SCANNER FUNCTION ====================
var _scanRunning = false;
var _lastScanTime = 0;
var SCAN_COOLDOWN = 5 * 60 * 1000; // 5 min cooldown

function runScanner(callback) {
  var now = Date.now();
  if (_scanRunning) {
    if (callback) callback(null, LS.getItem(SCANNER_RESULTS_KEY) ? JSON.parse(LS.getItem(SCANNER_RESULTS_KEY)) : []);
    return;
  }
  if ((now - _lastScanTime) < SCAN_COOLDOWN) {
    var cached = LS.getItem(SCANNER_RESULTS_KEY);
    if (cached) {
      try { if (callback) callback(null, JSON.parse(cached)); } catch(e) {}
      return;
    }
  }

  _scanRunning = true;

  buildUniverse(function(err, stocks) {
    if (err || !stocks || stocks.length === 0) {
      _scanRunning = false;
      if (callback) callback(err || new Error('Empty universe'), []);
      return;
    }

    var results = [];
    stocks.forEach(function(stock) {
      var setup = analyzeSetup(stock);
      if (setup) results.push(setup);
    });

    // Sort: EARLY_BREAKOUT by score desc, then PULLBACK by score desc
    var breakouts = results.filter(function(r) { return r.category === 'EARLY_BREAKOUT'; });
    var pullbacks = results.filter(function(r) { return r.category === 'PULLBACK'; });

    breakouts.sort(function(a, b) { return b.score - a.score; });
    pullbacks.sort(function(a, b) { return b.score - a.score; });

    // Take top 20 of each
    breakouts = breakouts.slice(0, 20);
    pullbacks = pullbacks.slice(0, 20);

    var combined = { breakouts: breakouts, pullbacks: pullbacks, timestamp: now };

    LS.setItem(SCANNER_RESULTS_KEY, JSON.stringify(combined));
    _lastScanTime = now;
    _scanRunning = false;

    if (callback) callback(null, combined);
  });
}

// ==================== UI RENDERING ====================
function renderScannerUI(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  // Show loading state
  container.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;">Running scanner...</div>';

  runScanner(function(err, results) {
    if (err || !results) {
      container.innerHTML = '<div style="padding:20px;color:#f66;">Scanner error: ' + (err ? err.message : 'unknown') + '</div>';
      return;
    }

    var breakouts = results.breakouts || [];
    var pullbacks = results.pullbacks || [];

    var html = '';

    // ---- EARLY BREAKOUTS SECTION ----
    html += '<div class="scanner-section">';
    html += '<div class="scanner-section-header breakout-header">';
    html += '<span class="section-icon">&#9650;</span>';
    html += '<span>EARLY BREAKOUTS</span>';
    html += '<span class="section-count">' + breakouts.length + '</span>';
    html += '</div>';

    if (breakouts.length === 0) {
      html += '<div class="scanner-empty">No early breakout setups found</div>';
    } else {
      html += '<div class="scanner-list">';
      breakouts.forEach(function(item, idx) {
        html += renderScannerRow(item, idx, 'breakout');
      });
      html += '</div>';
    }
    html += '</div>';

    // ---- PULLBACK ENTRIES SECTION ----
    html += '<div class="scanner-section">';
    html += '<div class="scanner-section-header pullback-header">';
    html += '<span class="section-icon">&#9660;</span>';
    html += '<span>PULLBACK ENTRIES</span>';
    html += '<span class="section-count">' + pullbacks.length + '</span>';
    html += '</div>';

    if (pullbacks.length === 0) {
      html += '<div class="scanner-empty">No pullback setups found</div>';
    } else {
      html += '<div class="scanner-list">';
      pullbacks.forEach(function(item, idx) {
        html += renderScannerRow(item, idx, 'pullback');
      });
      html += '</div>';
    }
    html += '</div>';

    container.innerHTML = html;

    // Attach click handlers
    container.querySelectorAll('.scanner-row').forEach(function(row) {
      row.addEventListener('click', function() {
        var ticker = this.getAttribute('data-ticker');
        if (ticker && typeof setActiveTicker === 'function') {
          setActiveTicker(ticker);
        }
      });
    });
  });
}

function renderScannerRow(item, idx, type) {
  var scoreColor = item.score >= 70 ? '#4CAF50' : item.score >= 50 ? '#FFC107' : '#9E9E9E';
  var perfColor  = item.perf3M >= 0 ? '#4CAF50' : '#F44336';
  var rsiColor   = item.rsi > 70 ? '#F44336' : item.rsi > 60 ? '#FFC107' : '#4CAF50';

  var html = '';
  html += '<div class="scanner-row ' + type + '-row" data-ticker="' + item.ticker + '" style="cursor:pointer;">';
  html += '<div class="row-rank">' + (idx + 1) + '</div>';
  html += '<div class="row-ticker">' + item.ticker + '</div>';
  html += '<div class="row-price">$' + item.price.toFixed(2) + '</div>';
  html += '<div class="row-score" style="color:' + scoreColor + '">' + item.score + '</div>';
  html += '<div class="row-perf" style="color:' + perfColor + '">' + (item.perf3M >= 0 ? '+' : '') + item.perf3M.toFixed(1) + '%</div>';
  html += '<div class="row-rsi" style="color:' + rsiColor + '">RSI ' + Math.round(item.rsi) + '</div>';
  html += '</div>';
  return html;
}

// ==================== SCANNER CSS ====================
function injectScannerStyles() {
  if (document.getElementById('scanner-styles')) return;
  var style = document.createElement('style');
  style.id = 'scanner-styles';
  style.textContent = [
    '.scanner-section { margin-bottom: 16px; }',
    '.scanner-section-header { display:flex; align-items:center; padding:8px 12px; font-weight:600; font-size:12px; letter-spacing:0.08em; border-radius:4px 4px 0 0; }',
    '.breakout-header { background: rgba(76,175,80,0.15); color: #4CAF50; border-bottom: 1px solid rgba(76,175,80,0.3); }',
    '.pullback-header { background: rgba(255,193,7,0.12); color: #FFC107; border-bottom: 1px solid rgba(255,193,7,0.3); }',
    '.section-icon { margin-right: 6px; }',
    '.section-count { margin-left: auto; background: rgba(255,255,255,0.1); border-radius: 10px; padding: 1px 7px; font-size: 11px; }',
    '.scanner-list { background: rgba(0,0,0,0.2); border-radius: 0 0 4px 4px; }',
    '.scanner-empty { padding: 12px; color: #666; font-size: 12px; text-align: center; font-style: italic; }',
    '.scanner-row { display:flex; align-items:center; padding:7px 12px; border-bottom:1px solid rgba(255,255,255,0.04); font-size:12px; transition:background 0.15s; }',
    '.scanner-row:last-child { border-bottom: none; }',
    '.scanner-row:hover { background: rgba(255,255,255,0.05); }',
    '.row-rank { width:20px; color:#555; font-size:11px; }',
    '.row-ticker { width:60px; font-weight:700; color:#e0e0e0; letter-spacing:0.04em; }',
    '.row-price { width:65px; color:#aaa; }',
    '.row-score { width:40px; font-weight:600; text-align:right; }',
    '.row-perf { width:55px; text-align:right; }',
    '.row-rsi { width:55px; text-align:right; color:#aaa; }'
  ].join('\n');
  document.head.appendChild(style);
}

// ==================== AUTO-BUILD INTEGRATION ====================
// Integrates with the existing MAC terminal auto-build system

var _autoBuildRunning = false;

(function() {
  // Wait for DOM and MAC terminal to be ready
  function tryInit() {
    if (typeof TV === 'undefined' || typeof LS === 'undefined') {
      setTimeout(tryInit, 500);
      return;
    }
    injectScannerStyles();
    // If there's a scanner container already in the DOM, render into it
    var scannerEl = document.getElementById('scanner-panel') ||
                    document.getElementById('scannerPanel') ||
                    document.getElementById('scanner_panel');
    if (scannerEl) {
      renderScannerUI(scannerEl.id);
    }

    // Expose globally for manual trigger
    window.MACScanner = {
      run: runScanner,
      render: renderScannerUI,
      buildUniverse: buildUniverse,
      analyzeSetup: analyzeSetup
    };
  }
  tryInit();

  // Hook into auto-build if available
  if (typeof window._autoBuildHooks === 'undefined') {
    window._autoBuildHooks = [];
  }
  window._autoBuildHooks.push(function(buildContent) {
    // Append scanner initialization to any auto-build
    if (typeof buildContent === 'string' && buildContent.indexOf('MACScanner') === -1) {
      // Scanner already loaded, just re-render if container exists
      setTimeout(function() {
        var scannerEl = document.getElementById('scanner-panel') ||
                        document.getElementById('scannerPanel') ||
                        document.getElementById('scanner_panel');
        if (scannerEl) renderScannerUI(scannerEl.id);
      }, 1000);
    }
  });

  // Periodic refresh: re-run scanner every 15 min if page is active
  setInterval(function() {
    if (document.hidden) return;
    var scannerEl = document.getElementById('scanner-panel') ||
                    document.getElementById('scannerPanel') ||
                    document.getElementById('scanner_panel');
    if (scannerEl) {
      runScanner(function(err, results) {
        if (!err && results) renderScannerUI(scannerEl.id);
      });
    }
  }, 15 * 60 * 1000);

})();

// ==================== AUTO-BUILD CONTENT GENERATOR ====================
// Called by auto-build system to get scanner JS to inject
function getScannerBuildContent() {
  _autoBuildRunning = true;
  try {
    // Return self-contained scanner init block
    var initBlock = '(function() {\n';
    initBlock += '  if (window.MACScanner) { window.MACScanner.render(\'scanner-panel\'); return; }\n';
    initBlock += '  var s = document.createElement(\'script\');\n';
    initBlock += '  s.src = \'app/js/scanner.js\';\n';
    initBlock += '  s.onload = function() { if(window.MACScanner) window.MACScanner.render(\'scanner-panel\'); };\n';
    initBlock += '  document.head.appendChild(s);\n';
    initBlock += '})();\n';
    _autoBuildRunning = false;
    return initBlock;
  } catch(e) {
    buildContent = 'Auto-build failed: ' + e.message;
  }
  _autoBuildRunning = false;
}

// ==================== AUTO-BUILD DELAYED INIT ====================
setTimeout(function() {
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      injectScannerStyles();
      var scannerEl = document.getElementById('scanner-panel') ||
                      document.getElementById('scannerPanel') ||
                      document.getElementById('scanner_panel');
      if (scannerEl && !scannerEl.hasAttribute('data-scanner-init')) {
        scannerEl.setAttribute('data-scanner-init', '1');
        renderScannerUI(scannerEl.id);
      }
    }
  } catch(e) {
    buildContent = 'Auto-build failed: ' + e.message;
  }
  _autoBuildRunning = false;
}, 2000);
