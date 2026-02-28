// ==================== watchlist.js ====================
// Watchlist helpers: data storage + CRUD.
// Rendering handled by overview.js (embedded in Overview tab).
// Uses db.js for cloud sync when logged in.

function getWatchlist() {
  // Synchronous read from localStorage (fast, always available)
  try {
    var saved = localStorage.getItem('mcc_watchlist');
    return saved ? JSON.parse(saved) : [];
  } catch (e) { return []; }
}

function saveWatchlistSync(list) {
  // Save to localStorage AND sync to cloud in background
  try { localStorage.setItem('mcc_watchlist', JSON.stringify(list)); } catch (e) {}
  if (typeof dbSaveWatchlist === 'function' && typeof getUser === 'function' && getUser()) {
    dbSaveWatchlist(list).catch(function(e) { console.warn('[watchlist] cloud sync error:', e); });
  }
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
  saveWatchlistSync(list);
  input.value = '';
  if (noteInput) noteInput.value = '';
  // Rendering handled by overview.js caller
}
function removeFromWatchlist(ticker) {
  var list = getWatchlist().filter(function(x) { return x.ticker !== ticker; });
  saveWatchlistSync(list);
  // Rendering handled by overview.js caller
}
function clearWatchlist() {
  saveWatchlistSync([]);
  // Rendering handled by overview.js caller
}
