// ============================================================
// MAC Terminal — Auth Guard
// Initializes Supabase, protects the app, exposes helpers.
// ============================================================

const SUPABASE_URL = 'https://urpblscayyeadecozgvo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_83TVqX2bbCJnXMlW6rGP0A_yu_9o77w';

// supabase client is available globally after the CDN script loads
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Expose client globally for other scripts
window.supabaseClient = _supabase;
window.currentUser = null;

// ── Auth guard ──────────────────────────────────────────────
(async function checkAuth() {
  const { data: { session }, error } = await _supabase.auth.getSession();

  if (error || !session) {
    // Not logged in — send to login page
    window.location.replace('/app/login.html');
    return;
  }

  // Logged in — store user and populate UI
  window.currentUser = session.user;

  const emailEl = document.getElementById('user-email');
  if (emailEl) {
    const displayEmail = session.user.email || session.user.user_metadata?.full_name || '';
    emailEl.textContent = displayEmail;
  }

  // Listen for auth state changes (e.g. token refresh, sign-out from another tab)
  _supabase.auth.onAuthStateChange((event, newSession) => {
    if (event === 'SIGNED_OUT' || !newSession) {
      window.location.replace('/app/login.html');
    } else {
      window.currentUser = newSession.user;
    }
  });
})();

// ── Logout helper (called from header button) ───────────────
async function logoutUser() {
  await _supabase.auth.signOut();
  window.location.replace('/');
}

window.logoutUser = logoutUser;
