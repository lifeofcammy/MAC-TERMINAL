// ==================== config.js ====================
// API endpoint constants and key getters.

// ==================== API CONFIG ====================
// Default Polygon key (fallback). User's own key from localStorage takes priority.
const DEFAULT_POLYGON_KEY = 'cITeodtOFuLRZuppvB3hc6U4XMBQUT0u';
function getPolygonKey() { try { return localStorage.getItem('mac_polygon_key') || DEFAULT_POLYGON_KEY; } catch(e) { return DEFAULT_POLYGON_KEY; } }
function getAlphaKey() { try { return localStorage.getItem('mac_alpha_key') || ''; } catch(e) { return ''; } }
const POLY = 'https://api.polygon.io';
const ALPHA = 'https://www.alphavantage.co/query';

// Legacy compat — some functions reference POLYGON_KEY / ALPHA_KEY directly
Object.defineProperty(window, 'POLYGON_KEY', { get: getPolygonKey });
Object.defineProperty(window, 'ALPHA_KEY', { get: getAlphaKey });

