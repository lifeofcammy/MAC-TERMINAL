// ==================== watchlist.js ====================
// Watchlist tab: manual ticker entry + live data tracking.
// Moved from overview.js into its own dedicated tab.

function getWatchlist() {
  try {
    var saved = localStorage.getItem('mcc_watchlist');
    return saved ? JSON.parse(saved) : [];
  } catch (e) { return []; }
}
function saveWatchlist(list) {
  try { localStorage.setItem('mcc_watchlist', JSON.stringify(list)); } catch (e) {}
}
function addToWatchlist() {
  var input = document.getElementById('wl-ticker-input');
  var noteInput = document.getElementById('wl-note-input');
  var biasSelect = document.getElementById('wl-bias-select');
  if (!input) return;
  var ticker = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!ticker) return;
  var list = getWatchlist();
  if (list.find(function(x) { return x.ticker === ticker; })) { input.value = ''; return; }
  list.push({ ticker: ticker, note: (noteInput ? noteInput.value.trim() : ''), bias: (biasSelect ? biasSelect.value : 'long'), addedAt: new Date().toISOString() });
  saveWatchlist(list);
  input.value = '';
  if (noteInput) noteInput.value = '';
  renderWatchlistTab();
}
function removeFromWatchlist(ticker) {
  var list = getWatchlist().filter(function(x) { return x.ticker !== ticker; });
  saveWatchlist(list);
  renderWatchlistTab();
}
function clearWatchlist() {
  saveWatchlist([]);
  renderWatchlistTab();
}

