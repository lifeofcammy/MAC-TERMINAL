// ==================== csv-import.js ====================
// Universal trade CSV/text importer — works with any trading platform.
// Auto-detects columns from CSV headers and maps them to MAC Terminal's
// internal trade format. Supports: TOS, Webull, IBKR, Robinhood,
// TradeStation, and any generic CSV with standard column names.
//
// Approach: Instead of hardcoding each platform's format, we use a
// smart column mapper that recognizes common header variations.

// ── COLUMN RECOGNITION PATTERNS ──
// Each key is our internal field name. Values are possible CSV header
// names (lowercased, trimmed) that could represent that field.
const COLUMN_MAP = {
  date: [
    'date', 'trade date', 'exec date', 'execution date', 'exec time',
    'order date', 'fill date', 'close date', 'settlement date',
    'datetime', 'date/time', 'date time', 'time', 'executed at',
    'activity date', 'transaction date', 'run date', 'process date'
  ],
  symbol: [
    'symbol', 'ticker', 'sym', 'instrument', 'stock', 'underlying',
    'underlying symbol', 'name', 'security', 'asset', 'description'
  ],
  side: [
    'side', 'action', 'type', 'transaction type', 'trans type',
    'buy/sell', 'buy sell', 'direction', 'order action', 'trade type',
    'pos effect', 'position effect', 'activity type'
  ],
  quantity: [
    'qty', 'quantity', 'shares', 'amount', 'contracts', 'size',
    'filled qty', 'fill qty', 'exec qty', 'executed qty', 'trade qty',
    'volume', 'lots', 'order qty', 'qty filled'
  ],
  price: [
    'price', 'fill price', 'exec price', 'execution price', 'avg price',
    'average price', 'trade price', 'net price', 'unit price', 'cost',
    'cost basis', 'fill_price', 'avg_price'
  ],
  pnl: [
    'p&l', 'pnl', 'p/l', 'profit', 'profit/loss', 'gain/loss',
    'realized p&l', 'realized pnl', 'net p&l', 'net profit',
    'realized p/l', 'pl', 'gain', 'return', 'total p/l', 'amount',
    'net amount', 'proceeds'
  ],
  fees: [
    'commission', 'fees', 'fee', 'comm', 'commissions', 'total fees',
    'transaction fee', 'reg fee', 'ecn fee', 'sec fee'
  ],
  optionType: [
    'option type', 'call/put', 'call put', 'c/p', 'put/call',
    'contract type', 'right'
  ],
  strike: [
    'strike', 'strike price', 'strike_price'
  ],
  expiration: [
    'exp', 'expiration', 'expiry', 'expiration date', 'exp date'
  ],
  entryExit: [
    'pos effect', 'position effect', 'open/close', 'opening/closing',
    'open close', 'entry/exit'
  ]
};

