(function() {
// ============================================
// SUPABASE INIT
// ============================================
var SUPABASE_URL = 'https://itkufrockebnlzcroigc.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0a3Vmcm9ja2Vibmx6Y3JvaWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2OTczNjYsImV4cCI6MjA5MTI3MzM2Nn0.mhOwZBwegogIb-yjYzxS4ROQdc4Tc8xLMNlHcDfozzI';

// Passkeys (beta) give a consistent native Face ID prompt on iPhone and Mac
var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { experimental: { passkey: true } }
});

// Supabase returns at most 1000 rows per request. Page through so large
// tables (transactions, transaction actions) are never silently cut off.
async function fetchAllRows(buildQuery) {
  var PAGE = 1000;
  var all = [];
  for (var from = 0; ; from += PAGE) {
    var r = await buildQuery().range(from, from + PAGE - 1);
    if (r.error) return { data: all.length ? all : null, error: r.error };
    all = all.concat(r.data || []);
    if (!r.data || r.data.length < PAGE) break;
  }
  return { data: all, error: null };
}

// ============================================
// DOM REFS
// ============================================
var $ = function(sel) { return document.querySelector(sel); };
var authForm = $('#auth-form');
var authEmail = $('#auth-email');
var authPassword = $('#auth-password');
var authSubmit = $('#auth-submit');
var authError = $('#auth-error');
var authFaceId = $('#auth-faceid');
var btnConnectPlaid = $('#btn-connect-plaid');
var btnAddAccount = $('#btn-add-account');
// (removed investing button ref)
var connectCta = $('#connect-cta');
var sectionBanks = $('#section-banks');
var sectionCredit = $('#section-credit');
var listBanks = $('#list-banks');
var listCredit = $('#list-credit');
var banksTotal = $('#banks-total');
var creditTotal = $('#credit-total');
var loading = $('#loading');
var headerAvatar = $('#header-avatar');
var headerName = $('#header-name');

var currentUser = null;
var userProfile = null;
var showAvailable = localStorage.getItem('alenjo_show_available') !== 'false';
var cachedAccounts = null;

// ============================================
// ============================================
// BETA GATE + SIGNUP
// ============================================
var betaForm = $('#beta-form');
var betaCode = $('#beta-code');
var betaSubmit = $('#beta-submit');
var betaError = $('#beta-error');
var signupForm = $('#signup-form');
var signupName = $('#signup-name');
var signupEmail = $('#signup-email');
var signupPassword = $('#signup-password');
var signupSubmit = $('#signup-submit');
var signupError = $('#signup-error');
var signupSuccess = $('#signup-success');

$('#btn-goto-beta').addEventListener('click', function() { showScreen('beta'); });
$('#btn-back-to-login').addEventListener('click', function() { showScreen('login'); });
$('#btn-back-to-login-from-signup').addEventListener('click', function() { showScreen('login'); });

var validatedBetaCode = '';

betaForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  betaSubmit.disabled = true;
  betaError.hidden = true;
  betaSubmit.textContent = 'Checking...';

  try {
    var res = await fetch(SUPABASE_URL + '/functions/v1/validate-beta-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: betaCode.value.trim() })
    });
    var data = await res.json();
    if (data.valid) {
      validatedBetaCode = betaCode.value.trim();
      betaCode.value = '';
      showScreen('signup');
    } else {
      betaError.textContent = 'Invalid beta code.';
      betaError.hidden = false;
    }
  } catch (err) {
    betaError.textContent = 'Something went wrong. Try again.';
    betaError.hidden = false;
  }

  betaSubmit.disabled = false;
  betaSubmit.textContent = 'Continue';
});

signupForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  signupSubmit.disabled = true;
  signupError.hidden = true;
  signupSuccess.hidden = true;
  signupSubmit.textContent = 'Creating account...';

  var name = signupName.value.trim();
  var email = signupEmail.value.trim();
  var password = signupPassword.value;

  // Ask the server for a one-time sign-up ticket for this email
  try {
    var ticketRes = await fetch(SUPABASE_URL + '/functions/v1/validate-beta-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: validatedBetaCode, email: email })
    });
    var ticket = await ticketRes.json();
    if (!ticket.valid) throw new Error('invalid');
  } catch (err) {
    signupError.textContent = 'Your beta code expired. Go back and enter it again.';
    signupError.hidden = false;
    signupSubmit.disabled = false;
    signupSubmit.textContent = 'Create Account';
    return;
  }

  var result = await sb.auth.signUp({
    email: email,
    password: password,
    options: { data: { full_name: name } }
  });

  if (result.error) {
    signupError.textContent = result.error.message;
    signupError.hidden = false;
    signupSubmit.disabled = false;
    signupSubmit.textContent = 'Create Account';
    return;
  }

  signupSuccess.textContent = 'Account created! Check your email to confirm, then sign in.';
  signupSuccess.hidden = false;
  signupForm.reset();
  signupSubmit.disabled = false;
  signupSubmit.textContent = 'Create Account';

  setTimeout(function() { showScreen('login'); }, 3000);
});

// ============================================
// AUTH (sign-in only, no new signups)
// ============================================
var signingIn = false;
function setSigningIn(on) {
  signingIn = on;
  authSubmit.disabled = on;
  authSubmit.textContent = on ? 'Signing in…' : 'Sign in';
  authForm.classList.toggle('is-busy', on);
}

authForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  if (signingIn) return;
  setSigningIn(true);
  authError.hidden = true;

  var email = authEmail.value.trim();
  var password = authPassword.value;

  var result = await sb.auth.signInWithPassword({ email: email, password: password });

  if (result.error) {
    authError.textContent = result.error.message;
    authError.hidden = false;
    setSigningIn(false);
    return;
  }

  // Stay in "Signing in…" until your accounts have loaded and Home is
  // showing (showScreen('app') resets it), so it never looks stuck.
  try { localStorage.setItem('alenjo_last_email', email); } catch (e) {}
});

// Remembered email: show it masked with a "Not you?" escape hatch.
// The real email input stays in the form (just out of view) so iOS
// password AutoFill and Face ID keep working.
function maskEmail(e) {
  var at = e.indexOf('@');
  if (at < 1) return e;
  return e.slice(0, Math.min(2, at)) + '•••••' + e.slice(at);
}
function setupRememberedEmail() {
  var saved = '';
  try { saved = localStorage.getItem('alenjo_last_email') || ''; } catch (e) {}
  var row = $('#remembered-row'), emailRow = $('#email-row');
  if (saved) {
    authEmail.value = saved;
    $('#remembered-email').textContent = maskEmail(saved);
    row.hidden = false;
    emailRow.classList.add('visually-hidden');
  } else {
    row.hidden = true;
    emailRow.classList.remove('visually-hidden');
  }
}
$('#btn-not-you').addEventListener('click', function() {
  try { localStorage.removeItem('alenjo_last_email'); localStorage.removeItem('alenjo_last_name'); } catch (e) {}
  authEmail.value = '';
  setupRememberedEmail();
  $('#login-greeting').textContent = 'Welcome back';
  authEmail.focus();
});
$('#btn-forgot').addEventListener('click', async function() {
  var email = authEmail.value.trim();
  if (!email) { authError.textContent = 'Enter your email first.'; authError.hidden = false; authEmail.focus(); return; }
  this.disabled = true;
  var res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  this.disabled = false;
  authError.hidden = false;
  authError.textContent = res.error ? res.error.message : 'Check ' + email + ' for a reset link.';
});
setupRememberedEmail();

// ============================================
// PASSWORD RESET (from the emailed link)
// ============================================
var resettingPassword = false;
function showPasswordReset() {
  resettingPassword = true;
  showScreen('login');
  $('#auth-form').hidden = true;
  $('#reset-form').hidden = false;
  $('#login-greeting').textContent = 'Choose a new password';
  $('#login-subtitle').textContent = 'At least 10 characters';
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}
var resetForm = $('#reset-form');
if (resetForm) resetForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  var pw = $('#reset-password').value, pw2 = $('#reset-password2').value, err = $('#reset-error');
  err.hidden = true;
  if (pw.length < 10) { err.textContent = 'Use at least 10 characters.'; err.hidden = false; return; }
  if (pw !== pw2) { err.textContent = 'The passwords don\u2019t match.'; err.hidden = false; return; }
  var btn = $('#reset-submit'); btn.disabled = true; btn.textContent = 'Saving…';
  var res = await sb.auth.updateUser({ password: pw });
  if (res.error) { err.textContent = res.error.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Save password'; return; }
  // Done: end this temporary session and sign in normally
  await sb.auth.signOut({ scope: 'local' });
  location.replace(location.pathname);
});

// Auto-submit on FaceID/password autofill
// Wait for both fields, then give iOS a moment to commit the values before submitting
// "Fill password" / Face ID autofill: sign in right away.
// A fill drops the whole password in at once; typing adds one character at
// a time, so typed passwords still wait for the Sign in button.
var lastPwLen = 0;
function submitAfterAutofill() {
  if (signingIn || !authPassword.value || !authEmail.value) return;
  try { document.activeElement.blur(); } catch (e) {}
  // Give iOS a moment to finish writing both fields
  setTimeout(function() {
    if (!signingIn && authEmail.value && authPassword.value) authForm.requestSubmit();
  }, 150);
}
authPassword.addEventListener('input', function(e) {
  var len = authPassword.value.length;
  var jumped = len - lastPwLen >= 2;
  var replaced = e.inputType === 'insertReplacementText' || e.inputType === undefined || e.inputType === '';
  lastPwLen = len;
  if (len && (jumped || replaced)) submitAfterAutofill();
});
// Some browsers only report autofill as a change, or style the field first
authPassword.addEventListener('change', function() {
  if (authPassword.matches(':-webkit-autofill')) submitAfterAutofill();
});
authPassword.addEventListener('animationstart', function(e) {
  if (e.animationName === 'onAutoFill') submitAfterAutofill();
});

// ============================================
// AUTO-UPDATE
// ============================================
// Home-screen apps keep reusing the page they already downloaded. On open
// and whenever the app comes back to the front, compare our version with
// the live one; if it's newer, load the new version.
var pendingVersion = null;
async function checkForUpdate() {
  try {
    var res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    var live = (await res.json()).version;
    if (!live || live === window._v) return;
    pendingVersion = live;
    var tried = '';
    try { tried = sessionStorage.getItem('alenjo_update_tried') || ''; } catch (e) {}
    if (!currentUser && tried !== live) {
      // Only try once per version, so a slow deploy can't cause a reload loop
      try { sessionStorage.setItem('alenjo_update_tried', live); } catch (e) {}
      location.replace('/?v=' + encodeURIComponent(live));
    } else {
      var bar = $('#update-bar');
      if (bar) bar.hidden = false;
    }
  } catch (e) {}
}
var updateBtn = $('#btn-update-now');
if (updateBtn) updateBtn.addEventListener('click', function() {
  location.replace('/?v=' + encodeURIComponent(pendingVersion || Date.now()));
});
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) checkForUpdate();
});
checkForUpdate();

// ============================================
// FACE ID (passkeys)
// ============================================
function hasPasskeyHere() {
  try { return localStorage.getItem('alenjo_has_passkey') === 'true'; } catch (e) { return false; }
}

var passkeyInFlight = false;
async function signInWithFaceId(fromUserTap) {
  if (passkeyInFlight || signingIn) return;
  if (!window.PublicKeyCredential) {
    if (fromUserTap) { authError.textContent = 'This browser does not support Face ID sign-in.'; authError.hidden = false; }
    return;
  }
  passkeyInFlight = true;
  authError.hidden = true;
  setSigningIn(true);
  var res = await sb.auth.signInWithPasskey();
  passkeyInFlight = false;
  if (res.error) {
    setSigningIn(false);
    var cancelled = /NotAllowed|abort|cancel/i.test((res.error.name || '') + ' ' + (res.error.message || ''));
    if (!cancelled) {
      authError.textContent = hasPasskeyHere()
        ? 'Face ID sign-in failed. Use your password instead.'
        : 'Face ID isn\u2019t set up yet. Sign in with your password, then go to Settings → Security.';
      authError.hidden = false;
    } else if (!fromUserTap) { $('#login-faceid-cta').hidden = false; }
  }
  if (!res.error) { try { localStorage.setItem('alenjo_has_passkey', 'true'); } catch (e) {} }
  // On success the SIGNED_IN handler takes over and opens Home.
}

authFaceId.addEventListener('click', function() { signInWithFaceId(true); });
// The Face ID icon lives in the password box. Fields stay read-only until
// you tap them, so iOS doesn't pop its saved-password sheet at the same
// time as the Face ID (passkey) prompt. Tapping a field unlocks it right
// away, and "Fill password" still works there.
[authEmail, authPassword].forEach(function(inp) {
  var unlock = function() { inp.removeAttribute('readonly'); };
  inp.addEventListener('pointerdown', unlock);
  inp.addEventListener('touchstart', unlock, { passive: true });
  inp.addEventListener('focus', unlock);
  inp.addEventListener('keydown', unlock);
});
var faceIdCta = $('#login-faceid-cta');
if (faceIdCta) faceIdCta.addEventListener('click', function() { signInWithFaceId(true); });

// Sign out any existing session on load so user must log in every time
// Then listen for fresh sign-ins only
// Opening a password-reset link: keep that session so you can set a new password
var isRecoveryLink = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);
// Sign out of THIS device only on load (the default would end your
// sessions on every device, e.g. opening on the Mac would sign out the iPhone)
(isRecoveryLink ? Promise.resolve() : sb.auth.signOut({ scope: 'local' })).then(function() {
  showScreen('login');

  sb.auth.onAuthStateChange(function(event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      showPasswordReset();
      return;
    }
    if (event === 'SIGNED_IN' && session && session.user && (isRecoveryLink || resettingPassword)) {
      // The reset link signs you in briefly; wait for the new password first
      showPasswordReset();
      return;
    }
    if (event === 'SIGNED_IN' && session && session.user) {
      // Unlocking a locked app: same person, so keep everything as it was
      if (appLocked && currentUser && session.user.id === currentUser.id) {
        currentUser = session.user;
        unlockApp();
        return;
      }
      currentUser = session.user;
      try {
        if (currentUser.created_at) localStorage.setItem('alenjo_since', new Date(currentUser.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
      } catch (e) {}
      firstSync = true;
      lastActivityAt = Date.now();
      Promise.all([loadProfile(), loadAccounts(), loadCardDesigns()]).then(function() {
        if (cachedAccounts && cachedAccounts.length > 0) throttledSync();
        return loadTransactions();
      }).catch(function(e) {
        console.error('Init error:', e);
      }).then(function() {
        showScreen('app');
      });
    } else if (event === 'SIGNED_OUT') {
      var wasSignedIn = currentUser !== null;
      currentUser = null;
      if (wasSignedIn) {
        authPassword.value = '';
        setupRememberedEmail();
        lastPwLen = 0;
      }
      showScreen('login');
    }
  });
});

// ============================================
// RESUME / VISIBILITY
// ============================================
// iOS keeps the PWA's JS state but pauses execution in the background.
// Without an explicit refresh on resume, the user sees stale data until
// they force-quit and reopen the app.
var lastHiddenAt = 0;
var resumeRefreshInFlight = false;

function refreshOnResume() {
  if (!currentUser) return;
  if (resumeRefreshInFlight) return;
  var appScreen = $('#screen-app');
  if (!appScreen || !appScreen.classList.contains('active')) return;

  resumeRefreshInFlight = true;
  loadAccounts().then(function() {
    var activeTab = localStorage.getItem('alenjo_active_tab') || 'snapshot';
    if (activeTab === 'transactions') {
      return loadTransactions();
    }
  }).catch(function(e) {
    console.error('Resume refresh error:', e);
  }).then(function() {
    resumeRefreshInFlight = false;
  });
}

document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    lastHiddenAt = Date.now();
    return;
  }
  // Away longer than the auto-lock time: lock (Face ID) or sign out
  if (currentUser && !appLocked && !plaidLinkOpen() && Date.now() - lastActivityAt > getLockMs()) {
    lockOrSignOut();
    return;
  }
  // Short glances at another app don't need a refresh
  if (lastHiddenAt && Date.now() - lastHiddenAt > 5000) {
    refreshOnResume();
  }
});

// bfcache restores on iOS Safari don't always fire visibilitychange
window.addEventListener('pageshow', function(e) {
  if (e.persisted) refreshOnResume();
});

// ============================================
// AUTO LOGOUT
// ============================================
var lastActivityAt = Date.now();
function getLockMs() {
  var m = 5;
  try { m = parseInt(localStorage.getItem('alenjo_lock_minutes') || '5', 10) || 5; } catch (e) {}
  return m * 60 * 1000;
}

// With Face ID (a passkey) on this device, time-outs lock the app instead of
// signing out: your screen stays where it was and one Face ID check opens it.
// Without a passkey, time-outs sign you out like before.
var appLocked = false;
var unlocking = false;
function canLock() {
  return !!(currentUser && window.PublicKeyCredential && hasPasskeyHere());
}
function lockOrSignOut() {
  if (canLock()) lockApp();
  else location.reload();
}
function lockApp() {
  appLocked = true;
  var lock = $('#lock-screen');
  if (lock) lock.hidden = false;
  $('#screen-app').setAttribute('inert', '');
  $('#lock-error').hidden = true;
  if (document.activeElement) try { document.activeElement.blur(); } catch (e) {}
}
function unlockApp() {
  appLocked = false;
  unlocking = false;
  var lock = $('#lock-screen');
  if (lock) lock.hidden = true;
  $('#screen-app').removeAttribute('inert');
  markActivity();
  refreshOnResume();
}
async function tryUnlock() {
  if (unlocking) return;
  unlocking = true;
  var res = await sb.auth.signInWithPasskey();
  if (res.error) {
    unlocking = false;
    var cancelled = /NotAllowed|abort|cancel/i.test((res.error.name || '') + ' ' + (res.error.message || ''));
    if (!cancelled) { $('#lock-error').textContent = 'Face ID didn\u2019t work. Try again or sign out.'; $('#lock-error').hidden = false; }
    return;
  }
  // The SIGNED_IN handler sees `unlocking` and just removes the lock
}
var unlockBtn = $('#btn-unlock');
if (unlockBtn) unlockBtn.addEventListener('click', tryUnlock);
var lockSignOut = $('#btn-lock-signout');
if (lockSignOut) lockSignOut.addEventListener('click', function() { location.reload(); });

function markActivity() {
  lastActivityAt = Date.now();
}

