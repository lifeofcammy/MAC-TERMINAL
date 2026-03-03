// ==================== settings.js ====================
// Settings modal: preferences and info.

// ==================== SETTINGS MODAL ====================
(function() {
  // Create modal HTML
  var modalHTML = `
  <div id="settings-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease;" onclick="if(event.target===this)toggleSettings()">
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:32px;width:520px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 24px 48px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary);">\u2699\uFE0F Settings</div>
          <div style="font-size:14px;color:var(--text-muted);margin-top:4px;">Your account and preferences.</div>
        </div>
        <button onclick="toggleSettings()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:4px 8px;">\u2715</button>
      </div>

      <!-- Market Data -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:14px;font-weight:700;color:var(--text-primary);">Market Data</span>
          <span style="font-size:12px;padding:2px 6px;border-radius:3px;background:var(--green-bg);color:var(--green);font-weight:700;">INCLUDED</span>
        </div>
        <div style="font-size:14px;color:var(--text-muted);line-height:1.6;">Real-time quotes, scanners, and market data are built in. No API key needed \u2014 powered by our secure server.</div>
      </div>

      <!-- AI Coaching -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:14px;font-weight:700;color:var(--text-primary);">AI Analysis & Coaching</span>
          <span style="font-size:12px;padding:2px 6px;border-radius:3px;background:var(--green-bg);color:var(--green);font-weight:700;">INCLUDED</span>
        </div>
        <div style="font-size:14px;color:var(--text-muted);line-height:1.6;">AI-powered analysis and trade coaching is built in. No API key needed \u2014 it runs through our secure server.</div>
      </div>

      <div style="display:flex;gap:10px;margin-top:24px;">
        <button onclick="toggleSettings()" style="flex:1;background:var(--blue);color:white;border:none;border-radius:8px;padding:12px;font-weight:700;font-size:14px;cursor:pointer;">Done</button>
      </div>

      <div style="margin-top:16px;padding:12px;background:var(--bg-secondary);border-radius:8px;font-size:14px;color:var(--text-muted);line-height:1.6;">
        <strong>\uD83D\uDD12 Privacy:</strong> Market data and AI features run through our secure server \u2014 no API keys needed on your end.
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHTML);
})();

function toggleSettings() {
  var overlay = document.getElementById('settings-overlay');
  if (!overlay) return;
  var isHidden = overlay.style.display === 'none';
  overlay.style.display = isHidden ? 'flex' : 'none';
}

// ==================== FIRST-RUN SETUP CHECK ====================
// No-op \u2014 all keys are server-side now. Users only need to log in.
function checkFirstRun() { /* no-op */ }