// ── CSV PARSER (handles quoted fields, commas inside quotes, etc.) ──
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── DETECT DELIMITER ──
function detectDelimiter(text) {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  const tabs = (firstLines.match(/\t/g) || []).length;
  const commas = (firstLines.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

// ── SMART HEADER MATCHER ──
// Given an array of header strings, returns a map of our internal field
// names to column indices. Returns null for fields that couldn't be matched.
function matchHeaders(headers) {
  const normalized = headers.map(h => h.toLowerCase().replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim());
  const mapping = {};

  Object.keys(COLUMN_MAP).forEach(field => {
    const candidates = COLUMN_MAP[field];
    let bestIdx = -1;
    // Exact match first
    for (let i = 0; i < normalized.length; i++) {
      if (candidates.includes(normalized[i])) {
        bestIdx = i;
        break;
      }
    }
    // Partial match fallback
    if (bestIdx === -1) {
      for (let i = 0; i < normalized.length; i++) {
        for (const c of candidates) {
          if (normalized[i].includes(c) || c.includes(normalized[i])) {
            bestIdx = i;
            break;
          }
        }
        if (bestIdx !== -1) break;
      }
    }
    mapping[field] = bestIdx >= 0 ? bestIdx : null;
  });

  return mapping;
}

// ── DETECT IF THIS IS A TOS FORMAT ──
// TOS CSVs have sections like "Filled Orders", "Canceled Orders" etc.
function isTOSFormat(text) {
  return /^Filled Orders/im.test(text) || /^Canceled Orders/im.test(text) ||
    (/Account Statement/i.test(text) && /Exec Time/i.test(text));
}

// ── DETECT IF THIS IS IBKR FORMAT ──
// IBKR CSVs have section names as the first column
function isIBKRFormat(text) {
  return /^Trades,Header/m.test(text) || /^"?Trades"?,/m.test(text) ||
    /^Statement,/m.test(text);
}

// ── PARSE DATE (flexible) ──
function parseFlexDate(str) {
  if (!str) return null;
  str = str.trim();

  // ISO format: 2024-01-15 or 2024-01-15T10:30:00
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // US format: 1/15/2024 or 01/15/2024 or 1/15/24
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let yr = +m[3];
    if (yr < 100) yr += 2000;
    return new Date(yr, +m[1] - 1, +m[2]);
  }

  // EU format: 15-01-2024 or 15.01.2024
  m = str.match(/^(\d{1,2})[\-\.](\d{1,2})[\-\.](\d{2,4})/);
  if (m) {
    let yr = +m[3];
    if (yr < 100) yr += 2000;
    // If first number > 12, assume DD-MM-YYYY
    if (+m[1] > 12) return new Date(yr, +m[2] - 1, +m[1]);
    return new Date(yr, +m[1] - 1, +m[2]);
  }

  // IBKR format: 20240115 (YYYYMMDD)
  m = str.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // Fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ── PARSE TIME from a datetime string ──
function parseFlexTime(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return m[1].padStart(2, '0') + ':' + m[2];

  // IBKR format: 103045 (HHMMSS)
  const m2 = str.match(/;?(\d{2})(\d{2})(\d{2})$/);
  if (m2) return m2[1] + ':' + m2[2];

  return null;
}

// ── DETECT SIDE (buy/sell/long/short) ──
function parseSide(sideStr, posEffect) {
  if (!sideStr) return null;
  const s = sideStr.toUpperCase().trim();

  // If we have position effect (TOS style), use it with side
  if (posEffect) {
    const pe = posEffect.toUpperCase().trim();
    if (s === 'BUY' && pe.includes('OPEN')) return 'BUY_OPEN';
    if (s === 'BUY' && pe.includes('CLOSE')) return 'BUY_CLOSE';
    if (s === 'SELL' && pe.includes('OPEN')) return 'SELL_OPEN';
    if (s === 'SELL' && pe.includes('CLOSE')) return 'SELL_CLOSE';
  }

  if (['BUY', 'BOT', 'BOUGHT', 'B', 'LONG', 'BUY_OPEN', 'BTO'].includes(s)) return 'BUY';
  if (['SELL', 'SLD', 'SOLD', 'S', 'SHORT', 'SELL_CLOSE', 'STC'].includes(s)) return 'SELL';
  if (s.includes('BUY')) return 'BUY';
  if (s.includes('SELL') || s.includes('SLD') || s.includes('SOLD')) return 'SELL';

  return null;
}

// ── PARSE IBKR CSV ──
function parseIBKR(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const trades = [];
  let tradeHeaders = null;

  for (const line of lines) {
    const row = parseCSVLine(line);
    if (row[0] === 'Trades' && row[1] === 'Header') {
      tradeHeaders = row.slice(2).map(h => h.toLowerCase().trim());
      continue;
    }
    if (row[0] === 'Trades' && row[1] === 'Data' && tradeHeaders) {
      const data = row.slice(2);
      const g = key => {
        const idx = tradeHeaders.indexOf(key);
        return idx >= 0 && data[idx] ? data[idx].trim() : null;
      };

      const sym = g('symbol');
      if (!sym) continue;

      const dateStr = g('date/time') || g('tradetime') || g('datetime') || '';
      const date = parseFlexDate(dateStr);
      const time = parseFlexTime(dateStr);
      const qty = Math.abs(parseFloat(g('quantity') || g('qty') || '0'));
      const price = parseFloat(g('t. price') || g('price') || g('tradeprice') || '0');
      const pnl = parseFloat(g('realized p/l') || g('realized p&l') || g('mtm p/l') || '0');
      const commission = parseFloat(g('comm/fee') || g('commission') || '0');
      const code = g('code') || '';

      trades.push({
        date: date ? date.toISOString().split('T')[0] : null,
        time: time,
        ticker: sym.replace(/\s+/g, ' ').split(' ')[0], // Get root symbol
        side: qty >= 0 ? 'BUY' : 'SELL',
        quantity: Math.abs(qty),
        price: price,
        pnl: pnl - Math.abs(commission),
        fees: Math.abs(commission),
        isOption: code.includes('O') || sym.includes(' '),
        raw: { sym, code }
      });
    }
  }

  return consolidateTrades(trades);
}

// ── UNIVERSAL CSV PARSER ──
// Works with any CSV that has recognizable column headers
function parseUniversalCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Find the header row — it's the first row that has multiple recognizable column names
  let headerIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const row = parseCSVLine(lines[i]);
    const normalized = row.map(h => h.toLowerCase().replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim());
    let score = 0;
    Object.values(COLUMN_MAP).forEach(candidates => {
      for (const h of normalized) {
        if (candidates.some(c => h === c || h.includes(c))) {
          score++;
          break;
        }
      }
    });
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }

  if (headerIdx === -1 || bestScore < 2) return []; // Need at least 2 recognized columns

  const headers = parseCSVLine(lines[headerIdx]);
  const mapping = matchHeaders(headers);

  // We need at minimum: symbol + (price or pnl)
  if (mapping.symbol === null && mapping.pnl === null) return [];

  const trades = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < 2) continue;

    const get = field => mapping[field] !== null && row[mapping[field]] ? row[mapping[field]].trim() : null;

    const ticker = get('symbol');
    if (!ticker || !/[A-Z]/i.test(ticker)) continue; // Skip rows without a valid symbol

    const dateStr = get('date') || '';
    const date = parseFlexDate(dateStr);
    const time = parseFlexTime(dateStr);

    const sideStr = get('side') || '';
    const entryExitStr = get('entryExit') || '';
    const side = parseSide(sideStr, entryExitStr);

    const qty = Math.abs(parseFloat(get('quantity') || '0') || 0);
    const price = Math.abs(parseFloat((get('price') || '0').replace(/[$,]/g, '')) || 0);
    const pnl = parseFloat((get('pnl') || '0').replace(/[$,]/g, '').replace(/[()]/g, m => m === '(' ? '-' : '')) || 0;
    const fees = Math.abs(parseFloat((get('fees') || '0').replace(/[$,]/g, '')) || 0);
    const optType = get('optionType');
    const strike = get('strike');
    const exp = get('expiration');

    trades.push({
      date: date ? date.toISOString().split('T')[0] : null,
      time: time,
      ticker: ticker.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6),
      side: side || (pnl !== 0 ? 'CLOSED' : null),
      quantity: qty || 1,
      price: price,
      pnl: pnl - fees,
      fees: fees,
      isOption: !!(optType || strike || exp),
      optionType: optType,
      strike: strike,
      expiration: exp,
      raw: {}
    });
  }

  return consolidateTrades(trades);
}