// Plaid Link runs in a cross-origin iframe, so taps inside it never reach this
// page. Treat an open Plaid window as activity so we don't reload mid-connection.
function plaidLinkOpen() {
  var frames = document.querySelectorAll('iframe[id^="plaid-link-iframe"]');
  for (var i = 0; i < frames.length; i++) {
    if (frames[i].offsetParent !== null || frames[i].style.display !== 'none') return true;
  }
  return false;
}

['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach(function(ev) {
  document.addEventListener(ev, markActivity, { passive: true, capture: true });
});

setInterval(function() {
  if (!currentUser) return;
  if (plaidLinkOpen()) { markActivity(); return; }
  if (!appLocked && Date.now() - lastActivityAt > getLockMs()) {
    lockOrSignOut();
  }
}, 5000);

// ============================================
// SCREENS & TABS
// ============================================
function showScreen(name) {
  if (name === 'app' || name === 'login') setSigningIn(false);
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  $('#screen-' + name).classList.add('active');
  if (name === 'app') {
    var savedTab = localStorage.getItem('alenjo_active_tab');
    if (savedTab === 'investments' || savedTab === 'settings' || savedTab === 'budget') savedTab = 'snapshot';
    if (savedTab) switchTab(savedTab);
  }
  if (name === 'login') {
    authEmail.setAttribute('readonly', ''); authPassword.setAttribute('readonly', '');
    // "Ask for Face ID on open": start the native Face ID prompt right away.
    // If the browser insists on a tap first, the big Face ID button stays up.
    if (autoFaceIdEnabled() && hasPasskeyHere()) setTimeout(function() { signInWithFaceId(false); }, 300);
  }
}

function autoFaceIdEnabled() {
  try { return localStorage.getItem('alenjo_auto_faceid') === 'true'; } catch (e) { return false; }
}

function switchTab(tabName) {
  if (tabName === 'settings' && typeof updateFaceIdSetting === 'function') updateFaceIdSetting();
  document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var tab = $('#tab-' + tabName);
  if (tab) tab.classList.add('active');
  var nav = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
  if (nav) nav.classList.add('active');
  if (tabName !== 'settings') localStorage.setItem('alenjo_active_tab', tabName);
}

// Settings via header avatar/name
var prevTab = 'snapshot';
var settingsBtn = $('#btn-open-settings');
if (settingsBtn) settingsBtn.addEventListener('click', function() {
  var current = localStorage.getItem('alenjo_active_tab');
  if (current === 'settings') {
    // Already on settings, go back
    switchTab(prevTab || 'snapshot');
  } else {
    prevTab = current || 'snapshot';
    switchTab('settings');
  }
});