async function renderWatchlistTab() {
  var container = document.getElementById('tab-watchlist');
  if (!container) return;
  var list = getWatchlist();
  var ts = getTimestamp();
  var live = isMarketOpen();

  var html = '';

  // Header
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">';
  html += '<div>';
  html += '<div class="section-title" style="margin:0;"><span class="dot" style="background:var(--cyan)"></span> Watchlist</div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Track your daily ideas with live data</div>';
  html += '</div>';
  if (list.length > 0) {
    html += '<button onclick="clearWatchlist()" style="background:none;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:10px;color:var(--text-muted);cursor:pointer;font-family:\'Inter\',sans-serif;font-weight:600;">Clear All</button>';
  }
  html += '</div>';

  // Add ticker form
  html += '<div class="card" style="padding:14px 16px;margin-bottom:16px;">';
  html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
  html += '<input type="text" id="wl-ticker-input" placeholder="TICKER" maxlength="5" style="width:80px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:700;color:var(--text-primary);text-transform:uppercase;" onkeydown="if(event.key===\'Enter\')addToWatchlist()" />';
  html += '<select id="wl-bias-select" style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px;font-weight:600;color:var(--text-primary);font-family:\'Inter\',sans-serif;">';
  html += '<option value="long">▲ Long</option><option value="short">▼ Short</option><option value="watch">● Watch</option></select>';
  html += '<input type="text" id="wl-note-input" placeholder="Trade thesis / notes..." style="flex:1;min-width:200px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;color:var(--text-primary);" onkeydown="if(event.key===\'Enter\')addToWatchlist()" />';
  html += '<button onclick="addToWatchlist()" style="background:var(--blue);color:white;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'Inter\',sans-serif;">+ Add</button>';
  html += '</div></div>';

  if (list.length === 0) {
    html += '<div class="card" style="text-align:center;padding:40px;color:var(--text-muted);">';
    html += '<div style="font-size:20px;margin-bottom:8px;">—</div>';
    html += '<div style="font-size:14px;font-weight:600;color:var(--text-primary);">No tickers on your watchlist</div>';
    html += '<div style="font-size:11px;margin-top:4px;">Add symbols above to track them with live data, sparklines, and position sizing.</div>';
    html += '</div>';
  } else {
    // Fetch live data
    try {
      var tickers = list.map(function(x) { return x.ticker; });
      var snap = await getSnapshots(tickers);
      var barCache = {};
      for (var bi = 0; bi < tickers.length; bi++) {
        try { barCache[tickers[bi]] = await getDailyBars(tickers[bi], 30); } catch (e) { barCache[tickers[bi]] = []; }
      }

      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));gap:10px;">';

      list.forEach(function(item) {
        var s = snap[item.ticker];
        var p = s ? (s.day && s.day.c ? s.day.c : (s.lastTrade ? s.lastTrade.p : 0)) : 0;
        var prev = s ? (s.prevDay ? s.prevDay.c : p) : 0;
        var chg = p - prev;
        var pctVal = prev > 0 ? (chg / prev) * 100 : 0;
        var todayVol = s ? (s.day ? s.day.v : 0) : 0;
        var vwap = s ? (s.day ? s.day.vw : p) : 0;
        var dayHi = s ? (s.day ? s.day.h : p) : 0;
        var dayLo = s ? (s.day ? s.day.l : p) : 0;

        var db = barCache[item.ticker] || [];
        var sma10 = db.length >= 10 ? db.slice(-10).reduce(function(sum, b) { return sum + b.c; }, 0) / 10 : null;
        var sma21 = db.length >= 21 ? db.slice(-21).reduce(function(sum, b) { return sum + b.c; }, 0) / 21 : null;

        // Sparkline
        var sparkSvg = '';
        var sparkBars = db.slice(-20);
        if (sparkBars.length > 5) {
          var sparkW = 140, sparkH = 32;
          var closes = sparkBars.map(function(b) { return b.c; });
          closes.push(p);
          var sMin = Math.min.apply(null, closes);
          var sMax = Math.max.apply(null, closes);
          var sRange = sMax - sMin || 1;
          var pts = closes.map(function(v, idx) {
            return (idx / (closes.length - 1)) * sparkW + ',' + (sparkH - 2 - ((v - sMin) / sRange) * (sparkH - 4));
          }).join(' ');
          var lineColor = pctVal >= 0 ? 'var(--green)' : 'var(--red)';
          sparkSvg = '<svg width="' + sparkW + '" height="' + sparkH + '" viewBox="0 0 ' + sparkW + ' ' + sparkH + '"><polyline points="' + pts + '" fill="none" stroke="' + lineColor + '" stroke-width="1.5" /></svg>';
        }

        var biasColor = item.bias === 'long' ? 'var(--green)' : item.bias === 'short' ? 'var(--red)' : 'var(--amber)';
        var biasBg = item.bias === 'long' ? 'var(--green-bg)' : item.bias === 'short' ? 'var(--red-bg)' : 'var(--amber-bg)';
        var biasIcon = item.bias === 'long' ? '▲' : item.bias === 'short' ? '▼' : '●';
        var biasLabel = item.bias.toUpperCase();

        html += '<div class="card" style="padding:12px 14px;border-left:3px solid ' + biasColor + ';position:relative;">';
        html += '<button onclick="removeFromWatchlist(\'' + item.ticker + '\')" style="position:absolute;top:8px;right:10px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;line-height:1;" title="Remove">×</button>';

        // Header
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
        html += '<span style="font-size:17px;font-weight:800;font-family:\'JetBrains Mono\',monospace;">' + item.ticker + '</span>';
        html += '<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;background:' + biasBg + ';color:' + biasColor + ';">' + biasIcon + ' ' + biasLabel + '</span>';
        if (p > 0) {
          html += '<span style="font-size:14px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + price(p) + '</span>';
          html += '<span style="font-size:12px;font-weight:700;color:' + (pctVal >= 0 ? 'var(--green)' : 'var(--red)') + ';">' + pct(pctVal) + '</span>';
        }
        html += '</div>';

        // Data + sparkline
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
        html += '<div style="display:flex;gap:10px;font-size:10px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);">';
        if (dayHi > 0) html += '<span>H:$' + dayHi.toFixed(2) + '</span><span>L:$' + dayLo.toFixed(2) + '</span>';
        if (vwap > 0) html += '<span>VWAP:$' + vwap.toFixed(2) + '</span>';
        html += '</div>';
        html += '<div>' + sparkSvg + '</div>';
        html += '</div>';

        // SMA row
        if (sma10 || sma21) {
          html += '<div style="display:flex;gap:12px;font-size:10px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);margin-bottom:8px;">';
          if (sma10) html += '<span>10 SMA: $' + sma10.toFixed(2) + ' ' + (p > sma10 ? '▲' : '▼') + '</span>';
          if (sma21) html += '<span>21 SMA: $' + sma21.toFixed(2) + ' ' + (p > sma21 ? '▲' : '▼') + '</span>';
          html += '</div>';
        }

        // Position sizing
        if (p > 0) {
          var entryEst = p;
          var stopEst = item.bias === 'short' ? p * 1.05 : p * 0.95;
          html += sizingHTML(entryEst, stopEst);
        }

        // Note
        if (item.note) {
          html += '<div style="margin-top:8px;padding:6px 8px;background:var(--bg-secondary);border-radius:5px;border-left:2px solid ' + biasColor + ';font-size:11px;color:var(--text-secondary);line-height:1.4;font-style:italic;">' + item.note.replace(/</g, '&lt;') + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    } catch (e) {
      html += '<div class="card" style="color:var(--red);font-size:11px;padding:16px;">Error loading watchlist data: ' + e.message + '</div>';
    }
  }

  // Footer
  html += '<div style="margin-top:12px;display:flex;justify-content:space-between;font-size:8px;color:var(--text-muted);">';
  html += '<span>Source: Polygon.io Snapshots + Daily Bars</span>';
  html += '<span>' + new Date().toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'}) + '</span>';
  html += '</div>';

  container.innerHTML = html;
}
