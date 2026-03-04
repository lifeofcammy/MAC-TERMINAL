// ==================== feedback.js ====================
// In-app feedback modal. Sends feedback via email.

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
      '<div style="font-family:var(--font-display);font-size:20px;color:var(--text-primary);">Send Feedback</div>' +
      '<button onclick="closeFeedbackModal()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px;">&times;</button>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">Help us improve MAC Terminal. Bug reports, feature requests, or general thoughts — all welcome.</div>' +
    '<div style="margin-bottom:12px;">' +
      '<label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;">Category</label>' +
      '<select id="fb-category" style="width:100%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;color:var(--text-primary);font-family:var(--font-body);">' +
        '<option value="Bug Report">Bug Report</option>' +
        '<option value="Feature Request">Feature Request</option>' +
        '<option value="General Feedback" selected>General Feedback</option>' +
      '</select>' +
    '</div>' +
    '<div style="margin-bottom:16px;">' +
      '<label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;">Message</label>' +
      '<textarea id="fb-message" rows="5" placeholder="Tell us what\'s on your mind..." style="width:100%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;color:var(--text-primary);font-family:var(--font-body);resize:vertical;line-height:1.5;"></textarea>' +
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
function submitFeedback() {
  var category = document.getElementById('fb-category').value;
  var message = document.getElementById('fb-message').value.trim();
  var status = document.getElementById('fb-status');

  if (!message) {
    status.style.display = 'block';
    status.style.color = 'var(--red)';
    status.textContent = 'Please enter a message.';
    return;
  }

  var subject = encodeURIComponent('[MAC Terminal] ' + category);
  var body = encodeURIComponent(message);
  window.location.href = 'mailto:support@marketactioncenter.com?subject=' + subject + '&body=' + body;

  status.style.display = 'block';
  status.style.color = 'var(--green)';
  status.textContent = 'Opening your email client...';

  setTimeout(function() { closeFeedbackModal(); }, 1500);
}