// Bottom nav clicks
document.getElementById('bottom-nav').addEventListener('click', function(e) {
  var btn = e.target.closest('.nav-item');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

// ============================================
// PROFILE
// ============================================
async function loadProfile() {
  var result = await sb.from('profiles').select('display_name, avatar_url, tab_order').eq('id', currentUser.id).single();
  if (result.error) {
    console.error('Profile load error:', result.error);
    return;
  }
  userProfile = result.data;
  try { if (userProfile && userProfile.display_name) localStorage.setItem('alenjo_last_name', userProfile.display_name); } catch (e) {}
  updateHeaderProfile();
  updateSettingsProfile();
}

function updateHeaderProfile() {
  if (!userProfile) return;
  headerName.textContent = userProfile.display_name || '';
  if (userProfile.avatar_url) {
    headerAvatar.style.backgroundImage = 'url(' + userProfile.avatar_url + ')';
  }
}

function updateSettingsProfile() {
  if (!userProfile) return;
  var nameInput = $('#settings-name');
  var avatar = $('#settings-avatar');
  if (nameInput) nameInput.value = userProfile.display_name || '';
  var emailEl = $('#settings-email');
  if (emailEl && currentUser) emailEl.textContent = currentUser.email || '';
  if (avatar && userProfile.avatar_url) {
    avatar.style.backgroundImage = 'url(' + userProfile.avatar_url + ')';
  }
}

// Save name
$('#btn-save-name').addEventListener('click', async function() {
  var name = $('#settings-name').value.trim();
  if (!name) return;
  this.disabled = true;
  await sb.from('profiles').update({ display_name: name }).eq('id', currentUser.id);
  userProfile.display_name = name;
  updateHeaderProfile();
  flashSaved(this);
});

// Avatar upload
$('#btn-change-avatar').addEventListener('click', function() {
  $('#avatar-upload').click();
});

$('#avatar-upload').addEventListener('change', async function(e) {
  var file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Photo is too large. Use one under 2 MB.');
    return;
  }
  showLoading(true);

  var path = currentUser.id + '/avatar.' + file.name.split('.').pop();
  var uploadResult = await sb.storage.from('avatars').upload(path, file, { upsert: true });

  if (uploadResult.error) {
    console.error('Upload error:', uploadResult.error);
    showLoading(false);
    showToast("Couldn't upload photo. Use a PNG, JPG or WebP image.");
    return;
  }

  var urlResult = sb.storage.from('avatars').getPublicUrl(path);
  var avatarUrl = urlResult.data.publicUrl + '?v=' + Date.now();

  await sb.from('profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
  userProfile.avatar_url = avatarUrl;
  updateHeaderProfile();
  updateSettingsProfile();
  showLoading(false);
});

// ============================================
// CARD DESIGNS
// ============================================
var cachedCardDesigns = [];
var nsfwModelPromise = null;

async function loadCardDesigns() {
  if (!currentUser) return;
  var result = await sb.from('card_designs').select('id, storage_path, url, name, created_at').order('created_at', { ascending: false });
  if (result.error) { console.error('card designs load error', result.error); return; }
  cachedCardDesigns = result.data || [];
  renderCardDesignsSettings();
  // Re-render accounts in case they loaded first and a design was referenced
  if (cachedAccounts && cachedAccounts.some(function(a) { return a.card_design_id; })) {
    renderAccounts(cachedAccounts);
  }
}

function getCardDesignById(id) {
  if (!id) return null;
  for (var i = 0; i < cachedCardDesigns.length; i++) {
    if (cachedCardDesigns[i].id === id) return cachedCardDesigns[i];
  }
  return null;
}

function renderCardDesignsSettings() {
  var list = $('#card-designs-list');
  if (!list) return;
  if (!cachedCardDesigns.length) {
    list.innerHTML = '<div class="card-designs-empty">No designs yet. Tap Upload Design to add one.</div>';
    return;
  }
  list.innerHTML = cachedCardDesigns.map(function(d) {
    return '<div class="card-design-tile">' +
      '<div class="card-design-tile-img" style="background-image:url(' + esc(d.url) + ')"></div>' +
      '<button class="card-design-delete" data-delete-design="' + d.id + '" aria-label="Delete">&times;</button>' +
    '</div>';
  }).join('');
}

function loadScript(src) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = function() { resolve(); };
    s.onerror = function() { reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

function loadNsfwModel() {
  if (nsfwModelPromise) return nsfwModelPromise;
  nsfwModelPromise = (async function() {
    if (!window.tf) {
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
    }
    if (!window.nsfwjs) {
      await loadScript('https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/nsfwjs.min.js');
    }
    return await window.nsfwjs.load();
  })();
  return nsfwModelPromise;
}

function setDesignStatus(msg, err) {
  var el = $('#card-designs-status');
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ''; el.classList.remove('error'); return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('error', !!err);
}

var cropperAssetsPromise = null;
function loadCropper() {
  if (cropperAssetsPromise) return cropperAssetsPromise;
  var cssLoad = new Promise(function(resolve) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css';
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
  cropperAssetsPromise = Promise.all([
    cssLoad,
    loadScript('https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js')
  ]);
  return cropperAssetsPromise;
}

var bgRemovalModulePromise = null;
var bgRemovalEverLoaded = false;
function loadBgRemoval() {
  if (bgRemovalModulePromise) return bgRemovalModulePromise;
  bgRemovalModulePromise = import('https://esm.sh/@imgly/background-removal@1.5.8');
  return bgRemovalModulePromise;
}

async function removeCardBackground(blob) {
  var mod = await loadBgRemoval();
  var result = await mod.removeBackground(blob, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: function(key, cur, total) {
      if (key && key.indexOf('fetch') === 0 && total) {
        var pct = Math.round((cur / total) * 100);
        setDesignStatus('Loading extraction model... ' + pct + '%');
      } else if (key && key.indexOf('compute') === 0) {
        setDesignStatus('Extracting card...');
      }
    }
  });
  bgRemovalEverLoaded = true;
  return result;
}

async function trimTransparentEdges(blob) {
  var objUrl = URL.createObjectURL(blob);
  var img = new Image();
  try {
    await new Promise(function(resolve, reject) {
      img.onload = resolve;
      img.onerror = function() { reject(new Error('load failed')); };
      img.src = objUrl;
    });
  } catch (e) {
    URL.revokeObjectURL(objUrl);
    return blob;
  }

  var w = img.naturalWidth, h = img.naturalHeight;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(objUrl);

  var data = ctx.getImageData(0, 0, w, h).data;
  var top = h, left = w, right = -1, bottom = -1;
  var alphaThreshold = 16;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return blob;

  var cw = right - left + 1;
  var ch = bottom - top + 1;
  var out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d').drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
  return new Promise(function(resolve) {
    out.toBlob(function(b) { resolve(b || blob); }, 'image/png');
  });
}

var activeCropper = null;
var cropModalObjUrl = null;

function closeCropModal() {
  var modal = $('#card-crop-modal');
  if (modal) modal.classList.remove('visible');
  if (activeCropper) { try { activeCropper.destroy(); } catch (e) {} activeCropper = null; }
  if (cropModalObjUrl) { URL.revokeObjectURL(cropModalObjUrl); cropModalObjUrl = null; }
  var img = $('#card-crop-image');
  if (img) img.src = '';
  var applyBtn = $('#card-crop-apply');
  if (applyBtn) applyBtn.disabled = false;
}

function openCropModal(file) {
  var modal = $('#card-crop-modal');
  var img = $('#card-crop-image');
  if (!modal || !img) return;
  if (activeCropper) { try { activeCropper.destroy(); } catch (e) {} activeCropper = null; }
  if (cropModalObjUrl) { URL.revokeObjectURL(cropModalObjUrl); cropModalObjUrl = null; }
  cropModalObjUrl = URL.createObjectURL(file);
  img.onload = function() {
    activeCropper = new window.Cropper(img, {
      viewMode: 1,
      autoCropArea: 0.9,
      background: false,
      movable: false,
      zoomable: true,
      rotatable: false,
      toggleDragModeOnDblclick: false
    });
  };
  img.src = cropModalObjUrl;
  modal.classList.add('visible');
}

$('#btn-add-card-design').addEventListener('click', function() {
  $('#card-design-upload').click();
});

$('#card-design-upload').addEventListener('change', async function(e) {
  var file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  setDesignStatus('');

  if (!/^image\/(png|webp|jpeg)$/.test(file.type)) {
    setDesignStatus('Image must be PNG, JPEG, or WebP.', true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setDesignStatus('Image must be under 10MB.', true);
    return;
  }

  setDesignStatus('Loading editor...');
  try {
    await loadCropper();
  } catch (err) {
    console.error('cropper load error', err);
    setDesignStatus('Could not load image editor.', true);
    return;
  }
  setDesignStatus('');
  openCropModal(file);
});

$('#card-crop-cancel').addEventListener('click', closeCropModal);

$('#card-crop-apply').addEventListener('click', async function() {
  if (!activeCropper) return;
  var applyBtn = this;
  applyBtn.disabled = true;

  var croppedBlob;
  try {
    var canvas = activeCropper.getCroppedCanvas({
      maxWidth: 1600,
      maxHeight: 1600,
      imageSmoothingQuality: 'high'
    });
    croppedBlob = await new Promise(function(resolve, reject) {
      canvas.toBlob(function(b) { b ? resolve(b) : reject(new Error('Crop failed')); }, 'image/png');
    });
  } catch (err) {
    console.error('crop error', err);
    setDesignStatus('Could not crop image.', true);
    applyBtn.disabled = false;
    return;
  }

  closeCropModal();

  var extractedBlob;
  try {
    setDesignStatus(bgRemovalEverLoaded ? 'Extracting card...' : 'Loading extraction model (first time, ~40MB)...');
    extractedBlob = await removeCardBackground(croppedBlob);
  } catch (err) {
    console.error('background removal error', err);
    setDesignStatus('Could not remove background. Try a clearer image.', true);
    return;
  }

  setDesignStatus('');
  try {
    await openRefineModal(croppedBlob, extractedBlob);
  } catch (err) {
    console.error('refine modal error', err);
    setDesignStatus('Could not open editor.', true);
  }
});

var ISO_CARD_ASPECT = 85.60 / 53.98;
var ISO_CARD_RADIUS_RATIO = 3.18 / 53.98;

var refineState = {
  origCanvas: null,
  editedCanvas: null,
  displayCanvas: null,
  extractedBlob: null,
  origBlob: null,
  tool: 'keep',
  mode: 'brush',
  brushPx: 40,
  drawing: false,
  lastPt: null,
  canvasRect: null,
  ringPt: null,
  ringScale: 1,
  cardShape: null,
  cardDrag: null
};

function blobToImage(blob) {
  return new Promise(function(resolve, reject) {
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function() { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

async function openRefineModal(origBlob, extractedBlob) {
  var origImg = await blobToImage(origBlob);
  var extImg = await blobToImage(extractedBlob);
  var w = origImg.naturalWidth, h = origImg.naturalHeight;

  var origCanvas = document.createElement('canvas');
  origCanvas.width = w; origCanvas.height = h;
  origCanvas.getContext('2d').drawImage(origImg, 0, 0);

  var editedCanvas = document.createElement('canvas');
  editedCanvas.width = w; editedCanvas.height = h;
  editedCanvas.getContext('2d').drawImage(extImg, 0, 0);

  refineState.origCanvas = origCanvas;
  refineState.editedCanvas = editedCanvas;
  refineState.origBlob = origBlob;
  refineState.extractedBlob = extractedBlob;
  refineState.tool = 'keep';
  refineState.mode = 'brush';
  refineState.cardShape = null;
  refineState.cardDrag = null;
  refineState.lastPt = null;
  refineState.drawing = false;

  var display = $('#card-refine-canvas');
  display.width = w;
  display.height = h;
  refineState.displayCanvas = display;
  redrawRefine();

  document.querySelectorAll('.card-refine-tool').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tool === 'keep');
  });
  var sizeInput = $('#card-refine-size-input');
  sizeInput.value = 40;
  refineState.brushPx = 40;

  updateRefineModeUI();
  $('#card-refine-modal').classList.add('visible');
  requestAnimationFrame(cacheRefineCanvasRect);
}

function cacheRefineCanvasRect() {
  var c = refineState.displayCanvas;
  if (c) refineState.canvasRect = c.getBoundingClientRect();
}

function closeRefineModal() {
  $('#card-refine-modal').classList.remove('visible');
  refineState.origCanvas = null;
  refineState.editedCanvas = null;
  refineState.displayCanvas = null;
  refineState.extractedBlob = null;
  refineState.origBlob = null;
  refineState.lastPt = null;
  refineState.drawing = false;
  refineState.canvasRect = null;
  refineState.ringPt = null;
  refineState.mode = 'brush';
  refineState.cardShape = null;
  refineState.cardDrag = null;
}

function initCardShape() {
  var w = refineState.editedCanvas.width;
  var h = refineState.editedCanvas.height;
  var maxW = w * 0.9;
  var maxH = h * 0.9;
  var sw = maxW;
  var sh = sw / ISO_CARD_ASPECT;
  if (sh > maxH) { sh = maxH; sw = sh * ISO_CARD_ASPECT; }
  refineState.cardShape = { cx: w / 2, cy: h / 2, w: sw, h: sh };
}

function cardShapePath(ctx, s) {
  var r = s.h * ISO_CARD_RADIUS_RATIO;
  var x = s.cx - s.w / 2, y = s.cy - s.h / 2;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, s.w, s.h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + s.w, y, x + s.w, y + r, r);
    ctx.arcTo(x + s.w, y + s.h, x + s.w - r, y + s.h, r);
    ctx.arcTo(x, y + s.h, x, y + s.h - r, r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

function refineCardHitTest(ix, iy, scale) {
  var s = refineState.cardShape;
  if (!s) return null;
  var hr = 32 * scale;
  var corners = [
    { type: 'nw', x: s.cx - s.w / 2, y: s.cy - s.h / 2 },
    { type: 'ne', x: s.cx + s.w / 2, y: s.cy - s.h / 2 },
    { type: 'sw', x: s.cx - s.w / 2, y: s.cy + s.h / 2 },
    { type: 'se', x: s.cx + s.w / 2, y: s.cy + s.h / 2 }
  ];
  for (var i = 0; i < corners.length; i++) {
    var dx = ix - corners[i].x, dy = iy - corners[i].y;
    if (dx * dx + dy * dy <= hr * hr) return corners[i].type;
  }
  if (ix >= s.cx - s.w / 2 && ix <= s.cx + s.w / 2 &&
      iy >= s.cy - s.h / 2 && iy <= s.cy + s.h / 2) {
    return 'move';
  }
  return null;
}

function updateCardDrag(p) {
  var d = refineState.cardDrag;
  if (!d) return;
  var s = refineState.cardShape;
  var start = d.startShape;
  var dx = p.x - d.startPt.x;
  var dy = p.y - d.startPt.y;
  if (d.type === 'move') {
    s.cx = start.cx + dx;
    s.cy = start.cy + dy;
    return;
  }
  var sgnX = (d.type === 'ne' || d.type === 'se') ? 1 : -1;
  var sgnY = (d.type === 'sw' || d.type === 'se') ? 1 : -1;
  var anchorX = start.cx - sgnX * start.w / 2;
  var anchorY = start.cy - sgnY * start.h / 2;
  var newCornerX = start.cx + sgnX * start.w / 2 + dx;
  var newCornerY = start.cy + sgnY * start.h / 2 + dy;
  var newW = Math.abs(newCornerX - anchorX);
  var newH = Math.abs(newCornerY - anchorY);
  if (newW / ISO_CARD_ASPECT >= newH) {
    newH = newW / ISO_CARD_ASPECT;
  } else {
    newW = newH * ISO_CARD_ASPECT;
  }
  var minW = Math.min(refineState.editedCanvas.width, refineState.editedCanvas.height) * 0.1;
  if (newW < minW) { newW = minW; newH = newW / ISO_CARD_ASPECT; }
  s.w = newW;
  s.h = newH;
  s.cx = anchorX + sgnX * newW / 2;
  s.cy = anchorY + sgnY * newH / 2;
}

function updateRefineModeUI() {
  var inCard = refineState.mode === 'card';
  var btn = $('#card-refine-mode-btn');
  if (btn) btn.classList.toggle('active', inCard);
  document.querySelectorAll('.card-refine-tool').forEach(function(b) {
    b.hidden = inCard;
  });
  var sizeWrap = document.querySelector('.card-refine-size');
  if (sizeWrap) sizeWrap.hidden = inCard;
  var applyBtn = $('#card-refine-shape-apply');
  if (applyBtn) applyBtn.hidden = !inCard;
  var help = document.querySelector('.card-refine-help');
  if (help) {
    help.innerHTML = inCard
      ? 'Drag to move the card outline, drag a corner to resize, then tap <strong>Apply</strong> to mask everything outside.'
      : 'Paint <strong>Keep</strong> or <strong>Erase</strong> to touch up edges, or tap <strong>Shapes</strong> to mask with a card outline.';
  }
  var hint = document.querySelector('.card-refine-hint');
  if (hint) hint.hidden = inCard;
  if (inCard) refineState.ringPt = null;
}

function redrawRefine() {
  var c = refineState.displayCanvas;
  if (!c) return;
  var ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(refineState.editedCanvas, 0, 0);
  var scale = refineState.ringScale || 1;

  if (refineState.mode === 'card' && refineState.cardShape) {
    var s = refineState.cardShape;
    ctx.lineWidth = Math.max(1.5, 1.5 * scale);
    ctx.strokeStyle = '#F45030';
    cardShapePath(ctx, s);
    ctx.stroke();
    return;
  }

  var rp = refineState.ringPt;
  if (rp) {
    var radius = (refineState.brushPx / 2) * scale;
    ctx.lineWidth = Math.max(1, scale);
    ctx.strokeStyle = '#F45030';
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function refinePointToImage(evt) {
  var c = refineState.displayCanvas;
  var rect = refineState.canvasRect || (refineState.canvasRect = c.getBoundingClientRect());
  var scale = c.width / rect.width;
  return {
    x: (evt.clientX - rect.left) * scale,
    y: (evt.clientY - rect.top) * scale,
    scale: scale
  };
}

function refineDot(cx, cy, r) {
  var ctx = refineState.editedCanvas.getContext('2d');
  ctx.save();
  if (refineState.tool === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(refineState.origCanvas, 0, 0);
  }
  ctx.restore();
}

function refineStroke(x0, y0, x1, y1, r) {
  var dx = x1 - x0, dy = y1 - y0;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 2)));
  for (var i = 0; i <= steps; i++) {
    var t = i / steps;
    refineDot(x0 + dx * t, y0 + dy * t, r);
  }
}

function refinePointerDown(e) {
  if (!refineState.editedCanvas) return;
  e.preventDefault();
  var p = refinePointToImage(e);
  refineState.ringScale = p.scale;

  if (refineState.mode === 'card') {
    var hit = refineCardHitTest(p.x, p.y, p.scale);
    if (hit) {
      refineState.cardDrag = {
        type: hit,
        startPt: { x: p.x, y: p.y },
        startShape: { cx: refineState.cardShape.cx, cy: refineState.cardShape.cy, w: refineState.cardShape.w, h: refineState.cardShape.h }
      };
    }
    return;
  }

  refineState.drawing = true;
  refineState.ringPt = { x: p.x, y: p.y };
  var r = (refineState.brushPx / 2) * p.scale;
  refineDot(p.x, p.y, r);
  refineState.lastPt = { x: p.x, y: p.y };
  redrawRefine();
}

function refinePointerMove(e) {
  if (!refineState.editedCanvas) return;
  var p = refinePointToImage(e);
  refineState.ringScale = p.scale;

  if (refineState.mode === 'card') {
    if (refineState.cardDrag) {
      e.preventDefault();
      updateCardDrag(p);
      redrawRefine();
    }
    return;
  }

  refineState.ringPt = { x: p.x, y: p.y };
  if (refineState.drawing) {
    e.preventDefault();
    var r = (refineState.brushPx / 2) * p.scale;
    if (refineState.lastPt) {
      refineStroke(refineState.lastPt.x, refineState.lastPt.y, p.x, p.y, r);
    } else {
      refineDot(p.x, p.y, r);
    }
    refineState.lastPt = { x: p.x, y: p.y };
  }
  redrawRefine();
}

function refinePointerUp() {
  refineState.drawing = false;
  refineState.lastPt = null;
  refineState.cardDrag = null;
}

function refinePointerLeave() {
  refineState.ringPt = null;
  redrawRefine();
}

(function wireRefineEvents() {
  var c = $('#card-refine-canvas');
  if (!c) return;
  c.addEventListener('pointerdown', refinePointerDown);
  c.addEventListener('pointermove', refinePointerMove);
  c.addEventListener('pointerleave', refinePointerLeave);
  window.addEventListener('pointerup', refinePointerUp);
  window.addEventListener('pointercancel', refinePointerUp);
  window.addEventListener('resize', function() { refineState.canvasRect = null; });
})();

document.addEventListener('click', function(e) {
  var toolBtn = e.target.closest('.card-refine-tool');
  if (!toolBtn) return;
  refineState.tool = toolBtn.dataset.tool;
  document.querySelectorAll('.card-refine-tool').forEach(function(b) {
    b.classList.toggle('active', b === toolBtn);
  });
});

$('#card-refine-size-input').addEventListener('input', function(e) {
  refineState.brushPx = parseInt(e.target.value, 10) || 40;
  redrawRefine();
});

$('#card-refine-mode-btn').addEventListener('click', function() {
  if (!refineState.editedCanvas) return;
  if (refineState.mode === 'card') {
    refineState.mode = 'brush';
    refineState.cardDrag = null;
  } else {
    refineState.mode = 'card';
    if (!refineState.cardShape) initCardShape();
  }
  updateRefineModeUI();
  redrawRefine();
});

$('#card-refine-shape-apply').addEventListener('click', function() {
  if (!refineState.cardShape || !refineState.editedCanvas) return;
  var ec = refineState.editedCanvas;
  var ctx = ec.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.clearRect(0, 0, ec.width, ec.height);
  ctx.restore();
  ctx.save();
  cardShapePath(ctx, refineState.cardShape);
  ctx.clip();
  ctx.drawImage(refineState.origCanvas, 0, 0);
  ctx.restore();
  refineState.mode = 'brush';
  refineState.cardDrag = null;
  updateRefineModeUI();
  redrawRefine();
});

$('#card-refine-reset').addEventListener('click', async function() {
  if (!refineState.extractedBlob) return;
  var img = await blobToImage(refineState.extractedBlob);
  var ctx = refineState.editedCanvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(img, 0, 0);
  ctx.restore();
  redrawRefine();
});

$('#card-refine-fill').addEventListener('click', function() {
  if (!refineState.editedCanvas || !refineState.origCanvas) return;
  var ctx = refineState.editedCanvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(refineState.origCanvas, 0, 0);
  ctx.restore();
  redrawRefine();
});

$('#card-refine-cancel').addEventListener('click', function() {
  closeRefineModal();
  setDesignStatus('');
});

$('#card-refine-apply').addEventListener('click', async function() {
  var btn = this;
  btn.disabled = true;
  try {
    var finalBlob = await new Promise(function(resolve, reject) {
      refineState.editedCanvas.toBlob(function(b) { b ? resolve(b) : reject(new Error('blob failed')); }, 'image/png');
    });
    closeRefineModal();
    setDesignStatus('Trimming edges...');
    finalBlob = await trimTransparentEdges(finalBlob);
    await finalizeDesignUpload(finalBlob);
  } catch (err) {
    console.error('refine save error', err);
    setDesignStatus('Could not save.', true);
  } finally {
    btn.disabled = false;
  }
});

async function finalizeDesignUpload(processedBlob) {
  var objUrl = URL.createObjectURL(processedBlob);
  var img = new Image();
  try {
    await new Promise(function(resolve, reject) {
      img.onload = resolve;
      img.onerror = function() { reject(new Error('Could not read processed image')); };
      img.src = objUrl;
    });
  } catch (err) {
    URL.revokeObjectURL(objUrl);
    setDesignStatus('Could not read processed image.', true);
    return;
  }

  try {
    setDesignStatus('Scanning for inappropriate content...');
    var model = await loadNsfwModel();
    var preds = await model.classify(img);
    var byClass = {};
    preds.forEach(function(p) { byClass[p.className] = p.probability; });
    var pornish = Math.max(byClass.Porn || 0, byClass.Hentai || 0);
    var sexy = byClass.Sexy || 0;
    if (pornish > 0.35 || sexy > 0.7) {
      URL.revokeObjectURL(objUrl);
      setDesignStatus('This image appears to contain inappropriate content and cannot be uploaded.', true);
      return;
    }
  } catch (err) {
    console.warn('NSFW scan failed, continuing:', err);
  }
  URL.revokeObjectURL(objUrl);

  setDesignStatus('Uploading...');
  var fname = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
  var path = currentUser.id + '/' + fname;

  var up = await sb.storage.from('card-designs').upload(path, processedBlob, { contentType: 'image/png' });
  if (up.error) {
    console.error('card design upload error', up.error);
    setDesignStatus('Upload failed.', true);
    return;
  }

  var pub = sb.storage.from('card-designs').getPublicUrl(path);
  var publicUrl = pub.data.publicUrl;

  var ins = await sb.from('card_designs').insert({
    user_id: currentUser.id,
    storage_path: path,
    url: publicUrl,
    name: null
  }).select('id, storage_path, url, name, created_at').single();

  if (ins.error) {
    console.error('card design insert error', ins.error);
    await sb.storage.from('card-designs').remove([path]);
    setDesignStatus('Save failed.', true);
    return;
  }

  cachedCardDesigns.unshift(ins.data);
  renderCardDesignsSettings();
  setDesignStatus('');
  showToast('Design added');
}

document.addEventListener('click', async function(e) {
  var btn = e.target.closest('[data-delete-design]');
  if (!btn) return;
  var id = btn.dataset.deleteDesign;
  if (!confirm('Delete this card design?')) return;
  var design = getCardDesignById(id);
  if (!design) return;

  var del = await sb.from('card_designs').delete().eq('id', id);
  if (del.error) {
    console.error('card design delete error', del.error);
    showToast('Delete failed');
    return;
  }
  sb.storage.from('card-designs').remove([design.storage_path]).then(function(res) {
    if (res && res.error) console.warn('Storage cleanup failed:', res.error);
  });

  cachedCardDesigns = cachedCardDesigns.filter(function(d) { return d.id !== id; });
  if (cachedAccounts) {
    cachedAccounts.forEach(function(a) { if (a.card_design_id === id) a.card_design_id = null; });
  }
  renderCardDesignsSettings();
  if (cachedAccounts) renderAccounts(cachedAccounts);
  showToast('Design deleted');
});

function renderCardDesignPicker(selectedId) {
  var el = $('#card-design-picker');
  if (!el) return;
  var usedBy = {};
  if (cachedAccounts) {
    cachedAccounts.forEach(function(a) {
      if (a.card_design_id && a.id !== editingAccountId) {
        usedBy[a.card_design_id] = a.nickname || a.name || 'another account';
      }
    });
  }
  var html = '<button type="button" class="card-design-option none' + (!selectedId ? ' selected' : '') + '" data-design-id="">None</button>';
  if (cachedCardDesigns.length === 0) {
    html += '<div class="card-design-picker-empty">Upload designs in Settings &rarr; Card Designs.</div>';
  } else {
    cachedCardDesigns.forEach(function(d) {
      var takenBy = usedBy[d.id];
      var classes = 'card-design-option';
      if (selectedId === d.id) classes += ' selected';
      if (takenBy) classes += ' in-use';
      var dataTaken = takenBy ? ' data-used-by="' + esc(takenBy) + '"' : '';
      html += '<button type="button" class="' + classes + '" data-design-id="' + d.id + '"' + dataTaken + '>' +
        '<div class="card-design-option-img" style="background-image:url(' + esc(d.url) + ')"></div>' +
      '</button>';
    });
  }
  el.innerHTML = html;
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('#card-design-picker .card-design-option');
  if (!btn) return;
  if (btn.classList.contains('in-use')) {
    var usedBy = btn.getAttribute('data-used-by') || 'another account';
    showToast('Already used on ' + usedBy + '. Remove it there first.');
    return;
  }
  var picker = document.getElementById('card-design-picker');
  picker.querySelectorAll('.card-design-option').forEach(function(b) { b.classList.remove('selected'); });
  btn.classList.add('selected');
});

// Settings collapsible sections
document.addEventListener('click', function(e) {
  var header = e.target.closest('.settings-card-header[data-toggle]');
  if (!header) return;
  var body = document.getElementById(header.dataset.toggle);
  if (body) body.classList.toggle('collapsed');
  header.classList.toggle('open');
});

// ============================================
// BALANCE TOGGLE
// ============================================
document.querySelectorAll('.hero-stat').forEach(function(btn) {
  btn.addEventListener('click', function() {
    showAvailable = !showAvailable;
    localStorage.setItem('alenjo_show_available', showAvailable ? 'true' : 'false');
    var pref = $('#pref-after-pending');
    if (pref) pref.checked = !showAvailable;
    if (cachedAccounts) renderAccounts(cachedAccounts);
  });
});

// Face ID setup in Settings → Security
async function updateFaceIdSetting() {
  var status = $('#faceid-status'), btn = $('#btn-setup-faceid');
  if (!status || !btn) return;
  var count = null;
  if (currentUser && sb.auth.passkey && sb.auth.passkey.list) {
    try {
      var res = await sb.auth.passkey.list();
      if (!res.error && res.data) count = res.data.length;
    } catch (e) {}
  }
  if (count) { try { localStorage.setItem('alenjo_has_passkey', 'true'); } catch (e) {} }
  var on = count ? true : hasPasskeyHere();
  status.textContent = count ? count + ' passkey' + (count !== 1 ? 's' : '') + ' saved' : (on ? 'On for this device' : 'Not set up yet');
  btn.textContent = on ? 'Add device' : 'Set up';
}
var setupFaceIdBtn = $('#btn-setup-faceid');
if (setupFaceIdBtn) setupFaceIdBtn.addEventListener('click', async function() {
  if (!window.PublicKeyCredential) { showToast('This browser does not support Face ID sign-in'); return; }
  this.disabled = true;
  var res = await sb.auth.registerPasskey();
  this.disabled = false;
  if (res.error) {
    var msg = res.error.message || 'Could not set up Face ID';
    if (/not enabled|disabled|passkey/i.test(msg) && !/cancel|NotAllowed/i.test(msg)) msg = 'Face ID needs passkeys turned on in Supabase first';
    showToast(msg);
    return;
  }
  try { localStorage.setItem('alenjo_has_passkey', 'true'); } catch (e) {}
  updateFaceIdSetting();
  showToast('Face ID is set up on this device');
});
updateFaceIdSetting();

var lockSelect = $('#pref-lock-minutes');
if (lockSelect) {
  lockSelect.value = String(getLockMs() / 60000);
  lockSelect.addEventListener('change', function() {
    try { localStorage.setItem('alenjo_lock_minutes', this.value); } catch (e) {}
    markActivity();
  });
}

// ============================================
// SETTINGS → ACCOUNTS (order, show on Home, count in totals)
// ============================================
function accountKind(a) {
  if (a.type === 'credit') return 'Credit cards';
  if (a.type === 'investment') return 'Investments';
  if (a.subtype === 'savings') return 'Savings';
  return 'Banks';
}
function renderAccountOrderList() {
  var list = $('#account-order-list');
  if (!list) return;
  if (!cachedAccounts || !cachedAccounts.length) { list.innerHTML = '<p class="set-empty">No accounts yet</p>'; return; }
  var groups = {};
  cachedAccounts.forEach(function(a) { (groups[accountKind(a)] = groups[accountKind(a)] || []).push(a); });
  var html = '';
  ['Banks', 'Credit cards', 'Savings', 'Investments'].forEach(function(kind) {
    var items = (groups[kind] || []).slice().sort(function(x, y) {
      var ox = x.sort_order == null ? 1e9 : x.sort_order, oy = y.sort_order == null ? 1e9 : y.sort_order;
      return ox - oy || Math.abs(getDisplayBalance(y, 'bank').amount) - Math.abs(getDisplayBalance(x, 'bank').amount);
    });
    if (!items.length) return;
    html += '<div class="acct-order-kind">' + kind + '</div>';
    items.forEach(function(a, i) {
      var name = a.nickname || a.name || 'Account';
      html += '<div class="acct-order-row' + (a.is_hidden ? ' is-hidden' : '') + '" data-id="' + esc(a.id) + '">' +
        '<span class="acct-order-name"><span>' + esc(name) + '</span><span class="set-hint">' + esc(a.institution || '') + (a.mask ? ' ••' + esc(a.mask) : '') + (a.exclude_from_totals ? ' · not in totals' : '') + '</span></span>' +
        '<button type="button" class="acct-order-btn" data-move="-1" aria-label="Move ' + esc(name) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="acct-order-btn" data-move="1" aria-label="Move ' + esc(name) + ' down"' + (i === items.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="acct-order-btn acct-eye" data-toggle-hide aria-pressed="' + (a.is_hidden ? 'false' : 'true') + '" aria-label="' + (a.is_hidden ? 'Show ' : 'Hide ') + esc(name) + '">' + (a.is_hidden ? 'Show' : 'Hide') + '</button>' +
      '</div>';
    });
  });
  list.innerHTML = html;
}
var accountOrderList = $('#account-order-list');
if (accountOrderList) accountOrderList.addEventListener('click', function(e) {
  var btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  var row = btn.closest('.acct-order-row');
  var acct = cachedAccounts.find(function(a) { return a.id === row.dataset.id; });
  if (!acct) return;
  if (btn.hasAttribute('data-toggle-hide')) {
    acct.is_hidden = !acct.is_hidden;
    sb.from('accounts').update({ is_hidden: acct.is_hidden }).eq('id', acct.id).then(function(r) { if (r.error) showToast('Could not save'); });
  } else {
    // Renumber this group in its current order, then swap with the neighbour
    var kind = accountKind(acct);
    var rows = Array.prototype.slice.call(accountOrderList.querySelectorAll('.acct-order-row'))
      .map(function(r) { return cachedAccounts.find(function(a) { return a.id === r.dataset.id; }); })
      .filter(function(a) { return a && accountKind(a) === kind; });
    var idx = rows.indexOf(acct), to = idx + parseInt(btn.dataset.move, 10);
    if (to < 0 || to >= rows.length) return;
    rows.splice(to, 0, rows.splice(idx, 1)[0]);
    rows.forEach(function(a, i) {
      if (a.sort_order !== i) {
        a.sort_order = i;
        sb.from('accounts').update({ sort_order: i }).eq('id', a.id).then(function(r) { if (r.error) showToast('Could not save order'); });
      }
    });
  }
  renderAccountOrderList();
  renderAccounts(cachedAccounts);
});

var prefAutoFaceId = $('#pref-auto-faceid');
if (prefAutoFaceId) {
  prefAutoFaceId.checked = autoFaceIdEnabled();
  prefAutoFaceId.addEventListener('change', function() {
    try { localStorage.setItem('alenjo_auto_faceid', this.checked ? 'true' : 'false'); } catch (e) {}
  });
}

var signOutBtn = $('#btn-sign-out');
if (signOutBtn) signOutBtn.addEventListener('click', function() {
  sb.auth.signOut({ scope: 'local' });
});

var prefAfterPending = $('#pref-after-pending');
if (prefAfterPending) {
  prefAfterPending.checked = !showAvailable;
  prefAfterPending.addEventListener('change', function() {
    showAvailable = !this.checked;
    localStorage.setItem('alenjo_show_available', showAvailable ? 'true' : 'false');
    if (cachedAccounts) renderAccounts(cachedAccounts);
  });
}

// ============================================
// APPEARANCE (system / light / dark)
// ============================================
function getThemePref() {
  try { return localStorage.getItem('alenjo_theme') || 'system'; } catch (e) { return 'system'; }
}
function applyTheme() {
  var pref = getThemePref();
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1C1B17' : '#EEECE5');
  document.querySelectorAll('[data-theme-choice]').forEach(function(b) {
    b.setAttribute('aria-pressed', b.dataset.themeChoice === pref ? 'true' : 'false');
  });
}
document.querySelectorAll('[data-theme-choice]').forEach(function(b) {
  b.addEventListener('click', function() {
    try { localStorage.setItem('alenjo_theme', b.dataset.themeChoice); } catch (e) {}
    applyTheme();
  });
});
if (window.matchMedia) {
  var darkQuery = matchMedia('(prefers-color-scheme: dark)');
  var onSystemTheme = function() { if (getThemePref() === 'system') applyTheme(); };
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemTheme);
  else if (darkQuery.addListener) darkQuery.addListener(onSystemTheme);
}
applyTheme();

// Personal greeting on the sign-in screen
(function() {
  var name = '';
  try { name = localStorage.getItem('alenjo_last_name') || ''; } catch (e) {}
  var h = new Date().getHours();
  var part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  var g = document.getElementById('login-greeting');
  if (g) g.textContent = name ? part + ', ' + name.split(' ')[0] : 'Welcome back';
  var sub = document.getElementById('login-subtitle');
  var since = '';
  try { since = localStorage.getItem('alenjo_since') || ''; } catch (e) {}
  if (sub && name && since) sub.textContent = 'Using Alenjo since ' + since;
})();

// ============================================
// PLAID LINK
// ============================================
async function openPlaidLink(products) {
  showLoading(true);
  products = products || ['transactions'];

  try {
    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data.session;
    var headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
      'apikey': SUPABASE_ANON_KEY
    };
    var res = await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ action: 'create_link_token', products: products })
    });

    var data = await res.json();

    if (!res.ok || !data.link_token) {
      showError('Could not connect to your bank. ' + (data.detail || data.error || 'Check your connection and try again.'));
      showLoading(false);
      return;
    }

    showLoading(false);

    var handler = Plaid.create({
      token: data.link_token,
      onSuccess: async function(publicToken, metadata) {
        showLoading(true);

        // Check for duplicate institution before exchanging token (per Plaid docs)
        var dupeCheck = await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            action: 'check_duplicate',
            institution: metadata.institution
          })
        });
        var dupeData = await dupeCheck.json();
        if (dupeData.duplicate) {
          showError(dupeData.message || 'This institution is already connected.');
          showLoading(false);
          return;
        }

        var exchangeRes = await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            action: 'exchange_token',
            public_token: publicToken,
            institution: metadata.institution
          })
        });
        var exchangeData = await exchangeRes.json();
        if (exchangeData.error === 'duplicate') {
          showError(exchangeData.message || 'This institution is already connected.');
          showLoading(false);
          return;
        }
        await loadAccounts();
        showLoading(false);
      },
      onExit: function(err) {
        showLoading(false);
        if (err) {
          showError('Connection failed: ' + (err.display_message || err.error_message || 'Check your connection and try again.'));
        }
      }
    });

    handler.open();
  } catch (err) {
    showError('Could not reach your bank. ' + err.message);
    showLoading(false);
  }
}

