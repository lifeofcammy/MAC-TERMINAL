// ==================== config.js ====================
// API endpoint constants and key getters.

// ==================== API CONFIG ====================
// Polygon key is now server-side only (Edge Function secret).
// Users can optionally set their own key in Settings (stored in localStorage).
const POLY = 'https://api.polygon.io';
const ALPHA = 'https://www.alphavantage.co/query';

// Supabase Edge Function base URL for server-side proxies (AI + Polygon)
const EDGE_FN_BASE = 'https://urpblscayyeadecozgvo.supabase.co/functions/v1';

function getPolygonKey() { try { return localStorage.getItem('mac_polygon_key') || ''; } catch(e) { return ''; } }
function getAlphaKey() { try { return localStorage.getItem('mac_alpha_key') || ''; } catch(e) { return ''; } }

// Legacy compat — some functions reference POLYGON_KEY / ALPHA_KEY directly
Object.defineProperty(window, 'POLYGON_KEY', { get: getPolygonKey });
Object.defineProperty(window, 'ALPHA_KEY', { get: getAlphaKey });

// ==================== AI PROXY ====================
// All AI calls go through the Edge Function — key is server-side only.
// Requires user to be logged in (sends Supabase JWT).
// The server only accepts structured tasks (generate_analysis, analysis_chat).
// Model, prompts, and max_tokens are controlled server-side — not by the client.
async function callAIProxy(body) {
  var session = window._currentSession;
  if (!session || !session.access_token) {
    throw new Error('You must be logged in to use AI features.');
  }
  var resp = await fetch(EDGE_FN_BASE + '/ai-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
      'apikey': typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''
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
