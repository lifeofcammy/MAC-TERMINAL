// ==================== settings.js ====================
// Settings modal: API key management (Polygon, Alpha Vantage, Anthropic).
// Keys saved to localStorage — never sent anywhere except the official API endpoints.
// Also includes first-run check (shows settings modal if no Polygon key found).

// ==================== SETTINGS MODAL ====================
(function() {
  // Create modal HTML
  var modalHTML = `
  <div id="settings-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease;" onclick="if(event.target===this)toggleSettings()">
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:32px;width:520px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 24px 48px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary);">⚙️ API Keys</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Keys are stored locally in your browser. Never shared.</div>
        </div>
        <button onclick="toggleSettings()" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;padding:4px 8px;">✕</button>
      </div>

      <!-- Polygon -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:12px;font-weight:700;color:var(--text-primary);">Polygon.io</span>
          <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:var(--red-bg);color:var(--red);font-weight:700;">REQUIRED</span>
          <span id="polygon-key-status" style="font-size:10px;margin-left:auto;"></span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">Powers all market data, scanners, and real-time quotes. Get a free key at <a href="https://polygon.io" target="_blank" style="color:var(--blue);">polygon.io</a></div>
        <input type="password" id="settings-polygon-key" placeholder="Enter your Polygon API key..." onblur="saveSettingsKey('polygon')" onkeydown="if(event.key==='Enter')saveSettingsKey('polygon')" style="width:100%;box-sizing:border-box;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-primary);" />
      </div>

      <!-- Alpha Vantage -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:12px;font-weight:700;color:var(--text-primary);">Alpha Vantage</span>
          <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:var(--bg-secondary);color:var(--text-muted);font-weight:700;">OPTIONAL</span>
          <span id="alpha-key-status" style="font-size:10px;margin-left:auto;"></span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">Used for supplemental data. Free key at <a href="https://www.alphavantage.co/support/#api-key" target="_blank" style="color:var(--blue);">alphavantage.co</a></div>
        <input type="password" id="settings-alpha-key" placeholder="Enter your Alpha Vantage key..." onblur="saveSettingsKey('alpha')" onkeydown="if(event.key==='Enter')saveSettingsKey('alpha')" style="width:100%;box-sizing:border-box;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-primary);" />
      </div>

      <!-- Anthropic -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:12px;font-weight:700;color:var(--text-primary);">Anthropic (Claude AI)</span>
          <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:var(--bg-secondary);color:var(--text-muted);font-weight:700;">OPTIONAL</span>
          <span id="anthropic-key-status" style="font-size:10px;margin-left:auto;"></span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">Powers AI Analysis & Trade Coaching. Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:var(--blue);">console.anthropic.com</a></div>
        <input type="password" id="settings-anthropic-key" placeholder="Enter your Anthropic API key..." onblur="saveSettingsKey('anthropic')" onkeydown="if(event.key==='Enter')saveSettingsKey('anthropic')" style="width:100%;box-sizing:border-box;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-primary);" />
      </div>

      <div style="display:flex;gap:10px;margin-top:24px;">
        <button onclick="toggleSettings()" style="flex:1;background:var(--blue);color:white;border:none;border-radius:8px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:'Inter',sans-serif;">Done</button>
      </div>

      <div style="margin-top:16px;padding:12px;background:var(--bg-secondary);border-radius:8px;font-size:10px;color:var(--text-muted);line-height:1.6;">
        <strong>🔒 Privacy:</strong> Your API keys are stored only in your browser's localStorage. They are never sent to any server except the official API endpoints (Polygon, Alpha Vantage, Anthropic). MAC Terminal has no backend — everything runs client-side.
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
  if (isHidden) loadSettingsKeys();
}

function loadSettingsKeys() {
  try {
    var pk = localStorage.getItem('mac_polygon_key') || '';
    var ak = localStorage.getItem('mac_alpha_key') || '';
    var ck = localStorage.getItem('mtp_anthropic_key') || '';
    document.getElementById('settings-polygon-key').value = pk;
    document.getElementById('settings-alpha-key').value = ak;
    document.getElementById('settings-anthropic-key').value = ck;
    updateKeyStatus('polygon', pk);
    updateKeyStatus('alpha', ak);
    updateKeyStatus('anthropic', ck);
  } catch(e) {}
}

function saveSettingsKey(type) {
  try {
    var inputId = 'settings-' + type + '-key';
    var val = document.getElementById(inputId).value.trim();
    if (type === 'polygon') localStorage.setItem('mac_polygon_key', val);
    else if (type === 'alpha') localStorage.setItem('mac_alpha_key', val);
    else if (type === 'anthropic') {
      localStorage.setItem('mtp_anthropic_key', val);
      // Also update the analysis panel key input if it exists
      var ak = document.getElementById('analysis-api-key');
      if (ak) ak.value = val;
    }
    updateKeyStatus(type, val);
  } catch(e) {}
}

function updateKeyStatus(type, val) {
  var el = document.getElementById(type + '-key-status');
  if (!el) return;
  if (val) el.innerHTML = '<span style="color:var(--green);font-weight:700;">✓ Saved</span>';
  else el.innerHTML = '<span style="color:var(--text-muted);">Not set</span>';
}

// ==================== FIRST-RUN SETUP CHECK ====================
// Disabled — Polygon key now has a built-in default in config.js
// Users can still manually open settings via the gear icon if they want to use their own key.
function checkFirstRun() { /* no-op */ }

// ==================== INITIAL LOAD ====================