// ── CONSOLIDATE TRADES ──
// Groups individual executions into round-trip trades where possible,
// or returns them as individual trade entries
function consolidateTrades(rawTrades) {
  if (!rawTrades.length) return [];

  // If trades already have P&L values, use them directly
  const hasPnL = rawTrades.some(t => t.pnl !== 0);
  if (hasPnL) {
    // Group by date + ticker and aggregate
    const grouped = {};
    rawTrades.forEach(t => {
      const key = (t.date || 'unknown') + '_' + t.ticker;
      if (!grouped[key]) {
        grouped[key] = {
          date: t.date,
          ticker: t.ticker,
          pnl: 0,
          quantity: 0,
          trades: 0,
          entryPrice: 0,
          exitPrice: 0,
          entryTime: t.time,
          isOption: t.isOption,
          fees: 0
        };
      }
      grouped[key].pnl += t.pnl;
      grouped[key].quantity += t.quantity;
      grouped[key].trades++;
      grouped[key].fees += t.fees;
      if (t.price > 0) {
        if (t.side === 'BUY' || t.side === 'BUY_OPEN') {
          grouped[key].entryPrice = t.price;
          grouped[key].entryTime = t.time;
        } else if (t.side === 'SELL' || t.side === 'SELL_CLOSE') {
          grouped[key].exitPrice = t.price;
        }
      }
    });

    return Object.values(grouped).filter(t => t.pnl !== 0 || t.quantity > 0);
  }

  // If no P&L, try to match buys with sells to create round trips
  const byTicker = {};
  rawTrades.forEach(t => {
    if (!byTicker[t.ticker]) byTicker[t.ticker] = { buys: [], sells: [] };
    if (t.side === 'BUY' || t.side === 'BUY_OPEN') byTicker[t.ticker].buys.push(t);
    else if (t.side === 'SELL' || t.side === 'SELL_CLOSE') byTicker[t.ticker].sells.push(t);
  });

  const roundTrips = [];
  Object.entries(byTicker).forEach(([ticker, { buys, sells }]) => {
    let bi = 0, si = 0;
    while (bi < buys.length && si < sells.length) {
      const buy = buys[bi], sell = sells[si];
      const matchQty = Math.min(buy.quantity, sell.quantity);
      const mult = buy.isOption ? 100 : 1;
      const pnl = (sell.price - buy.price) * matchQty * mult;

      roundTrips.push({
        date: buy.date || sell.date,
        ticker: ticker,
        pnl: parseFloat(pnl.toFixed(2)),
        quantity: matchQty,
        entryPrice: buy.price,
        exitPrice: sell.price,
        entryTime: buy.time,
        isOption: buy.isOption,
        fees: (buy.fees || 0) + (sell.fees || 0),
        trades: 1
      });

      buy.quantity -= matchQty;
      sell.quantity -= matchQty;
      if (buy.quantity <= 0) bi++;
      if (sell.quantity <= 0) si++;
    }
  });

  return roundTrips;
}

