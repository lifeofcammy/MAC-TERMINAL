// ==================== tabs.js ====================
// Tab switching logic and refresh orchestration.
// Handles tab click events and triggers per-tab renders.

// ==================== TAB SWITCHING ====================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'analysis') renderAnalysis();
    if (tab.dataset.tab === 'options') { if (!window._optionsLoaded) { renderOptionsTab(); window._optionsLoaded = true; } else { renderOptTags(); } }
    if (tab.dataset.tab === 'shakeout' && !window._shakeoutLoaded) { renderShakeout(); window._shakeoutLoaded = true; }
    if (tab.dataset.tab === 'vcp' && !window._vcpLoaded) { renderVCP(); window._vcpLoaded = true; }
  });
});

// ==================== REFRESH ====================
function refreshAll() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  document.getElementById('lastUpdated').textContent = 'Refreshing...';

  renderOverview();
  renderSegments();
  renderIdeas();
  renderRecapCalendar();

  setTimeout(() => {
    btn.classList.remove('spinning');
    document.getElementById('lastUpdated').textContent = 'Updated ' + getTimestamp();
  }, 2000);
}

// ==================== TRADE RECAP DATA BACKUP ====================