btnConnectPlaid.addEventListener('click', function() { openPlaidLink(['transactions']); });
btnAddAccount.addEventListener('click', function() { openPlaidLink(['transactions']); });
// ============================================
// LOAD ACCOUNTS
// ============================================
var loadingAccounts = false;
async function loadAccounts() {
  if (loadingAccounts) return;
  loadingAccounts = true;
  var result = await sb.rpc('get_user_accounts');

  if (result.error) {
    console.error('Error loading accounts:', result.error);
    return;
  }

  cachedAccounts = result.data || [];
  renderAccounts(cachedAccounts);
  resolveLogos();

  loadingAccounts = false;
}

// Dynamic sync cooldown based on connected Plaid items
// Plaid allows 30 req/min/item. Each sync = 3 calls/item.
// We stay conservative: 1 item = 5min, scale up slightly with more items.
var syncInFlight = false;

function getSyncCooldown() {
  if (!cachedAccounts) return 5 * 60 * 1000;
  // Count distinct bank connections (institutions)
  var institutions = {};
  cachedAccounts.forEach(function(a) {
    if (a.institution) institutions[a.institution] = true;
  });
  var itemCount = Object.keys(institutions).length || 1;
  // 1-2 banks: 2 min, 3-5 banks: 3 min, 6+: 5 min
  // Plaid allows 30 req/min/item. Well under limit at these intervals.
  if (itemCount <= 2) return 2 * 60 * 1000;
  if (itemCount <= 5) return 3 * 60 * 1000;
  return 5 * 60 * 1000;
}

var firstSync = true;
function throttledSync() {
  if (syncInFlight) return;
  if (!firstSync) {
    var cooldown = getSyncCooldown();
    var lastSync = parseInt(localStorage.getItem('alenjo_last_tx_sync') || '0');
    if (Date.now() - lastSync < cooldown) return;
  }
  firstSync = false;
  syncInFlight = true;
  localStorage.setItem('alenjo_last_tx_sync', String(Date.now()));
  backgroundSync().finally(function() {
    syncInFlight = false;
  });
}

async function backgroundSync() {
  try {
    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data.session;
    if (!session) return;

    await fetch(SUPABASE_URL + '/functions/v1/sync-transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY
      }
    });

    // Reload accounts with fresh balances (and fresh card/investment details)
    var result = await sb.rpc('get_user_accounts');
    if (!result.error) {
      cachedAccounts = result.data || [];
      cachedHoldings = null;
      cachedLiabilities = null;
      renderAccounts(cachedAccounts);
    }

    // Refresh txData so sign-up bonus progress reflects newly-synced transactions
    var hasBonus = cachedAccounts && cachedAccounts.some(function(a) { return a.type === 'credit' && a.bonus_target_amount; });
    if (hasBonus) {
      var now = new Date();
      var dataStartDate = new Date(now.getFullYear(), now.getMonth() - 24, 1);
      var fcResult = await sb.rpc('get_first_connection_date');
      if (fcResult.data) {
        var fc = new Date(fcResult.data);
        dataStartDate = new Date(fc.getFullYear(), fc.getMonth(), 1);
      }
      var cap = new Date(now.getFullYear(), now.getMonth() - 24, 1);
      if (dataStartDate < cap) dataStartDate = cap;
      var dataStartStr = dataStartDate.toISOString().split('T')[0];
      var txResult = await fetchAllRows(function() { return sb.from('synced_transactions').select('*').gte('date', dataStartStr).order('date', { ascending: false }).order('id'); });
      if (!txResult.error && txResult.data) {
        txData = txResult.data;
        renderAccounts(cachedAccounts);
      }
    }

  } catch (e) {
    console.error('Background sync error:', e);
  }
}


// ============================================
// LOGO.DEV
// ============================================
var LOGO_KEY = 'pk_H4uo3XF8R0iZtbgE3TDSgQ';
async function resolveLogos() {
  if (!cachedAccounts) return;
  var needsResolve = cachedAccounts.some(function(a) { return a.institution && !a.institution_logo_domain; });
  if (!needsResolve) return;

  try {
    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data.session;
    if (!session) return;

    var res = await fetch(SUPABASE_URL + '/functions/v1/resolve-logos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY
      }
    });
    var data = await res.json();
    if (data.resolved > 0) {
      var result = await sb.rpc('get_user_accounts');
      if (!result.error) {
        cachedAccounts = result.data || [];
        renderAccounts(cachedAccounts);
      }
    }
  } catch (e) {
    console.error('Logo resolve error:', e);
  }
}

function getLogoUrl(account) {
  if (!account.institution_logo_domain) return null;
  return 'https://img.logo.dev/' + account.institution_logo_domain +
    '?token=' + LOGO_KEY + '&size=200&format=png&retina=true';
}

// ============================================
// BALANCE HELPERS
// ============================================
function getDisplayBalance(account, type) {
  var current = parseFloat(account.balance_current || 0);
  var available = account.balance_available != null ? parseFloat(account.balance_available) : null;
  var limit = account.balance_limit != null ? parseFloat(account.balance_limit) : null;

  if (type === 'credit') {
    if (showAvailable) {
      return { amount: current, label: 'Posted' };
    } else {
      if (limit != null && available != null) {
        return { amount: limit - available, label: 'After Pending' };
      }
      return { amount: current, label: 'Posted' };
    }
  } else {
    if (showAvailable) {
      return { amount: current, label: 'Current' };
    } else {
      if (available != null) {
        return { amount: available, label: 'After Pending' };
      }
      return { amount: current, label: 'Current' };
    }
  }
}

// ============================================
// RENDER ACCOUNTS
// ============================================
// Accounts you've hidden stay out of the cards; "Not in totals" ones still
// show, but don't count toward Available / Net worth.
function inTotals(a) { return !a.exclude_from_totals; }

function renderAccounts(accounts) {
  accounts = accounts.filter(function(a) { return !a.is_hidden; });
  var banks = accounts.filter(function(a) { return a.type === 'depository' && a.subtype !== 'savings'; });
  var savings = accounts.filter(function(a) { return a.type === 'depository' && a.subtype === 'savings'; });
  var credits = accounts.filter(function(a) { return a.type === 'credit'; });
  var investments = accounts.filter(function(a) { return a.type === 'investment'; });

  // Snapshot tab: all account types
  var hasAnyAccounts = banks.length > 0 || credits.length > 0 || savings.length > 0 || investments.length > 0;
  connectCta.hidden = hasAnyAccounts;
  sectionBanks.hidden = banks.length === 0;
  sectionCredit.hidden = credits.length === 0;
  $('#section-inv-savings').hidden = savings.length === 0;
  $('#section-inv-investments').hidden = investments.length === 0;

  renderSection(listBanks, banks, 'bank');
  var bankSum = banks.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
  banksTotal.textContent = formatSigned(bankSum);
  banksTotal.className = 'section-total ' + (bankSum >= 0 ? 'balance-positive' : 'balance-negative');

  renderSection(listCredit, credits, 'credit');
  var creditSum = credits.reduce(function(s, a) { return s + getDisplayBalance(a, 'credit').amount; }, 0);
  creditTotal.textContent = (creditSum < 0 ? '-' : '') + formatMoney(Math.abs(creditSum));
  creditTotal.className = 'section-total ' + (creditSum >= 0 ? 'balance-negative' : 'balance-positive');

  if (credits.length > 0 && cachedLiabilities === null) {
    loadLiabilities().then(function() {
      renderSection(listCredit, credits, 'credit');
    });
  }

  renderSection($('#list-inv-savings'), savings, 'bank');
  renderSection($('#list-inv-investments'), investments, 'bank');
  updateInvestmentTotals(savings, investments);

  if (investments.length > 0 && cachedHoldings === null) {
    loadHoldings().then(function() {
      renderSection($('#list-inv-investments'), investments, 'bank');
      updateInvestmentTotals(savings, investments);
    });
  }

  // Available Cash (banks - credit) and Net Worth (everything)
  var netCashEl = $('#net-cash');
  if (hasAnyAccounts) {
    var heroBank = banks.filter(inTotals).reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
    var heroCredit = credits.filter(inTotals).reduce(function(s, a) { return s + getDisplayBalance(a, 'credit').amount; }, 0);
    var savingsSum = savings.filter(inTotals).reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
    var investSum = 0;
    investments.filter(inTotals).forEach(function(a) { investSum += getInvestmentValue(a); });
    var bankSum = heroBank, creditSum = heroCredit;
    var availableCash = bankSum - creditSum;
    lastAvailableCash = availableCash;
    var netWorth = bankSum - creditSum + savingsSum + investSum;
    netCashEl.hidden = false;

    var availEl = $('#available-value');
    if (availEl) {
      availEl.textContent = (availableCash < 0 ? '-' : '') + formatMoney(availableCash);
      availEl.className = 'hero-stat-value ' + (availableCash >= 0 ? 'balance-positive' : 'balance-negative');
    }
  } else {
    netCashEl.hidden = true;
  }

  renderAccountsSettings();
  renderAccountOrderList();
  renderHomeInsights();
}

// ============================================
// HOME INSIGHTS (30-day trend + this month's spending)
// ============================================
var lastAvailableCash = null;
function renderHomeInsights() {
  var label = $('#home-trend-label'), svgEl = $('#home-trend');
  if (!label || !svgEl) return;
  renderBalanceSplit();
  if (!txData || !txData.length || lastAvailableCash === null || !cachedAccounts) {
    label.hidden = true; svgEl.hidden = true;
    return;
  }

  // Trend: walk back from today's available cash. A charge (positive Plaid
  // amount) lowered available cash, so before it, cash was higher by that amount.
  var cashAcct = {};
  cachedAccounts.forEach(function(a) {
    if (a.plaid_account_id && ((a.type === 'depository' && a.subtype !== 'savings') || a.type === 'credit')) cashAcct[a.plaid_account_id] = true;
  });
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var dayKey = function(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var byDay = {};
  txData.forEach(function(tx) {
    if (!cashAcct[tx.plaid_account_id] || tx.pending) return;
    byDay[tx.date] = (byDay[tx.date] || 0) + parseFloat(tx.amount || 0);
  });
  var points = [], value = lastAvailableCash;
  for (var i = 0; i <= 30; i++) {
    var d = new Date(today); d.setDate(d.getDate() - i);
    points.unshift(value);
    value += byDay[dayKey(d)] || 0;
  }
  var min = Math.min.apply(null, points), max = Math.max.apply(null, points), range = (max - min) || 1;
  var path = points.map(function(v, idx) {
    var x = (idx / 30) * 300, y = 44 - ((v - min) / range) * 40;
    return (idx ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  $('#home-trend-path').setAttribute('d', path);
  var change = points[points.length - 1] - points[0];
  label.innerHTML = '<strong class="' + (change < 0 ? 'down' : '') + '">' + (change < 0 ? '↓ ' : '↑ ') + formatMoney(change) + '</strong> in the last 30 days';
  label.hidden = false; svgEl.hidden = false;

  renderBalanceSplit();
}

// Assets and Liabilities beside the big Available number
function renderBalanceSplit() {
  var aEl = $('#hero-assets'), lEl = $('#hero-liabs');
  if (!aEl || !lEl || !cachedAccounts) return;
  var assets = 0, liabs = 0;
  cachedAccounts.forEach(function(a) {
    if (a.is_hidden || a.exclude_from_totals) return;
    if (a.type === 'credit') liabs += Math.max(0, getDisplayBalance(a, 'credit').amount);
    else if (a.type === 'investment') assets += getInvestmentValue(a);
    else if (a.type === 'depository') assets += Math.max(0, getDisplayBalance(a, 'bank').amount);
  });
  aEl.textContent = formatMoney(assets);
  lEl.textContent = formatMoney(liabs);
}

function formatApy(a) {
  var apy = parseFloat(a.apy);
  var bal = getDisplayBalance(a, 'bank').amount;
  var monthly = bal > 0 ? bal * (Math.pow(1 + apy / 100, 1 / 12) - 1) : 0;
  var perMonth = monthly >= 1 ? '$' + Math.round(monthly).toLocaleString('en-US') : monthly >= 0.01 ? formatMoney(monthly) : '';
  return apy.toFixed(2).replace(/\.?0+$/, '') + '% APY' + (perMonth ? ' · ~' + perMonth + '/mo' : '');
}

function getInvestmentValue(a) {
  if (cachedHoldings) {
    var holdingsVal = 0;
    cachedHoldings.forEach(function(h) {
      if (h.account_id === a.id) holdingsVal += h.institution_value || (h.quantity * (h.institution_price || h.close_price || 0));
    });
    if (holdingsVal > 0) return holdingsVal;
  }
  return getDisplayBalance(a, 'bank').amount;
}

function updateInvestmentTotals(savings, investments) {
  var savingsSum = savings.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
  $('#inv-savings-total').textContent = formatSigned(savingsSum);
  $('#inv-savings-total').className = 'section-total ' + (savingsSum >= 0 ? 'balance-positive' : 'balance-negative');

  var investSum = 0;
  investments.forEach(function(a) {
    if (cachedHoldings) {
      var holdingsVal = 0;
      cachedHoldings.forEach(function(h) {
        if (h.account_id === a.id) holdingsVal += h.institution_value || (h.quantity * (h.institution_price || h.close_price || 0));
      });
      investSum += holdingsVal > 0 ? holdingsVal : getDisplayBalance(a, 'bank').amount;
    } else {
      investSum += getDisplayBalance(a, 'bank').amount;
    }
  });
  $('#inv-investments-total').textContent = formatSigned(investSum);
  $('#inv-investments-total').className = 'section-total ' + (investSum >= 0 ? 'balance-positive' : 'balance-negative');
}


async function renderAccountsSettings() {
  var list = $('#accounts-list');
  if (!cachedAccounts || cachedAccounts.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:var(--text-sm)">No banks connected</p>';
    return;
  }

  // Group active accounts by plaid_item_id for disconnect buttons
  var byItem = {};
  cachedAccounts.forEach(function(a) {
    var key = a.plaid_item_id || 'unknown';
    if (!byItem[key]) byItem[key] = { institution: a.institution || 'Unknown', accounts: [] };
    byItem[key].accounts.push(a);
  });

  var html = '';
  Object.keys(byItem).forEach(function(itemId) {
    var group = byItem[itemId];
    var instLogoUrl = getLogoUrl(group.accounts[0]);
    html += '<div class="settings-institution">';
    html += '<div class="settings-inst-top">';
    html += (instLogoUrl ? '<div class="settings-inst-logo" style="background-image:url(' + instLogoUrl + ')"></div>' : '');
    html += '<div class="settings-inst-info">';
    html += '<span class="settings-inst-name">' + esc(group.institution) + '</span>';
    var n = group.accounts.length;
    html += '<span class="settings-inst-detail">' + n + ' account' + (n !== 1 ? 's' : '') + '</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="settings-inst-actions">';
    html += '<button class="btn-add-card-inst" data-item="' + esc(itemId) + '">Manage</button>';
    html += '<button class="btn-disconnect-inst" data-item="' + esc(itemId) + '">Disconnect</button>';
    html += '</div>';
    html += '</div>';
  });


  list.innerHTML = html;

  // Horizontal scroll dots for institution carousel
  var wrap = list.parentElement;
  var existingDots = wrap.querySelector('.scroll-dots');
  if (existingDots) existingDots.remove();
  var cardCount = Object.keys(byItem).length;
  if (cardCount > 1) {
    var dots = document.createElement('div');
    dots.className = 'scroll-dots';
    for (var i = 0; i < cardCount; i++) {
      var dot = document.createElement('div');
      dot.className = 'scroll-dot' + (i === 0 ? ' active' : '');
      dots.appendChild(dot);
    }
    wrap.appendChild(dots);
    var ticking = false;
    if (list._dotsScroll) list.removeEventListener('scroll', list._dotsScroll);
    list._dotsScroll = function() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function() {
        var cardWidth = list.firstElementChild ? list.firstElementChild.offsetWidth : 1;
        var idx = Math.round(list.scrollLeft / cardWidth);
        dots.querySelectorAll('.scroll-dot').forEach(function(d, j) {
          d.classList.toggle('active', j === idx);
        });
        ticking = false;
      });
    };
    list.addEventListener('scroll', list._dotsScroll, { passive: true });
  }
}

document.addEventListener('click', async function(e) {
  var btn = e.target.closest('.btn-disconnect-inst');
  if (!btn) return;
  var itemId = btn.dataset.item;
  var group = cachedAccounts.filter(function(a) { return a.plaid_item_id === itemId; });
  var instName = group.length > 0 ? (group[0].institution || 'this institution') : 'this institution';
  var acctCount = group.length;
  if (!confirm('Disconnect ' + instName + '? This will remove ' + (acctCount === 1 ? 'this account' : 'all ' + acctCount + ' accounts') + ' and delete their transaction history.')) return;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data.session;
    var res = await fetch(SUPABASE_URL + '/functions/v1/cleanup-items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ item_id: itemId })
    });
    var data = await res.json();
    if (data.removed) {
      cachedAccounts = cachedAccounts.filter(function(a) { return a.plaid_item_id !== itemId; });
      if (txData.length) {
        txData = txData.filter(function(t) { return t.plaid_item_id !== itemId; });
        var cf = $('#tx-card-filter');
        if (cf) Array.prototype.slice.call(cf.options).forEach(function(o) {
          if (o.value !== 'all' && !cachedAccounts.some(function(a) { return a.plaid_account_id === o.value; })) o.remove();
        });
        if ($('#tx-month-filter').value) renderTransactionMonth();
      }
      cachedHoldings = null;
      cachedLiabilities = null;
      renderAccounts(cachedAccounts);
    } else {
      btn.textContent = 'Failed';
      btn.disabled = false;
    }
  } catch (err) {
    btn.textContent = 'Failed';
    btn.disabled = false;
  }
});

