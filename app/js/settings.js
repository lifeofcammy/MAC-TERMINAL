// ==================== settings.js ====================
// Settings modal: preferences, account size, risk management.

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

      <!-- Position Sizing -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:14px;font-weight:700;color:var(--text-primary);">Position Sizing</span>
        </div>
        <div style="font-size:14px;color:var(--text-muted);line-height:1.6;margin-bottom:12px;">Set your account size and max risk per trade. Used when you click any ticker to calculate position size.</div>
        <div style="display:flex;gap:12px;margin-bottom:8px;">
          <div style="flex:1;">
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Account Size ($)</label>
            <input id="settings-account-size" type="number" placeholder="25000" min="0" step="1000"
              style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font-mono);font-size:14px;box-sizing:border-box;">
          </div>
          <div style="flex:1;">
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Max Risk Per Trade (%)</label>
            <input id="settings-risk-pct" type="number" placeholder="1.0" min="0.1" max="5" step="0.25"
              style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font-mono);font-size:14px;box-sizing:border-box;">
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.5;">Risk is auto-adjusted by market regime. Risk On = full size, Choppy = half, Risk Off = quarter.</div>
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
  if (isHidden) {
    // Load saved values into inputs
    var acctInput = document.getElementById('settings-account-size');
    var riskInput = document.getElementById('settings-risk-pct');
    if (acctInput) acctInput.value = localStorage.getItem('mcc_account') || '';
    if (riskInput) riskInput.value = localStorage.getItem('mcc_risk') || '';
  } else {
    // Save on close
    var acctInput = document.getElementById('settings-account-size');
    var riskInput = document.getElementById('settings-risk-pct');
    var acctVal = acctInput ? acctInput.value.trim() : '';
    var riskVal = riskInput ? riskInput.value.trim() : '';
    if (acctVal) localStorage.setItem('mcc_account', acctVal);
    else localStorage.removeItem('mcc_account');
    if (riskVal) localStorage.setItem('mcc_risk', riskVal);
    else localStorage.removeItem('mcc_risk');
    // Sync header account input
    var headerAcct = document.getElementById('header-account-input');
    if (headerAcct) headerAcct.value = acctVal;
    // Cloud sync if available
    if (typeof dbSaveUserSettings === 'function') {
      dbSaveUserSettings({ account_size: acctVal, risk_pct: riskVal });
    }
  }
  overlay.style.display = isHidden ? 'flex' : 'none';
}
