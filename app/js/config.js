// ==================== config.js ====================
// API endpoint constants and key getters.

// ==================== API CONFIG ====================
// Default Polygon key (fallback). User's own key from localStorage takes priority.
const DEFAULT_POLYGON_KEY = 'cITeodtOFuLRZuppvB3hc6U4XMBQUT0u';

// Supabase Edge Function base URL for server-side AI proxy
const EDGE_FN_BASE = 'https://urpblscayyeadecozgvo.supabase.co/functions/v1';

function getPolygonKey() { try { return localStorage.getItem('mac_polygon_key') || DEFAULT_POLYGON_KEY; } catch(e) { return DEFAULT_POLYGON_KEY; } }
function getAlphaKey() { try { return localStorage.getItem('mac_alpha_key') || ''; } catch(e) { return ''; } }

const POLY = 'https://api.polygon.io';
const ALPHA = 'https://www.alphavantage.co/query';

// Legacy compat — some functions reference POLYGON_KEY / ALPHA_KEY directly
Object.defineProperty(window, 'POLYGON_KEY', { get: getPolygonKey });
Object.defineProperty(window, 'ALPHA_KEY', { get: getAlphaKey });

// ==================== AI PROXY ====================
// All Anthropic calls go through the Edge Function — key is server-side only.
// Requires user to be logged in (sends Supabase JWT).
async function callAIProxy(body) {
  var session = window._currentSession;
  if (!session || !session.access_token) {
    throw new Error('You must be logged in to use AI features.');
  }
  var resp = await fetch(EDGE_FN_BASE + '/ai-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token
    },
    body: JSON.stringify(body)
  });
  var data = await resp.json();
  if (!resp.ok) {
    var errMsg = (data && data.error && data.error.message) ? data.error.message : (data.error || 'AI proxy error ' + resp.status);
    throw new Error(errMsg);
  }
  return data;
}