// + Add card to an existing institution (Plaid update mode with account selection)
document.addEventListener('click', async function(e) {
  var btn = e.target.closest('.btn-add-card-inst');
  if (!btn) return;
  var itemId = btn.dataset.item;
  btn.disabled = true;
  var originalText = btn.textContent;
  btn.textContent = 'Opening...';

  try {
    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data.session;
    var headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
      'apikey': SUPABASE_ANON_KEY
    };

    var res = await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ action: 'create_add_accounts_token', item_id: itemId })
    });
    var data = await res.json();

    if (!res.ok || !data.link_token) {
      showError('Could not start add-card flow. ' + (data.detail || data.error || 'Check your connection and try again.'));
      btn.textContent = originalText;
      btn.disabled = false;
      return;
    }

    btn.textContent = originalText;
    btn.disabled = false;

    var handler = Plaid.create({
      token: data.link_token,
      onSuccess: async function() {
        showLoading(true);
        try {
          await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ action: 'sync_added_accounts', item_id: itemId })
          });
          await loadAccounts();
          showToast('Card added');
        } catch (err) {
          console.error('sync_added_accounts failed:', err);
          showError('Card linked but we couldn\'t finish syncing. Pull to refresh.');
        }
        showLoading(false);
      },
      onExit: function(err) {
        if (err) showError('Add card failed: ' + (err.display_message || err.error_message || 'Try again.'));
      }
    });

    handler.open();
  } catch (err) {
    showError('Could not start add-card flow. ' + err.message);
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

// ============================================
// INVESTMENT HOLDINGS
// ============================================
var cachedHoldings = null;
var cachedLiabilities = null;

async function loadHoldings() {
  var result = await sb.rpc('get_user_holdings');
  if (result.error) {
    console.error('Holdings load error:', result.error);
    return;
  }
  cachedHoldings = result.data || [];
}

async function loadLiabilities() {
  var result = await sb.rpc('get_user_liabilities');
  if (result.error) {
    console.error('Liabilities load error:', result.error);
    return;
  }
  cachedLiabilities = result.data || [];
}


function renderSection(listEl, items, type) {
  // Your own order first (Settings → Accounts), then largest balance first
  var sorted = items.slice().sort(function(a, b) {
    var oa = a.sort_order == null ? 1e9 : a.sort_order, ob = b.sort_order == null ? 1e9 : b.sort_order;
    if (oa !== ob) return oa - ob;
    return Math.abs(getDisplayBalance(b, type).amount) - Math.abs(getDisplayBalance(a, type).amount);
  });

  listEl.innerHTML = sorted.map(function(a) { return accountCard(a, type); }).join('');

  var dotsEl = listEl.parentElement.querySelector('.scroll-dots');
  if (dotsEl) dotsEl.remove();

  if (sorted.length > 1) {
    var dots = document.createElement('div');
    dots.className = 'scroll-dots';
    for (var i = 0; i < sorted.length; i++) {
      var dot = document.createElement('div');
      dot.className = 'scroll-dot' + (i === 0 ? ' active' : '');
      dots.appendChild(dot);
    }
    listEl.parentElement.appendChild(dots);

    var scrollTicking = false;
    listEl.addEventListener('scroll', function() {
      if (!scrollTicking) {
        requestAnimationFrame(function() {
          var cardWidth = listEl.firstElementChild ? listEl.firstElementChild.offsetWidth : 1;
          var idx = Math.round(listEl.scrollLeft / cardWidth);
          dots.querySelectorAll('.scroll-dot').forEach(function(d, j) {
            d.classList.toggle('active', j === idx);
          });
          scrollTicking = false;
        });
        scrollTicking = true;
      }
    }, { passive: true });
  }
}

function accountCard(account, type) {
  var bal = getDisplayBalance(account, type);
  var logoUrl = getLogoUrl(account);
  var syncTs = account.plaid_last_checked_at || account.balance_last_updated_at;
  var timestamp = formatTimestamp(syncTs);
  var displayName = account.nickname || account.name || 'Account';

  // For investment accounts, override balance with sum of holdings for consistency
  if (account.type === 'investment' && cachedHoldings) {
    var holdingsSum = 0;
    cachedHoldings.forEach(function(h) {
      if (h.account_id === account.id) {
        holdingsSum += h.institution_value || (h.quantity * (h.institution_price || h.close_price || 0));
      }
    });
    if (holdingsSum > 0) {
      bal = { amount: holdingsSum, label: 'Holdings' };
    }
  }

  var holdingsHtml = '';
  if (account.type === 'investment' && cachedHoldings) {
    var acctHoldings = cachedHoldings.filter(function(h) { return h.account_id === account.id; });
    if (acctHoldings.length > 0) {
      acctHoldings.sort(function(a, b) { return (b.institution_value || 0) - (a.institution_value || 0); });
      holdingsHtml = '<div class="card-holdings">';
      var totalValue = 0;
      acctHoldings.forEach(function(h) {
        var value = h.institution_value || (h.quantity * (h.institution_price || h.close_price || 0));
        totalValue += value;
      });
      acctHoldings.forEach(function(h) {
        var value = h.institution_value || (h.quantity * (h.institution_price || h.close_price || 0));
        var gain = h.cost_basis ? value - h.cost_basis : null;
        var gainPct = h.cost_basis && h.cost_basis > 0 ? ((value - h.cost_basis) / h.cost_basis * 100) : null;
        var gainClass = gain !== null ? (gain >= 0 ? 'holding-up' : 'holding-down') : '';
        var ticker = h.ticker_symbol || '';
        var name = h.security_name || 'Unknown';
        var pct = totalValue > 0 ? (value / totalValue * 100) : 0;
        var isCash = ticker === 'CUR:USD';
        var displayTicker = isCash ? 'USD' : (ticker || name);
        var displayName = isCash ? 'Cash' : (ticker ? name : '');
        var price = h.institution_price || h.close_price || 0;

        holdingsHtml += '<div class="card-holding-row">' +
          '<div class="card-holding-left">' +
            '<div class="card-holding-header">' +
              '<span class="card-holding-ticker">' + esc(displayTicker) + '</span>' +
              (displayName ? '<span class="card-holding-name">' + esc(displayName) + '</span>' : '') +
            '</div>' +
            '<span class="card-holding-meta">' +
              (isCash ? '' : parseFloat(h.quantity).toFixed(4) + ' shares') +
              (!isCash && price ? ' @ $' + parseFloat(price).toFixed(2) : '') +
            '</span>' +
          '</div>' +
          '<div class="card-holding-right">' +
            '<span class="card-holding-value">' + formatMoney(value) + '</span>' +
            (gainPct !== null ? '<span class="card-holding-change ' + gainClass + '">' + (gainPct >= 0 ? '+' : '') + gainPct.toFixed(2) + '%</span>' : '') +
            '<div class="card-holding-bar"><div class="card-holding-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
          '</div>' +
        '</div>';
      });
      holdingsHtml += '</div>';
      holdingsHtml = moreSection(account.id + ':h', acctHoldings.length + (acctHoldings.length === 1 ? ' holding' : ' holdings'), holdingsHtml);
    }
  }

  // Liabilities detail for credit cards
  var liabHtml = '';
  if (type === 'credit') {
    var limit = account.balance_limit ? parseFloat(account.balance_limit) : 0;
    var used = bal.amount;

    liabHtml = '<div class="card-liabilities">';

    if (limit > 0) {
      var utilPct = used <= 0 ? 0 : Math.min((used / limit) * 100, 100);
      var utilClass = used <= 0 ? 'util-low' : utilPct > 75 ? 'util-high' : utilPct > 30 ? 'util-mid' : 'util-low';
      var usedDisplay = used < 0 ? '-' + formatMoney(Math.abs(used)) : formatMoney(used);
      var utilLabel = used < 0 ? 'credit' : utilPct.toFixed(0) + '% used';
      liabHtml +=
        '<div class="liab-util-wrap">' +
          '<div class="liab-util-bar"><div class="liab-util-fill ' + utilClass + '" style="width:' + utilPct.toFixed(1) + '%"></div></div>' +
          '<div class="liab-util-labels"><span>' + usedDisplay + ' / ' + formatMoney(limit) + '</span><span>' + utilLabel + '</span></div>' +
        '</div>';
    }

    var liab = cachedLiabilities ? cachedLiabilities.find(function(l) { return l.account_id === account.id; }) : null;
    var details = '';
    if (liab && liab.apr_purchase) details += '<div class="liab-detail"><span>Purchase APR</span><span>' + parseFloat(liab.apr_purchase).toFixed(2) + '%</span></div>';

    var minPay = liab && liab.minimum_payment_amount != null ? parseFloat(liab.minimum_payment_amount) : null;
    if (minPay != null) details += '<div class="liab-detail"><span>Min Payment</span><span>' + formatMoney(minPay) + '</span></div>';

    var hasMinPayment = minPay != null && minPay > 0;
    if (liab && liab.next_payment_due_date) {
      var dueDate = new Date(liab.next_payment_due_date + 'T00:00:00');
      var now = new Date();
      var daysUntil = Math.ceil((dueDate - now) / 86400000);
      var dueClass = '';
      if (hasMinPayment) {
        dueClass = daysUntil <= 3 ? 'liab-urgent' : daysUntil <= 7 ? 'liab-soon' : '';
      }
      var dueLabel = daysUntil >= 0 ? ' (' + daysUntil + 'd)' : (hasMinPayment ? ' (overdue)' : ' (past)');
      details += '<div class="liab-detail ' + dueClass + '"><span>Due</span><span>' + formatLiabDate(liab.next_payment_due_date) + dueLabel + '</span></div>';
    }
    if (liab && liab.last_payment_amount) details += '<div class="liab-detail"><span>Last Payment</span><span>' + formatMoney(parseFloat(liab.last_payment_amount)) + '</span></div>';
    if (liab && liab.last_payment_date) details += '<div class="liab-detail"><span>Last Payment Date</span><span>' + formatLiabDate(liab.last_payment_date) + '</span></div>';
    if (liab && liab.last_statement_balance) details += '<div class="liab-detail"><span>Statement Bal</span><span>' + formatMoney(parseFloat(liab.last_statement_balance)) + '</span></div>';
    if (liab && liab.is_overdue && hasMinPayment) details += '<div class="liab-detail liab-urgent"><span>Status</span><span>OVERDUE</span></div>';

    if (details) {
      var peek = [];
      if (liab && liab.next_payment_due_date) peek.push('Due ' + formatLiabDate(liab.next_payment_due_date));
      if (minPay) peek.push('Min ' + formatMoney(minPay));
      liabHtml += moreSection(account.id + ':d', peek.join(' · ') || 'Card details', details);
    }

    var bonus = computeBonusProgress(account);
    if (bonus) {
      var daysLeft = bonus.daysLeft;
      var reached = bonus.earned >= bonus.target;
      var expired = daysLeft < 0 && !reached;
      var statusClass = reached ? 'bonus-reached' : expired ? 'bonus-expired' : (daysLeft <= 14 ? 'bonus-urgent' : '');
      var statusText = reached ? 'Earned' : expired ? 'Deadline passed' : 'by ' + formatLiabDate(bonus.endDate) + ' (' + daysLeft + 'd)';

      var hue;
      if (bonus.pct < 50) hue = (bonus.pct / 50) * 30;
      else hue = 30 + ((bonus.pct - 50) / 50) * 90;
      var fillColor = expired ? 'var(--text-muted)' : 'hsl(' + hue.toFixed(0) + ', 70%, 50%)';

      liabHtml +=
        '<div class="bonus-wrap">' +
          '<div class="bonus-header"><span>Sign-up bonus</span><span class="bonus-status ' + statusClass + '">' + statusText + '</span></div>' +
          '<div class="bonus-bar"><div class="bonus-fill" style="width:' + bonus.pct.toFixed(1) + '%; background:' + fillColor + '"></div></div>' +
          '<div class="bonus-amounts">' + formatMoney(bonus.earned) + ' of ' + formatMoney(bonus.target) + '</div>' +
        '</div>';
    }

    liabHtml += '</div>';
  }


  var cardDesign = account.card_design_id ? getCardDesignById(account.card_design_id) : null;
  var designHtml = cardDesign ? '<div class="account-card-art" style="background-image:url(' + esc(cardDesign.url) + ')"></div>' : '';
  var logoHtml = logoUrl ? '<div class="account-logo" style="background-image:url(' + logoUrl + ')"></div>' : '';
  var logoRowHtml = (logoHtml || designHtml) ? '<div class="account-logo-row">' + logoHtml + designHtml + '</div>' : '';

  return '<div class="account-card" data-id="' + account.id + '">' +
    '<div class="account-top">' +
      '<div class="account-left">' +
        '<span class="account-name" data-id="' + account.id + '">' + esc(displayName) + '</span>' +
        '<span class="account-institution">' + esc(account.institution || '') + '</span>' +
        (account.mask ? '<span class="account-mask">****' + esc(account.mask) + '</span>' : '') +
        (account.apy ? '<span class="account-apy">' + formatApy(account) + '</span>' : '') +
        (account.exclude_from_totals ? '<span class="account-flag">Not in totals</span>' : '') +
        logoRowHtml +
      '</div>' +
      '<div class="account-balance">' +
        '<div class="amount ' + (type === 'credit' ? (bal.amount < 0 ? 'balance-positive' : 'balance-negative') : 'balance-positive') + (type === 'credit' ? ' amount-bonus-trigger' : '') + '"' + (type === 'credit' ? ' data-bonus-id="' + account.id + '"' : '') + '>' + (bal.amount < 0 ? '-' : '') + formatMoney(Math.abs(bal.amount)) + '</div>' +
        '<div class="label"' + (syncTs ? ' data-ts="' + syncTs + '" data-ts-prefix="Synced "' : '') + '>' + (timestamp ? 'Synced ' + timestamp : '') + '</div>' +
      '</div>' +
    '</div>' +
    holdingsHtml +
    liabHtml +
  '</div>';
}

function formatLiabDate(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return monthNames[parseInt(parts[1]) - 1] + ' ' + parseInt(parts[2]);
}

function computeBonusProgress(account) {
  if (!account || !account.bonus_target_amount || !account.bonus_start_date || !account.bonus_months) return null;
  var target = parseFloat(account.bonus_target_amount);
  var months = parseInt(account.bonus_months);
  if (!(target > 0) || !(months > 0)) return null;

  var startStr = account.bonus_start_date;
  var startDate = new Date(startStr + 'T00:00:00');
  var endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + months);
  var endStr = endDate.getFullYear() + '-' +
    String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(endDate.getDate()).padStart(2, '0');

  var earned = 0;
  if (txData && account.plaid_account_id) {
    txData.forEach(function(tx) {
      if (tx.pending) return;
      if (tx.plaid_account_id !== account.plaid_account_id) return;
      if (tx.date < startStr || tx.date > endStr) return;
      var cat = tx.enriched_category_primary || tx.category;
      if (cat === 'LOAN_PAYMENTS' || cat === 'TRANSFER_IN' || cat === 'TRANSFER_OUT') return;
      earned += parseFloat(tx.amount || 0);
    });
  }
  if (earned < 0) earned = 0;

  var now = new Date();
  var daysLeft = Math.ceil((endDate - now) / 86400000);

  return {
    earned: earned,
    target: target,
    endDate: endStr,
    daysLeft: daysLeft,
    pct: Math.min(100, Math.max(0, (earned / target) * 100))
  };
}

