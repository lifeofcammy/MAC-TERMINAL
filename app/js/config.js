// ==================== config.js ====================
// API endpoint constants and key getters.
// Keys are stored in the user's browser localStorage — never hardcoded.

// ==================== API CONFIG ====================
// Keys are stored in browser localStorage — never hardcoded
function getPolygonKey() { try { return localStorage.getItem('mac_polygon_key') || ''; } catch(e) { return ''; } }
function getAlphaKey() { try { return localStorage.getItem('mac_alpha_key') || ''; } catch(e) { return ''; } }
const POLY = 'https://api.polygon.io';
const ALPHA = 'https://www.alphavantage.co/query';

// Legacy compat — some functions reference POLYGON_KEY / ALPHA_KEY directly
Object.defineProperty(window, 'POLYGON_KEY', { get: getPolygonKey });
Object.defineProperty(window, 'ALPHA_KEY', { get: getAlphaKey });

