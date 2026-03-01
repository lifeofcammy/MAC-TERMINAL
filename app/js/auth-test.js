// TEST AUTH BYPASS - for local responsive testing only
window.currentUser = { email: 'test@test.com' };
window._currentSession = { user: { email: 'test@test.com' } };
window.supabaseClient = null;
function getUser() { return window.currentUser; }
function logoutUser() { alert('Test mode — no logout'); }
function getAnthropicKey() { return ''; }