// Account edit modal (nickname + card design)
var accountEditModal = $('#account-edit-modal');
var nicknameInput = $('#nickname-input');
var editingAccountId = null;

document.addEventListener('click', function(e) {
  var card = e.target.closest('.account-card[data-id]');
  if (!card || e.target.closest('.amount-bonus-trigger, a, button, input, .card-more')) return;
  var nameEl = card.querySelector('.account-name');
  editingAccountId = card.dataset.id;
  nicknameInput.value = nameEl ? nameEl.textContent : '';

  var acct = cachedAccounts ? cachedAccounts.find(function(a) { return a.id === editingAccountId; }) : null;
  renderCardDesignPicker(acct && acct.card_design_id ? acct.card_design_id : null);
  var isDeposit = acct && acct.type === 'depository';
  $('#apy-field').hidden = !isDeposit;
  $('#apy-input').value = acct && acct.apy != null ? acct.apy : '';
  $('#edit-exclude').checked = !!(acct && acct.exclude_from_totals);
  $('#edit-hide').checked = !!(acct && acct.is_hidden);
  $('#manage-title').textContent = 'Manage ' + ((acct && acct.institution) || '') + ' account';
  $('#manage-subtitle').textContent = acct ? (acct.nickname || acct.name || 'Account') + (acct.mask ? ' ' + acct.mask : '') : '';
  accountEditModal.classList.add('visible');
  var mc = accountEditModal.querySelector('.modal-card'); if (mc) mc.scrollTop = 0;
});

$('#account-edit-save').addEventListener('click', function() {
  if (!editingAccountId) return;

  // Save nickname -- update local state and re-render immediately
  var newName = nicknameInput.value.trim();
  if (newName && cachedAccounts) {
    cachedAccounts.forEach(function(a) {
      if (a.id === editingAccountId) a.nickname = newName;
    });
    // Save to DB in background (must call .then() to execute the request)
    var saveId = editingAccountId;
    sb.from('accounts').update({ nickname: newName }).eq('id', saveId).then(function(result) {
      if (result.error) console.error('Nickname save error:', result.error);
    });
  }

  // Save card design selection
  var pickerEl = $('#card-design-picker');
  if (pickerEl) {
    var selectedBtn = pickerEl.querySelector('.card-design-option.selected');
    var newDesignId = (selectedBtn && selectedBtn.dataset.designId) ? selectedBtn.dataset.designId : null;
    var prevDesignId = null;
    if (cachedAccounts) {
      cachedAccounts.forEach(function(a) {
        if (a.id === editingAccountId) {
          prevDesignId = a.card_design_id || null;
          a.card_design_id = newDesignId;
        }
      });
    }
    if (newDesignId !== prevDesignId) {
      var saveDesignId = editingAccountId;
      sb.from('accounts').update({ card_design_id: newDesignId }).eq('id', saveDesignId).then(function(result) {
        if (result.error) console.error('Card design save error:', result.error);
      });
    }
  }

  // Interest rate, totals and visibility
  var acctNow = cachedAccounts ? cachedAccounts.find(function(a) { return a.id === editingAccountId; }) : null;
  if (acctNow) {
    var apyRaw = $('#apy-input').value.trim();
    var apyVal = apyRaw === '' ? null : Math.max(0, Math.min(25, parseFloat(apyRaw)));
    if (apyVal !== null && isNaN(apyVal)) apyVal = null;
    var changes = {
      apy: acctNow.type === 'depository' ? apyVal : acctNow.apy || null,
      exclude_from_totals: $('#edit-exclude').checked,
      is_hidden: $('#edit-hide').checked
    };
    Object.assign(acctNow, changes);
    sb.from('accounts').update(changes).eq('id', acctNow.id).then(function(result) {
      if (result.error) { console.error('Account settings save error:', result.error); showToast('Could not save account settings'); }
    });
  }

  if (cachedAccounts) renderAccounts(cachedAccounts);
  renderAccountOrderList();
  accountEditModal.classList.remove('visible');
  editingAccountId = null;
  showToast('Saved');
});

$('#account-edit-cancel').addEventListener('click', function() {
  accountEditModal.classList.remove('visible');
  editingAccountId = null;
});

nicknameInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); $('#account-edit-save').click(); }
  if (e.key === 'Escape') { $('#account-edit-cancel').click(); }
});

// Sign-up bonus modal (opens from tapping the balance amount on a credit card)
var bonusEditModal = $('#bonus-edit-modal');
var editingBonusId = null;

document.addEventListener('click', function(e) {
  var amt = e.target.closest('.amount-bonus-trigger');
  if (!amt || !amt.dataset.bonusId) return;
  editingBonusId = amt.dataset.bonusId;
  var acct = cachedAccounts ? cachedAccounts.find(function(a) { return a.id === editingBonusId; }) : null;
  $('#bonus-target').value = acct && acct.bonus_target_amount ? acct.bonus_target_amount : '';
  $('#bonus-start').value = acct && acct.bonus_start_date ? acct.bonus_start_date : '';
  $('#bonus-months').value = acct && acct.bonus_months ? acct.bonus_months : '';
  bonusEditModal.classList.add('visible');
});

$('#bonus-edit-clear').addEventListener('click', function() {
  $('#bonus-target').value = '';
  $('#bonus-start').value = '';
  $('#bonus-months').value = '';
});

$('#bonus-edit-cancel').addEventListener('click', function() {
  bonusEditModal.classList.remove('visible');
  editingBonusId = null;
});

$('#bonus-edit-save').addEventListener('click', function() {
  if (!editingBonusId) return;
  var bTarget = parseFloat($('#bonus-target').value);
  var bStart = $('#bonus-start').value || null;
  var bMonths = parseInt($('#bonus-months').value);
  var hasAll = bTarget > 0 && bStart && bMonths > 0;
  var bonusData = hasAll
    ? { bonus_target_amount: bTarget, bonus_start_date: bStart, bonus_months: bMonths }
    : { bonus_target_amount: null, bonus_start_date: null, bonus_months: null };
  if (cachedAccounts) {
    cachedAccounts.forEach(function(a) {
      if (a.id === editingBonusId) {
        a.bonus_target_amount = bonusData.bonus_target_amount;
        a.bonus_start_date = bonusData.bonus_start_date;
        a.bonus_months = bonusData.bonus_months;
      }
    });
  }
  var saveId = editingBonusId;
  sb.from('accounts').update(bonusData).eq('id', saveId).then(function(result) {
    if (result.error) console.error('Bonus save error:', result.error);
  });
  if (cachedAccounts) renderAccounts(cachedAccounts);
  bonusEditModal.classList.remove('visible');
  editingBonusId = null;
  showToast(hasAll ? 'Bonus saved' : 'Bonus cleared');
});

// ============================================
// TRANSACTIONS
// ============================================
var txData = [];
var txMonths = [];
var txActions = {};
var ignoreRules = {};
var txListenersReady = false;
async function loadTransactions() {
  var txEmpty = $('#tx-empty');
  var txContent = $('#tx-content');
  var txLoadingEl = $('#tx-loading');

  if (!cachedAccounts || cachedAccounts.length === 0) {
    txEmpty.hidden = false;
    txContent.hidden = true;
    txLoadingEl.classList.remove('visible');
    return;
  }

  txEmpty.hidden = true;
  txLoadingEl.classList.remove('visible');

  // Determine data window: start of first connection month, capped at 24 months
  var now = new Date();
  var dataStartDate = new Date(now.getFullYear(), now.getMonth() - 24, 1);
  var fcResult = await sb.rpc('get_first_connection_date');
  if (fcResult.data) {
    var fc = new Date(fcResult.data);
    dataStartDate = new Date(fc.getFullYear(), fc.getMonth(), 1);
  }
  var cap = new Date(now.getFullYear(), now.getMonth() - 24, 1);
  if (dataStartDate < cap) dataStartDate = cap;
  var dataStartStr = dataStartDate.toISOString().split('T')[0];

  // Fetch transactions within data window
  var result = await fetchAllRows(function() {
    return sb.from('synced_transactions').select('*').gte('date', dataStartStr).order('date', { ascending: false }).order('id');
  });

  if (result.error || !result.data || result.data.length === 0) {
    // No cached data — need to sync first
    var lastTxSync = parseInt(localStorage.getItem('alenjo_last_tx_sync') || '0');
    if (Date.now() - lastTxSync > getSyncCooldown()) {
      localStorage.setItem('alenjo_last_tx_sync', String(Date.now()));
      txLoadingEl.classList.add('visible');
      txEmpty.hidden = true;
      try {
        var sessionResult = await sb.auth.getSession();
        var session = sessionResult.data.session;
        if (session) {
          await fetch(SUPABASE_URL + '/functions/v1/sync-transactions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + session.access_token,
              'apikey': SUPABASE_ANON_KEY
            }
          });
        }
        txLoadingEl.classList.remove('visible');
        // Retry loading after sync
        return loadTransactions();
      } catch (e) {
        console.error('Initial sync error:', e);
      }
      txLoadingEl.classList.remove('visible');
    }
    txEmpty.hidden = false;
    txContent.hidden = true;
    txEmpty.querySelector('p').textContent = 'No transactions yet. Your bank may take a few minutes to send data after connecting.';
    return;
  }

  txData = result.data;
  txEmpty.hidden = true;
  txContent.hidden = false;

  // Re-render snapshot in case any credit card has a bonus tracker that needs tx data
  if (cachedAccounts && cachedAccounts.some(function(a) { return a.type === 'credit' && a.bonus_target_amount; })) {
    renderAccounts(cachedAccounts);
  }

  // Load user actions and ignore rules
  var actionsResult = await fetchAllRows(function() { return sb.from('transaction_actions').select('transaction_id, action_type, split_ways, split_portion, category_override, nickname, date_override, is_recurring, recurring_group, recurring_next_date, recurring_amount_mode, recurring_paused, recurring_deleted').order('transaction_id'); });
  txActions = {};
  if (actionsResult.data) {
    actionsResult.data.forEach(function(a) { txActions[a.transaction_id] = a; });
  }
  var rulesResult = await sb.from('merchant_ignore_rules').select('merchant_name').eq('is_active', true);
  ignoreRules = {};
  if (rulesResult.data) {
    rulesResult.data.forEach(function(r) { ignoreRules[r.merchant_name] = true; });
  }

  // Auto-apply ignore rules to new transactions
  var toAutoIgnore = txData.filter(function(tx) {
    if (txActions[tx.id]) return false;
    var key = (tx.merchant_name || tx.name || '').toLowerCase().trim();
    return ignoreRules[key];
  });
  if (toAutoIgnore.length > 0) {
    var rows = toAutoIgnore.map(function(tx) {
      return { user_id: currentUser.id, transaction_id: tx.id, action_type: 'ignored' };
    });
    await sb.from('transaction_actions').upsert(rows, { onConflict: 'user_id,transaction_id' });
    toAutoIgnore.forEach(function(tx) { txActions[tx.id] = { action_type: 'ignored' }; });
  }

  // Build month range from data start date to current month
  var currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var startMonth = dataStartDate.getFullYear() + '-' + String(dataStartDate.getMonth() + 1).padStart(2, '0');

  txMonths = [];
  var cursor = currentMonth;
  while (cursor >= startMonth) {
    txMonths.push(cursor);
    var cp = cursor.split('-');
    var cy = parseInt(cp[0]);
    var cm = parseInt(cp[1]) - 1;
    if (cm === 0) { cy--; cm = 12; }
    cursor = cy + '-' + String(cm).padStart(2, '0');
  }

  // Populate month filter — parse YYYY-MM directly to avoid timezone issues
  var filter = $('#tx-month-filter');
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  filter.innerHTML = txMonths.map(function(m) {
    var parts = m.split('-');
    var label = monthNames[parseInt(parts[1]) - 1] + ' ' + parts[0];
    return '<option value="' + m + '">' + label + '</option>';
  }).join('');

  // Show Plaid's real freshness time (when bank data was last updated)
  var updated = $('#tx-updated');
  var freshResult = await sb.from('plaid_items').select('plaid_last_checked_at, tx_last_synced_at').order('plaid_last_checked_at', { ascending: false, nullsFirst: false }).limit(1);
  if (freshResult.data && freshResult.data[0]) {
    var plaidTime = freshResult.data[0].plaid_last_checked_at;
    var syncTime = freshResult.data[0].tx_last_synced_at;
    if (plaidTime) {
      updated.textContent = 'Bank data from ' + formatTimestamp(plaidTime);
      updated.setAttribute('data-ts', plaidTime);
      updated.setAttribute('data-ts-prefix', 'Bank data from ');
    } else if (syncTime) {
      updated.textContent = 'Synced ' + formatTimestamp(syncTime);
      updated.setAttribute('data-ts', syncTime);
      updated.setAttribute('data-ts-prefix', 'Synced ');
    }
  }

  // Populate card filter using plaid_account_id for matching
  var cardFilter = $('#tx-card-filter');
  cardFilter.innerHTML = '<option value="all">All accounts</option>';
  if (cachedAccounts) {
    var usedAcct = {};
    txData.forEach(function(t) { if (t.plaid_account_id) usedAcct[t.plaid_account_id] = true; });
    cachedAccounts.forEach(function(a) {
      if (a.plaid_account_id && usedAcct[a.plaid_account_id]) {
        cardFilter.innerHTML += '<option value="' + esc(a.plaid_account_id) + '">' + esc(a.nickname || a.name || 'Account') + '</option>';
      }
    });
  }

  renderTransactionMonth();
  renderHomeInsights();

  // Set initial button state every load, but only bind listeners once
  var btnIgnored = $('#btn-toggle-ignored');
  btnIgnored.textContent = showIgnoredTx ? 'Hide ignored' : 'Show ignored';
  
  if (!txListenersReady) {
    txListenersReady = true;

    filter.addEventListener('change', renderTransactionMonth);
    cardFilter.addEventListener('change', renderTransactionMonth);

    var searchInput = $('#tx-search');
    var searchTimer = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderTransactionMonth, 200);
    });

    btnIgnored.addEventListener('click', function() {
      showIgnoredTx = !showIgnoredTx;
      localStorage.setItem('alenjo_show_ignored', showIgnoredTx ? 'true' : 'false');
      this.textContent = showIgnoredTx ? 'Hide ignored' : 'Show ignored';
      renderTransactionMonth();
    });
  }

}

function getEffectiveTx(tx) {
  var action = txActions[tx.id];
  var result = {
    excluded: false, amount: tx.amount, category: tx.enriched_category_primary || tx.category,
    actionType: action ? action.action_type : null,
    splitWays: action ? action.split_ways : null,
    splitPortion: action ? action.split_portion : null,
    reimbursement: 0,
    nickname: null, date: tx.date,
    isRecurring: false, recurringGroup: null,
    isSplit: false, isRecategorized: false
  };
  if (!action) return result;
  if (action.nickname) result.nickname = action.nickname;
  if (action.date_override) result.date = action.date_override;
  if (action.is_recurring) {
    result.isRecurring = true;
    result.recurringGroup = action.recurring_group || null;
  }
  if (action.action_type === 'ignored' || action.action_type === 'reimbursed') {
    result.excluded = true;
    result.amount = 0;
  }
  if (action.split_portion && action.split_portion > 0) {
    result.isSplit = true;
    result.splitPortion = parseFloat(action.split_portion);
    result.reimbursement = Math.abs(tx.amount) - result.splitPortion;
    if (!result.excluded) result.amount = tx.amount > 0 ? result.splitPortion : -result.splitPortion;
  } else if (action.split_ways && action.split_ways > 1) {
    result.isSplit = true;
    result.splitWays = action.split_ways;
    // Round up to nearest cent so user always gets the higher portion when amount doesn't divide evenly
    var userPortion = Math.ceil(Math.abs(tx.amount) * 100 / action.split_ways) / 100;
    result.reimbursement = Math.abs(tx.amount) - userPortion;
    if (!result.excluded) result.amount = tx.amount > 0 ? userPortion : -userPortion;
  }
  if (action.category_override) {
    result.isRecategorized = true;
    result.category = action.category_override;
  }
  return result;
}

var activeCategoryFilter = null;
var showIgnoredTx = localStorage.getItem('alenjo_show_ignored') === 'true';

var CATEGORY_COLORS = [
  '#2E8B57', '#4F6BD8', '#D98A2B', '#8A5CC2', '#C2524A',
  '#2A9AA8', '#7A8B2E', '#B0679A', '#5E7FA3', '#A6782E',
  '#3E8E7E', '#9C5B3C', '#6D6AC9', '#4D8F3F', '#B5873A'
];

function buildAccountMap() {
  var map = {};
  if (cachedAccounts) {
    cachedAccounts.forEach(function(a) {
      if (a.plaid_account_id) map[a.plaid_account_id] = a.nickname || a.name || 'Account';
    });
  }
  return map;
}

