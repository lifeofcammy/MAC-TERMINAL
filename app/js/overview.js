// ==================== overview.js ====================
// Overview tab: Morning mindset, renderOverview, daily watchlist,
// economic calendar (paste-in), morning briefing copy button.

// ==================== MORNING MINDSET TOGGLE ====================
function toggleMindset() {
  var body = document.getElementById('mindset-body');
  var arrow = document.getElementById('mindset-arrow');
  if (!body) return;
  var isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
  try { localStorage.setItem('mcc_mindset_collapsed', isHidden ? 'false' : 'true'); } catch (e) {}
}

// ==================== RENDER: OVERVIEW ====================
async function renderOverview() {
  const container = document.getElementById('tab-overview');
  const ts = getTimestamp();
  const live = isMarketOpen();

  // MARKET WEEK CALENDAR + TODAY'S THEMES (replaces index strip)
  let calendarHTML = '<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px;">';
  calendarHTML += '<div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  calendarHTML += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">This Week\'s Economic Calendar</div>';
  calendarHTML += '<div style="font-size:9px;color:var(--text-muted);">' + tsLabel(ts) + ' · <a href="https://www.forexfactory.com/calendar" target="_blank" style="color:var(--blue);text-decoration:none;">ForexFactory.com</a></div></div>';

  calendarHTML += '<div id="econ-cal-grid" style="padding:16px;font-size:11px;color:var(--text-muted);text-align:center;">Loading economic calendar...</div>';
  calendarHTML += '<div style="padding:6px 16px;border-top:1px solid var(--border);display:flex;gap:12px;font-size:8px;color:var(--text-muted);">';
  calendarHTML += '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:3px;vertical-align:middle;"></span>High impact</span><span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--amber);margin-right:3px;vertical-align:middle;"></span>Medium</span><span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--text-muted);margin-right:3px;vertical-align:middle;"></span>Low</span>';
  calendarHTML += '</div></div>';

  // TODAY'S THEMES & IDEAS
  calendarHTML += '<div class="card card-hue-blue" style="padding:16px;margin-bottom:16px;">';
  calendarHTML += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
  calendarHTML += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Today\'s Morning Briefing</div>';
  calendarHTML += '<button id="briefing-copy-btn" onclick="copyBriefingPrompt()" style="padding:6px 14px;border-radius:6px;border:1px solid var(--blue);background:rgba(59,130,246,0.1);color:var(--blue);cursor:pointer;font-size:10px;font-weight:700;font-family:\'Plus Jakarta Sans\',sans-serif;">📋 Copy & Open Claude</button>';
  calendarHTML += '</div>';
  calendarHTML += '<div style="font-size:11px;color:var(--text-muted);">Fetches live news from Polygon, copies a ready-made briefing prompt to clipboard, and opens Claude in a new tab. Just paste.</div>';
  calendarHTML += '</div>';

  // MORNING MINDSET
  const mindsetRules = [
    "My job is execution, not prediction. Only job is to manage risk.",
    "Capital Conservation before Capital Growth.",
    "I only trade my edge — nothing else exists.",
    "Trading is a business, losses are business expenses.",
    "One trade means nothing.",
    "I don't need to trade — I wait to be invited.",
    "I don't fight the tape, I align with it.",
    "Hope has no room in my strategy.",
    "Boredom is a signal I'm doing this right.",
    "Fall in love with the process, the outcome will figure itself out.",
    "You are defined by how you handle losses.",
    "The market is always right, respect the market.",
    "Being wrong is okay.",
    "Always have a stop loss.",
    "Better to lose on a trade and follow your rules, than make money and not follow.",
    "Discipline and process is built day in and day out.",
    "Cut losers fast, let winners run as long as trend intact.",
    "Avoid chop, cash is a position.",
    "You have a limited number of bandwidth every day, conserve it."
  ];
  const todayIdx = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % mindsetRules.length;
  const dailyFocus = mindsetRules[todayIdx];
  const collapsed = localStorage.getItem('mcc_mindset_collapsed') === 'true';

  let mindsetHTML = '<div class="card card-hue-amber" style="margin-bottom:16px;padding:0;overflow:hidden;border-left:3px solid var(--amber);">';
  mindsetHTML += '<div onclick="toggleMindset()" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;user-select:none;">';
  mindsetHTML += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:800;">Morning Mindset</span><span class="card-badge badge-amber" style="font-size:8px;">DAILY RULES</span></div>';
  mindsetHTML += '<span id="mindset-arrow" style="font-size:12px;color:var(--text-muted);transition:transform 0.2s;">' + (collapsed ? '▶' : '▼') + '</span>';
  mindsetHTML += '</div>';

  // Daily focus highlight (always visible)
  mindsetHTML += '<div style="padding:0 16px 10px;"><div style="background:var(--bg-primary);border:1px solid rgba(230,138,0,0.2);border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:10px;">';
  mindsetHTML += '';
  mindsetHTML += '<div><div style="font-size:8px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;">Today\'s Focus</div>';
  mindsetHTML += '<div style="font-size:13px;font-weight:700;color:var(--text-primary);line-height:1.4;">' + dailyFocus + '</div></div>';
  mindsetHTML += '</div></div>';

  // Full rules (collapsible)
  mindsetHTML += '<div id="mindset-body" style="' + (collapsed ? 'display:none;' : '') + 'padding:0 16px 14px;">';
  mindsetHTML += '<div style="columns:2;column-gap:16px;">';
  mindsetRules.forEach(function(rule, i) {
    var isToday = i === todayIdx;
    mindsetHTML += '<div style="break-inside:avoid;padding:5px 0;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:flex-start;' + (isToday ? 'background:var(--amber-bg);margin:0 -4px;padding:5px 4px;border-radius:4px;' : '') + '">';
    mindsetHTML += '<span style="font-size:10px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;min-width:18px;padding-top:1px;">' + (i+1) + '.</span>';
    mindsetHTML += '<span style="font-size:12px;color:' + (isToday ? 'var(--amber)' : 'var(--text-primary)') + ';line-height:1.4;font-weight:' + (isToday ? '700' : '500') + ';">' + rule + '</span>';
    mindsetHTML += '</div>';
  });
  mindsetHTML += '</div></div></div>';

  container.innerHTML = mindsetHTML + calendarHTML + '<div id="watchlist-section"></div>';
  renderWatchlist();
  loadEconCalendar();
}

