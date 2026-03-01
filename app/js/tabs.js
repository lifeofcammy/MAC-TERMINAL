// ==================== tabs.js ====================
// Tab switching logic and refresh orchestration.

// ==================== TAB SWITCHING ====================
document.querySelectorAll('.tabs > .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs > .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    // Trigger per-tab renders
    if (tab.dataset.tab === 'analysis') renderAnalysis();
    if (tab.dataset.tab === 'scanner' && !window._scannerLoaded) { renderScanner(); window._scannerLoaded = true; }
  });
});

// ==================== REFRESH ====================
function refreshAll() {
  var btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  document.getElementById('lastUpdated').textContent = 'Refreshing...';

  renderOverview();
  renderRecapCalendar();

  setTimeout(function() {
    btn.classList.remove('spinning');
    document.getElementById('lastUpdated').textContent = 'Updated ' + getTimestamp();
  }, 2000);
}