function renderTransactionMonth() {
  var month = $('#tx-month-filter').value;
  var cardId = $('#tx-card-filter').value;
  var searchVal = ($('#tx-search').value || '').toLowerCase().trim();
  var breakdown = $('#tx-breakdown');
  var legend = $('#tx-category-legend');
  var accountMap = buildAccountMap();
  var showCardName = cardId === 'all';

  // Filter by month using effective date (date_override if set)
  var filtered = txData.filter(function(tx) {
    var eff = getEffectiveTx(tx);
    return eff.date.substring(0, 7) === month;
  });

  // Filter by card using plaid_account_id
  if (cardId !== 'all') {
    filtered = filtered.filter(function(tx) { return tx.plaid_account_id === cardId; });
  }

  // Search filter — matches nickname, merchant, or original name
  if (searchVal) {
    filtered = filtered.filter(function(tx) {
      var eff = getEffectiveTx(tx);
      var nick = (eff.nickname || '').toLowerCase();
      var enriched = (tx.enriched_merchant_name || '').toLowerCase();
      var merchant = (tx.merchant_name || '').toLowerCase();
      var name = (tx.name || '').toLowerCase();
      return nick.indexOf(searchVal) !== -1 || enriched.indexOf(searchVal) !== -1 || merchant.indexOf(searchVal) !== -1 || name.indexOf(searchVal) !== -1;
    });
  }

  // Hide ignored/reimbursed unless toggled on
  var displayTx = filtered;
  if (!showIgnoredTx) {
    displayTx = displayTx.filter(function(tx) {
      var eff = getEffectiveTx(tx);
      return !eff.excluded;
    });
  }

  // Filter by active category if pie slice clicked
  if (activeCategoryFilter) {
    displayTx = displayTx.filter(function(tx) {
      var eff = getEffectiveTx(tx);
      return normalizeCategory(eff.category) === activeCategoryFilter;
    });
  }

  // ---- Summary: spent / money in / transfers (effective amounts, skip excluded)
  var byCategory = {}, spent = 0, moneyIn = 0, transfers = 0, byDay = {};
  filtered.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    if (eff.excluded) return;
    var cat = normalizeCategory(eff.category);
    if (isTransferCategory(cat)) { transfers += Math.abs(eff.amount); return; }
    if (eff.amount > 0) {
      spent += eff.amount;
      byCategory[cat] = (byCategory[cat] || 0) + eff.amount;
      var day = parseInt(eff.date.substring(8, 10), 10);
      byDay[day] = byDay[day] || {};
      byDay[day][cat] = (byDay[day][cat] || 0) + eff.amount;
    } else {
      moneyIn += -eff.amount;
    }
  });
  if (activeCategoryFilter && !byCategory[activeCategoryFilter]) activeCategoryFilter = null;
  var shownSpent = activeCategoryFilter ? byCategory[activeCategoryFilter] : spent;
  $('#act-spent-label').textContent = activeCategoryFilter ? activeCategoryFilter : 'Spent';
  $('#act-spent').textContent = formatMoney(shownSpent);
  $('#act-income').textContent = (moneyIn > 0 ? '+' : '') + formatMoney(moneyIn);
  $('#act-transfers').textContent = formatMoney(transfers);

  // ---- One chart: spending by day, each bar stacked by category.
  // The category chips under it are the legend and the filter.
  var catEntries = Object.keys(byCategory).map(function(k) { return [k, byCategory[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  var categoryColorMap = {};
  catEntries.forEach(function(e, i) { categoryColorMap[e[0]] = CATEGORY_COLORS[i % CATEGORY_COLORS.length]; });
  var parts = month.split('-'), y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  var daysInMonth = new Date(y, m, 0).getDate();
  var now = new Date();
  var isThisMonth = now.getFullYear() === y && now.getMonth() + 1 === m;
  var dayTotal = function(d) {
    var o = byDay[d] || {};
    if (activeCategoryFilter) return o[activeCategoryFilter] || 0;
    return Object.keys(o).reduce(function(s, k) { return s + o[k]; }, 0);
  };
  var maxDay = 0;
  for (var dd = 1; dd <= daysInMonth; dd++) maxDay = Math.max(maxDay, dayTotal(dd));
  var bw = 310 / daysInMonth, bars = '';
  for (var d = 1; d <= daysInMonth; d++) {
    var x = ((d - 1) * bw + 1).toFixed(1), w = Math.max(1, bw - 2).toFixed(1);
    var total = dayTotal(d);
    if (isThisMonth && d > now.getDate()) { bars += '<rect x="' + x + '" y="76" width="' + w + '" height="2" rx="1" fill="var(--track)"/>'; continue; }
    if (!total) continue;
    // Square-root scale so one big bill (like rent) doesn't flatten every other day
    var h = Math.max(4, Math.sqrt(total / maxDay) * 72), top = 78 - h;
    var segs = catEntries.filter(function(e) { return (byDay[d] || {})[e[0]] && (!activeCategoryFilter || activeCategoryFilter === e[0]); });
    var yy = 78, tip = MONTH_SHORT[m - 1] + ' ' + d + ': ' + formatMoney(total);
    bars += '<g><title>' + esc(tip) + '</title><clipPath id="dc' + d + '"><rect x="' + x + '" y="' + top.toFixed(1) + '" width="' + w + '" height="' + h.toFixed(1) + '" rx="1.5"/></clipPath><g clip-path="url(#dc' + d + ')">';
    segs.forEach(function(e) {
      var sh = byDay[d][e[0]] / total * h;
      yy -= sh;
      bars += '<rect x="' + x + '" y="' + yy.toFixed(1) + '" width="' + w + '" height="' + sh.toFixed(1) + '" fill="' + categoryColorMap[e[0]] + '"/>';
    });
    bars += '</g></g>';
  }
  $('#act-daily').innerHTML = '<line x1="0" y1="78.5" x2="310" y2="78.5" stroke="var(--border)" stroke-width="1"/>' + bars;
  $('#act-axis-start').textContent = MONTH_SHORT[m - 1] + ' 1';
  $('#act-axis-end').textContent = MONTH_SHORT[m - 1] + ' ' + daysInMonth;
  var daysSoFar = isThisMonth ? now.getDate() : daysInMonth;
  $('#act-daily-note').textContent = shownSpent ? '~' + formatMoney(shownSpent / daysSoFar) + '/day' : '';

  // Category chips: one swipeable row, tap to filter, tap again to clear
  legend.innerHTML = catEntries.length ? catEntries.map(function(e) {
    var on = activeCategoryFilter === e[0];
    return '<button type="button" class="act-cat' + (on ? ' on' : '') + '" data-cat="' + esc(e[0]) + '" aria-pressed="' + on + '">' +
      '<i style="background:' + categoryColorMap[e[0]] + '"></i><span>' + esc(e[0]) + '</span><b>' + formatMoney(e[1]).replace(/\.\d\d$/, '') + '</b></button>';
  }).join('') : '<p class="act-empty-note">No spending this month yet.</p>';
  legend.querySelectorAll('.act-cat').forEach(function(el) {
    el.addEventListener('click', function() {
      activeCategoryFilter = activeCategoryFilter === el.dataset.cat ? null : el.dataset.cat;
      renderTransactionMonth();
    });
  });

  // ---- Transactions grouped by day
  displayTx.sort(function(a, b) {
    var da = getEffectiveTx(a).date || a.date, db = getEffectiveTx(b).date || b.date;
    if (da !== db) return da > db ? -1 : 1;
    return (b.authorized_datetime || '') > (a.authorized_datetime || '') ? 1 : -1;
  });
  var html = '';
  if (!displayTx.length) {
    html += '<p class="act-empty-note">' + (searchVal ? 'Nothing matches “' + esc(searchVal) + '”.' : 'No transactions here yet.') + '</p>';
  }
  var groups = [], groupMap = {};
  displayTx.forEach(function(tx) {
    var key = getEffectiveTx(tx).date || tx.date;
    if (!groupMap[key]) { groupMap[key] = []; groups.push(key); }
    groupMap[key].push(tx);
  });
  groups.forEach(function(key) {
    var dayNet = 0;
    groupMap[key].forEach(function(tx) { var e = getEffectiveTx(tx); if (!e.excluded) dayNet -= e.amount; });
    html += '<div class="act-day"><div class="act-day-head"><span>' + friendlyDay(key) + '</span><span>' + (dayNet > 0 ? '+' : dayNet < 0 ? '−' : '') + formatMoney(dayNet) + '</span></div>';
    groupMap[key].forEach(function(tx) {
      var eff = getEffectiveTx(tx);
      var name = eff.nickname || tx.enriched_merchant_name || tx.merchant_name || tx.name || 'Unknown';
      var cat = normalizeCategory(eff.category);
      var acctName = accountMap[tx.plaid_account_id] || (tx.plaid_account_id ? 'Account' : 'Cash');
      var color = accountColor(tx.plaid_account_id);
      var income = tx.amount < 0;
      var tags = '';
      if (tx.pending) tags += '<span class="act-tag">Pending</span>';
      if (eff.actionType === 'reimbursed') tags += '<span class="act-tag">Reimbursed</span>';
      if (eff.actionType === 'ignored') tags += '<span class="act-tag">Ignored</span>';
      if (eff.isSplit) tags += '<span class="act-tag act-tag-accent">' + (eff.splitWays ? 'Split ' + eff.splitWays + ' ways' : 'Your share') + '</span>';
      // Store logo from Plaid when available; the first letter shows underneath as a fallback
      var avatar = '<span class="act-avatar" data-i="' + esc(name.charAt(0).toUpperCase()) + '">' +
        (tx.enriched_logo_url ? '<img src="' + esc(tx.enriched_logo_url) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>';
      var amountMain = (income ? '+' : '−') + formatMoney(eff.isSplit && !eff.excluded ? eff.amount : tx.amount);
      html += '<div class="tx-row act-row' + (eff.excluded ? ' is-excluded' : '') + '" role="button" tabindex="0" data-txid="' + esc(tx.id) + '">' +
        avatar +
        '<span class="act-row-main"><span class="act-row-name">' + esc(name) + '</span>' +
        '<span class="act-row-meta">' + (showCardName ? esc(acctName) + ' · ' : '') + esc(cat) + '</span></span>' +
        '<span class="act-row-right"><span class="act-row-amt' + (income ? ' is-in' : '') + '">' + amountMain + '</span>' +
        (eff.isSplit && !eff.excluded ? '<span class="act-row-sub">of ' + formatMoney(tx.amount) + '</span>' : '') +
        (tags ? '<span class="act-row-tags">' + tags + '</span>' : '') + '</span>' +
      '</div>';
    });
    html += '</div>';
  });
  breakdown.innerHTML = html;
  updateMonthButtons();
}

// Collapsible "more info" block on account cards; open state survives re-renders
var openCardSections = {};
function moreSection(key, summary, body) {
  return '<details class="card-more" data-key="' + esc(key) + '"' + (openCardSections[key] ? ' open' : '') + '>' +
    '<summary><span>' + esc(summary) + '</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>' +
    '<div class="card-more-body">' + body + '</div></details>';
}
document.addEventListener('toggle', function(e) {
  var d = e.target;
  if (d.classList && d.classList.contains('card-more')) openCardSections[d.dataset.key] = d.open;
}, true);

var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function friendlyDay(dateStr) {
  var p = dateStr.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// Each account keeps the same color everywhere (chips, dots)
var ACCOUNT_COLORS = ['#2F6FDB', '#0F8A95', '#7A4CC2', '#C27A1A', '#B0476A', '#3E8E5E', '#5E7FA3', '#9C5B3C'];
function accountColor(plaidAccountId) {
  if (!plaidAccountId || !cachedAccounts) return 'var(--track)';
  var ids = cachedAccounts.map(function(a) { return a.plaid_account_id; }).filter(Boolean);
  var i = ids.indexOf(plaidAccountId);
  return i === -1 ? 'var(--track)' : ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
}
function updateMonthButtons() {
  var sel = $('#tx-month-filter');
  if (!sel) return;
  $('#act-month-prev').disabled = sel.selectedIndex >= sel.options.length - 1;
  $('#act-month-next').disabled = sel.selectedIndex <= 0;
}
(function wireActivityControls() {
  var searchBtn = $('#btn-act-search'), searchRow = $('#act-search'), searchIn = $('#tx-search');
  var closeSearch = function() {
    searchRow.hidden = true; searchBtn.setAttribute('aria-expanded', 'false');
    if (searchIn.value) { searchIn.value = ''; renderTransactionMonth(); }
  };
  if (searchBtn) searchBtn.addEventListener('click', function() {
    if (!searchRow.hidden) { closeSearch(); return; }
    searchRow.hidden = false; searchBtn.setAttribute('aria-expanded', 'true'); searchIn.focus();
  });
  var cancel = $('#act-search-cancel');
  if (cancel) cancel.addEventListener('click', function(e) { e.preventDefault(); closeSearch(); });
  var step = function(dir) {
    var sel = $('#tx-month-filter');
    var i = sel.selectedIndex + dir;
    if (i < 0 || i >= sel.options.length) return;
    sel.selectedIndex = i;
    activeCategoryFilter = null;
    renderTransactionMonth();
  };
  var prev = $('#act-month-prev'), next = $('#act-month-next');
  if (prev) prev.addEventListener('click', function() { step(1); });
  if (next) next.addEventListener('click', function() { step(-1); });
  var list = $('#tx-breakdown');
  if (list) list.addEventListener('keydown', function(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tx-row')) { e.preventDefault(); e.target.click(); }
  });
})();

window._clearCatFilter = function() {
  activeCategoryFilter = null;
  renderTransactionMonth();
};

// CSV Export — exports categorized transactions (excludes ignored)
$('#btn-export-csv').addEventListener('click', function() {
  var month = $('#tx-month-filter').value;
  var cardId = $('#tx-card-filter').value;

  var filtered = txData.filter(function(tx) {
    return tx.date.substring(0, 7) === month;
  });
  if (cardId !== 'all') {
    filtered = filtered.filter(function(tx) { return tx.plaid_account_id === cardId; });
  }
  if (activeCategoryFilter) {
    filtered = filtered.filter(function(tx) {
      var eff = getEffectiveTx(tx);
      return normalizeCategory(eff.category) === activeCategoryFilter;
    });
  }

  // Exclude ignored transactions
  filtered = filtered.filter(function(tx) {
    var eff = getEffectiveTx(tx);
    return eff.actionType !== 'ignored';
  });

  if (filtered.length === 0) return;

  // Sort by category, then by date
  filtered.sort(function(a, b) {
    var catA = normalizeCategory(getEffectiveTx(a).category);
    var catB = normalizeCategory(getEffectiveTx(b).category);
    if (catA !== catB) return catA.localeCompare(catB);
    return a.date > b.date ? 1 : a.date < b.date ? -1 : 0;
  });

  var csvRows = ['Category,Date,Merchant,Amount,Your Share,Type,Split,Reimbursed'];
  filtered.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    var cat = normalizeCategory(eff.category).replace(/"/g, '""');
    var merchant = (eff.nickname || tx.merchant_name || tx.name || 'Unknown').replace(/"/g, '""');
    var type = tx.amount < 0 ? 'Income' : 'Expense';
    var splitInfo = eff.isSplit ? (eff.splitWays ? eff.splitWays + '-way' : 'Custom') : '';
    var reimbursed = eff.actionType === 'reimbursed' ? 'Yes' : '';
    csvRows.push(
      '"' + cat + '",' + eff.date + ',"' + merchant + '",' +
      tx.amount.toFixed(2) + ',' + eff.amount.toFixed(2) + ',' +
      type + ',' + splitInfo + ',' + reimbursed
    );
  });

  var blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'transactions-' + month + '.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// ============================================
// ADD MANUAL TRANSACTION
// ============================================
var addTxSheet = $('#add-tx-sheet');

$('#btn-add-tx').addEventListener('click', function() {
  // Reset form
  $('#add-tx-name').value = '';
  $('#add-tx-amount').value = '';
  $('#add-tx-date').value = new Date().toISOString().split('T')[0];
  $('#add-tx-category').value = 'OTHER';

  // Populate account dropdown with Cash first, then linked accounts
  var acctSelect = $('#add-tx-account');
  acctSelect.innerHTML = '<option value="cash" data-account-id="" data-plaid-item-id="">Cash</option>';
  if (cachedAccounts) {
    var usedAcct = {};
    txData.forEach(function(t) { if (t.plaid_account_id) usedAcct[t.plaid_account_id] = true; });
    cachedAccounts.forEach(function(a) {
      if (a.plaid_account_id && usedAcct[a.plaid_account_id]) {
        var opt = document.createElement('option');
        opt.value = a.plaid_account_id;
        opt.textContent = a.nickname || a.name || 'Account';
        opt.dataset.accountId = a.id;
        opt.dataset.plaidItemId = a.plaid_item_id || '';
        acctSelect.appendChild(opt);
      }
    });
  }

  addTxSheet.classList.add('visible');
  setTimeout(function() { $('#add-tx-name').focus(); }, 100);
});

// Cancel
$('#add-tx-cancel').addEventListener('click', function() {
  addTxSheet.classList.remove('visible');
});
addTxSheet.addEventListener('click', function(e) {
  if (e.target === addTxSheet) addTxSheet.classList.remove('visible');
});

// Save
$('#add-tx-save').addEventListener('click', async function() {
  var name = $('#add-tx-name').value.trim();
  var amountVal = parseFloat($('#add-tx-amount').value);
  var date = $('#add-tx-date').value;
  var acctSelect = $('#add-tx-account');
  var category = $('#add-tx-category').value;

  if (!name) { showToast('Enter a name'); return; }
  if (!amountVal || amountVal <= 0) { showToast('Enter an amount'); return; }
  if (!date) { showToast('Pick a date'); return; }

  // Plaid convention: positive = expense
  var amount = amountVal;

  var selectedOpt = acctSelect.options[acctSelect.selectedIndex];
  var isCash = acctSelect.value === 'cash';
  var plaidAccountId = isCash ? null : (acctSelect.value || null);
  var accountId = isCash ? null : (selectedOpt ? selectedOpt.dataset.accountId || null : null);
  var plaidItemId = isCash ? null : (selectedOpt ? selectedOpt.dataset.plaidItemId || null : null);

  var txId = 'manual_' + crypto.randomUUID();

  var row = {
    id: txId,
    user_id: currentUser.id,
    account_id: accountId,
    plaid_item_id: plaidItemId,
    plaid_account_id: plaidAccountId,
    amount: amount,
    date: date,
    name: name,
    merchant_name: name,
    category: category,
    pending: false,
    type: 'place',
    enriched_category_primary: category
  };

  // Update local state and render immediately
  txData.push(row);
  renderTransactionMonth();
  addTxSheet.classList.remove('visible');
  showToast('Transaction added');

  // Save to DB in background
  sb.from('synced_transactions').insert(row).then(function(result) {
    if (result.error) console.error('Insert manual tx error:', result.error);
  });
});

function formatTxDate(dateStr, datetimeStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var datePart = monthNames[parseInt(parts[1]) - 1] + ' ' + parseInt(parts[2]);
  var thisYear = new Date().getFullYear();
  if (parseInt(parts[0]) !== thisYear) datePart += ', ' + parts[0];
  if (datetimeStr) {
    var d = new Date(datetimeStr);
    datePart += ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return datePart;
}

// Plaid's category codes in plain words (also maps older saved overrides
// like "FOOD AND DRINK"). Your own custom category names pass through.
var CATEGORY_NAMES = {
  INCOME: 'Income', TRANSFER_IN: 'Transfers in', TRANSFER_OUT: 'Transfers out',
  LOAN_PAYMENTS: 'Loan & card payments', BANK_FEES: 'Bank fees', ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Food & drink', GENERAL_MERCHANDISE: 'Shopping', HOME_IMPROVEMENT: 'Home',
  MEDICAL: 'Medical', PERSONAL_CARE: 'Personal care', GENERAL_SERVICES: 'Services',
  GOVERNMENT_AND_NON_PROFIT: 'Government & charity', TRANSPORTATION: 'Transportation',
  TRAVEL: 'Travel', RENT_AND_UTILITIES: 'Rent & utilities', OTHER: 'Other'
};
function normalizeCategory(cat) {
  if (!cat) return 'Other';
  var key = String(cat).trim().toUpperCase().replace(/\s*&\s*/g, '_AND_').replace(/[\s-]+/g, '_');
  if (CATEGORY_NAMES[key]) return CATEGORY_NAMES[key];
  if (cat === cat.toUpperCase()) return cat.charAt(0) + cat.slice(1).toLowerCase().replace(/_/g, ' ');
  return cat;
}
// Money moved between your own accounts or to pay a card isn't spending
function isTransferCategory(name) {
  return name === 'Transfers in' || name === 'Transfers out' || name === 'Loan & card payments';
}

// ============================================
// TRANSACTION ACTION SHEET
// ============================================
var actionSheet = $('#tx-action-sheet');
var actionTxId = null;
var actionTx = null;

// Open action sheet on tx row tap
document.addEventListener('click', function(e) {
  var row = e.target.closest('.tx-row[data-txid]');
  if (!row) return;
  var txId = row.dataset.txid;
  var tx = txData.find(function(t) { return t.id === txId; });
  if (!tx) return;
  openActionSheet(tx);
});

function openActionSheet(tx) {
  actionTxId = tx.id;
  actionTx = tx;
  var action = txActions[tx.id] || {};

  $('#tx-action-merchant').textContent = tx.enriched_merchant_name || tx.merchant_name || tx.name || 'Unknown';
  $('#tx-action-amount').textContent = (tx.amount < 0 ? '+' : '-') + formatMoney(Math.abs(tx.amount));
  $('#tx-action-amount').className = 'action-sheet-subtitle ' + (tx.amount < 0 ? 'balance-positive' : 'balance-negative');

  // Show enriched details
  var detailParts = [];
  if (tx.enriched_location_city || tx.enriched_location_region) {
    detailParts.push([tx.enriched_location_city, tx.enriched_location_region].filter(Boolean).join(', '));
  }
  if (tx.enriched_payment_channel) detailParts.push(tx.enriched_payment_channel.replace(/_/g, ' '));
  if (tx.enriched_website) detailParts.push(tx.enriched_website);
  var detailEl = $('#tx-action-detail');
  if (detailEl) {
    detailEl.textContent = detailParts.join(' / ');
    detailEl.hidden = detailParts.length === 0;
  }

  // Build status text
  var statusParts = [];
  if (action.action_type === 'ignored') statusParts.push('Ignored');
  if (action.action_type === 'reimbursed') statusParts.push('Reimbursed');
  if (action.split_portion > 0) statusParts.push('Split (your portion: ' + formatMoney(parseFloat(action.split_portion)) + ')');
  else if (action.split_ways > 1) statusParts.push(action.split_ways + '-way split');
  if (action.category_override) statusParts.push('Re-categorized');

  var statusEl = $('#tx-action-status');
  var hasActions = statusParts.length > 0;
  statusEl.textContent = hasActions ? statusParts.join(', ') : '';
  statusEl.hidden = !hasActions;
  document.querySelector('.action-option-clear').hidden = !hasActions;

  // Show delete button only for manual transactions
  var deleteBtn = $('#btn-delete-tx');
  deleteBtn.hidden = !(tx.id && tx.id.indexOf('manual_') === 0);

  // Highlight active toggles
  document.querySelectorAll('.action-toggle').forEach(function(btn) {
    var t = btn.dataset.toggle;
    var isActive = false;
    if (t === 'split') isActive = action.split_ways > 1;
    else if (t === 'recategorized') isActive = !!action.category_override;
    else if (t === 'reimbursed') isActive = action.action_type === 'reimbursed';
    else if (t === 'ignored') isActive = action.action_type === 'ignored';
    btn.classList.toggle('active', isActive);
  });

  // Reset sub-pickers
  $('#split-picker').hidden = true;
  $('#recat-picker').hidden = true;
  $('#edit-picker').hidden = true;
  $('#tx-action-options').hidden = false;

  actionSheet.classList.add('visible');
}

function closeActionSheet() {
  actionSheet.classList.remove('visible');
  actionTxId = null;
  actionTx = null;
}

$('#action-sheet-cancel').addEventListener('click', closeActionSheet);
actionSheet.addEventListener('click', function(e) {
  if (e.target === actionSheet) closeActionSheet();
});

// Back to main options from any sub-picker
function showMainOptions() {
  $('#tx-action-options').hidden = false;
  $('#split-picker').hidden = true;
  $('#edit-picker').hidden = true;
  $('#recat-picker').hidden = true;
  // Restore detail/status rows
  var detail = $('#tx-action-detail');
  var status = $('#tx-action-status');
  if (detail.dataset.wasVisible === '1') detail.hidden = false;
  if (status.dataset.wasVisible === '1') status.hidden = false;
}

function showSubPicker(pickerId) {
  // Hide main options and detail/status
  $('#tx-action-options').hidden = true;
  $('#split-picker').hidden = true;
  $('#edit-picker').hidden = true;
  $('#recat-picker').hidden = true;
  var detail = $('#tx-action-detail');
  var status = $('#tx-action-status');
  detail.dataset.wasVisible = detail.hidden ? '0' : '1';
  status.dataset.wasVisible = status.hidden ? '0' : '1';
  detail.hidden = true;
  status.hidden = true;
  $(pickerId).hidden = false;
}
$('#split-back').addEventListener('click', showMainOptions);
$('#edit-back').addEventListener('click', showMainOptions);
$('#recat-back').addEventListener('click', showMainOptions);

// Toggle click handlers
document.querySelectorAll('.action-toggle').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (!actionTxId) return;
    var toggle = btn.dataset.toggle;
    var existing = txActions[actionTxId] || {};

    if (toggle === 'ignored' || toggle === 'reimbursed') {
      var isAlreadySet = existing.action_type === toggle;
      saveMultiAction(actionTxId, {
        action_type: isAlreadySet ? null : toggle
      });
      return;
    }

    if (toggle === 'split') {
      // If already split, toggle it off
      if (existing.split_ways > 1 || existing.split_portion > 0) {
        saveMultiAction(actionTxId, { split_ways: null, split_portion: null });
        return;
      }
      // Show split picker
      showSubPicker('#split-picker');
      $('#split-preview').textContent = '';
      $('#split-custom-row').hidden = true;
      $('#split-portion-row').hidden = true;
      return;
    }

    if (toggle === 'recategorized') {
      if (existing.category_override) {
        // Toggle off
        saveMultiAction(actionTxId, { category_override: null });
        return;
      }
      showRecatPicker();
      return;
    }

    if (toggle === 'edit') {
      showEditPicker();
      return;
    }
  });
});

// Clear all
document.querySelector('.action-option-clear').addEventListener('click', function() {
  if (!actionTxId) return;
  clearTxAction(actionTxId);
});

// Delete manual transaction
$('#btn-delete-tx').addEventListener('click', function() {
  if (!actionTxId || actionTxId.indexOf('manual_') !== 0) return;
  var deleteId = actionTxId;
  txData = txData.filter(function(tx) { return tx.id !== deleteId; });
  delete txActions[deleteId];
  showToast('Transaction deleted');
  renderTransactionMonth();
  closeActionSheet();
  // Delete from DB in background
  sb.from('synced_transactions').delete().eq('id', deleteId).eq('user_id', currentUser.id).then(function(result) {
    if (result.error) console.error('Delete tx error:', result.error);
  });
});

// Split picker - quick split buttons (2-way, 3-way)
document.querySelectorAll('#split-picker button[data-ways]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var ways = parseInt(btn.dataset.ways);
    var share = Math.abs(actionTx.amount) / ways;
    var reimburse = Math.abs(actionTx.amount) - share;
    $('#split-preview').textContent = 'You pay ' + formatMoney(share) + ', get back ' + formatMoney(reimburse);
    var existing = txActions[actionTxId] || {};
    var updates = { split_ways: ways, split_portion: null };
    if (existing.action_type === 'ignored' || existing.action_type === 'reimbursed') {
      updates.action_type = null;
    }
    saveMultiAction(actionTxId, updates);
  });
});

// Split picker - custom N-way
var splitCustomBtn = $('#split-custom-btn');
if (splitCustomBtn) splitCustomBtn.addEventListener('click', function() {
  var row = $('#split-custom-row');
  var isOpen = !row.hidden;
  $('#split-custom-row').hidden = isOpen;
  $('#split-portion-row').hidden = true;
  $('#split-preview').textContent = '';
  if (!isOpen) {
    $('#split-custom-ways').value = '';
    setTimeout(function() { $('#split-custom-ways').focus(); }, 50);
  }
});

var splitCustomApply = $('#split-custom-apply');
if (splitCustomApply) splitCustomApply.addEventListener('click', function() {
  var ways = parseInt($('#split-custom-ways').value);
  if (!ways || ways < 2) return;
  var share = Math.abs(actionTx.amount) / ways;
  var reimburse = Math.abs(actionTx.amount) - share;
  $('#split-preview').textContent = 'You pay ' + formatMoney(share) + ', get back ' + formatMoney(reimburse);
  var existing = txActions[actionTxId] || {};
  var updates = { split_ways: ways, split_portion: null };
  if (existing.action_type === 'ignored' || existing.action_type === 'reimbursed') {
    updates.action_type = null;
  }
  saveMultiAction(actionTxId, updates);
});

var splitCustomWays = $('#split-custom-ways');
if (splitCustomWays) splitCustomWays.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') $('#split-custom-apply').click();
});

