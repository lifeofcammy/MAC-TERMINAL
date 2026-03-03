// ==================== tabs.js ====================
// Tab switching logic and refresh orchestration.

// ==================== TAB SWITCHING ====================
// Track whether overview has been loaded at least once
var _overviewLoaded = false;
var _scannerAutoBuildDone = false;

document.querySelectorAll('.tabs > .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs > .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

    // Stop breadth auto-refresh when leaving overview; restart when returning
    if (tab.dataset.tab === 'overview') {
      // Only re-fetch if never loaded — otherwise just show cached content
      if (!_overviewLoaded) {
        renderOverview().then(function() { _overviewLoaded = true; }).catch(function() {});
      } else {
        // Restart breadth auto-refresh without re-fetching everything
        if (typeof startBreadthAutoRefresh === 'function') startBreadthAutoRefresh();
      }
    } else {
      stopBreadthAutoRefresh();
    }

    // Trigger per-tab renders
    if (tab.dataset.tab === 'analysis') renderAnalysis();
    if (tab.dataset.tab === 'scanner') {
      if (!window._scannerLoaded) { renderScanner(); window._scannerLoaded = true; }
      // Trigger auto-build on first Scanner tab click (lazy load)
      if (!_scannerAutoBuildDone && typeof scannerAutoBuild === 'function') {
        _scannerAutoBuildDone = true;
        scannerAutoBuild();
      }
    }
  });
});

// ==================== REFRESH ====================
function refreshAll() {
  var btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  document.getElementById('lastUpdated').textContent = 'Refreshing...';

  // Clear the Polygon cache so all data is re-fetched fresh
  if (typeof clearPolyCache === 'function') clearPolyCache();

  renderOverview().then(function() { _overviewLoaded = true; }).catch(function() {});
  renderRecapCalendar();

  setTimeout(function() {
    btn.classList.remove('spinning');
    document.getElementById('lastUpdated').textContent = 'Updated ' + getTimestamp();
  }, 2000);
}