// ==================== DAILY WATCHLIST ====================
function getWatchlist() {
  try {
    const saved = localStorage.getItem('mcc_watchlist');
    return saved ? JSON.parse(saved) : [];
  } catch (e) { return []; }
}
function saveWatchlist(list) {
  try { localStorage.setItem('mcc_watchlist', JSON.stringify(list)); } catch (e) {}
}
function addToWatchlist() {
  const input = document.getElementById('wl-ticker-input');
  const noteInput = document.getElementById('wl-note-input');
  const biasSelect = document.getElementById('wl-bias-select');
  if (!input) return;
  const ticker = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!ticker) return;
  const list = getWatchlist();
  if (list.find(function(x) { return x.ticker === ticker; })) { input.value = ''; return; } // no dupes
  list.push({ ticker: ticker, note: (noteInput ? noteInput.value.trim() : ''), bias: (biasSelect ? biasSelect.value : 'long'), addedAt: new Date().toISOString() });
  saveWatchlist(list);
  input.value = '';
  if (noteInput) noteInput.value = '';
  renderWatchlist();
}
function removeFromWatchlist(ticker) {
  var list = getWatchlist().filter(function(x) { return x.ticker !== ticker; });
  saveWatchlist(list);
  renderWatchlist();
}
function clearWatchlist() {
  saveWatchlist([]);
  renderWatchlist();
}
async function renderWatchlist() {
  const el = document.getElementById('watchlist-section');
  if (!el) return;
  const list = getWatchlist();
  const ts = getTimestamp();
  const live = isMarketOpen();

  let html = '<div class="card card-hue-cyan" style="margin-top:16px;margin-bottom:16px;padding:16px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:16px;font-weight:800;">Daily Watchlist</span><span class="card-badge badge-amber">YOUR PICKS</span></div>';
  if (list.length > 0) html += '<button onclick="clearWatchlist()" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 10px;font-size:9px;color:var(--text-muted);cursor:pointer;">Clear All</button>';
  html += '</div>';

  // Add ticker form
  html += '<div style="display:flex;gap:6px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">';
  html += '<input type="text" id="wl-ticker-input" placeholder="TICKER" maxlength="5" style="width:70px;background:var(--bg-primary);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;color:var(--text-primary);text-transform:uppercase;" onkeydown="if(event.key===\'Enter\')addToWatchlist()" />';
  html += '<select id="wl-bias-select" style="background:var(--bg-primary);border:1px solid var(--border);border-radius:5px;padding:5px 6px;font-size:11px;font-weight:600;color:var(--text-primary);">';
  html += '<option value="long">▲ Long</option><option value="short">▼ Short</option><option value="watch">● Watch</option></select>';
  html += '<input type="text" id="wl-note-input" placeholder="Trade thesis / note..." style="flex:1;min-width:180px;background:var(--bg-primary);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:11px;color:var(--text-primary);" onkeydown="if(event.key===\'Enter\')addToWatchlist()" />';
  html += '<button onclick="addToWatchlist()" style="background:var(--blue);color:white;border:none;border-radius:5px;padding:6px 14px;font-size:11px;font-weight:700;cursor:pointer;">+ Add</button>';
  html += '</div>';

  if (list.length === 0) {
    html += '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;">No tickers on watchlist yet. Add symbols above to track your daily ideas.</div>';
  } else {
    // Fetch live data for all watchlist tickers
    try {
      const tickers = list.map(function(x) { return x.ticker; });
      const snap = await getSnapshots(tickers);
      const barCache = {};
      for (const t of tickers) {
        try { barCache[t] = await getDailyBars(t, 30); } catch (e) { barCache[t] = []; }
      }

      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:8px;">';

      list.forEach(function(item) {
        const s = snap[item.ticker];
        const p = s ? (s.day?.c || s.lastTrade?.p || 0) : 0;
        const prev = s ? (s.prevDay?.c || p) : 0;
        const chg = p - prev;
        const pctVal = prev > 0 ? (chg / prev) * 100 : 0;
        const todayVol = s ? (s.day?.v || 0) : 0;
        const vwap = s ? (s.day?.vw || p) : 0;
        const dayHi = s ? (s.day?.h || p) : 0;
        const dayLo = s ? (s.day?.l || p) : 0;

        // Mini SMA data
        const db = barCache[item.ticker] || [];
        const sma10 = db.length >= 10 ? db.slice(-10).reduce(function(sum, b) { return sum + b.c; }, 0) / 10 : null;
        const sma21 = db.length >= 21 ? db.slice(-21).reduce(function(sum, b) { return sum + b.c; }, 0) / 21 : null;

        // Sparkline SVG from last 20 bars
        var sparkSvg = '';
        var sparkBars = db.slice(-20);
        if (sparkBars.length > 5) {
          var sparkW = 120, sparkH = 28;
          var closes = sparkBars.map(function(b) { return b.c; });
          closes.push(p); // add current
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

        html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;border-left:3px solid ' + biasColor + ';position:relative;">';
        // Remove button
        html += '<button onclick="removeFromWatchlist(\'' + item.ticker + '\')" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;line-height:1;" title="Remove">×</button>';
        // Header
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">';
        html += '<span style="font-size:15px;font-weight:800;font-family:\'JetBrains Mono\',monospace;">' + item.ticker + '</span>';
        html += '<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:' + biasBg + ';color:' + biasColor + ';">' + biasIcon + ' ' + biasLabel + '</span>';
        if (p > 0) {
          html += '<span style="font-size:12px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + price(p) + '</span>';
          html += '<span style="font-size:11px;font-weight:700;color:' + (pctVal >= 0 ? 'var(--green)' : 'var(--red)') + ';">' + pct(pctVal) + '</span>';
        }
        html += '</div>';
        // Data row + sparkline
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
        html += '<div style="display:flex;gap:8px;font-size:9px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);">';
        if (dayHi > 0) html += '<span>H:$' + dayHi.toFixed(2) + '</span><span>L:$' + dayLo.toFixed(2) + '</span>';
        if (vwap > 0) html += '<span>VWAP:$' + vwap.toFixed(2) + '</span>';
        html += '</div>';
        html += '<div>' + sparkSvg + '</div>';
        html += '</div>';
        // SMA row
        if (sma10 || sma21) {
          html += '<div style="display:flex;gap:10px;font-size:9px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);margin-bottom:6px;">';
          if (sma10) { var aboveBelow10 = p > sma10 ? '▲' : '▼'; html += '<span>10 SMA: $' + sma10.toFixed(2) + ' ' + aboveBelow10 + '</span>'; }
          if (sma21) { var aboveBelow21 = p > sma21 ? '▲' : '▼'; html += '<span>21 SMA: $' + sma21.toFixed(2) + ' ' + aboveBelow21 + '</span>'; }
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
          html += '<div style="margin-top:5px;padding:5px 7px;background:var(--bg-primary);border-radius:4px;border-left:2px solid ' + biasColor + ';font-size:10px;color:var(--text-secondary);line-height:1.4;font-style:italic;">' + item.note.replace(/</g, '&lt;') + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    } catch (e) {
      html += '<div style="color:var(--red);font-size:11px;">Error loading watchlist data: ' + e.message + '</div>';
    }
  }

  html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:8px;color:var(--text-muted);">';
  html += '<span>Source: <span style="font-weight:600;">Polygon.io</span> Snapshots + Daily Bars</span>';
  html += '<span>' + new Date().toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'}) + '</span>';
  html += '</div>';

  html += '</div>';
  el.innerHTML = html;
}


// ==================== FINNHUB ECONOMIC CALENDAR ====================
// ==================== ECONOMIC CALENDAR (paste-in) ====================

async function loadEconCalendar() {
  var el = document.getElementById('econ-cal-grid');
  if (!el) return;

  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  var cacheKey = 'mtp_econ_cal_ff_' + monday.toISOString().split('T')[0];

  var saved = null;
  try { var raw = localStorage.getItem(cacheKey); if (raw) saved = JSON.parse(raw); } catch(e) {}

  if (saved && saved.text) {
    renderPastedCal(el, saved.text, saved.ts);
  } else {
    showCalPasteBox(el);
  }
}

function showCalPasteBox(el) {
  var html = '<div style="padding:12px 14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  html += '<span style="font-size:9px;color:var(--text-muted);">Paste USD events from FF (Medium + High impact)</span>';
  html += '<a href="https://www.forexfactory.com/calendar" target="_blank" style="padding:4px 10px;border-radius:4px;border:1px solid var(--blue);background:rgba(59,130,246,0.08);color:var(--blue);font-size:9px;font-weight:700;text-decoration:none;">Forex Factory ↗</a>';
  html += '</div>';
  html += '<textarea id="econ-cal-paste" placeholder="Select USD rows on Forex Factory → Copy → Paste here" style="width:100%;height:100px;background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;padding:8px;font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--text-primary);resize:vertical;box-sizing:border-box;line-height:1.5;"></textarea>';
  html += '<button onclick="saveEconCal()" style="margin-top:6px;padding:5px 14px;border-radius:4px;border:1px solid var(--green);background:rgba(0,135,90,0.08);color:var(--green);cursor:pointer;font-size:9px;font-weight:700;">Save</button>';
  html += '</div>';
  el.innerHTML = html;
}

function saveEconCal() {
  var textarea = document.getElementById('econ-cal-paste');
  if (!textarea || !textarea.value.trim()) return;

  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  var cacheKey = 'mtp_econ_cal_ff_' + monday.toISOString().split('T')[0];

  try { localStorage.setItem(cacheKey, JSON.stringify({ text: textarea.value.trim(), ts: Date.now() })); } catch(e) {}

  var el = document.getElementById('econ-cal-grid');
  renderPastedCal(el, textarea.value.trim(), Date.now());
}

function clearEconCal() {
  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  var cacheKey = 'mtp_econ_cal_ff_' + monday.toISOString().split('T')[0];
  try { localStorage.removeItem(cacheKey); } catch(e) {}
  var el = document.getElementById('econ-cal-grid');
  showCalPasteBox(el);
}

function renderPastedCal(el, text, ts) {
  // Parse the pasted FF data — identify events by looking for known patterns
  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

  // Try to identify event blocks: USD line → event name → numbers/time
  var events = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];

    // Skip pure "USD" currency markers
    if (line === 'USD') { i++; continue; }

    // Check if this looks like a time (e.g., "7:45am", "8:30am", "10:00am")
    if (/^\d{1,2}:\d{2}(am|pm)$/i.test(line)) { i++; continue; }

    // Check if this looks like an event name (contains letters, not just numbers/%)
    if (/[a-zA-Z]{3,}/.test(line) && !/^\d/.test(line)) {
      var ev = { name: line, details: '' };

      // Look ahead for data lines (numbers, percentages, K, M, B values)
      var dataLines = [];
      var j = i + 1;
      while (j < lines.length) {
        var next = lines[j];
        if (next === 'USD') break;
        // If it looks like another event name (has 3+ letters, not starting with digit)
        if (/[a-zA-Z]{3,}/.test(next) && !/^[\d\-]/.test(next) && !/^\d{1,2}:\d{2}/.test(next) && !/%|[KMB]$/.test(next)) break;
        dataLines.push(next);
        j++;
      }

      if (dataLines.length > 0) {
        ev.details = dataLines.join(' · ');
      }
      events.push(ev);
      i = j;
    } else {
      i++;
    }
  }

  var html = '<div style="padding:10px 14px;max-height:280px;overflow-y:auto;">';

  if (events.length > 0) {
    events.forEach(function(ev) {
      var name = ev.name.toLowerCase();
      var isHigh = /gdp|pce|cpi|nonfarm|payroll|fomc|fed fund|interest rate|unemployment rate|retail sales|ism manu/.test(name);
      var isMed = /pmi|housing|home sale|consumer confidence|jobless|claim|durable|sentiment|philly|empire|pending|trump speaks|president/.test(name);
      var dotColor = isHigh ? 'var(--red)' : isMed ? 'var(--amber)' : 'var(--text-muted)';
      var dot = '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;margin-top:3px;"></span>';

      html += '<div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:4px;font-size:9px;">';
      html += dot;
      html += '<span style="color:var(--text-primary);font-weight:600;">' + ev.name + '</span>';
      if (ev.details) html += '<span style="color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;font-size:8px;margin-left:2px;">' + ev.details + '</span>';
      html += '</div>';
    });
  } else {
    html += '<div style="white-space:pre-wrap;font-family:\'JetBrains Mono\',monospace;font-size:9px;line-height:1.5;color:var(--text-secondary);">' + text.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
  }

  html += '</div>';

  // Footer
  var fetchTime = new Date(ts).toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',hour12:true});
  html += '<div style="padding:6px 12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-size:8px;color:var(--text-muted);">';
  html += '<span>Source: <a href="https://www.forexfactory.com/calendar" target="_blank" style="color:var(--blue);text-decoration:none;font-weight:600;">ForexFactory.com</a> · ' + fetchTime + '</span>';
  html += '<button onclick="clearEconCal()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:2px 8px;font-size:8px;color:var(--text-muted);cursor:pointer;">Update</button>';
  html += '</div>';

  el.innerHTML = html;
}

// ==================== COPY BRIEFING PROMPT ====================
async function copyBriefingPrompt() {
  var btn = document.getElementById('briefing-copy-btn');

  var prompt = 'Generate my morning trading briefing for today. 1. MACRO THEMES — 2-3 sentences on what\'s driving markets 2. SECTOR OUTLOOK — what\'s hot, what\'s cold, rotation signals 3. TOP 5 TRADE IDEAS — specific tickers with key levels and direction 4. RISK EVENTS — earnings, fed speakers, geopolitical catalysts 5. KEY LEVELS — SPY and QQQ support/resistance for the session';

  navigator.clipboard.writeText(prompt).then(function() {
    btn.innerHTML = '✓ Copied!';
    btn.style.borderColor = 'var(--green)';
    btn.style.color = 'var(--green)';
    btn.style.background = 'rgba(34,197,94,0.1)';
    window.open('https://claude.ai', '_blank');
    setTimeout(function() {
      btn.innerHTML = '📋 Copy & Open Claude';
      btn.style.borderColor = 'var(--blue)';
      btn.style.color = 'var(--blue)';
      btn.style.background = 'rgba(59,130,246,0.1)';
    }, 3000);
  }).catch(function() {
    btn.innerHTML = '⚠ Copy failed';
    btn.style.borderColor = 'var(--red)';
    btn.style.color = 'var(--red)';
    setTimeout(function() {
      btn.innerHTML = '📋 Copy & Open Claude';
      btn.style.borderColor = 'var(--blue)';
      btn.style.color = 'var(--blue)';
      btn.style.background = 'rgba(59,130,246,0.1)';
    }, 2000);
  });
}