// Split picker - my portion (dollar amount)
var splitPortionBtn = $('#split-portion-btn');
if (splitPortionBtn) splitPortionBtn.addEventListener('click', function() {
  var row = $('#split-portion-row');
  var isOpen = !row.hidden;
  $('#split-portion-row').hidden = isOpen;
  $('#split-custom-row').hidden = true;
  $('#split-preview').textContent = '';
  if (!isOpen) {
    $('#split-portion-amount').value = '';
    setTimeout(function() { $('#split-portion-amount').focus(); }, 50);
  }
});

var splitPortionApply = $('#split-portion-apply');
if (splitPortionApply) splitPortionApply.addEventListener('click', function() {
  var portion = parseFloat($('#split-portion-amount').value);
  if (!portion || portion <= 0 || portion >= Math.abs(actionTx.amount)) {
    showToast('Enter an amount between $0 and ' + formatMoney(actionTx.amount));
    return;
  }
  var reimburse = Math.abs(actionTx.amount) - portion;
  $('#split-preview').textContent = 'You pay ' + formatMoney(portion) + ', get back ' + formatMoney(reimburse);
  var existing = txActions[actionTxId] || {};
  var updates = { split_portion: portion, split_ways: null };
  if (existing.action_type === 'ignored' || existing.action_type === 'reimbursed') {
    updates.action_type = null;
  }
  saveMultiAction(actionTxId, updates);
});

var splitPortionAmount = $('#split-portion-amount');
if (splitPortionAmount) splitPortionAmount.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') $('#split-portion-apply').click();
});

// Recurring picker

// Re-categorize picker
function showRecatPicker() {
  showSubPicker('#recat-picker');
  var list = $('#recat-list');

  var allCats = {};
  txData.forEach(function(tx) {
    var cat = normalizeCategory(tx.enriched_category_primary || tx.category);
    allCats[cat] = true;
  });
  var catList = Object.keys(allCats).sort();

  list.innerHTML = catList.map(function(cat) {
    return '<button class="recat-option" data-cat="' + esc(cat) + '">' + esc(cat) + '</button>';
  }).join('');

  list.querySelectorAll('.recat-option').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var existing = txActions[actionTxId] || {};
      var updates = { category_override: btn.dataset.cat };
      if (existing.action_type === 'ignored' || existing.action_type === 'reimbursed') {
        updates.action_type = null;
      }
      saveMultiAction(actionTxId, updates);
    });
  });

  $('#recat-custom-input').value = '';
}

$('#recat-custom-apply').addEventListener('click', function() {
  var name = $('#recat-custom-input').value.trim();
  if (!name || !actionTxId) return;
  var cat = name.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  var existing = txActions[actionTxId] || {};
  var updates = { category_override: cat };
  if (existing.action_type === 'ignored' || existing.action_type === 'reimbursed') {
    updates.action_type = null;
  }
  saveMultiAction(actionTxId, updates);
});

// Edit picker
function showEditPicker() {
  showSubPicker('#edit-picker');
  var action = txActions[actionTxId];
  $('#edit-nickname').value = (action && action.nickname) || '';
  $('#edit-date').value = (action && action.date_override) || actionTx.date;
}

$('#edit-save').addEventListener('click', async function() {
  if (!actionTxId) return;
  var nickname = $('#edit-nickname').value.trim() || null;
  var dateOverride = $('#edit-date').value || null;
  if (dateOverride === actionTx.date) dateOverride = null;
  saveMultiAction(actionTxId, { nickname: nickname, date_override: dateOverride });
});

// Unified save that merges updates with existing action state
async function saveMultiAction(txId, updates) {
  var existing = txActions[txId] || {};
  var row = {
    user_id: currentUser.id,
    transaction_id: txId,
    action_type: updates.hasOwnProperty('action_type') ? updates.action_type : (existing.action_type || null),
    split_ways: updates.hasOwnProperty('split_ways') ? updates.split_ways : (existing.split_ways || null),
    split_portion: updates.hasOwnProperty('split_portion') ? updates.split_portion : (existing.split_portion || null),
    category_override: updates.hasOwnProperty('category_override') ? updates.category_override : (existing.category_override || null),
    nickname: updates.hasOwnProperty('nickname') ? updates.nickname : (existing.nickname || null),
    date_override: updates.hasOwnProperty('date_override') ? updates.date_override : (existing.date_override || null),
    is_recurring: updates.hasOwnProperty('is_recurring') ? updates.is_recurring : (existing.is_recurring || false),
    recurring_group: updates.hasOwnProperty('recurring_group') ? updates.recurring_group : (existing.recurring_group || null),
    recurring_next_date: updates.hasOwnProperty('recurring_next_date') ? updates.recurring_next_date : (existing.recurring_next_date || null),
    recurring_amount_mode: updates.hasOwnProperty('recurring_amount_mode') ? updates.recurring_amount_mode : (existing.recurring_amount_mode || 'recent'),
    recurring_paused: updates.hasOwnProperty('recurring_paused') ? updates.recurring_paused : (existing.recurring_paused || false),
    recurring_deleted: updates.hasOwnProperty('recurring_deleted') ? updates.recurring_deleted : (existing.recurring_deleted || false)
  };
  // Update local state and render immediately
  txActions[txId] = row;
  showToast('Saved');
  renderTransactionMonth();
  closeActionSheet();

  // Save to DB in background
  var previous = txActions.hasOwnProperty(txId) && existing !== row ? existing : null;
  sb.from('transaction_actions').upsert(row, { onConflict: 'user_id,transaction_id' }).then(function(result) {
    if (result.error) {
      console.error('Failed to save action:', result.error);
      if (previous && Object.keys(previous).length) txActions[txId] = previous; else delete txActions[txId];
      renderTransactionMonth();
      showToast("Couldn't save. Check your connection and try again.");
    }
  });
  // After re-render the list may be shorter — clamp scroll so content stays visible
  var tabEl = document.getElementById('tab-transactions');
  if (tabEl) {
    // Force layout recalc (contain: layout style can delay it)
    void tabEl.scrollHeight;
    var maxScroll = tabEl.scrollHeight - tabEl.clientHeight;
    if (tabEl.scrollTop > maxScroll) tabEl.scrollTop = maxScroll;
  }
}

function clearTxAction(txId) {
  delete txActions[txId];
  renderTransactionMonth();
  closeActionSheet();
  // Delete from DB in background
  sb.from('transaction_actions').delete().eq('user_id', currentUser.id).eq('transaction_id', txId).then(function(result) {
    if (result.error) console.error('Clear action error:', result.error);
  });
}

// Load transactions when switching to that tab
document.getElementById('bottom-nav').addEventListener('click', function(e) {
  var btn = e.target.closest('.nav-item');
  if (btn && btn.dataset.tab === 'transactions' && txData.length === 0) {
    loadTransactions();
  }
});

// Legend section toggle
var legendToggle = $('#btn-toggle-legend');
if (legendToggle) legendToggle.addEventListener('click', function() {
  this.closest('.tx-legend-section').classList.toggle('collapsed');
});

// ============================================
// UTILS
// ============================================
function formatTimestamp(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var diff = Date.now() - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatSigned(amount) {
  return (amount < 0 ? '−' : '') + formatMoney(amount);
}

function formatMoney(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Math.abs(amount));
}

function formatPct(value) {
  // 3 significant figures: 45.2%, 5.03%, 0.482%, 0.0312%
  if (value >= 10) return value.toFixed(1) + '%';
  if (value >= 1) return value.toFixed(2) + '%';
  if (value >= 0.1) return value.toFixed(3) + '%';
  return value.toFixed(4) + '%';
}

// Tick all visible relative timestamps every 60s (no API calls)
setInterval(function() {
  document.querySelectorAll('[data-ts]').forEach(function(el) {
    var ts = el.getAttribute('data-ts');
    var prefix = el.getAttribute('data-ts-prefix') || '';
    var formatted = formatTimestamp(ts);
    if (formatted) el.textContent = prefix + formatted;
  });
}, 60000);

// Escapes text for HTML, including inside attribute values ("..." and '...')
function esc(str) {
  if (str === null || str === undefined || str === '') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showLoading(show) {
  loading.classList.toggle('visible', show);
}

function showError(msg) {
  var el = document.getElementById('snapshot-error');
  if (el) {
    el.textContent = msg;
    el.hidden = false;
    setTimeout(function() { el.hidden = true; }, 5000);
  }
  console.error(msg);
}

// Toast notification
function showToast(msg) {
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.classList.add('visible'); });
  setTimeout(function() {
    toast.classList.remove('visible');
    setTimeout(function() { toast.remove(); }, 300);
  }, 1500);
}

// Button save feedback (briefly shows "Saved" then reverts)
function flashSaved(btn) {
  var orig = btn.textContent;
  btn.textContent = 'Saved';
  btn.disabled = true;
  setTimeout(function() {
    btn.textContent = orig;
    btn.disabled = false;
  }, 1200);
}


})();