// ── MAIN ENTRY POINT ──
// Takes raw text (CSV or pasted data), auto-detects format, returns
// an array of normalized trade objects ready for the journal.
function universalTradeImport(text) {
  if (!text || !text.trim()) return { trades: [], platform: 'unknown', error: 'No data provided' };

  const trimmed = text.trim();

  // 1. Check if it's TOS format — if so, use the existing TOS parser
  if (isTOSFormat(trimmed)) {
    try {
      const parsed = parseTosCSV(trimmed);
      const { completed } = matchRoundTrips(parsed);
      const trades = completed.map(t => ({
        date: (() => {
          if (!t.entryTime) return null;
          const m = t.entryTime.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
          if (m) {
            let yr = +m[3]; if (yr < 100) yr += 2000;
            return yr + '-' + String(+m[1]).padStart(2, '0') + '-' + String(+m[2]).padStart(2, '0');
          }
          return null;
        })(),
        ticker: t.sym,
        pnl: t.pnlDollar,
        quantity: t.qty,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        entryTime: parseFlexTime(t.entryTime),
        exitTime: parseFlexTime(t.exitTime),
        holdMins: t.holdMins,
        isOption: t.isOption,
        optionType: t.optType,
        strike: t.strike,
        rr: t.rr,
        stopPrice: t.stopPrice,
        isLong: t.isLong,
        trades: 1,
        fees: 0
      }));
      return { trades, platform: 'ThinkOrSwim', error: null };
    } catch (e) {
      return { trades: [], platform: 'ThinkOrSwim', error: 'Failed to parse TOS data: ' + e.message };
    }
  }

  // 2. Check if it's IBKR format
  if (isIBKRFormat(trimmed)) {
    try {
      const trades = parseIBKR(trimmed);
      return { trades, platform: 'Interactive Brokers', error: trades.length ? null : 'No trades found in IBKR data' };
    } catch (e) {
      return { trades: [], platform: 'Interactive Brokers', error: 'Failed to parse IBKR data: ' + e.message };
    }
  }

  // 3. Try universal CSV parser
  try {
    const trades = parseUniversalCSV(trimmed);
    if (trades.length > 0) {
      return { trades, platform: 'Auto-Detected', error: null };
    }
  } catch (e) {}

  return { trades: [], platform: 'unknown', error: 'Could not recognize the data format. Make sure your CSV has column headers like Symbol, Date, Price, Quantity, P&L.' };
}

