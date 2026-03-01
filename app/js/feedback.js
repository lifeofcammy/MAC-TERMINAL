// ==================== feedback.js ====================
// In-app feedback modal. Replaces old Google Forms link.
// Stores feedback in Supabase user_settings table with 'feedback_' key prefix.

// ── Open / Close Modal ──
function openFeedbackModal() {
  // Don't create duplicates
  if (document.getElementById('feedback-modal')) {
    document.getElementById('feedback-modal').style.display = 'flex';
    return;
  }

  var overlay = document.createElement('div');
  overlay.id = 'feedback-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);';
  overlay.onclick = function(e) { if (e.target === overlay) closeFeedbackModal(); };

  var modal = document.createElement('div');
  modal.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

  modal.innerHTML = '' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<div style="font-family:\'DM Serif Display\',Georgia,serif;font-size:20px;color:var(--text-primary);">Send Feedback</div>' +
      '<button onclick="closeFeedbackModal()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px;">&times;</button>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">Help us improve MAC Terminal. Bug reports, feature requests, or general thoughts — all welcome.</div>' +
    '<div style="margin-bottom:12px;">' +
      '<label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;">Category</label>' +
      '<select id="fb-category" style="width:100%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;color:var(--text-primary);font-family:Inter,sans-serif;">' +
        '<option value="bug">Bug Report</option>' +
        '<option value="feature">Feature Request</option>' +
        '<option value="general" selected>General Feedback</option>' +
      '</select>' +
    '</div>' +
    '<div style="margin-bottom:16px;">' +
      '<label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;">Message</label>' +
      '<textarea id="fb-message" rows="5" placeholder="Tell us what\'s on your mind..." style="width:100%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;color:var(--text-primary);font-family:Inter,sans-serif;resize:vertical;line-height:1.5;"></textarea>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button onclick="closeFeedbackModal()" class="refresh-btn" style="padding:8px 16px;font-size:14px;">Cancel</button>' +
      '<button onclick="submitFeedback()" id="fb-submit-btn" style="background:var(--blue);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:14px;font-weight:600;cursor:pointer;">Submit</button>' +
    '</div>' +
    '<div id="fb-status" style="margin-top:10px;font-size:12px;text-align:center;display:none;"></div>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Focus textarea
  setTimeout(function() {
    var ta = document.getElementById('fb-message');
    if (ta) ta.focus();
  }, 100);
}

function closeFeedbackModal() {
  var modal = document.getElementById('feedback-modal');
  if (modal) modal.style.display = 'none';
  // Reset form
  var msg = document.getElementById('fb-message');
  var status = document.getElementById('fb-status');
  if (msg) msg.value = '';
  if (status) status.style.display = 'none';
}

// ── Submit Feedback ──
async function submitFeedback() {
  var category = document.getElementById('fb-category').value;
  var message = document.getElementById('fb-message').value.trim();
  var btn = document.getElementById('fb-submit-btn');
  var status = document.getElementById('fb-status');

  if (!message) {
    status.style.display = 'block';
    status.style.color = 'var(--red)';
    status.textContent = 'Please enter a message.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';
  status.style.display = 'none';

  try {
    // Try Edge Function first
    var session = window._currentSession;
    if (!session || !session.access_token) throw new Error('Not logged in');

    var resp = await fetch(EDGE_FN_BASE + '/submit-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''
      },
      body: JSON.stringify({ category: category, message: message })
    });

    var data = await resp.json();

    if (!resp.ok && !data.success) {
      // Edge function failed — fallback to direct insert
      throw new Error(data.error || 'Edge function error');
    }

    // Success
    status.style.display = 'block';
    status.style.color = 'var(--green)';
    status.textContent = 'Thank you! Feedback submitted.';
    btn.textContent = 'Sent ✓';

    // Auto-close after 1.5s
    setTimeout(function() { closeFeedbackModal(); }, 1500);

  } catch (err) {
    console.warn('[Feedback] Edge function failed, trying direct insert:', err.message);

    // Fallback: insert directly via Supabase client into user_settings
    try {
      var user = window.currentUser;
      var feedbackData = {
        user_id: user ? user.id : null,
        key: 'feedback_' + Date.now(),
        value: JSON.stringify({
          category: category,
          message: message,
          user_email: user ? user.email : 'unknown',
          created_at: new Date().toISOString()
        })
      };

      var { error: insertErr } = await window.supabaseClient
        .from('user_settings')
        .insert(feedbackData);

      if (insertErr) throw insertErr;

      status.style.display = 'block';
      status.style.color = 'var(--green)';
      status.textContent = 'Thank you! Feedback submitted.';
      btn.textContent = 'Sent ✓';
      setTimeout(function() { closeFeedbackModal(); }, 1500);

    } catch (fallbackErr) {
      status.style.display = 'block';
      status.style.color = 'var(--red)';
      status.textContent = 'Failed to send: ' + fallbackErr.message;
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
  }
}