// ── IMPORT TRADES INTO JOURNAL ──
// Takes the output of universalTradeImport and saves to the journal database
function importTradesToJournal(importResult) {
  if (!importResult.trades || !importResult.trades.length) return 0;

  const journal = getJournal();
  let imported = 0;

  importResult.trades.forEach(t => {
    if (!t.ticker) return;

    const trade = {
      id: 'T' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      date: t.date || new Date().toISOString().split('T')[0],
      ticker: t.ticker,
      strategy: t.isOption ? (t.optionType || 'Options') : 'Equity',
      direction: t.isLong !== undefined ? (t.isLong ? 'Long' : 'Short') : (t.side === 'BUY' ? 'Long' : 'Short'),
      entry: t.entryPrice || 0,
      exit: t.exitPrice || 0,
      pl: t.pnl || 0,
      contracts: t.quantity || 1,
      entryTime: t.entryTime || null,
      exitTime: t.exitTime || null,
      holdMinutes: t.holdMins || null,
      isWin: (t.pnl || 0) > 0,
      dte: null,
      strikeWidth: null,
      shortStrike: t.strike || null,
      longStrike: null,
      marketCondition: null,
      scannerGrade: null,
      rvol: null,
      notes: 'Imported from ' + (importResult.platform || 'CSV'),
      importedAt: new Date().toISOString()
    };

    journal.push(trade);
    imported++;
  });

  saveJournal(journal);
  return imported;
}

// ── UPDATE CALENDAR FROM IMPORTED TRADES ──
function updateCalendarFromImport(importResult) {
  if (!importResult.trades || !importResult.trades.length) return;

  const summaries = JSON.parse(localStorage.getItem('mtp_cal_summaries') || '{}');

  // Group P&L by date
  const byDate = {};
  importResult.trades.forEach(t => {
    const d = t.date || new Date().toISOString().split('T')[0];
    if (!byDate[d]) byDate[d] = 0;
    byDate[d] += (t.pnl || 0);
  });

  // Update summaries
  Object.entries(byDate).forEach(([dateKey, pnl]) => {
    summaries[dateKey] = parseFloat(((summaries[dateKey] || 0) + pnl).toFixed(2));
  });

  localStorage.setItem('mtp_cal_summaries', JSON.stringify(summaries));
  // Cloud sync
  if (typeof dbSaveCalSummaries === 'function' && typeof getUser === 'function' && getUser()) {
    dbSaveCalSummaries(summaries).catch(function(e) {});
  }
}
