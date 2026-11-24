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
// Privacy: long-press the Available number to hide every amount (like Robinhood). Remembered on this device.
var hideMoney = (function() { try { return localStorage.getItem('alenjo_hide_money') === '1'; } catch (e) { return false; } })();
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

// ---- Trusted device (two-step sign-in): keep the code-verified session on this device for
// 30 days. Opening or unlocking still needs Face ID or your password, checked on a side
// client so the kept session (which passed the code step) is never replaced.
var TRUST_DAYS = 30;
function trustedFor() { try { var t = JSON.parse(localStorage.getItem('alenjo_trusted') || 'null'); return t && t.until > Date.now() ? t : null; } catch (e) { return null; } }
function setTrusted(uid) { try { localStorage.setItem('alenjo_trusted', JSON.stringify({ uid: uid, until: Date.now() + TRUST_DAYS * 86400000 })); } catch (e) {} }
function clearTrusted() { try { localStorage.removeItem('alenjo_trusted'); } catch (e) {} }
var resumeSession = null;   // a kept session waiting for Face ID or your password
var awaitingUnlock = false;
async function keepOrSignOut() {
  var t = trustedFor();
  if (t) {
    try {
      var s = (await sb.auth.getSession()).data.session;
      var lvl = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (s && s.user && s.user.id === t.uid && lvl.data && lvl.data.currentLevel === 'aal2') { resumeSession = s; awaitingUnlock = true; return; }
    } catch (e) {}
  }
  clearTrusted();
  return sb.auth.signOut({ scope: 'local' });
}
function keptSessionTrusted() { var t = trustedFor(); return !!(t && currentUser && t.uid === currentUser.id); }
async function verifyOnSide(kind, email, password) {
  var c = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'alenjo-side-check' } });
  var r = kind === 'passkey' ? await c.auth.signInWithPasskey() : await c.auth.signInWithPassword({ email: email, password: password });
  var uid = resumeSession ? resumeSession.user.id : (currentUser && currentUser.id);
  var ok = !r.error && r.data && r.data.session && r.data.session.user.id === uid;
  c.auth.signOut({ scope: 'local' }).catch(function() {});
  return { ok: !!ok, error: r.error };
}
async function finishResume() {
  awaitingUnlock = false;
  var s = (await sb.auth.getSession()).data.session || resumeSession;
  resumeSession = null;
  finishSignIn(s);
}
async function dropResume() {
  clearTrusted(); resumeSession = null; awaitingUnlock = false;
  await sb.auth.signOut({ scope: 'local' });
}

authForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  if (signingIn) return;
  setSigningIn(true);
  authError.hidden = true;

  var email = authEmail.value.trim();
  var password = authPassword.value;

  // Trusted device: check the password on the side and open with the kept session
  if (resumeSession) {
    if (email.toLowerCase() !== String(resumeSession.user.email || '').toLowerCase()) {
      await dropResume();
    } else {
      var v = await verifyOnSide('password', email, password);
      if (!v.ok) { authError.textContent = (v.error && v.error.message) || 'That password isn’t right.'; authError.hidden = false; setSigningIn(false); return; }
      try { localStorage.setItem('alenjo_last_email', email); } catch (x) {}
      finishResume();
      return;
    }
  }

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
  if (resumeSession) dropResume(); else clearTrusted();
  try { ['alenjo_last_email', 'alenjo_last_name', 'alenjo_last_avatar', SIGNED_KEY].forEach(function(k) { localStorage.removeItem(k); }); } catch (e) {}
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
      // Full screen, no way around it: the app needs the new version to keep working right
      var bar = $('#update-bar');
      if (bar && bar.hidden) {
        try { saveTxNote(); } catch (e) {}
        bar.hidden = false;
        document.body.classList.add('update-required');
        var b = $('#btn-update-now'); if (b) b.focus();
      }
    }
  } catch (e) {}
}
var updateBtn = $('#btn-update-now');
if (updateBtn) updateBtn.addEventListener('click', function() {
  updateBtn.disabled = true;
  updateBtn.textContent = 'Updating…';
  // Your theme, Face ID and other choices live on this device and carry over
  location.replace('/?v=' + encodeURIComponent(pendingVersion || Date.now()));
});
// Keep the update screen from being closed with Escape or tabbed around
document.addEventListener('keydown', function(e) {
  var bar = $('#update-bar');
  if (!bar || bar.hidden) return;
  if (e.key === 'Escape') e.preventDefault();
  if (e.key === 'Tab') { e.preventDefault(); updateBtn.focus(); }
}, true);
// Also check every 10 minutes while the app stays open
setInterval(checkForUpdate, 10 * 60 * 1000);
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) checkForUpdate();
});
checkForUpdate();

// ============================================
// FACE ID (passkeys)
// ============================================
// Signed out on purpose (Sign out button): only then does reopening show the email sign-in.
// Any other reopen (iOS closed the app, auto-lock) shows the Face ID lock screen instead.
function markSignedOut() { try { localStorage.setItem('alenjo_signed_out', '1'); localStorage.removeItem('alenjo_set_sums'); } catch (e) {} }
function signedOutOnPurpose() { try { return localStorage.getItem('alenjo_signed_out') === '1'; } catch (e) { return true; } }
var coldLocked = false;
function showColdLock() {
  coldLocked = true;
  var lock = $('#lock-screen');
  if (lock) lock.hidden = false;
  $('#lock-error').hidden = true;
  document.documentElement.classList.remove('boot-locked');   // the real lock screen takes over
}
function hideColdLock() {
  document.documentElement.classList.remove('boot-locked');
  if (!coldLocked) return;
  coldLocked = false;
  var lock = $('#lock-screen');
  if (lock && !appLocked) lock.hidden = true;
}
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
  if (resumeSession) {
    var v = await verifyOnSide('passkey');
    passkeyInFlight = false;
    if (v.ok) { finishResume(); return; }
    setSigningIn(false);
    var c = v.error && /NotAllowed|abort|cancel/i.test((v.error.name || '') + ' ' + (v.error.message || ''));
    if (!c) { authError.textContent = 'Face ID sign-in failed. Use your password instead.'; authError.hidden = false; }
    return;
  }
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
    }
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

// Sign out any existing session on load so user must log in every time
// Then listen for fresh sign-ins only
// Opening a password-reset link: keep that session so you can set a new password
var isRecoveryLink = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);
// Coming back from a bank's own sign-in page (Plaid OAuth redirect): remember the full
// address Plaid sent you back to, and finish connecting once you're signed in.
(function() {
  if (!/[?&]oauth_state_id=/.test(location.search)) return;
  try { sessionStorage.setItem('alenjo_oauth_return', location.href); } catch (e) {}
  history.replaceState(null, '', location.pathname);
})();

// After the password: ask for the authenticator code if two-step sign-in is on
async function continueSignIn(session) {
  try {
    var lvl = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (lvl.data && lvl.data.nextLevel === 'aal2' && lvl.data.currentLevel !== 'aal2') { showMfaStep(); return; }
  } catch (e) { console.error('mfa level', e); }
  finishSignIn(session);
}
function showMfaStep() {
  hideColdLock();   // the code step is on the sign-in page
  setSigningIn(false);
  $('#auth-form').hidden = true;
  $('#mfa-form').hidden = false;
  $('#mfa-error').hidden = true;
  $('#mfa-code').value = '';
  setTimeout(function() { $('#mfa-code').focus(); }, 50);
}
function hideMfaStep() { $('#mfa-form').hidden = true; $('#auth-form').hidden = false; }
$('#mfa-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  var code = $('#mfa-code').value.replace(/\D/g, '');
  if (code.length !== 6) { $('#mfa-error').textContent = 'Enter the 6-digit code'; $('#mfa-error').hidden = false; return; }
  var btn = $('#mfa-submit'); btn.disabled = true; btn.textContent = 'Checking…';
  try {
    var f = await sb.auth.mfa.listFactors();
    var factor = f.data && f.data.totp && f.data.totp[0];
    if (!factor) throw new Error('No authenticator found');
    var v = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code });
    if (v.error) throw v.error;
    hideMfaStep();
    var s = (await sb.auth.getSession()).data.session;
    if ($('#mfa-trust') && $('#mfa-trust').checked && s && s.user) setTrusted(s.user.id); else clearTrusted();
    finishSignIn(s);
  } catch (x) {
    $('#mfa-error').textContent = 'That code didn’t work. Check your authenticator app and try again.';
    $('#mfa-error').hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Verify'; }
});
$('#mfa-code').addEventListener('input', function() {
  if (this.value.replace(/\D/g, '').length === 6) $('#mfa-form').requestSubmit();
});
$('#mfa-cancel').addEventListener('click', function() {
  hideMfaStep();
  sb.auth.signOut({ scope: 'local' });
});
function finishSignIn(session) {
  // Unlocking a locked app: same person, so keep everything as it was
  if (appLocked && currentUser && session.user.id === currentUser.id) {
    currentUser = session.user;
    unlockApp();
    return;
  }
  currentUser = session.user;
  try { localStorage.removeItem('alenjo_signed_out'); } catch (e) {}
  try {
    if (currentUser.created_at) localStorage.setItem('alenjo_since', new Date(currentUser.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
  } catch (e) {}
  firstSync = true;
  lastActivityAt = Date.now();
  loadSignedCache(currentUser.id);
  paintCachedProfile();
  setTimeout(refreshStalePush, 1500);
  Promise.all([loadProfile(), loadAccounts(), loadCardDesigns()]).then(function() {
    if (cachedAccounts && cachedAccounts.length > 0) throttledSync();
    return loadTransactions();
  }).catch(function(e) {
    console.error('Init error:', e);
  }).then(function() {
    showScreen('app');
    hideColdLock();
    resumePlaidOAuth();
  });
}

// Sign out of THIS device only on load (the default would end your
// sessions on every device, e.g. opening on the Mac would sign out the iPhone)
window._alenjoBoot = true;
if (!isRecoveryLink && hasPasskeyHere() && window.PublicKeyCredential && !signedOutOnPurpose()) showColdLock();
else document.documentElement.classList.remove('boot-locked');
var bootReady = isRecoveryLink ? Promise.resolve() : keepOrSignOut();
bootReady.then(function() {
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
    if (event === 'SIGNED_IN' && session && session.user && (awaitingUnlock || (appLocked && keptSessionTrusted() && !unlocking))) {
      return;   // a kept session refreshing itself: Face ID or your password still opens it
    }
    if (event === 'SIGNED_IN' && session && session.user) {
      // Two-step sign-in first if it's on (run outside this callback, per Supabase)
      setTimeout(function() { continueSignIn(session); }, 0);
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
    if (currentUser && !appLocked) saveTxView(true);
    return;
  }
  // Away longer than the auto-lock time: lock (Face ID) or sign out
  if (lockIfIdle()) return;
  // Short glances at another app don't need a refresh
  if (lastHiddenAt && Date.now() - lastHiddenAt > 5000) {
    refreshOnResume();
  }
});

// bfcache restores on iOS Safari don't always fire visibilitychange
window.addEventListener('pageshow', function(e) {
  if (lockIfIdle()) return;
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
  txViewExpired = true; // past auto-lock: open on the current month next time
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
  if (coldLocked) {
    $('#lock-error').hidden = true;
    // Let the startup session check finish first (capped, so a bad connection can't stall the button)
    await Promise.race([bootReady, new Promise(function(r) { setTimeout(r, 4000); })]);
    await signInWithFaceId(true);
    if (!currentUser && !authError.hidden) { $('#lock-error').textContent = 'Face ID didn\u2019t work. Try again or sign out.'; $('#lock-error').hidden = false; }
    return;
  }
  if (unlocking) return;
  unlocking = true;
  if (keptSessionTrusted()) {
    var v = await verifyOnSide('passkey');
    if (v.ok) { unlockApp(); return; }
    unlocking = false;
    var c = v.error && /NotAllowed|abort|cancel/i.test((v.error.name || '') + ' ' + (v.error.message || ''));
    if (!c) { $('#lock-error').textContent = 'Face ID didn\u2019t work. Try again or sign out.'; $('#lock-error').hidden = false; }
    return;
  }
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
if (lockSignOut) lockSignOut.addEventListener('click', function() { markSignedOut(); clearTrusted(); location.reload(); });

function markActivity(e) {
  // Only real taps and keys count. Scroll events also fire when the page
  // re-renders or iOS restores the app, which kept resetting the timer.
  if (document.hidden || (e && e.isTrusted === false)) return;
  lastActivityAt = Date.now();
}

// Plaid Link runs in a cross-origin iframe, so taps inside it never reach this
// page. While it's open, count it as activity so we don't lock mid-connection.
// Tracked with our own flag: Plaid leaves its iframe in the page after closing,
// and checking that iframe kept the app "active" forever.
var plaidOpenSince = 0;
function plaidLinkOpen() {
  if (plaidOpenSince && Date.now() - plaidOpenSince > 30 * 60 * 1000) plaidOpenSince = 0;   // safety cap
  return !!plaidOpenSince;
}
function plaidCreate(cfg) {
  var done = function(fn) { return function() { plaidOpenSince = 0; markActivity(); return fn && fn.apply(this, arguments); }; };
  cfg.onSuccess = done(cfg.onSuccess);
  cfg.onExit = done(cfg.onExit);
  // Plaid: watch Link events for errors (with the session id Plaid support asks for)
  if (!cfg.onEvent) cfg.onEvent = function(name, meta) {
    if (name === 'ERROR' || (meta && meta.error_code)) console.error('Plaid Link', name, meta && meta.error_type, meta && meta.error_code, meta && meta.link_session_id);
  };
  var h = Plaid.create(cfg), open = h.open.bind(h);
  h.open = function() { plaidOpenSince = Date.now(); return open.apply(null, arguments); };
  return h;
}

['pointerdown', 'touchstart', 'keydown', 'wheel'].forEach(function(ev) {
  document.addEventListener(ev, markActivity, { passive: true, capture: true });
});
// Check the moment the app comes back, however iOS brings it back
function lockIfIdle() {
  if (currentUser && !appLocked && !plaidLinkOpen() && Date.now() - lastActivityAt > getLockMs()) { lockOrSignOut(); return true; }
  return false;
}
window.addEventListener('focus', lockIfIdle);

setInterval(function() {
  if (!currentUser) return;
  if (plaidLinkOpen()) { markActivity(); return; }
  lockIfIdle();
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
  if (tabName === 'settings') closeSetPage(true);
  if (tabName === 'settings' && typeof updateFaceIdSetting === 'function') updateFaceIdSetting();
  if (tabName === 'settings' && typeof renderNotifications === 'function') renderNotifications().catch(function(e) { console.error(e); });
  document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var tab = $('#tab-' + tabName);
  if (tab) tab.classList.add('active');
  var nav = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
  if (nav) nav.classList.add('active');
  if (tabName !== 'settings') localStorage.setItem('alenjo_active_tab', tabName);
  syncSettingsHeader();
}

// ============================================
// SETTINGS PAGES: one short list on top; each row opens its own page.
// The controls inside never move, so everything else keeps working.
// ============================================
var setMainScroll = 0;
function openSetPage(key) {
  var page = document.querySelector('.set-page[data-page="' + key + '"]');
  if (!page) return;
  var tab = $('#tab-settings');
  if (!$('#set-main').hidden) setMainScroll = tab.scrollTop;
  $('#set-main').hidden = true;
  document.querySelectorAll('.set-page').forEach(function(p) { p.hidden = p !== page; });
  tab.scrollTop = 0;
  syncSettingsHeader();
}
// On Settings the profile card already shows your photo and name, so the header
// shows the page title (or the back button inside a section) instead.
function syncSettingsHeader() {
  var head = document.querySelector('.app-header'), tab = $('#tab-settings'), main = $('#set-main');
  if (!head || !tab || !main) return;
  var on = tab.classList.contains('active');
  head.classList.toggle('is-settings', on);
  head.classList.toggle('is-subpage', on && main.hidden);
}
function closeSetPage(toTop) {
  var main = $('#set-main');
  if (!main) return;
  document.querySelectorAll('.set-page').forEach(function(p) { p.hidden = true; });
  main.hidden = false;
  refreshSettingsSummary();
  $('#tab-settings').scrollTop = toTop ? 0 : setMainScroll;
  syncSettingsHeader();
}
// The Settings rows' little summaries. Each is only written once its data has loaded (so a row
// never shows "Off" or "None connected yet" for a moment before the real answer), and the last
// values are kept on this device so they're already right when the app opens.
var SET_SUMS_KEY = 'alenjo_set_sums';
function paintCachedSettingsSummary() {
  try {
    var m = JSON.parse(localStorage.getItem(SET_SUMS_KEY) || '{}');
    Object.keys(m).forEach(function(id) { var el = $('#' + id); if (el && typeof m[id] === 'string') el.textContent = m[id]; });
  } catch (e) {}
}
paintCachedSettingsSummary();
var notifSettingsLoaded = false;
function refreshSettingsSummary() {
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(SET_SUMS_KEY) || '{}'); } catch (e) {}
  var changed = false;
  var put = function(id, text) {
    var el = $('#' + id);
    if (el && el.textContent !== text) el.textContent = text;
    if (saved[id] !== text) { saved[id] = text; changed = true; }
  };
  var opts = $('#notif-options'), on = opts && !opts.hidden;
  if (!notifSettingsLoaded && !notifSettings) {
    // not loaded yet: keep what's showing
  } else if (on && notifSettings) {
    var kinds = [notifSettings.purchases ? 'purchases' : '', notifSettings.deposits ? 'deposits' : '', notifSettings.bills !== false ? 'payments due' : ''].filter(Boolean);
    var said = kinds.length > 1 ? kinds.slice(0, -1).join(', ') + ' and ' + kinds[kinds.length - 1] : kinds[0];
    put('set-sum-notif', kinds.length ? 'On · ' + said : 'On · everything paused');
  } else {
    put('set-sum-notif', typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'Blocked in iPhone Settings' : 'Off');
  }
  if (cachedAccounts !== null) {
    var banks = document.querySelectorAll('#accounts-list .settings-institution').length;
    put('set-sum-banks', banks ? banks + ' connected' : 'None connected yet');
  }
  var fid = $('#faceid-status'), mins = $('#pref-lock-minutes');
  if (fid && fid.textContent.trim()) put('set-sum-lock', fid.textContent + (mins ? ' · locks after ' + mins.value + ' min' : ''));
  if (changed) try { localStorage.setItem(SET_SUMS_KEY, JSON.stringify(saved)); } catch (e) {}
}
(function wireSettingsPages() {
  var tab = $('#tab-settings');
  if (!tab) return;
  tab.addEventListener('click', function(e) {
    var open = e.target.closest('[data-open-page]');
    if (open) { openSetPage(open.dataset.openPage); return; }
    if (e.target.closest('[data-close-page]')) closeSetPage(false);
  });
  $('#header-set-back').addEventListener('click', function() { closeSetPage(false); });
  $('#set-change-photo').addEventListener('click', function() { $('#avatar-upload').click(); });
  // Keep the row summaries current as the pages' contents load or change
  var watch = new MutationObserver(function() { refreshSettingsSummary(); });
  var el;
  if ((el = $('#accounts-list'))) watch.observe(el, { childList: true });
  if ((el = $('#faceid-status'))) watch.observe(el, { childList: true, characterData: true, subtree: true });
  if ((el = $('#notif-options'))) watch.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  tab.addEventListener('change', function() { setTimeout(refreshSettingsSummary, 0); });
  document.querySelectorAll('[data-theme-choice]').forEach(function(b) { b.addEventListener('click', function() { setTimeout(refreshSettingsSummary, 0); }); });
  refreshSettingsSummary();
})();

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
// PRIVATE PHOTOS: profile photos and card images aren't public; the app asks
// for short-lived links (7 days) that only work for the signed-in owner's files.
// ============================================
var signedUrlCache = {};
// The links are kept on this device (for this account only) so the next launch can show
// your photo and card art straight away, and the browser can reuse the image it already downloaded.
var SIGNED_KEY = 'alenjo_signed_urls';
function loadSignedCache(uid) {
  try {
    var o = JSON.parse(localStorage.getItem(SIGNED_KEY) || 'null');
    if (!o || o.uid !== uid) return;
    Object.keys(o.m || {}).forEach(function(k) { if (o.m[k].exp > Date.now()) signedUrlCache[k] = o.m[k]; });
  } catch (e) {}
}
function saveSignedCache() {
  if (!currentUser) return;
  var m = {};
  Object.keys(signedUrlCache).forEach(function(k) { if (signedUrlCache[k].exp > Date.now()) m[k] = signedUrlCache[k]; });
  try { localStorage.setItem(SIGNED_KEY, JSON.stringify({ uid: currentUser.id, m: m })); } catch (e) {}
}
async function signedUrl(bucket, path) {
  if (!path) return null;
  var key = bucket + '/' + path, hit = signedUrlCache[key];
  if (hit && hit.exp > Date.now()) return hit.url;
  var r = await sb.storage.from(bucket).createSignedUrl(path, 7 * 24 * 3600);
  if (r.error || !r.data) return null;
  signedUrlCache[key] = { url: r.data.signedUrl, exp: Date.now() + 6 * 24 * 3600 * 1000 };
  saveSignedCache();
  return r.data.signedUrl;
}
// Many at once; only asks the server for the ones not already known. Returns { path: url }.
async function signedUrls(bucket, paths) {
  var out = {}, need = [];
  paths.forEach(function(p) { var h = signedUrlCache[bucket + '/' + p]; if (h && h.exp > Date.now()) out[p] = h.url; else need.push(p); });
  if (need.length) {
    var r = await sb.storage.from(bucket).createSignedUrls(need, 7 * 24 * 3600);
    (r.data || []).forEach(function(x) {
      if (!x.signedUrl) return;
      out[x.path] = x.signedUrl;
      signedUrlCache[bucket + '/' + x.path] = { url: x.signedUrl, exp: Date.now() + 6 * 24 * 3600 * 1000 };
    });
    saveSignedCache();
  }
  return out;
}
// Shrink an image to what the app actually shows (keeps transparency for PNG/WebP)
function shrinkImage(src, maxDim, type, quality) {
  return new Promise(function(resolve, reject) {
    var img = new Image(), url = typeof src === 'string' ? src : URL.createObjectURL(src);
    if (typeof src === 'string') img.crossOrigin = 'anonymous';
    img.onload = function() {
      var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, maxDim / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var ctx = c.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      c.toBlob(function(b) {
        if (!b) return reject(new Error('encode'));
        // Some Safari versions can't write WebP and quietly give PNG; that's fine
        resolve({ blob: b, width: w, height: h, shrunk: k < 1 });
      }, type, quality);
    };
    img.onerror = function() { if (typeof src !== 'string') URL.revokeObjectURL(url); reject(new Error('read')); };
    img.src = url;
  });
}
var IMG_CACHE = '604800';   // images can be reused by the browser for a week
// One time per image: photos and card art uploaded before images were resized get resized
// in the background (they were often 1-3 MB for a 40px picture).
var IMG_LIMITS = { 'avatars': { max: 512, type: 'image/jpeg', q: 0.86 }, 'card-designs': { max: 900, type: 'image/webp', q: 0.9 } };
async function optimizeStoredImages(items) {
  for (var i = 0; i < items.length; i++) {
    var it = items[i], flag = 'alenjo_opt_' + it.bucket + '/' + it.path, lim = IMG_LIMITS[it.bucket];
    try { if (localStorage.getItem(flag)) continue; } catch (e) { continue; }
    try {
      var r = await shrinkImage(it.url, lim.max, lim.type, lim.q);
      if (r.shrunk) {
        var up = await sb.storage.from(it.bucket).upload(it.path, r.blob, { upsert: true, contentType: r.blob.type, cacheControl: IMG_CACHE });
        if (up.error) { console.warn('optimise upload', up.error); continue; }
      }
      localStorage.setItem(flag, '1');
    } catch (e) { console.warn('optimise skipped', it.path, e); }
  }
}
function whenIdle(fn) { (window.requestIdleCallback || function(f) { setTimeout(f, 1500); })(fn); }
function storagePathFromUrl(url, bucket) {
  var m = String(url || '').match(new RegExp('/' + bucket + '/(.+?)(?:\\?|$)'));
  return m ? decodeURIComponent(m[1]) : null;
}

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
  if (userProfile && userProfile.avatar_url) {
    var avPath = storagePathFromUrl(userProfile.avatar_url, 'avatars');
    userProfile.avatar_url = await signedUrl('avatars', avPath) || null;
    try { localStorage.setItem('alenjo_last_avatar', JSON.stringify({ uid: currentUser.id, path: avPath })); } catch (e) {}
    if (userProfile.avatar_url) { var avUrl = userProfile.avatar_url; whenIdle(function() { optimizeStoredImages([{ bucket: 'avatars', path: avPath, url: avUrl }]); }); }
  }
  try { if (userProfile && userProfile.display_name) localStorage.setItem('alenjo_last_name', userProfile.display_name); } catch (e) {}
  updateHeaderProfile();
  updateSettingsProfile();
}

// Right after sign-in, before the server answers: last known name and photo on this device
function paintCachedProfile() {
  try {
    var name = localStorage.getItem('alenjo_last_name');
    if (name && headerName && !headerName.textContent) headerName.textContent = name;
    var av = JSON.parse(localStorage.getItem('alenjo_last_avatar') || 'null');
    var hit = av && currentUser && av.uid === currentUser.id && signedUrlCache['avatars/' + av.path];
    if (hit && hit.exp > Date.now() && headerAvatar) headerAvatar.style.backgroundImage = 'url(' + hit.url + ')';
  } catch (e) {}
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
  var who = $('#set-profile-name');
  if (who) who.textContent = userProfile.display_name || 'Your profile';
  var since = $('#set-profile-since');
  if (since && currentUser && currentUser.created_at) since.textContent = 'Using Alenjo since ' + new Date(currentUser.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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
  updateSettingsProfile();
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
  if (file.size > 25 * 1024 * 1024) {
    showToast('Photo is too large. Use one under 25 MB.');
    return;
  }
  showLoading(true);

  // Shown as a small circle: 512px is plenty and loads instantly
  var shrunk;
  try { shrunk = (await shrinkImage(file, 512, 'image/jpeg', 0.86)).blob; } catch (err) { showLoading(false); showToast("Couldn't read that photo."); return; }
  var path = currentUser.id + '/avatar.jpg';
  var oldPath = userProfile && userProfile.avatar_url ? storagePathFromUrl(userProfile.avatar_url, 'avatars') : null;
  var uploadResult = await sb.storage.from('avatars').upload(path, shrunk, { upsert: true, contentType: 'image/jpeg', cacheControl: IMG_CACHE });

  if (uploadResult.error) {
    console.error('Upload error:', uploadResult.error);
    showLoading(false);
    showToast("Couldn't upload photo. Use a PNG, JPG or WebP image.");
    return;
  }

  // Save where the photo lives; show it with a fresh private link
  var urlResult = sb.storage.from('avatars').getPublicUrl(path);
  await sb.from('profiles').update({ avatar_url: urlResult.data.publicUrl }).eq('id', currentUser.id);
  delete signedUrlCache['avatars/' + path];
  if (oldPath && oldPath !== path) sb.storage.from('avatars').remove([oldPath]);   // the old photo under another name
  try { localStorage.setItem('alenjo_opt_avatars/' + path, '1'); localStorage.setItem('alenjo_last_avatar', JSON.stringify({ uid: currentUser.id, path: path })); } catch (e) {}
  userProfile.avatar_url = (await signedUrl('avatars', path)) + '&v=' + Date.now();
  updateHeaderProfile();
  updateSettingsProfile();
  showLoading(false);
});

// ============================================
// CARD DESIGNS
// ============================================
var cachedCardDesigns = [];

async function loadCardDesigns() {
  if (!currentUser) return;
  var result = await sb.from('card_designs').select('id, storage_path, url, name, created_at').order('created_at', { ascending: false });
  if (result.error) { console.error('card designs load error', result.error); return; }
  cachedCardDesigns = result.data || [];
  var paths = cachedCardDesigns.map(function(d) { return d.storage_path; }).filter(Boolean);
  if (paths.length) {
    var byPath = await signedUrls('card-designs', paths);
    cachedCardDesigns.forEach(function(d) {
      if (!byPath[d.storage_path]) return;
      d.url = byPath[d.storage_path];
      new Image().src = d.url;   // start downloading now, before the cards render
    });
    whenIdle(function() {
      optimizeStoredImages(cachedCardDesigns.filter(function(d) { return d.url; }).map(function(d) { return { bucket: 'card-designs', path: d.storage_path, url: d.url }; }));
    });
  }
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
  var countEl = $('#card-designs-count'), det = $('#card-designs-details');
  if (countEl) countEl.textContent = String(cachedCardDesigns.length);
  if (det) det.hidden = !cachedCardDesigns.length;
  if (!cachedCardDesigns.length) { list.innerHTML = ''; return; }
  list.innerHTML = cachedCardDesigns.map(function(d) {
    return '<div class="card-design-tile">' +
      '<div class="card-design-tile-img" style="background-image:url(' + esc(d.url) + ')"></div>' +
      '<button class="card-design-delete" data-delete-design="' + d.id + '" aria-label="Delete">&times;</button>' +
    '</div>';
  }).join('');
}

function loadScript(src, integrity) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    if (integrity) s.integrity = integrity;   // a tampered CDN copy is refused
    s.crossOrigin = 'anonymous';
    s.onload = function() { resolve(); };
    s.onerror = function() { reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
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
    link.integrity = 'sha384-6LFfkTKLRlzFtgx8xsWyBdKGpcMMQTkv+dB7rAbugeJAu1Ym2q1Aji1cjHBG12Xh';
    link.crossOrigin = 'anonymous';
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
  cropperAssetsPromise = Promise.all([
    cssLoad,
    loadScript('https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js', 'sha384-jrOgQzBlDeUNdmQn3rUt/PZD+pdcRBdWd/HWRqRo+n2OR2QtGyjSaJC0GiCeH+ir')
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

  URL.revokeObjectURL(objUrl);

  setDesignStatus('Uploading...');
  // Card art shows at most ~300px wide: 900px covers sharp screens without megabytes
  try { processedBlob = (await shrinkImage(processedBlob, 900, 'image/webp', 0.9)).blob; } catch (err) {}
  var fname = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + (processedBlob.type === 'image/webp' ? '.webp' : '.png');
  var path = currentUser.id + '/' + fname;
  try { localStorage.setItem('alenjo_opt_card-designs/' + path, '1'); } catch (e) {}

  var up = await sb.storage.from('card-designs').upload(path, processedBlob, { contentType: processedBlob.type || 'image/png', cacheControl: IMG_CACHE });
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

  if (!ins.error && ins.data) ins.data.url = (await signedUrl('card-designs', path)) || ins.data.url;
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
    html += '<div class="card-design-picker-empty">Upload designs in Settings &rarr; Card designs and logos.</div>';
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
// Long-press Available: hide or show every amount. A short tap still switches pending.
var heroLongPressed = false;
// Account numbers hide along with amounts
function shownMask(m) { return hideMoney ? '####' : m; }
function setHideMoney(v) {
  hideMoney = !!v;
  try { localStorage.setItem('alenjo_hide_money', hideMoney ? '1' : '0'); } catch (e) {}
  syncMoneyEye();
  if (cachedAccounts) { renderAccounts(cachedAccounts); renderHomeInsights(); }
  if (txData && txData.length) renderTransactionMonth();
  if (actionTx && actionSheet && actionSheet.classList.contains('visible')) renderTxSheet(actionTx);
  if (navigator.vibrate) navigator.vibrate(10);
}
function syncMoneyEye() {
  document.body.classList.toggle('money-hidden', hideMoney);
  var eye = $('#money-eye'); if (eye) eye.hidden = !hideMoney;
  alignMoneyEye();
}
// The eye's position is set in CSS (measured against the real Newsreader asterisks)
function alignMoneyEye() {}
syncMoneyEye();
(function wireHeroLongPress() {
  var hero = $('#hero-available'), eye = $('#money-eye'), timer = null, start = null;
  if (!hero) return;
  function cancel() { clearTimeout(timer); timer = null; hero.classList.remove('pressing'); }
  hero.addEventListener('pointerdown', function(e) {
    if (e.target.closest('#money-eye')) return;
    heroLongPressed = false; start = { x: e.clientX, y: e.clientY };
    hero.classList.add('pressing');
    timer = setTimeout(function() { timer = null; heroLongPressed = true; hero.classList.remove('pressing'); setHideMoney(!hideMoney); }, 550);
  });
  hero.addEventListener('pointermove', function(e) { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(ev) { hero.addEventListener(ev, cancel); });
  hero.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  if (eye) {
    var reveal = function(e) { e.preventDefault(); e.stopPropagation(); setHideMoney(false); };
    eye.addEventListener('click', reveal);
    eye.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') reveal(e); });
  }
})();

document.querySelectorAll('.hero-stat').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (heroLongPressed) { heroLongPressed = false; return; }
    showAvailable = !showAvailable;
    localStorage.setItem('alenjo_show_available', showAvailable ? 'true' : 'false');
    var pref = $('#pref-after-pending');
    if (pref) pref.checked = !showAvailable;
    if (cachedAccounts) { renderAccounts(cachedAccounts); renderHomeInsights(); }
    showToast(showAvailable ? 'Posted balances only' : 'Including pending charges');
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
  if (a.type === 'loan') return 'Loans';
  if (a.subtype === 'savings') return 'Savings';
  return 'Banks';
}
var EYE_ON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
var EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function renderAccountOrderList() {
  var list = $('#account-order-list');
  if (!list) return;
  if (!cachedAccounts || !cachedAccounts.length) { list.innerHTML = '<p class="set-empty">No accounts yet</p>'; return; }
  var groups = {};
  cachedAccounts.forEach(function(a) { if (!a.closed_at) (groups[accountKind(a)] = groups[accountKind(a)] || []).push(a); });
  var html = '';
  ['Banks', 'Credit cards', 'Savings', 'Investments', 'Loans'].forEach(function(kind) {
    var items = (groups[kind] || []).slice().sort(function(x, y) {
      var ox = x.sort_order == null ? 1e9 : x.sort_order, oy = y.sort_order == null ? 1e9 : y.sort_order;
      return ox - oy || Math.abs(getDisplayBalance(y, 'bank').amount) - Math.abs(getDisplayBalance(x, 'bank').amount);
    });
    if (!items.length) return;
    var hiddenCount = items.filter(function(a) { return a.is_hidden; }).length;
    html += '<details class="acct-order-sec" data-kind="' + kind + '"' + (acctOrderOpen[kind] ? ' open' : '') + '><summary class="acct-order-kind"><span>' + kind + '</span><span class="acct-order-count">' + items.length + (hiddenCount ? ' · ' + hiddenCount + ' hidden' : '') + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></summary><div class="acct-order-group" data-kind="' + kind + '">';
    items.forEach(function(a) {
      var name = (a.nickname || a.name || 'Account').replace(/\s*[*•]+\s*\d{2,4}\s*$/, '');
      html += '<div class="acct-order-row' + (a.is_hidden ? ' is-hidden' : '') + '" data-id="' + esc(a.id) + '">' +
        '<button type="button" class="acct-eye" data-toggle-hide aria-pressed="' + !a.is_hidden + '" aria-label="' + (a.is_hidden ? 'Show ' : 'Hide ') + esc(name) + '">' + (a.is_hidden ? EYE_OFF : EYE_ON) + '</button>' +
        '<span class="acct-order-name"><span>' + esc(name) + '</span><span class="set-hint">' + esc([a.institution, a.mask ? shownMask(a.mask) : ''].filter(Boolean).join(' · ')) + (a.is_hidden ? ' · hidden' : a.exclude_from_totals ? ' · not in totals' : '') + '</span></span>' +
        (items.length > 1 ? '<span class="acct-handle" role="button" tabindex="0" aria-label="Reorder ' + esc(name) + '. Use arrow keys to move."><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h16M4 12h16M4 16h16"/></svg></span>' : '') +
      '</div>';
    });
    html += '</div>';
    if (items.length > 1) {
      var custom = items.some(function(a) { return a.sort_order != null; });
      html += '<div class="acct-order-foot"><span>' + (custom ? 'Your order' : 'Largest balance first') + '</span>' +
        (custom ? '<button type="button" class="acct-order-reset" data-reset-order="' + kind + '">Sort by balance</button>' : '') + '</div>';
    }
    html += '</details>';
  });
  list.innerHTML = html;
}
var acctOrderOpen = {};
document.addEventListener('toggle', function(e) {
  var d = e.target;
  if (d.classList && d.classList.contains('acct-order-sec')) acctOrderOpen[d.dataset.kind] = d.open;
}, true);
function saveGroupOrder(group) {
  Array.prototype.forEach.call(group.querySelectorAll('.acct-order-row'), function(r, i) {
    var a = cachedAccounts.find(function(x) { return x.id === r.dataset.id; });
    if (a && a.sort_order !== i) {
      a.sort_order = i;
      sb.from('accounts').update({ sort_order: i }).eq('id', a.id).then(function(res) { if (res.error) showToast('Could not save order'); });
    }
  });
  renderAccounts(cachedAccounts);
}
var accountOrderList = $('#account-order-list');
if (accountOrderList) {
  accountOrderList.addEventListener('click', function(e) {
    var reset = e.target.closest('[data-reset-order]');
    if (reset) {
      // Back to automatic: clear the saved order so the group sorts by balance again
      cachedAccounts.forEach(function(a) {
        if (accountKind(a) !== reset.dataset.resetOrder || a.sort_order == null) return;
        a.sort_order = null;
        sb.from('accounts').update({ sort_order: null }).eq('id', a.id).then(function(res) { if (res.error) showToast('Could not save order'); });
      });
      renderAccountOrderList();
      renderAccounts(cachedAccounts);
      return;
    }
    var btn = e.target.closest('[data-toggle-hide]');
    if (!btn) return;
    var acct = cachedAccounts.find(function(a) { return a.id === btn.closest('.acct-order-row').dataset.id; });
    if (!acct) return;
    acct.is_hidden = !acct.is_hidden;
    sb.from('accounts').update({ is_hidden: acct.is_hidden }).eq('id', acct.id).then(function(r) { if (r.error) showToast('Could not save'); });
    renderAccountOrderList();
    renderAccounts(cachedAccounts);
  });
  // Drag the handle to reorder within its group (iOS-style)
  var drag = null;
  accountOrderList.addEventListener('pointerdown', function(e) {
    var handle = e.target.closest('.acct-handle');
    if (!handle) return;
    e.preventDefault();
    var row = handle.closest('.acct-order-row'), group = row.parentNode;
    var r = row.getBoundingClientRect();
    drag = { row: row, group: group, startY: e.clientY, offset: 0, h: r.height, moved: false };
    row.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  accountOrderList.addEventListener('pointermove', function(e) {
    if (!drag) return;
    var dy = e.clientY - drag.startY;
    var row = drag.row;
    // Swap with a neighbour once we pass half its height
    var prev = row.previousElementSibling, next = row.nextElementSibling;
    if (dy > drag.h / 2 && next) { drag.group.insertBefore(next, row); drag.startY += drag.h; dy -= drag.h; drag.moved = true; }
    else if (dy < -drag.h / 2 && prev) { drag.group.insertBefore(row, prev); drag.startY -= drag.h; dy += drag.h; drag.moved = true; }
    row.style.transform = 'translateY(' + dy + 'px)';
  });
  var endDrag = function() {
    if (!drag) return;
    drag.row.classList.remove('dragging');
    drag.row.style.transform = '';
    if (drag.moved) saveGroupOrder(drag.group);
    drag = null;
  };
  accountOrderList.addEventListener('pointerup', endDrag);
  accountOrderList.addEventListener('pointercancel', endDrag);
  // Keyboard: arrow keys on the handle
  accountOrderList.addEventListener('keydown', function(e) {
    var handle = e.target.closest('.acct-handle');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    var row = handle.closest('.acct-order-row'), group = row.parentNode;
    if (e.key === 'ArrowUp' && row.previousElementSibling) group.insertBefore(row, row.previousElementSibling);
    else if (e.key === 'ArrowDown' && row.nextElementSibling) group.insertBefore(row.nextElementSibling, row);
    else return;
    handle.focus();
    saveGroupOrder(group);
  });
}

var prefAutoFaceId = $('#pref-auto-faceid');
if (prefAutoFaceId) {
  prefAutoFaceId.checked = autoFaceIdEnabled();
  prefAutoFaceId.addEventListener('change', function() {
    try { localStorage.setItem('alenjo_auto_faceid', this.checked ? 'true' : 'false'); } catch (e) {}
  });
}

// Delete account (like GitHub): your password plus typing the exact sentence
(function wireDeleteAccount() {
  var open = $('#btn-delete-account'), sheet = $('#delete-sheet');
  if (!open || !sheet) return;
  var pw = $('#delete-password'), conf = $('#delete-confirm'), submit = $('#delete-submit'), err = $('#delete-error');
  var PHRASE = 'i want to delete my account';
  function typed() { return conf.value.trim().replace(/\s+/g, ' ').toLowerCase(); }
  function ready() { submit.disabled = !(pw.value && typed() === PHRASE); }
  function close() { $('#budget-copy').dataset.confirm = ''; sheet.classList.remove('visible'); sheet.setAttribute('aria-hidden', 'true'); pw.value = ''; conf.value = ''; err.hidden = true; ready(); }
  open.addEventListener('click', function() { sheet.classList.add('visible'); sheet.setAttribute('aria-hidden', 'false'); setTimeout(function() { pw.focus(); }, 200); });
  $('#delete-cancel').addEventListener('click', close);
  sheet.addEventListener('click', function(e) { if (e.target === sheet) close(); });
  pw.addEventListener('input', ready); conf.addEventListener('input', ready);
  $('#delete-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (submit.disabled || !currentUser) return;
    err.hidden = true; submit.disabled = true; submit.textContent = 'Deleting…';
    try {
      // Make sure it's really you before deleting anything
      // (checked on a separate client so your signed-in, two-step session isn't replaced)
      var checker = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'alenjo-pw-check' } });
      var check = await checker.auth.signInWithPassword({ email: currentUser.email, password: pw.value });
      if (check.error) throw new Error('That password isn’t right.');
      checker.auth.signOut({ scope: 'local' }).catch(function() {});
      var session = (await sb.auth.getSession()).data.session;
      var res = await fetch(SUPABASE_URL + '/functions/v1/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ confirm: conf.value })
      });
      var data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.deleted) throw new Error('Something went wrong and nothing was deleted. Try again.');
      // Forget this device's saved email, name and settings too
      try { Object.keys(localStorage).forEach(function(k) { if (k.indexOf('alenjo_') === 0) localStorage.removeItem(k); }); } catch (x) {}
      await sb.auth.signOut({ scope: 'local' });
      location.replace('/?deleted=1');
    } catch (x) {
      err.textContent = x.message; err.hidden = false;
      submit.textContent = 'Delete this account'; ready();
    }
  });
})();

var signOutBtn = $('#btn-sign-out');
if (signOutBtn) signOutBtn.addEventListener('click', function() {
  markSignedOut();
  clearTrusted();
  sb.auth.signOut({ scope: 'local' });
});

var prefAfterPending = $('#pref-after-pending');
if (prefAfterPending) {
  prefAfterPending.checked = !showAvailable;
  prefAfterPending.addEventListener('change', function() {
    showAvailable = !this.checked;
    localStorage.setItem('alenjo_show_available', showAvailable ? 'true' : 'false');
    if (cachedAccounts) { renderAccounts(cachedAccounts); renderHomeInsights(); }
  });
}

// ============================================
// APPEARANCE (light / dark / adaptive)
// Adaptive: dark from sunset until 6am. Helpers live in index.html (AlenjoTime).
// ============================================
var AT = window.AlenjoTime;
function getThemePref() { return AT.pref(); }
function fmtClock(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function applyTheme() {
  var pref = getThemePref(), dark = AT.isDark(pref);
  if (document.documentElement.getAttribute('data-theme') !== (dark ? 'dark' : 'light')) document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1C1B17' : '#E6E2D8');
  document.querySelectorAll('[data-theme-choice]').forEach(function(b) {
    b.setAttribute('aria-pressed', b.dataset.themeChoice === pref ? 'true' : 'false');
  });
  var note = $('#theme-note');
  if (note) {
    if (pref !== 'adaptive') { note.hidden = true; }
    else {
      var p = AT.place(), set = AT.sunset(new Date(), p.lat, p.lon);
      note.hidden = false;
      note.innerHTML = 'Dark from sunset (' + esc(fmtClock(set)) + ' today) until 6:00 AM.' +
        (p.guessed ? ' <button type="button" class="theme-loc" id="theme-loc">Use my location for exact sunset</button>' : '');
    }
  }
}
// One rough location (about 10 km), only if you ask for exact sunset. Never sent anywhere.
document.addEventListener('click', function(e) {
  if (!e.target.closest('#theme-loc') || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(function(pos) {
    try { localStorage.setItem('alenjo_place', JSON.stringify({ lat: Math.round(pos.coords.latitude * 10) / 10, lon: Math.round(pos.coords.longitude * 10) / 10 })); } catch (err) {}
    applyTheme();
  }, function() {}, { maximumAge: 86400000, timeout: 15000 });
});
document.querySelectorAll('[data-theme-choice]').forEach(function(b) {
  b.addEventListener('click', function() {
    try { localStorage.setItem('alenjo_theme', b.dataset.themeChoice); } catch (e) {}
    applyTheme();
  });
});
applyTheme();

// ============================================
// NOTIFICATIONS (Web Push)
// New purchases and deposits, sent by the server when Plaid finds them.
// Works from the Home Screen app on iPhone (iOS 16.4+) and in desktop browsers.
// ============================================
var PUSH_PUBLIC_KEY = 'BLmR6kVCiyDOlbY0NjFOO5iXtSGNnZbtZkPTVQv3NZbYKscwfxtHSSnTFPvUw5HqHZj9H7mmaKuiuAYivbHqDv0';
var pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
var isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
var swReady = pushSupported ? navigator.serviceWorker.register('/sw.js').then(function() { return navigator.serviceWorker.ready; }).catch(function(e) { console.error('SW register failed', e); return null; }) : Promise.resolve(null);

// Tapping a notification: open the tab it points to
function tabFromUrl(u) { try { return new URL(u, location.origin).searchParams.get('tab'); } catch (e) { return null; } }
(function() {
  var t = tabFromUrl(location.href);
  if (t === 'transactions' || t === 'snapshot') { try { localStorage.setItem('alenjo_active_tab', t); } catch (e) {} }
  if (t) history.replaceState(null, '', location.pathname);
})();
if (pushSupported) navigator.serviceWorker.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'alenjo-open') return;
  var t = tabFromUrl(e.data.url);
  if (!t) return;
  if (t === 'transactions' || t === 'snapshot') { try { localStorage.setItem('alenjo_active_tab', t); } catch (x) {} }
  if (currentUser && !appLocked && $('#screen-app').classList.contains('active')) {
    if (t === 'transactions') { switchTab('transactions'); loadTransactions(); } else switchTab(t);
  }
});

function b64uToBytes(s) {
  var b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, function(c) { return c.charCodeAt(0); });
}
function deviceLabel() {
  var ua = navigator.userAgent;
  var d = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Browser';
  var b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Safari';
  return (d === 'iPhone' || d === 'iPad') && isStandalone ? d : d + ' · ' + b;
}
async function currentSubscription() {
  var reg = await swReady;
  return reg ? reg.pushManager.getSubscription() : null;
}
// A subscription made with an older server key can't receive pushes anymore
function subUsesCurrentKey(sub) {
  var k = sub && sub.options && sub.options.applicationServerKey;
  if (!k) return true;
  var a = new Uint8Array(k), b = b64uToBytes(PUSH_PUBLIC_KEY);
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
async function dropStaleSubscription(sub) {
  try { await sb.from('push_devices').delete().eq('endpoint', sub.endpoint); } catch (e) {}
  try { await sub.unsubscribe(); } catch (e) {}
}
async function subscribeAndRegister(reg) {
  var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(PUSH_PUBLIC_KEY) });
  var j = sub.toJSON();
  var r = await sb.rpc('register_push_device', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: deviceLabel() });
  if (r.error) throw r.error;
  return j;
}
// After a server key change, quietly move this device to the new key on open.
// If the browser wants a tap first, Settings shows "Turn on for this device" again.
async function refreshStalePush() {
  try {
    if (!pushSupported || Notification.permission !== 'granted') return;
    var reg = await swReady;
    var sub = reg && await reg.pushManager.getSubscription();
    if (!sub || subUsesCurrentKey(sub)) return;
    await dropStaleSubscription(sub);
    await subscribeAndRegister(reg);
  } catch (e) { console.warn('Push refresh needs a tap in Settings', e); }
}

var notifSettings = null;
var NOTIF_CACHE = 'alenjo_notif_settings';
function cachedNotifSettings() {
  if (notifSettings) return notifSettings;
  try { return JSON.parse(localStorage.getItem(NOTIF_CACHE) || 'null'); } catch (e) { return null; }
}
// Set the switches without their slide animation, so opening Settings never shows them flip
function paintNotifSettings(s) {
  var opts = $('#notif-options');
  opts.classList.add('no-anim');
  $('#notif-purchases').checked = !!s.purchases;
  $('#notif-deposits').checked = !!s.deposits;
  $('#notif-bills').checked = s.bills !== false;
  $('#notif-quiet').checked = !!s.quiet;
  if (document.activeElement !== $('#notif-min')) $('#notif-min').value = Number(s.min_amount) ? String(+s.min_amount) : '';
  void opts.offsetWidth;
  requestAnimationFrame(function() { requestAnimationFrame(function() { opts.classList.remove('no-anim'); }); });
}
// Settings paints the notifications card from the last known state right away,
// then checks the server (all at once) and only touches what actually changed.
var notifRenderSeq = 0, notifDevicesHtml = null;
function notifViewKey() { return 'alenjo_notif_view_' + (currentUser ? currentUser.id : ''); }
function applyNotifView(v) {
  var status = $('#notif-status'), enable = $('#notif-enable'), opts = $('#notif-options'), list = $('#notif-devices');
  if (status.textContent !== v.status) status.textContent = v.status;
  if (enable.hidden !== v.enableHidden) enable.hidden = v.enableHidden;
  if (opts.hidden !== v.optsHidden) opts.hidden = v.optsHidden;
  if (notifDevicesHtml !== v.devicesHtml) { list.innerHTML = v.devicesHtml; notifDevicesHtml = v.devicesHtml; }
}
async function renderNotifications() {
  if (!currentUser) return;
  var status = $('#notif-status'), enable = $('#notif-enable'), opts = $('#notif-options');
  if (!status) return;
  if (!pushSupported) {
    enable.hidden = true; opts.hidden = true;
    status.textContent = isIOS && !isStandalone
      ? 'To turn these on, add Alenjo to your Home Screen (Share → Add to Home Screen) and open it from there.'
      : 'This browser can’t show notifications.';
    return;
  }
  var seq = ++notifRenderSeq;
  var cached = cachedNotifSettings();
  if (cached) paintNotifSettings(cached);
  try { var savedView = JSON.parse(localStorage.getItem(notifViewKey()) || 'null'); if (savedView) applyNotifView(savedView); } catch (e) {}

  var results = await Promise.all([
    currentSubscription().catch(function() { return null; }),
    sb.from('push_devices').select('id, endpoint, label, created_at, last_success_at').order('created_at'),
    sb.from('notification_settings').select('*').maybeSingle(),
  ]);
  if (seq !== notifRenderSeq) return;            // a newer refresh is already running
  var sub = results[0], res = results[1], st = results[2];
  if (res.error || st.error) return;             // offline or hiccup: keep what's on screen
  var devices = res.data || [];
  if (sub && !subUsesCurrentKey(sub)) sub = null;
  var here = !!(sub && devices.some(function(d) { return d.endpoint === sub.endpoint; }));
  var view = { optsHidden: devices.length === 0 };
  if (Notification.permission === 'denied') {
    view.status = isIOS ? 'Notifications are blocked for Alenjo. Turn them on in iPhone Settings → Notifications → Alenjo, then come back here.' : 'Notifications are blocked for this site in your browser settings.';
    view.enableHidden = true;
  } else {
    view.status = here ? 'On for this ' + (deviceLabel().split(' ·')[0].replace('Browser', 'device')) + '. Works even when Alenjo is closed.' : 'Get a heads-up when something new shows up in Activity.';
    view.enableHidden = here;
  }
  view.devicesHtml = devices.map(function(d) {
    var mine = sub && d.endpoint === sub.endpoint;
    var when = new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return '<div class="notif-device"><span class="set-row-text"><span>' + esc(d.label || 'Device') + '</span><span class="set-hint">' + (mine ? 'This device' : 'Added ' + esc(when)) + '</span></span>' +
      '<span class="notif-device-actions">' + (mine ? '<button type="button" class="notif-test" data-test-device="1">Test</button>' : '') +
      '<button type="button" class="notif-remove" data-remove-device="' + esc(d.id) + '"' + (mine ? ' data-mine="1"' : '') + '>Remove</button></span></div>';
  }).join('');
  notifSettingsLoaded = true;
  notifSettings = st.data || { purchases: true, deposits: true, bills: true, min_amount: 0, quiet: true };
  try {
    localStorage.setItem(NOTIF_CACHE, JSON.stringify(notifSettings));
    localStorage.setItem(notifViewKey(), JSON.stringify(view));
  } catch (e) {}
  paintNotifSettings(notifSettings);
  applyNotifView(view);
}

async function saveNotifSettings(patch) {
  if (!currentUser) return;
  notifSettings = Object.assign({}, notifSettings || {}, patch);
  try { localStorage.setItem(NOTIF_CACHE, JSON.stringify(notifSettings)); } catch (e) {}
  var tz = 'America/New_York';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
  var row = Object.assign({ user_id: currentUser.id, tz: tz, updated_at: new Date().toISOString() }, patch);
  var r = await sb.from('notification_settings').upsert(row, { onConflict: 'user_id' });
  if (r.error) { showToast('Couldn’t save that. Try again.'); renderNotifications(); }
}

async function sendTestPush(endpoint) {
  var session = (await sb.auth.getSession()).data.session;
  var r = await fetch(SUPABASE_URL + '/functions/v1/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ action: 'test', endpoint: endpoint })
  });
  return r.json().catch(function() { return {}; });
}

(function wireNotifications() {
  var enable = $('#notif-enable');
  if (!enable) return;
  enable.addEventListener('click', async function() {
    var btn = this;
    // iOS only shows the permission prompt straight from a tap, so ask first
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') { renderNotifications(); return; }
    btn.disabled = true; btn.textContent = 'Turning on…';
    try {
      var reg = await swReady;
      if (!reg) throw new Error('no service worker');
      var existing = await reg.pushManager.getSubscription();
      if (existing && !subUsesCurrentKey(existing)) { await dropStaleSubscription(existing); existing = null; }
      var j;
      if (existing) {
        j = existing.toJSON();
        var r = await sb.rpc('register_push_device', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: deviceLabel() });
        if (r.error) throw r.error;
      } else {
        j = await subscribeAndRegister(reg);
      }
      await saveNotifSettings({});
      sendTestPush(j.endpoint);
      showToast('Notifications are on');
    } catch (e) {
      console.error('Enable notifications failed', e);
      showToast('Couldn’t turn on notifications. Try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Turn on for this device';
      renderNotifications();
    }
  });
  $('#notif-purchases').addEventListener('change', function() { saveNotifSettings({ purchases: this.checked }); });
  $('#notif-deposits').addEventListener('change', function() { saveNotifSettings({ deposits: this.checked }); });
  $('#notif-bills').addEventListener('change', function() { saveNotifSettings({ bills: this.checked }); });
  $('#notif-quiet').addEventListener('change', function() { saveNotifSettings({ quiet: this.checked }); });
  $('#notif-min').addEventListener('change', function() {
    var v = parseFloat(String(this.value).replace(/[^0-9.]/g, ''));
    if (!isFinite(v) || v < 0) v = 0;
    v = Math.round(v * 100) / 100;
    this.value = v ? String(v) : '';
    saveNotifSettings({ min_amount: v });
  });
  async function testThisDevice(btn) {
    btn.disabled = true;
    var sub = await currentSubscription();
    var r = await sendTestPush(sub ? sub.endpoint : undefined);
    btn.disabled = false;
    showToast(r.sent ? 'Sent. Check your notifications.' : 'Couldn’t send. Try removing this device and turning it on again.');
  }
  $('#notif-devices').addEventListener('click', async function(e) {
    var t = e.target.closest('[data-test-device]');
    if (t) { testThisDevice(t); return; }
    var b = e.target.closest('[data-remove-device]');
    if (!b) return;
    b.disabled = true;
    await sb.from('push_devices').delete().eq('id', b.dataset.removeDevice);
    if (b.dataset.mine) { try { var s = await currentSubscription(); if (s) await s.unsubscribe(); } catch (x) {} }
    renderNotifications();
  });
})();

// Personal greeting on the sign-in screen
function renderLoginGreeting() {
  if (resettingPassword) return;   // keep "Choose a new password"
  var name = '';
  try { name = localStorage.getItem('alenjo_last_name') || ''; } catch (e) {}
  var g = document.getElementById('login-greeting');
  if (g) g.textContent = name ? AT.greeting() + ', ' + name.split(' ')[0] : 'Welcome back';
  var sub = document.getElementById('login-subtitle');
  var since = '';
  try { since = localStorage.getItem('alenjo_since') || ''; } catch (e) {}
  if (sub && name && since) sub.textContent = 'Using Alenjo since ' + since;
}
renderLoginGreeting();
// The app can sit open in the background for hours: refresh the greeting and the
// Adaptive theme whenever it comes back, and once a minute while it's open.
function refreshTimeOfDay() { applyTheme(); renderLoginGreeting(); }
document.addEventListener('visibilitychange', function() { if (!document.hidden) refreshTimeOfDay(); });
window.addEventListener('pageshow', refreshTimeOfDay);
setInterval(function() { if (!document.hidden) applyTheme(); }, 60000);

// ============================================
// PLAID LINK
// ============================================
// Plaid's duplicate check compares the accounts you picked (name and last 4) with ones you already have
function dupeAccounts(metadata) {
  return ((metadata && metadata.accounts) || []).map(function(x) { return { name: x.name || null, mask: x.mask || null }; });
}
// After you finish Plaid's sign-in for a new bank (also used when returning from a bank's own site)
async function finishNewConnection(headers, publicToken, metadata) {
  showLoading(true);

  // Check for duplicate institution before exchanging token (per Plaid docs)
  var dupeCheck = await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      action: 'check_duplicate',
      institution: metadata.institution,
      accounts: dupeAccounts(metadata)
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
      institution: metadata.institution,
      accounts: dupeAccounts(metadata)
    })
  });
  var exchangeData = await exchangeRes.json();
  if (exchangeData.error === 'duplicate' || exchangeData.error === 'limit') {
    showError(exchangeData.message || 'This institution is already connected.');
    showLoading(false);
    return;
  }
  if (!exchangeRes.ok) {
    showError('Couldn’t finish connecting. Try again.');
    showLoading(false);
    return;
  }
  await loadAccounts();
  showLoading(false);
}

// Plaid docs: reopen Link with the same Link token (kept on the server for you) and the
// full address Plaid sent you back to, then finish whatever you were doing.
async function resumePlaidOAuth() {
  var received = null;
  try { received = sessionStorage.getItem('alenjo_oauth_return'); sessionStorage.removeItem('alenjo_oauth_return'); } catch (e) {}
  if (!received || typeof Plaid === 'undefined') return;
  try {
    var session = (await sb.auth.getSession()).data.session;
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY };
    var res = await fetch(SUPABASE_URL + '/functions/v1/plaid-link', { method: 'POST', headers: headers, body: JSON.stringify({ action: 'resume_link' }) });
    var data = await res.json();
    if (!res.ok || !data.link_token) { showError('Your bank sign-in timed out. Try connecting again.'); return; }
    var handler = plaidCreate({
      token: data.link_token,
      receivedRedirectUri: received,
      onSuccess: function(publicToken, metadata) {
        if (data.kind === 'reconnect' || data.kind === 'consent') return finishReconnect(data.item_id, headers);
        if (data.kind === 'add_accounts') return finishAddAccounts(data.item_id, headers);
        return finishNewConnection(headers, publicToken, metadata);
      },
      onExit: function(err) { showLoading(false); if (err) showError('Connection didn’t finish: ' + (err.display_message || err.error_message || 'try again.')); }
    });
    handler.open();
  } catch (e) {
    showError('Couldn’t finish connecting your bank. Try again.');
  }
}

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

    var handler = plaidCreate({
      token: data.link_token,
      onSuccess: function(publicToken, metadata) { return finishNewConnection(headers, publicToken, metadata); },
      onExit: function(err, meta) {
        showLoading(false);
        if (err) console.error('Plaid Link exit', err.error_type, err.error_code, meta && meta.link_session_id);
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
  loadItemHealth();

  loadingAccounts = false;
}

// ============================================
// BANK CONNECTION HEALTH (needs sign-in again, access expiring)
// ============================================
var itemHealth = {};   // plaid_item_id -> { error_code, consent_expires_at }
async function loadItemHealth() {
  var r = await sb.from('plaid_items').select('id, error_code, consent_expires_at, notice_code').eq('status', 'active');
  itemHealth = {};
  if (r.data) r.data.forEach(function(i) { itemHealth[i.id] = i; });
  renderBankAlerts();
  if (typeof renderAccountsSettings === 'function' && cachedAccounts) renderAccountsSettings();
}
function institutionForItem(itemId) {
  var a = (cachedAccounts || []).find(function(x) { return x.plaid_item_id === itemId; });
  return (a && a.institution) || 'A bank';
}
// What (if anything) a connection needs from you
function itemAttention(itemId) {
  var h = itemHealth[itemId];
  if (!h) return null;
  if (h.error_code) {
    var why = h.error_code === 'ITEM_LOGIN_REQUIRED' || h.error_code === 'INVALID_CREDENTIALS' ? 'needs you to sign in again'
      : h.error_code === 'PENDING_EXPIRATION' || h.error_code === 'ACCESS_NOT_GRANTED' || h.error_code === 'CONSENT_EXPIRED' ? 'needs your permission again'
      : h.error_code === 'INSTITUTION_DOWN' || h.error_code === 'INSTITUTION_NOT_RESPONDING' ? 'isn’t responding right now'
      : 'stopped syncing';
    return { level: 'error', text: why, canReconnect: !/^INSTITUTION_/.test(h.error_code) };
  }
  // Alerts Plaid sent about this bank
  if (h.notice_code === 'USER_PERMISSION_REVOKED' || h.notice_code === 'USER_ACCOUNT_REVOKED') return { level: 'error', text: 'lost permission to share your data', canReconnect: true };
  if (h.notice_code === 'PENDING_DISCONNECT' || h.notice_code === 'PENDING_EXPIRATION') return { level: 'warn', text: 'will disconnect within 7 days unless you reconnect', canReconnect: true };
  if (h.notice_code === 'NEW_ACCOUNTS_AVAILABLE') return { level: 'warn', text: 'has new accounts you can add', canAdd: true };
  if (h.consent_expires_at) {
    var days = Math.ceil((new Date(h.consent_expires_at) - new Date()) / 86400000);
    if (days <= 14) return { level: 'warn', text: days <= 0 ? 'access expired' : 'access expires in ' + days + ' day' + (days === 1 ? '' : 's'), canReconnect: true };
  }
  return null;
}
function clearItemNotice(itemId, headers) {
  if (!itemHealth[itemId] || !itemHealth[itemId].notice_code) return;
  itemHealth[itemId].notice_code = null;
  fetch(SUPABASE_URL + '/functions/v1/plaid-link', { method: 'POST', headers: headers, body: JSON.stringify({ action: 'clear_notice', item_id: itemId }) }).catch(function() {});
}
function renderBankAlerts() {
  var box = $('#bank-alerts');
  if (!box) return;
  var html = '';
  Object.keys(itemHealth).forEach(function(id) {
    var att = itemAttention(id);
    if (!att) return;
    html += '<div class="bank-alert ' + att.level + '" role="status"><span class="bank-alert-dot" aria-hidden="true"></span>' +
      '<span class="bank-alert-text"><b>' + esc(institutionForItem(id)) + '</b> ' + esc(att.text) + (att.level === 'error' ? '. Balances and transactions from it aren’t updating.' : '.') + '</span>' +
      (att.canReconnect ? '<button type="button" class="bank-alert-btn" data-reconnect="' + esc(id) + '">Reconnect</button>' : '') +
      (att.canAdd ? '<button type="button" class="bank-alert-btn btn-add-card-inst" data-item="' + esc(id) + '">Add</button>' : '') + '</div>';
  });
  box.innerHTML = html;
  box.hidden = !html;
}
async function finishReconnect(itemId, headers) {
  showToast('Reconnected. Catching up…');
  if (itemHealth[itemId]) { itemHealth[itemId].error_code = null; itemHealth[itemId].consent_expires_at = null; itemHealth[itemId].notice_code = null; }
  clearItemNotice(itemId, headers);
  renderBankAlerts();
  localStorage.setItem('alenjo_last_tx_sync', String(Date.now()));
  await backgroundSync();
  await loadItemHealth();
  if ($('#tx-month-filter') && typeof loadTransactions === 'function') { try { await loadTransactions(); } catch (e) {} }
}
// ---- Two-step sign-in (authenticator app codes, enforced by the server once on) ----
var mfaFactor = null, mfaPending = null;
async function refreshMfaStatus() {
  var btn = $('#btn-mfa-toggle'), st = $('#mfa-status');
  if (!btn) return;
  try {
    var f = await sb.auth.mfa.listFactors();
    mfaFactor = (f.data && f.data.totp && f.data.totp.find(function(x) { return x.status === 'verified'; })) || null;
  } catch (e) { mfaFactor = null; }
  st.textContent = mfaFactor ? 'On · Alenjo asks for a code after your password' : 'Off · a code from an authenticator app after your password';
  btn.textContent = mfaFactor ? 'Turn off' : 'Turn on';
}
function closeMfaEnroll() { $('#mfa-enroll').hidden = true; $('#mfa-enroll-code').value = ''; $('#mfa-enroll-error').hidden = true; }
$('#btn-mfa-toggle').addEventListener('click', async function() {
  var btn = this;
  if (mfaFactor) {
    if (!btn._armed) {
      btn._armed = true; btn.textContent = 'Tap again to turn off';
      setTimeout(function() { btn._armed = false; refreshMfaStatus(); }, 3000);
      return;
    }
    btn._armed = false;
    var r = await sb.auth.mfa.unenroll({ factorId: mfaFactor.id });
    if (r.error) showToast('Couldn’t turn it off. Try again.'); else { clearTrusted(); showToast('Two-step sign-in is off'); }
    refreshMfaStatus();
    return;
  }
  btn.disabled = true;
  try {
    // Clear any half-finished setup first
    var f = await sb.auth.mfa.listFactors();
    var all = (f.data && f.data.all) || [];
    for (var i = 0; i < all.length; i++) if (all[i].status !== 'verified') await sb.auth.mfa.unenroll({ factorId: all[i].id });
    var r = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + Date.now(), issuer: 'Alenjo' });
    if (r.error) throw r.error;
    mfaPending = r.data;
    $('#mfa-qr').src = r.data.totp.qr_code;
    $('#mfa-secret').textContent = r.data.totp.secret;
    $('#mfa-otpauth').href = r.data.totp.uri;
    $('#mfa-enroll').hidden = false;
  } catch (e) {
    showToast('Couldn’t start setup. Try again.');
  } finally { btn.disabled = false; }
});
$('#mfa-enroll-verify').addEventListener('click', async function() {
  var code = $('#mfa-enroll-code').value.replace(/\D/g, ''), err = $('#mfa-enroll-error');
  if (!mfaPending || code.length !== 6) { err.textContent = 'Enter the 6-digit code'; err.hidden = false; return; }
  var btn = this; btn.disabled = true;
  var v = await sb.auth.mfa.challengeAndVerify({ factorId: mfaPending.id, code: code });
  btn.disabled = false;
  if (v.error) { err.textContent = 'That code didn’t work. Try the newest one.'; err.hidden = false; return; }
  mfaPending = null;
  closeMfaEnroll();
  showToast('Two-step sign-in is on');
  refreshMfaStatus();
});
$('#mfa-enroll-cancel').addEventListener('click', async function() {
  if (mfaPending) { try { await sb.auth.mfa.unenroll({ factorId: mfaPending.id }); } catch (e) {} mfaPending = null; }
  closeMfaEnroll();
});
document.addEventListener('click', function(e) { var b = e.target.closest('[data-open-page="security"]'); if (b) refreshMfaStatus(); });
// Billing page: which of your banks already pay for cards and loans, and for investments, so you
// can see where adding one through Manage is free. Mirrors sync-transactions, which starts
// Liabilities for a bank with a card or loan and Investments for a bank with an investment account.
function renderBillingYours() {
  var box = $('#billing-yours');
  if (!box) return;
  var banks = {};
  (cachedAccounts || []).forEach(function(a) {
    if (a.closed_at || !a.plaid_item_id) return;
    var b = banks[a.plaid_item_id] = banks[a.plaid_item_id] || { name: a.institution || 'Bank', liab: false, inv: false };
    if (a.type === 'credit' || a.type === 'loan') b.liab = true;
    if (a.type === 'investment') b.inv = true;
  });
  var list = Object.keys(banks).map(function(k) { return banks[k]; }).sort(function(x, y) { return x.name.localeCompare(y.name); });
  if (!list.length) { box.hidden = true; return; }
  function names(arr) {
    var n = arr.map(function(b) { return b.name; });
    return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }
  function line(has, lacks, kind, price) {
    if (!lacks.length) return 'All your banks already pay for ' + kind + ', so adding more anywhere costs nothing.';
    if (!has.length) return 'None of your banks pay for ' + kind + ' yet. The first one at any bank adds ' + price + ' a month.';
    return names(has) + ' already ' + (has.length === 1 ? 'pays' : 'pay') + ' for ' + kind + ', so more there cost nothing. The first one at ' + names(lacks) + ' adds ' + price + ' a month.';
  }
  var liab = line(list.filter(function(b) { return b.liab; }), list.filter(function(b) { return !b.liab; }), 'cards and loans', '$0.20');
  var inv = line(list.filter(function(b) { return b.inv; }), list.filter(function(b) { return !b.inv; }), 'investments', '$0.18');
  box.innerHTML = '<b>Your banks</b><span><b>Cards and loans:</b> ' + esc(liab) + '</span><span><b>Investments:</b> ' + esc(inv) + '</span>';
  box.hidden = false;
}
document.addEventListener('click', function(e) { if (e.target.closest('[data-open-page="billing"]')) renderBillingYours(); });


// Plaid's own sign-in window for that bank. Same connection: history, splits, notes all stay.
async function reconnectItem(itemId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  try {
    var session = (await sb.auth.getSession()).data.session;
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY };
    var res = await fetch(SUPABASE_URL + '/functions/v1/plaid-link', { method: 'POST', headers: headers, body: JSON.stringify({ action: 'create_reconnect_token', item_id: itemId }) });
    var data = await res.json();
    if (!res.ok || !data.link_token) { showError('Couldn’t start reconnecting. Try again in a minute.'); return; }
    var handler = plaidCreate({
      token: data.link_token,
      onSuccess: function() { return finishReconnect(itemId, headers); },
      onExit: function(err) { if (err) showError('Reconnect didn’t finish: ' + (err.display_message || err.error_message || 'try again.')); }
    });
    handler.open();
  } catch (e) {
    showError('Couldn’t start reconnecting. ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Reconnect'; }
  }
}
document.addEventListener('click', function(e) {
  var b = e.target.closest('[data-reconnect]');
  if (b) { e.preventDefault(); reconnectItem(b.dataset.reconnect, b); }
});

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
      var dataStartStr = ymdLocal(await txWindowStart());
      var txResult = await fetchAllRows(function() { return sb.from('synced_transactions').select('*').gte('date', dataStartStr).order('date', { ascending: false }).order('id'); });
      if (!txResult.error && txResult.data) {
        txData = txResult.data;
        renderAccounts(cachedAccounts);
      }
    }

    loadItemHealth();
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

// Store logo for a transaction: Plaid's logo first, then logo.dev by the store's
// website, then logo.dev by the store's name (your rename or Plaid's merchant name).
// Transfers and deposits with no store behind them keep the letter.
var merchantLogos = {};   // store (bank name, lowercase) -> logo domain you picked

// ---- Your own logos: uploaded images with a name, found by the logo search ----
var customLogos = [];   // { id, name, storage_path, url }
function customLogoById(id) { for (var i = 0; i < customLogos.length; i++) if (customLogos[i].id === id) return customLogos[i]; return null; }
async function loadCustomLogos() {
  var r = await sb.from('custom_logos').select('id, name, storage_path, created_at').order('name');
  if (r.error) { console.error('custom logos load error', r.error); return; }
  customLogos = r.data || [];
  var paths = customLogos.map(function(l) { return l.storage_path; });
  if (paths.length) {
    var byPath = await signedUrls('logos', paths);
    customLogos.forEach(function(l) { l.url = byPath[l.storage_path] || null; });
  }
  renderCustomLogosSettings();
}
// Square 256px PNG, transparency kept, whole image visible
function logoImageToBlob(file) {
  return new Promise(function(resolve, reject) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function() {
      var S = 256, c = document.createElement('canvas'); c.width = S; c.height = S;
      var k = Math.min(S / img.naturalWidth, S / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
      c.getContext('2d').drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(function(b) { b ? resolve(b) : reject(new Error('convert')); }, 'image/png');
    };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('read')); };
    img.src = url;
  });
}
async function uploadCustomLogo(file, name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) throw new Error('name');
  var blob = file instanceof Blob && file.type === 'image/png' && file.__framed ? file : await logoImageToBlob(file);
  var path = currentUser.id + '/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '.png';
  var up = await sb.storage.from('logos').upload(path, blob, { contentType: 'image/png', cacheControl: IMG_CACHE });
  if (up.error) throw up.error;
  var ins = await sb.from('custom_logos').insert({ name: name, storage_path: path }).select('id, name, storage_path').single();
  if (ins.error) { sb.storage.from('logos').remove([path]); throw ins.error; }
  var logo = ins.data; logo.url = await signedUrl('logos', path);
  customLogos.push(logo);
  customLogos.sort(function(a, b) { return a.name.localeCompare(b.name); });
  renderCustomLogosSettings();
  return logo;
}
async function deleteCustomLogo(id) {
  var logo = customLogoById(id); if (!logo) return;
  customLogos = customLogos.filter(function(l) { return l.id !== id; });
  // Stores that used it go back to the automatic logo
  Object.keys(merchantLogos).forEach(function(k) { if (merchantLogos[k] === 'custom:' + id) delete merchantLogos[k]; });
  await sb.from('merchant_logos').delete().eq('domain', 'custom:' + id);
  await sb.from('custom_logos').delete().eq('id', id);
  sb.storage.from('logos').remove([logo.storage_path]);
  renderCustomLogosSettings();
  if (typeof renderTransactionMonth === 'function' && txData && txData.length) renderTransactionMonth();
}
function renderCustomLogosSettings() {
  var list = $('#custom-logos-list'), count = $('#custom-logos-count'), det = $('#custom-logos-details');
  if (!list) return;
  if (count) count.textContent = customLogos.length ? String(customLogos.length) : '';
  if (det) det.hidden = !customLogos.length;
  list.innerHTML = customLogos.map(function(l) {
    return '<div class="mylogo" data-id="' + esc(l.id) + '">' +
      '<span class="logo-img mine" data-i="' + esc(l.name.charAt(0).toUpperCase()) + '">' + (l.url ? '<img src="' + esc(l.url) + '" alt="">' : '') + '</span>' +
      '<input class="mylogo-name" value="' + esc(l.name) + '" maxlength="60" aria-label="Logo name" enterkeyhint="done">' +
      '<button type="button" class="mylogo-del" aria-label="Delete ' + esc(l.name) + '">Delete</button></div>';
  }).join('');
}
function merchantKey(tx) { return String(tx.merchant_name || tx.name || '').trim().toLowerCase().slice(0, 120); }
function logoByDomain(domain, size) { return 'https://img.logo.dev/' + encodeURIComponent(domain) + '?token=' + LOGO_KEY + '&size=' + (size || 64) + '&retina=true&format=png&fallback=404'; }
function txLogoUrl(tx, eff) {
  var q = '?token=' + LOGO_KEY + '&size=64&retina=true&format=png&fallback=404';
  // 1. A logo you picked for this store
  var picked = merchantLogos[merchantKey(tx)];
  if (picked === 'none') return null;   // you chose no logo: show the letter instead
  if (picked && picked.indexOf('custom:') === 0) { var mine = customLogoById(picked.slice(7)); return mine ? mine.url : null; }
  if (picked) return logoByDomain(picked);
  // 2. If you renamed it, look up the new name (so "Claude" gets Claude's logo)
  if (eff.nickname) return 'https://img.logo.dev/name/' + encodeURIComponent(eff.nickname.trim()) + q;
  // 3. Plaid's logo, 4. the store's website
  if (tx.enriched_logo_url) return tx.enriched_logo_url;
  var site = (tx.enriched_website || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0];
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(site)) return logoByDomain(site);
  // 5. The store's name ("To DISCOVER" → "DISCOVER"); skip things that aren't a store
  var name = (tx.merchant_name || (tx.name || '').replace(/^(to|from)\s+/i, '')).trim();
  if (!name || /^\d/.test(name) || /\b(personal|joint|savings|checking|brokerage|interest|payment|deposit|transfer|cash back)\b/i.test(name)) return null;
  return 'https://img.logo.dev/name/' + encodeURIComponent(name) + q;
}

function getLogoUrl(account) {
  var d = account.institution_logo_domain;
  // Only plain hostnames: this URL ends up inside a style attribute.
  if (!d || !/^[a-z0-9.-]+$/i.test(d)) return null;
  return 'https://img.logo.dev/' + encodeURIComponent(d) +
    '?token=' + LOGO_KEY + '&size=200&format=png&retina=true';
}

// ============================================
// BALANCE HELPERS
// ============================================
function getDisplayBalance(account, type) {
  var current = parseFloat(account.balance_current || 0);
  var available = account.balance_available != null ? parseFloat(account.balance_available) : null;
  var limit = account.balance_limit != null ? parseFloat(account.balance_limit) : null;
  // A loan's balance is what you owe; Plaid's "available" for loans is meaningless (often 0)
  if (type === 'loan' || account.type === 'loan') return { amount: current, label: 'Owed' };

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
  accounts = accounts.filter(function(a) { return !a.is_hidden && !a.closed_at; });
  var banks = accounts.filter(function(a) { return a.type === 'depository' && a.subtype !== 'savings'; });
  var savings = accounts.filter(function(a) { return a.type === 'depository' && a.subtype === 'savings'; });
  var credits = accounts.filter(function(a) { return a.type === 'credit'; });
  var investments = accounts.filter(function(a) { return a.type === 'investment'; });
  var loans = accounts.filter(function(a) { return a.type === 'loan'; });

  // Snapshot tab: all account types
  var hasAnyAccounts = banks.length > 0 || credits.length > 0 || savings.length > 0 || investments.length > 0 || loans.length > 0;
  connectCta.hidden = hasAnyAccounts;
  sectionBanks.hidden = banks.length === 0;
  sectionCredit.hidden = credits.length === 0;
  $('#section-inv-savings').hidden = savings.length === 0;
  $('#section-inv-investments').hidden = investments.length === 0;
  $('#section-loans').hidden = loans.length === 0;

  renderSection(listBanks, banks, 'bank');
  var bankSum = banks.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
  banksTotal.textContent = formatSigned(bankSum);
  banksTotal.className = 'section-total ' + (bankSum >= 0 ? 'balance-positive' : 'balance-negative');

  renderSection(listCredit, credits, 'credit');
  var creditSum = credits.reduce(function(s, a) { return s + getDisplayBalance(a, 'credit').amount; }, 0);
  creditTotal.textContent = (creditSum < 0 ? '-' : '') + formatMoney(Math.abs(creditSum));
  creditTotal.className = 'section-total balance-positive';   // owing is normal, not an alarm: white

  if (credits.length > 0 && cachedLiabilities === null) {
    loadLiabilities().then(function() {
      renderSection(listCredit, credits, 'credit');
    });
  }

  // Loans: what you owe. Details (rate, next payment, payoff) come from the same liabilities sync as cards.
  renderSection($('#list-loans'), loans, 'loan');
  var loanSum = loans.reduce(function(s, a) { return s + Math.abs(getDisplayBalance(a, 'loan').amount); }, 0);
  $('#loans-total').textContent = formatMoney(loanSum);
  $('#loans-total').className = 'section-total balance-positive';
  if (loans.length > 0 && cachedLiabilities === null) {
    loadLiabilities().then(function() { renderSection($('#list-loans'), loans, 'loan'); });
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
      availEl.textContent = heroMoney(availableCash);
      if (hideMoney) requestAnimationFrame(alignMoneyEye);
      availEl.className = 'hero-stat-value ' + (availableCash >= 0 ? 'balance-positive' : 'balance-negative');
    }
  } else {
    netCashEl.hidden = true;
  }

  renderAccountsSettings();
  renderAccountOrderList();
  renderHomeInsights();
  if (hideMoney) requestAnimationFrame(alignMoneyEye);
}

// ============================================
// HOME INSIGHTS (30-day trend + this month's spending)
// ============================================
var lastAvailableCash = null;
// Home chart: Available, Assets and Liabilities rebuilt day by day by walking
// back through transactions from today's balances. Drag across it (like
// Robinhood) and the numbers above show that day.
var homeRange = parseInt(localStorage.getItem('alenjo_home_range') || '30', 10) || 30;
var homeSeries = null;
function heroMoney(v) { return (v < 0 && !hideMoney ? '-' : '') + formatMoney(Math.abs(v)); }
function renderHomeInsights() {
  var label = $('#home-trend-label'), chart = $('#home-chart'), ranges = $('#home-ranges');
  if (!label || !chart) return;
  renderBalanceSplit();
  if (!txData || !txData.length || lastAvailableCash === null || !cachedAccounts) {
    label.hidden = true; chart.hidden = true; ranges.hidden = true; homeSeries = null;
    return;
  }
  var kind = {}, assets = 0, liabs = 0;
  cachedAccounts.forEach(function(a) {
    if (a.is_hidden || a.exclude_from_totals || a.closed_at) return;
    if (a.type === 'credit') { liabs += Math.max(0, getDisplayBalance(a, 'credit').amount); if (a.plaid_account_id) kind[a.plaid_account_id] = 'credit'; }
    else if (a.type === 'loan') liabs += Math.abs(getDisplayBalance(a, 'loan').amount);
    else if (a.type === 'investment') assets += getInvestmentValue(a);
    else if (a.type === 'depository') { assets += Math.max(0, getDisplayBalance(a, 'bank').amount); if (a.plaid_account_id) kind[a.plaid_account_id] = a.subtype === 'savings' ? 'savings' : 'bank'; }
  });
  var dayKey = function(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var byDay = {}, earliest = null;
  txData.forEach(function(tx) {
    var k = kind[tx.plaid_account_id];
    if (!k || tx.pending) return;
    var o = byDay[tx.date] || (byDay[tx.date] = { bank: 0, savings: 0, credit: 0 });
    o[k] += parseFloat(tx.amount || 0);
    if (!earliest || tx.date < earliest) earliest = tx.date;
  });
  var today = new Date(); today.setHours(0, 0, 0, 0);
  // Never draw further back than the transactions we have
  var span = homeRange;
  if (earliest) {
    var p = earliest.split('-'), first = new Date(+p[0], +p[1] - 1, +p[2]);
    span = Math.max(1, Math.min(homeRange, Math.round((today - first) / 86400000)));
  }
  var pts = [], av = lastAvailableCash, as = assets, li = liabs;
  for (var i = 0; i <= span; i++) {
    var d = new Date(today); d.setDate(d.getDate() - i);
    pts.unshift({ date: d, available: av, assets: as, liabs: li });
    var o = byDay[dayKey(d)];
    if (!o) continue;
    // Before a charge, cash was higher / the card owed less (Plaid: charges are positive)
    av += o.bank + o.credit;
    as += o.bank + o.savings;
    li -= o.credit;
  }
  homeSeries = pts;
  var vals = pts.map(function(x) { return x.available; });
  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), range = (max - min) || 1;
  var n = pts.length - 1 || 1;
  pts.forEach(function(x, idx) { x.x = idx / n * 300; x.y = 60 - ((x.available - min) / range) * 54; });
  // Like Robinhood: green if at or above where the range started, red if below,
  // with a dotted line at the starting value.
  var down = pts[pts.length - 1].available < pts[0].available - 0.005;
  chart.classList.toggle('is-down', down);
  $('#home-trend-base').style.top = (pts[0].y / 64 * 100) + '%';
  $('#home-trend-path').setAttribute('d', pts.map(function(x, idx) { return (idx ? 'L' : 'M') + x.x.toFixed(1) + ',' + x.y.toFixed(1); }).join(' '));
  ranges.querySelectorAll('button').forEach(function(b) { b.classList.toggle('on', +b.dataset.range === homeRange); });
  chart.hidden = false; ranges.hidden = false; label.hidden = false;
  showHomePoint(null);
}
// Plain-English change line: "Down $4,630.48 since Oct 21"
function shortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
function homeChangeLabel(from, to, sinceDate) {
  var change = to - from;
  if (Math.abs(change) < 0.005) return 'No change since ' + shortDate(sinceDate);
  return '<strong class="' + (change < 0 ? 'down' : '') + '">' + (change < 0 ? 'Down ' : 'Up ') + formatMoney(Math.abs(change)) + '</strong> since ' + shortDate(sinceDate);
}
function showHomePoint(idx) {
  var s = homeSeries; if (!s || !s.length) return;
  var cur = $('#home-trend-cursor'), dot = $('#home-trend-dot');
  var pt = idx === null ? s[s.length - 1] : s[idx];
  var availEl = $('#available-value');
  availEl.textContent = heroMoney(pt.available);
  availEl.className = 'hero-stat-value ' + (pt.available >= 0 ? 'balance-positive' : 'balance-negative');
  $('#hero-assets').textContent = formatMoney(pt.assets);
  $('#hero-liabs').textContent = formatMoney(pt.liabs);
  var label = $('#home-trend-label');
  if (idx === null) {
    cur.setAttribute('visibility', 'hidden'); dot.hidden = true;
    label.innerHTML = homeChangeLabel(s[0].available, pt.available, s[0].date);
    return;
  }
  cur.setAttribute('x1', pt.x); cur.setAttribute('x2', pt.x); cur.setAttribute('visibility', 'visible');
  dot.hidden = false; dot.style.left = (pt.x / 3) + '%'; dot.style.top = (pt.y / 64 * 100) + '%';
  // While dragging: which day you're on, and how it compares with today
  var diff = s[s.length - 1].available - pt.available;
  label.innerHTML = '<span class="home-trend-date">' + shortDate(pt.date) + '</span>' +
    (Math.abs(diff) < 0.005 ? ' · same as today' : ' · ' + formatMoney(Math.abs(diff)) + (diff < 0 ? ' more than today' : ' less than today'));
}
(function wireHomeChart() {
  var chart = $('#home-chart'), ranges = $('#home-ranges');
  if (!chart) return;
  var scrubbing = false;
  var pick = function(e) {
    if (!homeSeries) return;
    var r = chart.getBoundingClientRect();
    var f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    showHomePoint(Math.round(f * (homeSeries.length - 1)));
  };
  chart.addEventListener('pointerdown', function(e) { scrubbing = true; pick(e); });
  chart.addEventListener('pointermove', function(e) { if (scrubbing || e.pointerType === 'mouse') pick(e); });
  var end = function() { scrubbing = false; showHomePoint(null); };
  chart.addEventListener('pointerup', end);
  chart.addEventListener('pointercancel', end);
  chart.addEventListener('pointerleave', end);
  ranges.addEventListener('click', function(e) {
    var b = e.target.closest('button[data-range]'); if (!b) return;
    homeRange = +b.dataset.range;
    try { localStorage.setItem('alenjo_home_range', String(homeRange)); } catch (err) {}
    renderHomeInsights();
  });
})();

// Assets and Liabilities beside the big Available number
function renderBalanceSplit() {
  var aEl = $('#hero-assets'), lEl = $('#hero-liabs');
  if (!aEl || !lEl || !cachedAccounts) return;
  var assets = 0, liabs = 0;
  cachedAccounts.forEach(function(a) {
    if (a.is_hidden || a.exclude_from_totals || a.closed_at) return;
    if (a.type === 'credit') liabs += Math.max(0, getDisplayBalance(a, 'credit').amount);
    else if (a.type === 'loan') liabs += Math.abs(getDisplayBalance(a, 'loan').amount);
    else if (a.type === 'investment') assets += getInvestmentValue(a);
    else if (a.type === 'depository') assets += Math.max(0, getDisplayBalance(a, 'bank').amount);
  });
  aEl.textContent = formatMoney(assets);
  lEl.textContent = formatMoney(liabs);
}

// Interest estimate for the current calendar month. Banks accrue interest daily on each
// day's posted balance and pay it monthly, so a short-lived deposit should barely count.
// Days already passed use that day's real end-of-day balance (rebuilt backwards from
// today's posted balance using posted transactions); today and the rest of the month
// assume today's balance stays put.
function monthInterestEstimate(a) {
  var apy = parseFloat(a.apy);
  if (!(apy > 0)) return 0;
  var bal = parseFloat(a.balance_current);
  if (isNaN(bal)) bal = getDisplayBalance(a, 'bank').amount;
  var dayKey = function(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var byDay = {};
  (txData || []).forEach(function(tx) {
    if (tx.pending || !a.plaid_account_id || tx.plaid_account_id !== a.plaid_account_id) return;
    byDay[tx.date] = (byDay[tx.date] || 0) + parseFloat(tx.amount || 0);
  });
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  var dayOfMonth = today.getDate();
  var sum = bal * (daysInMonth - dayOfMonth + 1); // today through month end
  var b = bal;
  for (var i = 1; i < dayOfMonth; i++) {
    var after = new Date(today); after.setDate(after.getDate() - i + 1);
    // End of the earlier day = end of the later day plus what posted on the later day
    // (Plaid amounts: money out is positive)
    b += byDay[dayKey(after)] || 0;
    sum += Math.max(0, b);
  }
  var avg = sum / daysInMonth;
  var daily = Math.pow(1 + apy / 100, 1 / 365) - 1;
  return Math.max(0, avg * daily * daysInMonth);
}

function formatApy(a) {
  var apy = parseFloat(a.apy);
  var est = monthInterestEstimate(a);
  var amt = hideMoney ? (est >= 0.01 ? '****' : '') : est >= 1 ? '$' + Math.round(est).toLocaleString('en-US') : est >= 0.01 ? formatMoney(est) : '';
  return '<span>' + apy.toFixed(2).replace(/\.?0+$/, '') + '% APY</span>' + (amt ? '<span class="apy-est">~' + amt + '/mo</span>' : '');
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


function renderClosedAccounts() {
  var sec = $('#closed-section'), list = $('#closed-list');
  if (!sec || !list) return;
  var closed = (cachedAccounts || []).filter(function(a) { return a.closed_at; });
  sec.hidden = !closed.length;
  var byItem = {};
  closed.forEach(function(a) { (byItem[a.plaid_item_id] = byItem[a.plaid_item_id] || []).push(a); });
  list.innerHTML = Object.keys(byItem).map(function(itemId) {
    var g = byItem[itemId], inst = g[0].institution || 'Closed';
    var names = g.map(function(a) { return (a.nickname || a.name || 'Account').replace(/\s*[*•]+\s*\d{2,4}\s*$/, ''); }).join(', ');
    var when = new Date(g[0].closed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return '<div class="closed-row"><span class="set-row-text"><span>' + esc(inst) + '</span><span class="set-hint">' + esc(names) + ' · closed ' + esc(when) + '</span></span>' +
      '<button type="button" class="closed-del" data-purge="' + esc(itemId) + '">Delete history</button></div>';
  }).join('');
}

async function renderAccountsSettings() {
  var list = $('#accounts-list');
  renderClosedAccounts();
  var open = (cachedAccounts || []).filter(function(a) { return !a.closed_at; });
  if (open.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:var(--text-sm)">No institutions connected</p>';
    return;
  }

  // Group active accounts by plaid_item_id for disconnect buttons
  var byItem = {};
  open.forEach(function(a) {
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
    var att = itemAttention(itemId);
    html += '<span class="settings-inst-detail">' + n + ' account' + (n !== 1 ? 's' : '') + '</span>';
    if (att) html += '<span class="settings-inst-alert ' + att.level + '">' + (att.level === 'error' ? 'Needs attention: ' : '') + esc(att.text) + '</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="settings-inst-actions">';
    if (att && att.canReconnect) html += '<button class="btn-reconnect-inst" data-reconnect="' + esc(itemId) + '">Reconnect</button>';
    else html += '<button class="btn-add-card-inst" data-item="' + esc(itemId) + '">Manage</button>';
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

// Disconnect: keep the history (default) or delete everything. Plaid is disconnected either way.
(function wireDisconnect() {
  var sheet = $('#disconnect-sheet'), keepBtn = $('#disconnect-keep'), delBtn = $('#disconnect-delete'), err = $('#disconnect-error');
  var itemId = null, sourceBtn = null;
  function close() { sheet.classList.remove('visible'); sheet.setAttribute('aria-hidden', 'true'); itemId = null; keepBtn.disabled = delBtn.disabled = false; err.hidden = true; }
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.btn-disconnect-inst');
    if (!btn) return;
    itemId = btn.dataset.item; sourceBtn = btn;
    var group = cachedAccounts.filter(function(a) { return a.plaid_item_id === itemId; });
    var instName = group.length ? (group[0].institution || 'this institution') : 'this institution';
    $('#disconnect-title').textContent = 'Disconnect ' + instName + '?';
    $('#disconnect-lead').textContent = group.length === 1 ? '1 account: ' + (group[0].nickname || group[0].name || 'Account') : group.length + ' accounts';
    err.hidden = true;
    sheet.classList.add('visible'); sheet.setAttribute('aria-hidden', 'false');
  });
  $('#disconnect-cancel').addEventListener('click', close);
  async function go(keep) {
    if (!itemId) return;
    var id = itemId;
    keepBtn.disabled = delBtn.disabled = true;
    try {
      var session = (await sb.auth.getSession()).data.session;
      var res = await fetch(SUPABASE_URL + '/functions/v1/cleanup-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ item_id: id, keep_history: keep })
      });
      var data = await res.json();
      if (!data.removed) throw new Error(data.error || 'failed');
      if (keep) {
        var now = new Date().toISOString();
        cachedAccounts.forEach(function(a) { if (a.plaid_item_id === id) a.closed_at = now; });
        refreshAccountNames();
      } else {
        dropItemLocally(id);
      }
      cachedHoldings = null; cachedLiabilities = null;
      renderAccounts(cachedAccounts);
      if (txData && txData.length) renderTransactionMonth();
      close();
      showToast(keep ? 'Disconnected · history kept' : 'Disconnected and deleted');
    } catch (e2) {
      keepBtn.disabled = delBtn.disabled = false;
      err.textContent = 'Couldn’t disconnect. Check your connection and try again.'; err.hidden = false;
    }
  }
  keepBtn.addEventListener('click', function() { go(true); });
  delBtn.addEventListener('click', function() { go(false); });
})();

// ---- Budget sheet: set, change or remove one category's budget

// Average monthly amount for a category, over the months you actually have transactions for:
// up to the last 3 full months; the current month only if it's all there is. Grows with your data.
function budgetSuggestion(cat, side) {
  var cur = new Date(), curKey = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0');
  var byMonth = {}, hasData = {};
  (txData || []).forEach(function(tx) {
    var eff = getEffectiveTx(tx), k = (eff.date || tx.date || '').substring(0, 7);
    if (k) hasData[k] = true;
    if (eff.excluded || tx.pending || isTransferCategory(baseCategory(eff.category))) return;
    if ((side === 'in') !== (eff.amount < 0)) return;
    // The Income pill is all money in, so its average is too
    if (!(side === 'in' && cat === 'Income') && normalizeCategory(eff.category) !== cat) return;
    byMonth[k] = (byMonth[k] || 0) + Math.abs(eff.amount);
  });
  var months = Object.keys(hasData).filter(function(k) { return k < curKey; }).sort().reverse().slice(0, 3);
  if (!months.length && hasData[curKey]) months = [curKey];
  if (!months.length) return null;
  var sum = months.reduce(function(t, k) { return t + (byMonth[k] || 0); }, 0);
  if (!(sum > 0)) return null;
  return { avg: Math.round(sum / months.length * 100) / 100, months: months };
}
// Every category you have, each with its monthly amount (blank = no budget)
function budgetCategories(side) {
  if (side === 'out') return allCategories().filter(function(c) { return !isTransferCategory(c) && c !== 'Income'; });
  var seen = {};
  (txData || []).forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    if (eff.excluded || eff.amount >= 0 || isTransferCategory(baseCategory(eff.category))) return;
    seen[normalizeCategory(eff.category)] = true;
  });
  Object.keys(budgets).forEach(function(m) { Object.keys(budgets[m].in).forEach(function(c) { seen[c] = true; }); });
  return Object.keys(seen).filter(function(c) { return c && c !== 'Uncategorized'; }).sort(function(x, y) { return x.localeCompare(y); });
}
// Budget sheet: a table like a notes-app bills list. Net pay on top (monthly, and biweekly as
// half of it: two paychecks a month), one row per budgeted category, what's left at the bottom.
// Every amount can be edited in place; add more categories from the row underneath.
var budgetSheet = { month: '', order: [] };
function curMonthKey() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function budgetMonthName(m) { var p = m.split('-'); return MONTH_LONG[+p[1] - 1]; }
// 1475 -> "1475", 4.15 -> "4.15", 1556.3 -> "1556.30"
function budgetAmtText(v) { var n = Math.round(v * 100) / 100; return n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
// What you typed, as an amount; null for empty, NaN for nonsense
function budgetParse(raw) {
  raw = String(raw || '').replace(/[$,\s−-]/g, '');
  if (raw === '') return null;
  var v = Math.round(parseFloat(raw) * 100) / 100;
  return v > 0 && v < 1e7 ? v : NaN;
}
function openBudgetSheet(side, focusCat) {
  var month = $('#tx-month-filter').value;
  var BO = monthBudgets(month, 'out');
  // Biggest first, like a bills list; stays put while the sheet is open, new rows go at the end
  budgetSheet = { month: month, order: Object.keys(BO).sort(function(a, b) { return BO[b].amount - BO[a].amount || a.localeCompare(b); }) };
  $('#budget-add-amt').value = ''; $('#budget-add-name').value = '';
  var pre = side === 'out' && focusCat && !BO[focusCat] ? focusCat : null;
  renderBudgetSheet(pre);
  var sheet = $('#budget-sheet');
  sheet.querySelector('.budget-sheet').classList.toggle('adding', !!pre);
  sheet.querySelector('.action-sheet').scrollTop = 0;
  sheet.classList.add('visible'); sheet.setAttribute('aria-hidden', 'false');
  if (!focusCat) return;
  setTimeout(function() {
    var el = side === 'in' && focusCat === 'Income' ? $('#bt-pay-m')
      : side === 'out' && BO[focusCat] ? document.querySelector('#budget-table input[data-side="out"][data-cat="' + CSS.escape(focusCat) + '"]')
      : side === 'out' ? $('#budget-add-amt') : null;
    if (el) { el.focus(); if (el.select) el.select(); }
  }, 250);
}
function budgetRow(cls, label, input) {
  return '<div class="bt-row ' + cls + '"><span class="bt-name"><span>' + label + '</span></span>' + input + '</div>';
}
function budgetInput(side, cat, v, aria, extra) {
  return '<label class="bt-chip"><span aria-hidden="true">$</span>' +
    '<input inputmode="decimal" autocomplete="off" enterkeyhint="done" data-side="' + side + '" data-cat="' + esc(cat) + '"' + (extra || '') +
    ' value="' + (v ? budgetAmtText(v) : '') + '" placeholder="0" aria-label="' + esc(aria) + '"></label>';
}
function renderBudgetSheet(preselect) {
  var bs = budgetSheet, mName = budgetMonthName(bs.month);
  var BO = monthBudgets(bs.month, 'out'), BIn = monthBudgets(bs.month, 'in');
  $('#budget-title').textContent = 'Budgets · ' + mName.slice(0, 3);
  renderBudgetCopy();

  Object.keys(BO).forEach(function(c) { if (bs.order.indexOf(c) < 0) bs.order.push(c); });
  bs.order = bs.order.filter(function(c) { return BO[c]; });
  var pay = BIn.Income ? BIn.Income.amount : 0;
  // One big number: what's left each month. Your pay sits in the line under it, tap to edit.
  var html = '<div class="bt-hero"><small>Left each month</small><b id="bt-left-m"></b>' +
    '<label class="bt-pay-line">from <span class="bt-pay-in"><span aria-hidden="true">$</span><input inputmode="decimal" autocomplete="off" enterkeyhint="done" data-side="in" data-cat="Income" id="bt-pay-m" value="' + (pay ? budgetAmtText(pay) : '') + '" placeholder="0" aria-label="Take-home pay each month"></span> take-home pay</label></div>';

  html += '<div class="bt-group">';
  // Any other money you expect in, besides pay
  Object.keys(BIn).filter(function(c) { return c !== 'Income'; }).sort().forEach(function(c) {
    html += budgetRow('bt-pay', esc(c), budgetInput('in', c, BIn[c].amount, c + ', monthly'));
  });
  bs.order.forEach(function(c) { html += budgetRow('bt-out', esc(c), budgetInput('out', c, BO[c].amount, c + ', monthly')); });
  html += '<button type="button" class="bt-row bt-add-open" id="bt-add-open">+ Add budget</button></div>';
  if (bs.order.length) html += '<p class="bt-foot">Clear an amount to remove it.</p>';
  $('#budget-table').innerHTML = html;
  refreshBudgetTotals();

  // Add row: every category that doesn't have a budget yet, or a new one
  var sel = $('#budget-add-cat'), keep = preselect || sel.value;
  var free = budgetCategories('out').filter(function(c) { return !BO[c]; });
  if (preselect && free.indexOf(preselect) < 0) free.unshift(preselect);
  sel.innerHTML = '<option value="">Category</option>' + free.map(function(c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') +
    '<option value="__new">New category…</option>';
  sel.value = keep && (keep === '__new' || free.indexOf(keep) >= 0) ? keep : '';
  budgetAddPicked();
}
// "Use October's": always offered when last month had budgets; says so when they already match
function renderBudgetCopy() {
  var bs = budgetSheet, mName = budgetMonthName(bs.month);
  var BO = monthBudgets(bs.month, 'out'), BIn = monthBudgets(bs.month, 'in');
  var prev = prevMonthKey(bs.month), PO = (budgets[prev] || {}).out || {}, PI = (budgets[prev] || {}).in || {};
  var nPrev = Object.keys(PO).length + Object.keys(PI).length, pName = budgetMonthName(prev);
  var copy = $('#budget-copy');
  var same = function(A, B) { var k = Object.keys(A); return k.length === Object.keys(B).length && k.every(function(c) { return B[c] && Math.abs(B[c].amount - A[c].amount) < 0.005; }); };
  var matches = nPrev && same(PO, BO) && same(PI, BIn);
  // Only offered while this month is still empty, so it never sits there competing with your list
  copy.hidden = !nPrev || Object.keys(BO).length + Object.keys(BIn).length > 0;
  copy.disabled = !!matches;
  copy.classList.toggle('confirm', !matches && copy.dataset.confirm === bs.month);
  if (!nPrev || matches) copy.dataset.confirm = '';
  copy.textContent = matches ? 'Same as ' + pName : copy.dataset.confirm === bs.month ? 'Replace? Tap again' : 'Use ' + pName + '\u2019s';
  copy.setAttribute('aria-label', matches ? mName + '\u2019s budgets match ' + pName + '\u2019s' : 'Use ' + pName + '\u2019s budgets for ' + mName);
}
// Left = pay coming in minus every budget going out
function refreshBudgetTotals() {
  var bs = budgetSheet, BO = monthBudgets(bs.month, 'out'), BIn = monthBudgets(bs.month, 'in');
  var inTot = Object.keys(BIn).reduce(function(t, c) { return t + BIn[c].amount; }, 0);
  var outTot = Object.keys(BO).reduce(function(t, c) { return t + BO[c].amount; }, 0);
  var left = Math.round((inTot - outTot) * 100) / 100;
  var el = $('#bt-left-m'); if (!el) return;
  el.textContent = inTot ? (left < 0 ? '−' : '') + wholeMoney(left) : '—';
  el.classList.toggle('bad', !!inTot && left < 0);
  renderBudgetCopy();
}
function budgetAddPicked() {
  var cat = $('#budget-add-cat').value, isNew = cat === '__new';
  $('#budget-add-name').hidden = !isNew;
  var sug = cat && !isNew ? budgetSuggestion(cat, 'out') : null;
  $('#budget-add-avg').textContent = !sug ? '' : sug.months.length === 1
    ? budgetMonthName(sug.months[0]) + (sug.months[0] === curMonthKey() ? ' so far ' : ' ') + wholeMoney(sug.avg)
    : 'Last ' + sug.months.length + ' months averaged ' + wholeMoney(sug.avg);
}
function saveMonthBudget(month, side, cat, amount) {
  var B = monthBudgets(month, side);
  if (amount == null) {
    delete B[cat];
    return sb.from('category_budgets').delete().eq('month', month).eq('direction', side).eq('category', cat);
  }
  B[cat] = { kind: 'limit', amount: amount };
  return sb.from('category_budgets').upsert({ month: month, category: cat, direction: side, kind: 'limit', amount: amount, updated_at: new Date().toISOString() }, { onConflict: 'user_id,month,direction,category' });
}
(function wireBudgetSheet() {
  var sheet = $('#budget-sheet');
  if (!sheet) return;
  function close() { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); sheet.classList.remove('visible'); sheet.setAttribute('aria-hidden', 'true'); renderTransactionMonth(); }
  $('#budget-cancel').addEventListener('click', close);
  var table = $('#budget-table');
  function saved(r) { if (r && r.error) showToast('Couldn’t save'); }
  // An amount in the table: saved when you leave the box or press Enter
  table.addEventListener('change', function(e) {
    var inp = e.target.closest('input[data-cat]'); if (!inp) return;
    var bs = budgetSheet, side = inp.dataset.side, cat = inp.dataset.cat, B = monthBudgets(bs.month, side);
    var v = budgetParse(inp.value);
    if (v !== v) {   // NaN
      showToast('Enter an amount, or clear it to remove the budget');
      inp.value = B[cat] ? budgetAmtText(inp.dataset.biweekly ? B[cat].amount / 2 : B[cat].amount) : '';
      return;
    }
    if (v !== null && inp.dataset.biweekly) v = Math.round(v * 2 * 100) / 100;   // biweekly pay sets monthly
    saveMonthBudget(bs.month, side, cat, v).then(saved);
    if (side === 'in' && cat === 'Income') {
      $('#bt-pay-m').value = v ? budgetAmtText(v) : '';
    } else if (v === null) {
      renderBudgetSheet();   // a cleared row leaves the table
      return;
    } else inp.value = budgetAmtText(v);
    refreshBudgetTotals();
  });
  table.addEventListener('keydown', function(e) { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.blur(); } });
  table.addEventListener('click', function(e) {
    if (e.target.closest('#bt-add-open')) {
      sheet.querySelector('.budget-sheet').classList.add('adding');
      setTimeout(function() { $('#budget-add-amt').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); var h = sheet.querySelector('.budget-add .picker-hit'); if (h) h.click(); }, 60);
      return;
    }
    var del = e.target.closest('[data-del]'); if (!del) return;
    saveMonthBudget(budgetSheet.month, 'out', del.dataset.del, null).then(saved);
    renderBudgetSheet();
  });
  $('#budget-add-cat').addEventListener('change', function() {
    budgetAddPicked();
    if (this.value === '__new') $('#budget-add-name').focus();
    else if (this.value) $('#budget-add-amt').focus();
  });
  function addIt() {
    var bs = budgetSheet, sel = $('#budget-add-cat'), cat = sel.value;
    if (!cat) { sel.focus(); showToast('Choose a category'); return; }
    if (cat === '__new') {
      var nameInp = $('#budget-add-name'), name = nameInp.value.trim().slice(0, 40);
      if (!name) { nameInp.focus(); return; }
      var existing = allCategories().find(function(c) { return c.toLowerCase() === name.toLowerCase(); });
      cat = existing || name.charAt(0).toUpperCase() + name.slice(1);
      if (!existing) saveCatMap([{ source: cat, display: cat }]);
    }
    var v = budgetParse($('#budget-add-amt').value);
    if (v === null || v !== v) { $('#budget-add-amt').focus(); showToast('Enter a monthly amount'); return; }
    saveMonthBudget(bs.month, 'out', cat, v).then(saved);
    if (bs.order.indexOf(cat) < 0) bs.order.push(cat);
    $('#budget-add-amt').value = ''; $('#budget-add-name').value = ''; sel.value = '';
    sheet.querySelector('.budget-sheet').classList.remove('adding');
    renderBudgetSheet();
  }
  $('#budget-add-btn').addEventListener('click', addIt);
  $('#budget-add-amt').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
  $('#budget-add-name').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); $('#budget-add-amt').focus(); } });
  $('#budget-copy').addEventListener('click', function() {
    var bs = budgetSheet, prev = budgets[prevMonthKey(bs.month)] || {}, rows = [], btn = this;
    var cur = (monthBudgets(bs.month, 'out'), monthBudgets(bs.month, 'in'), budgets[bs.month]);
    var nCur = Object.keys(cur.out).length + Object.keys(cur.in).length;
    // This month already has budgets: ask once before replacing them
    if (nCur && btn.dataset.confirm !== bs.month) { btn.dataset.confirm = bs.month; renderBudgetSheet(); return; }
    btn.dataset.confirm = '';
    ['out', 'in'].forEach(function(side) {
      var P = prev[side] || {}, C = cur[side];
      // Make this month match last month exactly: drop the ones last month didn't have
      Object.keys(C).forEach(function(c) { if (!P[c]) saveMonthBudget(bs.month, side, c, null).then(function(r) { if (r.error) showToast('Couldn’t copy budgets'); }); });
      Object.keys(P).forEach(function(c) {
        monthBudgets(bs.month, side)[c] = { kind: 'limit', amount: P[c].amount };
        rows.push({ month: bs.month, category: c, direction: side, kind: 'limit', amount: P[c].amount, updated_at: new Date().toISOString() });
      });
    });
    if (rows.length) sb.from('category_budgets').upsert(rows, { onConflict: 'user_id,month,direction,category' }).then(function(r) { if (r.error) showToast('Couldn’t copy budgets'); });
    var BO = monthBudgets(bs.month, 'out');
    bs.order = Object.keys(BO).sort(function(a, b) { return BO[b].amount - BO[a].amount || a.localeCompare(b); });
    renderBudgetSheet(); showToast('Copied ' + rows.length + ' budget' + (rows.length === 1 ? '' : 's'));
  });
})();

// Remove a connection's accounts and transactions from what's on screen
function dropItemLocally(itemId) {
  var gone = {};
  cachedAccounts.forEach(function(a) { if (a.plaid_item_id === itemId && a.plaid_account_id) gone[a.plaid_account_id] = true; });
  cachedAccounts = cachedAccounts.filter(function(a) { return a.plaid_item_id !== itemId; });
  if (txData && txData.length) {
    txData = txData.filter(function(t) { return t.plaid_item_id !== itemId && !gone[t.plaid_account_id]; });
    var cf = $('#tx-card-filter');
    if (cf) Array.prototype.slice.call(cf.options).forEach(function(o) { if (gone[o.value]) o.remove(); });
  }
}

// Closed accounts: delete their saved history later
(function wirePurge() {
  var sheet = $('#purge-sheet'), btn = $('#purge-confirm'), itemId = null;
  function close() { sheet.classList.remove('visible'); sheet.setAttribute('aria-hidden', 'true'); itemId = null; btn.disabled = false; btn.textContent = 'Delete history'; }
  document.addEventListener('click', function(e) {
    var b = e.target.closest('[data-purge]');
    if (!b) return;
    itemId = b.dataset.purge;
    var g = cachedAccounts.filter(function(a) { return a.plaid_item_id === itemId; });
    var accIds = {}; g.forEach(function(a) { if (a.plaid_account_id) accIds[a.plaid_account_id] = true; });
    var n = txData ? txData.filter(function(t) { return t.plaid_item_id === itemId || accIds[t.plaid_account_id]; }).length : 0;
    $('#purge-title').textContent = 'Delete ' + ((g[0] && g[0].institution) || 'this') + ' history?';
    $('#purge-lead').textContent = 'Deletes ' + (g.length === 1 ? 'this closed account' : 'these ' + g.length + ' closed accounts') + (n ? ', ' + n + ' transaction' + (n === 1 ? '' : 's') : '') + ' and your notes and splits on them. Can’t be undone.';
    sheet.classList.add('visible'); sheet.setAttribute('aria-hidden', 'false');
  });
  $('#purge-cancel').addEventListener('click', close);
  btn.addEventListener('click', async function() {
    if (!itemId) return;
    var id = itemId; btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      var session = (await sb.auth.getSession()).data.session;
      var res = await fetch(SUPABASE_URL + '/functions/v1/cleanup-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ purge_item_id: id })
      });
      var data = await res.json();
      if (!data.purged) throw new Error('failed');
      dropItemLocally(id);
      renderAccounts(cachedAccounts);
      if (txData && txData.length) renderTransactionMonth();
      close(); showToast('History deleted');
    } catch (e2) { btn.disabled = false; btn.textContent = 'Delete history'; showToast('Couldn’t delete. Try again.'); }
  });
})();

async function finishAddAccounts(itemId, headers) {
  showLoading(true);
  try {
    await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ action: 'sync_added_accounts', item_id: itemId })
    });
    clearItemNotice(itemId, headers);
    await loadAccounts();
    await loadItemHealth();
    showToast('Card added');
  } catch (err) {
    console.error('sync_added_accounts failed:', err);
    showError('Card linked but we couldn\'t finish syncing. Pull to refresh.');
  }
  showLoading(false);
}
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

    var handler = plaidCreate({
      token: data.link_token,
      onSuccess: function() { return finishAddAccounts(itemId, headers); },
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


// Update a list in place instead of rebuilding it: cards that didn't change keep the same
// elements, so their card art and logos don't blink when balances refresh (on open, after a
// sync, on returning to the app). Only the parts whose text or attributes changed are touched.
function morphInto(parent, html) {
  var t = document.createElement('template');
  t.innerHTML = html;
  morphChildren(parent, t.content);
}
function morphChildren(oldP, newP) {
  var oldKids = Array.prototype.slice.call(oldP.childNodes), newKids = Array.prototype.slice.call(newP.childNodes);
  newKids.forEach(function(n, i) {
    var o = oldKids[i];
    if (!o) { oldP.appendChild(n); return; }
    var sameKind = o.nodeType === n.nodeType && o.nodeName === n.nodeName &&
      (o.nodeType !== 1 || o.getAttribute('data-id') === n.getAttribute('data-id'));
    if (!sameKind) { oldP.replaceChild(n, o); return; }
    if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
    morphEl(o, n);
  });
  for (var j = oldKids.length - 1; j >= newKids.length; j--) oldP.removeChild(oldKids[j]);
}
function morphEl(o, n) {
  if (o.isEqualNode(n)) return;
  Array.prototype.forEach.call(n.attributes, function(a) { if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value); });
  Array.prototype.slice.call(o.attributes).forEach(function(a) { if (!n.hasAttribute(a.name)) o.removeAttribute(a.name); });
  if (o.tagName === 'INPUT') { o.checked = n.checked; if (document.activeElement !== o) o.value = n.value; }
  morphChildren(o, n);
}

function renderSection(listEl, items, type) {
  // Your own order first (Settings → Accounts), then largest balance first
  var sorted = items.slice().sort(function(a, b) {
    var oa = a.sort_order == null ? 1e9 : a.sort_order, ob = b.sort_order == null ? 1e9 : b.sort_order;
    if (oa !== ob) return oa - ob;
    return Math.abs(getDisplayBalance(b, type).amount) - Math.abs(getDisplayBalance(a, type).amount);
  });

  morphInto(listEl, sorted.map(function(a) { return accountCard(a, type); }).join(''));

  // Page dots: kept in place (and on the card you were looking at) across refreshes
  var dotsEl = listEl.parentElement.querySelector('.scroll-dots');
  var syncDots = function() {
    var d = listEl.parentElement.querySelector('.scroll-dots');
    if (!d) return;
    var cardWidth = listEl.firstElementChild ? listEl.firstElementChild.offsetWidth : 1;
    var idx = Math.round(listEl.scrollLeft / (cardWidth || 1));
    d.querySelectorAll('.scroll-dot').forEach(function(dot, j) { dot.classList.toggle('active', j === idx); });
  };
  if (sorted.length > 1) {
    if (!dotsEl) { dotsEl = document.createElement('div'); dotsEl.className = 'scroll-dots'; listEl.parentElement.appendChild(dotsEl); }
    if (dotsEl.children.length !== sorted.length) {
      dotsEl.innerHTML = '';
      for (var i = 0; i < sorted.length; i++) { var dot = document.createElement('div'); dot.className = 'scroll-dot'; dotsEl.appendChild(dot); }
    }
    syncDots();
    if (!listEl._dotsWired) {
      listEl._dotsWired = true;
      var scrollTicking = false;
      listEl.addEventListener('scroll', function() {
        if (scrollTicking) return;
        scrollTicking = true;
        requestAnimationFrame(function() { syncDots(); scrollTicking = false; });
      }, { passive: true });
    }
  } else if (dotsEl) dotsEl.remove();
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
      holdingsHtml = '<div class="hold-list">';
      var totalValue = 0, totalCost = 0, allCost = true;
      acctHoldings.forEach(function(h) { if (h.cost_basis) totalCost += +h.cost_basis; else if (h.ticker_symbol !== 'CUR:USD') allCost = false; });
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

        holdingsHtml += '<div class="hold-row">' +
          '<span class="hold-ticker">' + esc(displayTicker.slice(0, 5)) + '</span>' +
          '<span class="hold-main"><span class="hold-name">' + esc(displayName || displayTicker) + '</span>' +
            '<span class="hold-meta">' + (isCash ? 'Cash' : (+parseFloat(h.quantity).toFixed(4)) + ' shares' + (price ? ' · $' + parseFloat(price).toFixed(2) : '')) + ' · ' + pct.toFixed(0) + '%</span></span>' +
          '<span class="hold-right"><span class="hold-value">' + formatMoney(value) + '</span>' +
            (gainPct !== null ? '<span class="hold-change ' + gainClass + '">' + (gainPct >= 0 ? '+' : '') + gainPct.toFixed(2) + '%</span>' : '') + '</span>' +
        '</div>';
      });
      holdingsHtml += '</div>';
      var cashVal = acctHoldings.reduce(function(s, h) { return s + (h.ticker_symbol === 'CUR:USD' ? (h.institution_value || 0) : 0); }, 0);
      var totGain = allCost && totalCost > 0 ? ((totalValue - cashVal) - totalCost) / totalCost * 100 : null;
      holdingsHtml = moreSection(account.id + ':h',
        '<span>' + acctHoldings.length + (acctHoldings.length === 1 ? ' holding' : ' holdings') + '</span>' +
        (totGain !== null ? '<span class="hold-change ' + (totGain >= 0 ? 'holding-up' : 'holding-down') + '">' + (totGain >= 0 ? '+' : '') + totGain.toFixed(2) + '% all time</span>' : ''),
        holdingsHtml);
    }
  }

  // Liabilities detail for credit cards
  var liabHtml = '', loanMain = null;
  if (type === 'loan') {
    var ln = cachedLiabilities ? cachedLiabilities.find(function(l) { return l.account_id === account.id; }) : null;
    var lt = [];
    var lTile = function(label, value, cls) { lt.push('<div class="liab-tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b></div>'); };
    lTile('Balance owed', formatMoney(Math.abs(parseFloat(account.balance_current) || 0)));
    if (ln) {
      var pay = ln.minimum_payment_amount != null ? parseFloat(ln.minimum_payment_amount) : ln.next_monthly_payment != null ? parseFloat(ln.next_monthly_payment) : null;
      if (ln.interest_rate != null) lTile('Interest rate', parseFloat(ln.interest_rate).toFixed(2) + '%');
      if (ln.outstanding_interest) lTile('Unpaid interest', formatMoney(parseFloat(ln.outstanding_interest)));
      if (ln.ytd_interest_paid) lTile('Interest paid this year', formatMoney(parseFloat(ln.ytd_interest_paid)));
      if (ln.ytd_principal_paid) lTile('Principal paid this year', formatMoney(parseFloat(ln.ytd_principal_paid)));
      var withYear = function(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
      if (ln.origination_principal) lTile('Original amount', formatMoney(parseFloat(ln.origination_principal)) + (ln.origination_date ? '<small>' + withYear(ln.origination_date) + '</small>' : ''));
      if (ln.expected_payoff_date || ln.maturity_date) lTile('Paid off by', withYear(ln.expected_payoff_date || ln.maturity_date));
      if (ln.last_payment_amount) lTile('Last paid', formatMoney(parseFloat(ln.last_payment_amount)) + (ln.last_payment_date ? '<small>' + formatLiabDate(ln.last_payment_date) + '</small>' : ''));
      if (ln.repayment_plan) lTile('Plan', esc(ln.repayment_plan));
      var statusWord = ln.loan_status ? ln.loan_status.replace(/_/g, ' ').replace(/^./, function(c) { return c.toUpperCase(); }) : '';
      var paused = /^(deferment|forbearance|in school|grace)/i.test(ln.loan_status || '');
      if (ln.loan_status && ln.loan_status !== 'repayment') lTile('Status', esc(statusWord));
      if (ln.escrow_balance) lTile('Escrow', formatMoney(parseFloat(ln.escrow_balance)));
      if (ln.is_overdue) lTile('Status', 'Overdue', 'liab-urgent');
      var lDue = '', lCls = '';
      if (ln.next_payment_due_date) {
        var dU = Math.ceil((new Date(ln.next_payment_due_date + 'T00:00:00') - new Date()) / 86400000);
        lCls = dU <= 3 ? 'liab-urgent' : dU <= 7 ? 'liab-soon' : '';
        lDue = 'Due ' + formatLiabDate(ln.next_payment_due_date) + (dU > 1 ? ' · in ' + dU + ' days' : dU === 1 ? ' · tomorrow' : dU === 0 ? ' · today' : ' · overdue');
      }
      // No due date while payments are paused: say so instead of a blank "Loan details"
      if (!lDue && paused) lDue = statusWord + ' · no payment due';
      // Card's big number: the next payment (what you'll actually pay), not the whole balance
      loanMain = { amount: paused && pay == null ? 0 : pay, label: paused ? statusWord : ln.next_payment_due_date ? 'Due ' + formatLiabDate(ln.next_payment_due_date) : 'Next payment' };
      if (lt.length || lDue) {
        liabHtml += moreSection(account.id + ':d',
          '<span class="liab-due ' + lCls + '">' + esc(lDue || 'Loan details') + '</span><span class="more-word">Details</span>',
          '<div class="liab-tiles">' + lt.join('') + '</div>');
      }
    }
  }
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
          '<div class="liab-util-labels"><span>' + usedDisplay + ' of ' + formatMoney(limit).replace(/\.00$/, '') + '</span><span>' + utilLabel + '</span></div>' +
        '</div>';
    }

    var liab = cachedLiabilities ? cachedLiabilities.find(function(l) { return l.account_id === account.id; }) : null;
    var minPay = liab && liab.minimum_payment_amount != null ? parseFloat(liab.minimum_payment_amount) : null;
    var hasMinPayment = minPay != null && minPay > 0;
    var tiles = [];
    var tile = function(label, value, cls) { tiles.push('<div class="liab-tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b></div>'); };
    var dueText = '', dueClass = '';
    if (liab && liab.next_payment_due_date) {
      var daysUntil = Math.ceil((new Date(liab.next_payment_due_date + 'T00:00:00') - new Date()) / 86400000);
      if (hasMinPayment) dueClass = daysUntil <= 3 ? 'liab-urgent' : daysUntil <= 7 ? 'liab-soon' : '';
      dueText = 'Due ' + formatLiabDate(liab.next_payment_due_date) + (daysUntil > 1 ? ' · in ' + daysUntil + ' days' : daysUntil === 1 ? ' · tomorrow' : daysUntil === 0 ? ' · today' : hasMinPayment ? ' · overdue' : '');
    }
    if (minPay != null) tile('Minimum', formatMoney(minPay));
    if (liab && liab.last_statement_balance) tile('Statement', formatMoney(parseFloat(liab.last_statement_balance)));
    if (liab && liab.apr_purchase) tile('Purchase APR', parseFloat(liab.apr_purchase).toFixed(2) + '%');
    if (liab && liab.last_payment_amount) tile('Last paid', formatMoney(parseFloat(liab.last_payment_amount)) + (liab.last_payment_date ? '<small>' + formatLiabDate(liab.last_payment_date) + '</small>' : ''));
    if (liab && liab.is_overdue && hasMinPayment) tile('Status', 'Overdue', 'liab-urgent');
    if (tiles.length || dueText) {
      liabHtml += moreSection(account.id + ':d',
        '<span class="liab-due ' + dueClass + '">' + esc(dueText || 'Card details') + '</span>' + (dueText ? '<span class="more-word">Details</span>' : ''),
        '<div class="liab-tiles">' + tiles.join('') + '</div>');
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
  // One badge per card: your card design if you added one, else the bank logo, else an initial
  var badge = cardDesign ? '<div class="acct-badge acct-badge-art" style="background-image:url(' + esc(cardDesign.url) + ')"></div>'
    : logoUrl ? '<div class="acct-badge acct-badge-logo" style="background-image:url(' + logoUrl + ')"></div>'
    : '<div class="acct-badge acct-badge-initial">' + esc((account.institution || displayName).charAt(0).toUpperCase()) + '</div>';
  var cleanName = account.nickname ? displayName : displayName.replace(/\s*[*•]+\s*\d{2,4}\s*$/, '');
  var sub = [account.institution, account.mask ? shownMask(account.mask) : ''].filter(Boolean).join(' · ');

  return '<div class="account-card" data-id="' + account.id + '">' +
    '<div class="account-top">' +
      badge +
      '<div class="account-left">' +
        '<span class="account-name" data-id="' + account.id + '">' + esc(cleanName) + '</span>' +
        '<span class="account-sub">' + esc(sub) + '</span>' +
        (account.apy ? '<span class="account-apy">' + formatApy(account) + '</span>' : '') +
        (account.exclude_from_totals ? '<span class="account-flag">Not in totals</span>' : '') +
      '</div>' +
      '<div class="account-balance">' +
        (loanMain && loanMain.amount != null
          ? '<div class="amount balance-positive">' + formatMoney(loanMain.amount) + '</div><div class="label">' + esc(loanMain.label) + '</div>'
          : '') +
        (loanMain && loanMain.amount != null ? '' : ('<div class="amount ' + 'balance-positive' + (type === 'credit' ? ' amount-bonus-trigger' : '') + '"' + (type === 'credit' ? ' data-bonus-id="' + account.id + '"' : '') + '>' + (bal.amount < 0 ? '-' : '') + formatMoney(Math.abs(bal.amount)) + '</div>' +
        '<div class="label"' + (syncTs ? ' data-ts="' + syncTs + '" data-ts-prefix="Synced "' : '') + '>' + (timestamp ? 'Synced ' + timestamp : '') + '</div>')) +
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
// The big card in the account popup: your card art, or a plain card with the bank and name
function renderManageCardFace(acct) {
  var face = $('#manage-cardface');
  if (!face || !acct) return;
  var sel = $('#card-design-picker') && $('#card-design-picker').querySelector('.card-design-option.selected');
  var designId = sel ? (sel.dataset.designId || null) : acct.card_design_id;
  var design = designId ? getCardDesignById(designId) : null;
  face.className = 'manage-cardface' + (design ? ' has-art' : '');
  face.style.backgroundImage = '';
  var name = nicknameInput.value.trim() || acct.name || 'Account';
  var thumb = $('#manage-back-thumb');
  if (thumb) { thumb.className = 'manage-back-thumb' + (design ? ' has-art' : ''); thumb.innerHTML = design ? '<img src="' + esc(design.url) + '" alt="">' : esc((acct.institution || name).charAt(0).toUpperCase()); }
  face.innerHTML = design ? '<img src="' + esc(design.url) + '" alt="' + esc(name) + ' card">' :
    '<span class="mcf-bank">' + esc(acct.institution || '') + '</span>' +
    '<span class="mcf-name">' + esc(name) + '</span>' +
    '<span class="mcf-mask">' + (acct.mask ? '•••• ' + esc(shownMask(acct.mask)) : '') + '</span>';
}
(function wireManageCard() {
  var btn = $('#manage-name-btn'), input = $('#nickname-input');
  if (!btn) return;
  btn.addEventListener('click', function() { btn.hidden = true; input.hidden = false; input.focus(); input.select(); });
  var done = function() {
    var acct = cachedAccounts && cachedAccounts.find(function(a) { return a.id === editingAccountId; });
    $('#manage-name').textContent = input.value.trim() || (acct && acct.name) || 'Account';
    input.hidden = true; btn.hidden = false;
    renderManageCardFace(acct);
  };
  input.addEventListener('blur', done);
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  // Tap the card to flip it over to its details; tap the top of the details to flip back
  var flip = function(toBack) {
    var face = $('#manage-cardface'), back = $('#manage-details'), hint = $('#manage-hint');
    var out = toBack ? face : back, inn = toBack ? back : face;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var swap = function() {
      out.hidden = true; inn.hidden = false;
      out.classList.remove('flip-out'); inn.classList.add('flip-in');
      setTimeout(function() { inn.classList.remove('flip-in'); }, 260);
      face.setAttribute('aria-expanded', String(toBack));
      if (hint) hint.hidden = toBack;
    };
    if (reduce) return swap();
    out.classList.add('flip-out');
    setTimeout(swap, 170);
  };
  $('#manage-cardface').addEventListener('click', function() { flip(true); });
  $('#manage-flip-back').addEventListener('click', function() { flip(false); });
  // Picking a card design updates the big card right away
  $('#card-design-picker').addEventListener('click', function() {
    setTimeout(function() { renderManageCardFace(cachedAccounts && cachedAccounts.find(function(a) { return a.id === editingAccountId; })); }, 0);
  });
})();
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
  $('#apy-hint').hidden = !isDeposit;
  $('#apy-input').value = acct && acct.apy != null ? acct.apy : '';
  $('#edit-exclude').checked = !!(acct && acct.exclude_from_totals);
  $('#edit-hide').checked = !!(acct && acct.is_hidden);
  $('#manage-title').textContent = 'Manage ' + ((acct && acct.institution) || '') + ' account';
  $('#manage-subtitle').textContent = acct ? [acct.institution, acct.mask ? shownMask(acct.mask) : ''].filter(Boolean).join(' · ') : '';
  $('#manage-name').textContent = nicknameInput.value || (acct && acct.name) || 'Account';
  $('#manage-name-btn').hidden = false; nicknameInput.hidden = true;
  // Only credit cards and checking accounts come with a card. Savings, investments and loans
  // just show their details: no card, no flip, no card design.
  var hasCard = !!acct && (acct.type === 'credit' || (acct.type === 'depository' && acct.subtype !== 'savings'));
  accountEditModal.classList.toggle('no-card', !hasCard);
  $('#manage-flip-back').hidden = !hasCard;
  $('#card-design-picker-section').hidden = !hasCard;
  $('#manage-details').hidden = hasCard; $('#manage-cardface').hidden = !hasCard;
  $('#manage-cardface').setAttribute('aria-expanded', 'false'); $('#manage-hint').hidden = !hasCard;
  // A small tilt on open hints that the card can be tapped
  var cf = $('#manage-cardface'); cf.classList.remove('hint-tilt'); void cf.offsetWidth; cf.classList.add('hint-tilt');
  renderManageCardFace(acct);
  accountEditModal.classList.add('visible');
  var mc = accountEditModal.querySelector('.modal-card'); if (mc) mc.scrollTop = 0;
});

$('#account-edit-save').addEventListener('click', function() {
  if (!editingAccountId) return;

  // Save nickname -- update local state and re-render immediately
  var newName = nicknameInput.value.trim() || null;
  var prevAcct = cachedAccounts && cachedAccounts.find(function(a) { return a.id === editingAccountId; });
  if (prevAcct && (prevAcct.nickname || null) !== newName) {
    prevAcct.nickname = newName;
    refreshAccountNames();
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

// Remember which month and account you were looking at (and how far down you
// were) so leaving for another app doesn't drop you back on this month.
// Kept only while you're within your auto-lock time; after that, a fresh open
// starts on the current month again.
var TX_VIEW_KEY = 'alenjo_tx_view';
var txViewExpired = false;
function saveTxView(withScroll) {
  var m = $('#tx-month-filter'), c = $('#tx-card-filter');
  if (!m || !m.value) return;
  var v = { month: m.value, card: c ? c.value : 'all', at: Date.now() };
  var tabEl = document.getElementById('tab-transactions');
  if (withScroll && tabEl) v.scroll = tabEl.scrollTop;
  else { var old = readTxView(true); if (old && old.month === v.month && old.card === v.card) v.scroll = old.scroll; }
  try { localStorage.setItem(TX_VIEW_KEY, JSON.stringify(v)); } catch (e) {}
}
function readTxView(ignoreAge) {
  try {
    var v = JSON.parse(localStorage.getItem(TX_VIEW_KEY) || 'null');
    if (!v || !v.month) return null;
    if (!ignoreAge && Date.now() - (v.at || 0) > getLockMs()) return null;
    return v;
  } catch (e) { return null; }
}
function selectIfPresent(sel, value) {
  if (!sel || value == null) return false;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === value) { sel.selectedIndex = i; return true; }
  }
  return false;
}
var txListenersReady = false;
// Transactions window: the month before your first connection onward (two months of
// history by design), capped at 24 months.
function ymdLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
async function txWindowStart() {
  var now = new Date();
  var floor = new Date(now.getFullYear(), now.getMonth() - 24, 1);
  var start = floor;
  var fc = await sb.rpc('get_first_connection_date');
  if (fc.data) { var f = new Date(fc.data); start = new Date(f.getFullYear(), f.getMonth() - 1, 1); }
  var from = start < floor ? floor : start;
  txWindowFrom = ymdLocal(from);
  return from;
}
var txWindowFrom = null;

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

  var now = new Date();
  var dataStartDate = await txWindowStart();
  var dataStartStr = ymdLocal(dataStartDate);

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

  // Re-render snapshot: bonus trackers and interest estimates use tx data
  if (cachedAccounts && cachedAccounts.some(function(a) { return (a.type === 'credit' && a.bonus_target_amount) || a.apy; })) {
    renderAccounts(cachedAccounts);
  }

  // Load user actions and ignore rules
  var actionsResult = await fetchAllRows(function() { return sb.from('transaction_actions').select('transaction_id, action_type, split_ways, split_portion, amount_override, category_override, nickname, note, date_override').order('transaction_id'); });
  txActions = {};
  if (actionsResult.data) {
    actionsResult.data.forEach(function(a) { txActions[a.transaction_id] = a; });
  }
  var logoResult = await sb.from('merchant_logos').select('merchant_key, domain');
  merchantLogos = {};
  if (logoResult.data) logoResult.data.forEach(function(r) { merchantLogos[r.merchant_key] = r.domain; });
  await loadCustomLogos();
  var mapResult = await sb.from('user_category_map').select('source, display');
  catMap = {};
  if (mapResult.data) mapResult.data.forEach(function(r) { catMap[r.source] = r.display; });
  await loadBudgets();

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

  // Rebuilding the pickers resets them to this month, so note what was picked first.
  // Already on screen (a refresh on resume): keep it, unless you were away past
  // auto-lock. Fresh page load: use the saved view if it's still recent.
  var prevMonthSel = $('#tx-month-filter').value;
  var prevCardSel = $('#tx-card-filter').value;
  var restoredView = null;
  if (txViewExpired) { prevMonthSel = ''; prevCardSel = ''; }
  else if (!prevMonthSel) {
    restoredView = readTxView();
    if (restoredView) { prevMonthSel = restoredView.month; prevCardSel = restoredView.card; }
  }
  txViewExpired = false;

  // Populate month filter — parse YYYY-MM directly to avoid timezone issues
  var filter = $('#tx-month-filter');
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  filter.innerHTML = txMonths.map(function(m) {
    var parts = m.split('-');
    var full = monthNames[parseInt(parts[1]) - 1] + ' ' + parts[0];
    // The button shows just the month (year only when it isn't this year); the picker shows both
    var short = +parts[0] === now.getFullYear() ? monthNames[parseInt(parts[1]) - 1] : monthNames[parseInt(parts[1]) - 1].slice(0, 3) + ' ' + parts[0];
    return '<option value="' + m + '" data-full="' + full + '">' + short + '</option>';
  }).join('');

  // Show Plaid's real freshness time (when bank data was last updated)
  var updated = $('#tx-updated');
  var freshResult = await sb.from('plaid_items').select('plaid_last_checked_at, tx_last_synced_at').order('plaid_last_checked_at', { ascending: false, nullsFirst: false }).limit(1);
  if (freshResult.data && freshResult.data[0]) {
    var plaidTime = freshResult.data[0].plaid_last_checked_at;
    var syncTime = freshResult.data[0].tx_last_synced_at;
    // Up top: the exact day and time your bank data was last pulled
    var top = $('#act-updated'), when = plaidTime || syncTime;
    if (top && when) { top.textContent = 'Updated ' + whenExact(when); top.title = new Date(when).toLocaleString(); top.dataset.when = when; }
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
        cardFilter.innerHTML += '<option value="' + esc(a.plaid_account_id) + '">' + esc((a.nickname || a.name || 'Account') + (a.closed_at ? ' (closed)' : '')) + '</option>';
      }
    });
  }

  selectIfPresent(filter, prevMonthSel);
  selectIfPresent(cardFilter, prevCardSel);

  renderTransactionMonth();
  renderHomeInsights();
  if (restoredView && restoredView.scroll) {
    var txTab = document.getElementById('tab-transactions');
    if (txTab) requestAnimationFrame(function() { txTab.scrollTop = restoredView.scroll; });
  }

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

// The day the card was used (Plaid's authorized_date); falls back to the posted date
function swipeDate(tx) { return tx.authorized_date || tx.date; }
function getEffectiveTx(tx) {
  var action = txActions[tx.id];
  var result = {
    excluded: false, amount: tx.amount, category: tx.enriched_category_primary || tx.category,
    actionType: action ? action.action_type : null,
    splitWays: action ? action.split_ways : null,
    splitPortion: action ? action.split_portion : null,
    reimbursement: 0,
    nickname: null, note: null, date: swipeDate(tx),
    isSplit: false, isAdjusted: false, isRecategorized: false,
    removedByBank: !!tx.removed_at
  };
  // Your bank withdrew it: not counted until you choose to keep it
  if (tx.removed_at) { result.excluded = true; result.amount = 0; }
  if (!action) return result;
  if (action.nickname) result.nickname = action.nickname;
  if (action.note) result.note = action.note;
  if (action.date_override) result.date = action.date_override;
  if (action.action_type === 'ignored' || action.action_type === 'reimbursed') {
    result.excluded = true;
    result.amount = 0;
  }
  if (action.amount_override != null && action.amount_override !== '') {
    result.isAdjusted = true;
    result.adjustedAmount = parseFloat(action.amount_override);
    if (!result.excluded) result.amount = tx.amount > 0 ? result.adjustedAmount : -result.adjustedAmount;
  } else if (action.split_portion && action.split_portion > 0) {
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

// ---- Budgets: per category, per month. Money out is a spending limit (judged against an even
// pace through the month) or a fixed bill (paid vs expected). Money in is what you expect to receive.
var budgets = {};   // 'YYYY-MM' -> { out: {category: {amount}}, in: {...} }; each month has its own
function monthBudgets(month, side) {
  budgets[month] = budgets[month] || { out: {}, in: {} };
  return budgets[month][side];
}
async function loadBudgets() {
  var r = await sb.from('category_budgets').select('month, category, kind, amount, direction');
  budgets = {};
  (r.data || []).forEach(function(b) { monthBudgets(b.month, b.direction)[b.category] = { kind: b.kind, amount: parseFloat(b.amount) }; });
}
function prevMonthKey(month) {
  var p = month.split('-'), d = new Date(+p[0], +p[1] - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function wholeMoney(v) { return formatMoney(v); }   // keeps the cents
// Spending categories never use green: green means income
var CATEGORY_COLORS = [
  '#4F6BD8', '#D98A2B', '#8A5CC2', '#C2524A', '#3E8CC7',
  '#B0679A', '#B8913A', '#6D6AC9', '#D46A5A', '#5E7FA3',
  '#7D4E8F', '#9C5B3C', '#C04F86', '#A8956B', '#8C6A4F'
];
// Income sources: greens and teals (green means money in)
var INCOME_COLORS = ['var(--success)', '#4E9A73', '#3F7F86', '#7FB08F', '#5C8A5A', '#2F5F6E'];

// After renaming an account: Activity (rows, filter, add-transaction picker, open sheet) uses the new name right away
function refreshAccountNames() {
  if (!cachedAccounts) return;
  var byPlaid = {};
  cachedAccounts.forEach(function(a) { if (a.plaid_account_id) byPlaid[a.plaid_account_id] = (a.nickname || a.name || 'Account') + (a.closed_at ? ' (closed)' : ''); });
  ['#tx-card-filter', '#add-tx-account'].forEach(function(sel) {
    var el = $(sel); if (!el) return;
    Array.prototype.forEach.call(el.options, function(o) { if (byPlaid[o.value]) o.textContent = byPlaid[o.value]; });
  });
  if (txData && txData.length) renderTransactionMonth();
  if (typeof actionTx !== 'undefined' && actionTx && actionSheet && actionSheet.classList.contains('visible')) renderTxSheet(actionTx);
  syncPickerLabels();
}
function buildAccountMap() {
  var map = {};
  if (cachedAccounts) {
    cachedAccounts.forEach(function(a) {
      if (a.plaid_account_id) map[a.plaid_account_id] = a.nickname || (a.name || 'Account').replace(/\s*[*•]+\s*\d{2,4}\s*$/, '');
    });
  }
  return map;
}

var lastActKey = '';
function renderTransactionMonth() {
  sizeAcctFilter();
  var month = $('#tx-month-filter').value;
  var cardId = $('#tx-card-filter').value;
  saveTxView(false);
  if (month + '|' + cardId !== lastActKey) { activeDay = null; lastActKey = month + '|' + cardId; }
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
      if ((eff.note || '').toLowerCase().indexOf(searchVal) !== -1) return true;
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

  // On the earliest month you can open, "Show ignored" also lists anything you
  // moved to a month before it, so it can still be found and moved back.
  // These don't count toward this month's totals.
  var movedEarlier = {};
  if (showIgnoredTx && txMonths.length && month === txMonths[txMonths.length - 1]) {
    txData.forEach(function(tx) {
      var eff = getEffectiveTx(tx);
      if (eff.date.substring(0, 7) >= month) return;
      if (cardId !== 'all' && tx.plaid_account_id !== cardId) return;
      if (searchVal) {
        var hay = [eff.nickname, eff.note, tx.enriched_merchant_name, tx.merchant_name, tx.name].join(' ').toLowerCase();
        if (hay.indexOf(searchVal) === -1) return;
      }
      movedEarlier[tx.id] = eff.date.substring(0, 7);
      displayTx = displayTx.concat([tx]);
    });
  }

  // Filter by active category if pie slice clicked
  if (activeCategoryFilter) {
    displayTx = displayTx.filter(function(tx) {
      var eff = getEffectiveTx(tx);
      return normalizeCategory(eff.category) === activeCategoryFilter;
    });
  }

  if (activeDay) {
    displayTx = displayTx.filter(function(tx) { return parseInt(getEffectiveTx(tx).date.substring(8, 10), 10) === activeDay; });
  }

  // Money in view: only incoming money (no transfers between your accounts)
  if (incomeMode) {
    displayTx = displayTx.filter(function(tx) {
      var eff = getEffectiveTx(tx);
      return !eff.excluded && eff.amount < 0 && !isTransferCategory(baseCategory(eff.category));
    });
  }

  // ---- Summary: spent / money in / transfers (effective amounts, skip excluded)
  var byCategory = {}, spent = 0, moneyIn = 0, transfers = 0, byDay = {};
  var outByCat = {};
  filtered.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    if (eff.excluded) return;
    var cat = normalizeCategory(eff.category);
    // Transfers stay out of spending even if you renamed or deleted that category
    if (isTransferCategory(baseCategory(eff.category))) { transfers += Math.abs(eff.amount); return; }
    // The chart, chips and big number follow whichever side you're looking at
    var amt = Math.abs(eff.amount), isOut = eff.amount > 0;
    if (isOut) { spent += amt; outByCat[cat] = (outByCat[cat] || 0) + amt; } else moneyIn += amt;
    if (isOut === !incomeMode) {
      byCategory[cat] = (byCategory[cat] || 0) + amt;
      var day = parseInt(eff.date.substring(8, 10), 10);
      byDay[day] = byDay[day] || {};
      byDay[day][cat] = (byDay[day][cat] || 0) + amt;
    }
  });
  if (activeCategoryFilter && !byCategory[activeCategoryFilter]) activeCategoryFilter = null;
  var shownSpent = activeCategoryFilter ? byCategory[activeCategoryFilter] : (incomeMode ? moneyIn : spent);
  $('#act-spent-label').textContent = activeCategoryFilter ? activeCategoryFilter : (incomeMode ? 'Income' : 'Spent');
  $('#act-spent').textContent = (incomeMode && shownSpent > 0 && !hideMoney ? '+' : '') + formatMoney(shownSpent);
  $('#act-spent').classList.toggle('is-in', incomeMode);
  // One sentence: spent vs what came in this month (all accounts; transfers between your accounts left out)
  // Nothing picked: spent vs made. A category picked: its share of your income.
  // Income picked: how much of it you kept (your savings rate).
  var net = $('#act-net'), gap = Math.round((moneyIn - spent) * 100) / 100;
  var pctOf = function(x) { var v = x / moneyIn * 100; return (v > 0 && v < 0.1 ? '<0.1' : (Math.round(v * 10) / 10).toLocaleString('en-US')) + '%'; };
  if (cardId !== 'all' || (!moneyIn && !spent)) net.innerHTML = '';
  else if (incomeMode) {
    if (!moneyIn) net.innerHTML = 'Nothing has come in yet';
    else if (gap >= 0) net.innerHTML = 'You kept <b class="good">' + pctOf(gap) + '</b> of it · <button type="button" class="act-made-link" data-show-income="0">Back to spending</button>';
    else net.innerHTML = 'You spent <b class="bad">' + pctOf(-gap) + ' more</b> than this · <button type="button" class="act-made-link" data-show-income="0">Back to spending</button>';
  } else if (activeCategoryFilter) {
    // A category picked: its share of your income, then whether it's within its budget
    var catAmt = outByCat[activeCategoryFilter] || 0, cb = monthBudgets(month, 'out')[activeCategoryFilter];
    var parts = [];
    if (moneyIn) parts.push('<b>' + pctOf(catAmt) + '</b> of income');
    if (cb) parts.push(catAmt > cb.amount + 0.005 ? '<b class="bad">' + wholeMoney(catAmt - cb.amount) + ' over budget</b>' : '<b class="good">On budget</b>');
    net.innerHTML = parts.join(' · ') || 'No budget set';
  }
  else if (!moneyIn) net.innerHTML = 'Nothing has come in yet';
  // "the total you made" is a dashed green link: tap it to see your income
  else if (gap > 0) net.innerHTML = '<b class="good">' + wholeMoney(gap) + ' less</b>' + ' than <button type="button" class="act-made-link" data-show-income="1">the total you made</button>';
  else if (gap < 0) net.innerHTML = '<b class="bad">' + wholeMoney(-gap) + ' more</b>' + ' than <button type="button" class="act-made-link" data-show-income="1">the total you made</button>';
  else net.innerHTML = 'Spent exactly' + ' <button type="button" class="act-made-link" data-show-income="1">the total you made</button>';
  $('#act-bars').setAttribute('aria-label', (incomeMode ? 'Money in' : 'Spending') + ' by day. Tap a day to see its transactions.');

  // ---- One chart: spending by day, each bar stacked by category.
  // The category chips under it are the legend and the filter.
  var catEntries = Object.keys(byCategory).map(function(k) { return [k, byCategory[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  var categoryColorMap = {};
  // Money in is always green (income sources in greens); spending never is
  var barPalette = incomeMode ? INCOME_COLORS : CATEGORY_COLORS;
  catEntries.forEach(function(e, i) { categoryColorMap[e[0]] = barPalette[i % barPalette.length]; });
  var parts = month.split('-'), y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  var daysInMonth = new Date(y, m, 0).getDate();
  var now = new Date();
  var isThisMonth = now.getFullYear() === y && now.getMonth() + 1 === m;
  var lastDay = isThisMonth ? now.getDate() : daysInMonth;
  if (activeDay && activeDay > lastDay) activeDay = null;
  // Picked a day that doesn't have the filtered category: drop the category filter
  if (activeDay && activeCategoryFilter && !(byDay[activeDay] || {})[activeCategoryFilter]) { activeCategoryFilter = null; return renderTransactionMonth(); }
  var dayTotal = function(d) {
    var o = byDay[d] || {};
    if (activeCategoryFilter) return o[activeCategoryFilter] || 0;
    return Object.keys(o).reduce(function(s, k) { return s + o[k]; }, 0);
  };
  var maxDay = 0;
  for (var dd = 1; dd <= lastDay; dd++) maxDay = Math.max(maxDay, dayTotal(dd));
  // Scrollable bars: Week / 2 weeks fill the width with that many days, Month fits them all
  var vis = Math.min(actRange, daysInMonth);
  var barsEl = $('#act-bars');
  barsEl.style.setProperty('--vis', vis);
  barsEl.classList.toggle('dense', vis > 14);
  var bars = '';
  for (var d = 1; d <= daysInMonth; d++) {
    var future = d > lastDay;
    var total = future ? 0 : dayTotal(d);
    var date = new Date(y, m - 1, d);
    var h = total && maxDay ? Math.max(4, Math.sqrt(total / maxDay) * 100) : 0;
    var segs = '';
    if (total) catEntries.forEach(function(e) {
      var v = (byDay[d] || {})[e[0]];
      if (!v || (activeCategoryFilter && activeCategoryFilter !== e[0])) return;
      segs += '<i style="flex-grow:' + v.toFixed(2) + ';background:' + categoryColorMap[e[0]] + '"></i>';
    });
    var showLabel = vis <= 14 || d === 1 || d % 7 === 1 || d === daysInMonth;
    bars += '<button type="button" class="act-bar' + (activeDay === d ? ' on' : '') + (activeDay && activeDay !== d ? ' dim' : '') + (isThisMonth && d === now.getDate() ? ' today' : '') + '" data-day="' + d + '"' + (future ? ' disabled' : '') +
      ' aria-pressed="' + (activeDay === d) + '" aria-label="' + MONTH_SHORT[m - 1] + ' ' + d + ': ' + formatMoney(total) + '">' +
      '<span class="act-bar-col">' + (h ? '<span class="act-bar-fill" style="height:' + h.toFixed(1) + '%">' + segs + '</span>' : '<span class="act-bar-zero"></span>') + '</span>' +
      '<span class="act-bar-label">' + (showLabel ? (vis <= 14 ? '<small>' + 'SMTWTFS'.charAt(date.getDay()) + '</small>' : '') + d : '') + '</span>' +
    '</button>';
  }
  var keepScroll = barsEl.dataset.month === month && barsEl.dataset.vis === String(vis);
  var prevScroll = barsEl.scrollLeft;
  barsEl.innerHTML = bars;
  // Start at the most recent days (or the picked day); keep position on re-render
  if (keepScroll) barsEl.scrollLeft = prevScroll;
  else { barsEl._focusDay = activeDay || lastDay; scrollBarsToFocus(); }
  barsEl.dataset.month = month; barsEl.dataset.vis = String(vis);
  $('#act-range').querySelectorAll('button').forEach(function(b) { b.classList.toggle('on', Math.min(+b.dataset.range, daysInMonth) === vis); });
  // ---- Budgets: this month's own, shown on the category pills (whole month, all accounts)
  var B = monthBudgets(month, 'out'), BI = monthBudgets(month, 'in');
  var expectedIn = Object.keys(BI).reduce(function(t, c) { return t + BI[c].amount; }, 0);
  var budgetOn = cardId === 'all' && !activeDay && (Object.keys(B).length > 0 || expectedIn > 0);
  if (activeDay) net.innerHTML = '';

  if (activeDay) {
    var dayAmt = dayTotal(activeDay);
    $('#act-spent-label').textContent = new Date(y, m - 1, activeDay).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + (activeCategoryFilter ? ' · ' + activeCategoryFilter : '');
    $('#act-spent').textContent = formatMoney(dayAmt);
    $('#act-daily-note').innerHTML = '<button type="button" class="signin-link" id="act-clear-day">Show all of ' + MONTH_LONG[m - 1] + '</button>';
  } else if (cardId === 'all') {
    var anyB = Object.keys(B).length > 0;
    $('#act-daily-note').innerHTML = '<button type="button" class="signin-link" id="act-set-budget">Budgets</button>';
  } else {
    $('#act-daily-note').textContent = '';
  }

  // Legend under the bars: names only, 6 to a page, swipe for more (dots show the page).
  // Income first (green), then spending categories in the same colours as the bars.
  // With a day picked, only that day's categories.
  var outEntries = Object.keys(outByCat).map(function(k) { return [k, outByCat[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  var outColors = {};
  outEntries.forEach(function(e, i) { outColors[e[0]] = CATEGORY_COLORS[i % CATEGORY_COLORS.length]; });
  var legEntries = outEntries;
  if (activeDay && !incomeMode) {
    var od = byDay[activeDay] || {};
    legEntries = Object.keys(od).map(function(k) { return [k, od[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  } else if (activeDay && incomeMode) legEntries = [];
  var legItem = function(name, color, on, isIncome) {
    var dim = (incomeMode || activeCategoryFilter) && !on;
    return '<button type="button" class="act-leg' + (on ? ' on' : '') + (dim ? ' dim' : '') + '"' + (isIncome ? ' data-income="1"' : ' data-cat="' + esc(name) + '"') + ' aria-pressed="' + on + '"><i style="background:' + color + '"></i><span>' + esc(name) + '</span></button>';
  };
  var legItems = legEntries.map(function(e) {
    return legItem(e[0], outColors[e[0]] || categoryColorMap[e[0]], !incomeMode && activeCategoryFilter === e[0], false);
  });
  var legPages = paginateLegend(legend, legItems);
  var legKey = month + '|' + cardId + '|' + (activeDay || '');
  var keepLeg = legend.dataset.key === legKey ? legend.scrollLeft : 0;
  legend.innerHTML = legPages.join('') || '<p class="act-empty-note">' + (activeDay ? 'Nothing this day.' : 'Nothing yet this month.') + '</p>';
  legend.dataset.key = legKey;
  legend.scrollLeft = keepLeg;
  $('#act-leg-dots').innerHTML = legPages.length > 1 ? legPages.map(function(_, i) { return '<button type="button" data-page="' + i + '" aria-label="Page ' + (i + 1) + ' of ' + legPages.length + '"></button>'; }).join('') : '';
  updateLegendDots();

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
    groupMap[key].forEach(function(tx) { var e = getEffectiveTx(tx); if (!e.excluded && !movedEarlier[tx.id]) dayNet -= e.amount; });
    html += '<div class="act-day"><div class="act-day-head"><span>' + friendlyDay(key) + '</span><span>' + (dayNet > 0 ? '+' : dayNet < 0 ? '−' : '') + formatMoney(dayNet) + '</span></div>';
    groupMap[key].forEach(function(tx) {
      var eff = getEffectiveTx(tx);
      var name = eff.nickname || tx.enriched_merchant_name || tx.merchant_name || tx.name || 'Unknown';
      var cat = normalizeCategory(eff.category);
      var acctName = accountMap[tx.plaid_account_id] || (tx.plaid_account_id ? 'Account' : 'Cash');
      var color = accountColor(tx.plaid_account_id);
      var income = tx.amount < 0;
      var tags = '';
      if (tx.pending) tags += '<span class="act-tag act-tag-pending">Pending</span>';
      if (eff.removedByBank) tags += '<span class="act-tag act-tag-pending">Removed by bank</span>';
      if (movedEarlier[tx.id]) tags += '<span class="act-tag act-tag-pending">Moved to ' + MONTH_LONG[parseInt(movedEarlier[tx.id].substring(5, 7), 10) - 1] + '</span>';
      else if (eff.date !== swipeDate(tx)) tags += '<span class="act-tag">Moved</span>';
      if (eff.actionType === 'reimbursed') tags += '<span class="act-tag">Reimbursed</span>';
      if (eff.actionType === 'ignored') tags += '<span class="act-tag">Ignored</span>';
      if (!eff.excluded && eff.isAdjusted) tags += '<span class="act-tag act-tag-adjusted">Adjusted</span>';
      else if (!eff.excluded && eff.isSplit) tags += '<span class="act-tag act-tag-split">' + (eff.splitWays ? 'Split ' + eff.splitWays + ' ways' : 'Split') + '</span>';
      if (eff.nickname) tags += '<span class="act-tag">Renamed</span>';
      // Store logo (see txLogoUrl); the first letter shows underneath as a fallback
      var logoSrc = txLogoUrl(tx, eff);
      var avatar = '<span class="act-avatar" data-i="' + esc(name.charAt(0).toUpperCase()) + '">' +
        (logoSrc ? '<img src="' + esc(logoSrc) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>';
      var amountMain = (income ? '+' : '−') + formatMoney((eff.isSplit || eff.isAdjusted) && !eff.excluded ? eff.amount : tx.amount);
      html += '<div class="tx-row act-row' + (eff.excluded || movedEarlier[tx.id] ? ' is-excluded' : '') + '" role="button" tabindex="0" data-txid="' + esc(tx.id) + '">' +
        avatar +
        '<span class="act-row-main"><span class="act-row-name">' + esc(name) + '</span>' +
        '<span class="act-row-meta">' + (showCardName ? esc(acctName) + ' · ' : '') + esc(cat) + '</span>' +
        (eff.note ? '<span class="act-row-note">' + esc(eff.note) + '</span>' : '') + '</span>' +
        '<span class="act-row-right"><span class="act-row-amt ' + (tx.pending ? 'is-pending' : income ? 'is-in' : 'is-out') + '">' + amountMain + '</span>' +

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
    '<summary><span class="card-more-sum">' + summary + '</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>' +
    '<div class="card-more-body">' + body + '</div></details>';
}
document.addEventListener('toggle', function(e) {
  var d = e.target;
  if (d.classList && d.classList.contains('card-more')) openCardSections[d.dataset.key] = d.open;
}, true);

// In-app picker sheet instead of the native select popup (keeps the app's look)
var pickerSelect = null;
function openPicker(sel) {
  pickerSelect = sel;
  var label = sel.getAttribute('aria-label') || (sel.id && document.querySelector('label[for="' + sel.id + '"]') ? document.querySelector('label[for="' + sel.id + '"]').textContent : 'Choose');
  $('#picker-title').textContent = label;
  $('#picker-list').innerHTML = Array.prototype.map.call(sel.options, function(o, i) {
    var on = i === sel.selectedIndex;
    return '<button type="button" class="picker-row' + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" data-i="' + i + '"><span>' + esc(o.dataset.full || o.textContent) + '</span>' +
      (on ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>' : '') + '</button>';
  }).join('');
  var ov = $('#picker-sheet');
  ov.classList.add('visible'); ov.setAttribute('aria-hidden', 'false');
  var cur = ov.querySelector('.picker-row.on');
  if (cur) { cur.scrollIntoView({ block: 'center' }); cur.focus({ preventScroll: true }); }
}
function closePicker() {
  var ov = $('#picker-sheet');
  ov.classList.remove('visible'); ov.setAttribute('aria-hidden', 'true');
  if (pickerSelect && pickerSelect.parentNode.querySelector('.picker-hit')) pickerSelect.parentNode.querySelector('.picker-hit').focus({ preventScroll: true });
  pickerSelect = null;
}
(function wirePicker() {
  var ov = $('#picker-sheet');
  if (!ov) return;
  ov.addEventListener('click', function(e) {
    var row = e.target.closest('.picker-row');
    if (row && pickerSelect) {
      var sel = pickerSelect, i = +row.dataset.i;
      closePicker();
      if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    if (e.target === ov) closePicker();
  });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && ov.classList.contains('visible')) closePicker(); });
  // A transparent button over each select opens the picker
  document.querySelectorAll('select:not(.visually-hidden)').forEach(function(sel) {
    var wrap = document.createElement('span');
    wrap.className = 'picker-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.tabIndex = -1;
    var hit = document.createElement('button');
    hit.type = 'button'; hit.className = 'picker-hit';
    hit.setAttribute('aria-label', (sel.getAttribute('aria-label') || 'Choose') + ': ' + (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : ''));
    hit.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); openPicker(sel); });
    wrap.appendChild(hit);
  });
})();

// Legend pages: never more than two rows (and at most 6 names) per page.
// Long names like "Rent & utilities" take more room, so a page may hold fewer.
function paginateLegend(legend, items) {
  var pages = [], i, avail = legend.clientWidth - 8, GAP = 4;
  if (avail <= 0) {   // not on screen yet: fall back to 6 per page
    for (i = 0; i < items.length; i += 6) pages.push(items.slice(i, i + 6));
  } else {
    legend.innerHTML = '<div class="act-leg-page">' + items.join('') + '</div>';
    var widths = Array.prototype.map.call(legend.firstChild.children, function(el) { return Math.ceil(el.getBoundingClientRect().width); });
    var page = [], rows = 1, rowW = 0;
    items.forEach(function(it, k) {
      var w = Math.min(widths[k], avail);
      if (page.length === 6) { pages.push(page); page = []; rows = 1; rowW = 0; }
      if (rowW && rowW + GAP + w > avail) {
        if (rows === 2) { pages.push(page); page = []; rows = 1; }
        else rows = 2;
        rowW = 0;
      }
      rowW += (rowW ? GAP : 0) + w;
      page.push(it);
    });
    if (page.length) pages.push(page);
  }
  return pages.map(function(p) { return '<div class="act-leg-page">' + p.join('') + '</div>'; });
}
// Which legend page you're on
function updateLegendDots() {
  var leg = $('#tx-category-legend'), dots = $('#act-leg-dots');
  if (!leg || !dots || !dots.children.length) return;
  var at = Math.round(leg.scrollLeft / Math.max(1, leg.clientWidth));
  Array.prototype.forEach.call(dots.children, function(d, i) { d.classList.toggle('on', i === at); d.setAttribute('aria-current', i === at ? 'true' : 'false'); });
}
var activeDay = null;
var incomeMode = false;   // Activity: false = spending, true = money in

// Scroll the day bars so the focus day (today, or the picked day) is at the right edge.
// If the tab is hidden (width 0) this waits until it's shown.
function scrollBarsToFocus() {
  var el = $('#act-bars');
  if (!el || !el._focusDay || !el.clientWidth) return;
  var col = el.scrollWidth / el.children.length;
  el.scrollLeft = Math.max(0, el._focusDay * col - el.clientWidth);
  el._focusDay = null;
}
if (window.ResizeObserver) {
  new ResizeObserver(function() { requestAnimationFrame(function() { scrollBarsToFocus(); updateLegendDots(); }); })
    .observe(document.getElementById('tx-content'));
}
var actRange = parseInt(localStorage.getItem('alenjo_act_range') || '7', 10) || 7;
(function wireActBars() {
  var bars = $('#act-bars'), range = $('#act-range'), note = $('#act-daily-note');
  if (!bars) return;
  bars.addEventListener('click', function(e) {
    var b = e.target.closest('.act-bar');
    if (!b || b.disabled) return;
    var d = +b.dataset.day;
    activeDay = activeDay === d ? null : d;
    renderTransactionMonth();
  });
  range.addEventListener('click', function(e) {
    var b = e.target.closest('button[data-range]');
    if (!b) return;
    actRange = +b.dataset.range;
    try { localStorage.setItem('alenjo_act_range', String(actRange)); } catch (err) {}
    renderTransactionMonth();
  });
  note.addEventListener('click', function(e) {
    if (e.target.id === 'act-clear-day') { activeDay = null; renderTransactionMonth(); }
    if (e.target.id === 'act-set-budget') openBudgetSheet('out');
  });
  // "the total you made" / "Back to spending" under the big number
  $('#act-net').addEventListener('click', function(e) {
    var b = e.target.closest('[data-show-income]'); if (!b) return;
    incomeMode = b.dataset.showIncome === '1'; activeCategoryFilter = null;
    renderTransactionMonth();
  });
  // Legend: tap a name to filter (again to clear)
  var legend = $('#tx-category-legend');
  legend.addEventListener('click', function(e) {
    var el = e.target.closest('.act-leg'); if (!el) return;
    if (el.dataset.income) { incomeMode = !incomeMode; activeCategoryFilter = null; }
    else { incomeMode = false; activeCategoryFilter = activeCategoryFilter === el.dataset.cat ? null : el.dataset.cat; }
    renderTransactionMonth();
  });
  legend.addEventListener('scroll', function() { requestAnimationFrame(updateLegendDots); }, { passive: true });
  $('#act-leg-dots').addEventListener('click', function(e) {
    var d = e.target.closest('[data-page]'); if (!d) return;
    legend.scrollTo({ left: +d.dataset.page * legend.clientWidth, behavior: 'smooth' });
  });
})();

// Privacy / Security / FAQ open inside the app (no new browser window, no white flash,
// and you stay signed in)
(function wireInfoPanel() {
  // Privacy, Security and FAQ aren't on the public site: they're stored in the database,
  // readable only when signed in, and shown here inside the app.
  var panel = $('#info-panel'), frame = $('#info-frame');
  if (!panel) return;
  var lastFocus = null, pages = {};
  async function pageHtml(slug) {
    if (pages[slug]) return pages[slug];
    var res = await sb.from('info_pages').select('gz_b64').eq('slug', slug).maybeSingle();
    if (res.error || !res.data) throw new Error('not available');
    var bin = atob(res.data.gz_b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    pages[slug] = await new Response(stream).text();
    return pages[slug];
  }
  async function show(slug, hash) {
    if (!currentUser) return;
    frame.classList.remove('loaded');
    if (panel.hidden) {
      panel.hidden = false;
      requestAnimationFrame(function() { panel.classList.add('open'); });
    }
    try {
      var html = await pageHtml(slug);
      var theme = document.documentElement.getAttribute('data-theme') || 'light';
      frame.srcdoc = html.replace('<head>', '<head><script>window.__ALENJO_EMBED = 1; window.__ALENJO_THEME = ' + JSON.stringify(theme) + ';<\/script>');
      frame.onload = function() {
        frame.classList.add('loaded');
        if (hash) { try { var el = frame.contentDocument.getElementById(hash); if (el) el.scrollIntoView(); } catch (e) {} }
      };
    } catch (err) {
      close();
      showToast("Couldn't open that page. Check your connection and try again.");
    }
  }
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[data-info]');
    if (!a) return;
    e.preventDefault();
    lastFocus = a;
    var href = a.getAttribute('href');
    show(href.split('#')[0].replace(/^[/]/, '').replace(/[.]html$/, ''), href.split('#')[1] || '');
    // Only move focus for keyboard users; on touch it drew a focus box around Back
    if (e.detail === 0) $('#info-close').focus();
  });
  // Links between the three pages come from inside the page
  window.addEventListener('message', function(e) {
    if (e.source !== frame.contentWindow || !e.data || !e.data.alenjoInfo) return;
    if (['privacy', 'security', 'faq'].indexOf(e.data.alenjoInfo) < 0) return;
    show(e.data.alenjoInfo, e.data.hash || '');
  });
  var close = function() {
    panel.classList.remove('open');
    setTimeout(function() { panel.hidden = true; frame.removeAttribute('srcdoc'); frame.src = 'about:blank'; }, 250);
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  };
  $('#info-close').addEventListener('click', close);
  panel.addEventListener('click', function(e) { if (e.target === panel) close(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && !panel.hidden) close(); });
})();

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
// Account filter hugs whatever is selected (capped by CSS max-width, long names still get "…")
var _measureCtx = null;
function sizeAcctFilter() {
  var sel = $('#tx-card-filter'), box = sel && sel.closest('.act-acct');
  if (!box || !sel.options.length) return;
  var text = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
  _measureCtx = _measureCtx || document.createElement('canvas').getContext('2d');
  var cs = getComputedStyle(sel);
  _measureCtx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  var pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  box.style.width = Math.ceil(_measureCtx.measureText(text).width + pad + 2) + 'px';
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function() { sizeAcctFilter(); });
function syncPickerLabels() {
  sizeAcctFilter();
  document.querySelectorAll('.picker-wrap').forEach(function(w) {
    var sel = w.querySelector('select'), hit = w.querySelector('.picker-hit');
    if (sel && hit) hit.setAttribute('aria-label', (sel.getAttribute('aria-label') || 'Choose') + ': ' + (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : ''));
  });
}
function updateMonthButtons() {
  syncPickerLabels();
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

// Excel export: a formatted workbook (table with category and status chips,
// a Summary tab with live monthly totals, and charts). The builder loads only
// when you tap Export. Covers every month; follows the account filter.
var xlsxLoading = null;
function loadXlsxBuilder() {
  if (window.AlenjoXlsx) return Promise.resolve();
  if (!xlsxLoading) xlsxLoading = new Promise(function(res, rej) {
    var sc = document.createElement('script');
    sc.src = '/xlsx-export.js?v=' + (typeof _v !== 'undefined' ? _v : '');
    sc.onload = res; sc.onerror = function() { xlsxLoading = null; rej(new Error('load')); };
    document.head.appendChild(sc);
  });
  return xlsxLoading;
}
// Rows for the workbook: one month or everything, following the account filter, skipping ignored
function exportRows(month) {
  var cardId = $('#tx-card-filter').value, acct = buildAccountMap(), rows = [];
  txData.forEach(function(tx) {
    if (cardId !== 'all' && tx.plaid_account_id !== cardId) return;
    var eff = getEffectiveTx(tx);
    if (eff.actionType === 'ignored' || eff.removedByBank) return;
    if (month && eff.date.slice(0, 7) !== month) return;
    var status = tx.pending ? 'Pending'
      : eff.actionType === 'reimbursed' ? 'Reimbursed'
      : eff.isAdjusted ? 'Adjusted'
      : eff.isSplit ? (eff.splitWays ? 'Split ' + eff.splitWays + ' ways' : 'Split')
      : !tx.plaid_account_id ? 'Manual' : '';
    rows.push({
      date: eff.date, name: eff.nickname || tx.merchant_name || tx.name || 'Unknown',
      category: normalizeCategory(eff.category),
      account: tx.plaid_account_id ? acct[tx.plaid_account_id] || 'Account' : 'Cash',
      amount: -eff.amount, full: -tx.amount, status: status, note: eff.note || ''
    });
  });
  return rows;
}
function monthLabel(m) { return MONTH_LONG[parseInt(m.slice(5, 7), 10) - 1] + ' ' + m.slice(0, 4); }

(function wireExport() {
  var sheet = $('#export-sheet');
  function close() { sheet.classList.remove('visible'); sheet.setAttribute('aria-hidden', 'true'); }
  $('#btn-export-xlsx').addEventListener('click', function() {
    var month = $('#tx-month-filter').value;
    var nMonth = exportRows(month).length, nAll = exportRows(null).length;
    $('#export-month-label').textContent = monthLabel(month) + ' only';
    $('#export-month-sub').textContent = nMonth + ' transaction' + (nMonth === 1 ? '' : 's');
    $('#export-all-sub').textContent = nAll + ' transactions, every month, with a month-by-month summary';
    $('#export-month').disabled = !nMonth; $('#export-all').disabled = !nAll;
    sheet.classList.add('visible'); sheet.setAttribute('aria-hidden', 'false');
    loadXlsxBuilder().catch(function() {});   // ready by the time you pick
  });
  $('#export-cancel').addEventListener('click', close);
  $('#export-month').addEventListener('click', function() { doExport($('#tx-month-filter').value, this); });
  $('#export-all').addEventListener('click', function() { doExport(null, this); });

  async function doExport(month, btn) {
    var rows = exportRows(month);
    if (!rows.length) return;
    var cardId = $('#tx-card-filter').value, acct = buildAccountMap();
    // Same palette as the app, biggest spending category first
    var totals = {};
    rows.forEach(function(r) { if (r.amount < 0 && !isTransferCategory(r.category)) totals[r.category] = (totals[r.category] || 0) - r.amount; });
    var colors = {};
    Object.keys(totals).sort(function(a, b) { return totals[b] - totals[a]; }).forEach(function(c, i) { colors[c] = CATEGORY_COLORS[i % CATEGORY_COLORS.length]; });
    var bud = {};
    Object.keys(budgets).forEach(function(m) {
      var out = (budgets[m] && budgets[m].out) || {};
      bud[m] = {};
      Object.keys(out).forEach(function(c) { bud[m][c] = +out[c].amount; });
    });
    var label = btn.querySelector('b').textContent;
    btn.disabled = true;
    try {
      if (!window.AlenjoXlsx) { btn.querySelector('b').textContent = 'Preparing…'; await loadXlsxBuilder(); }
      var today = new Date();
      var scope = (month ? monthLabel(month) : 'Spending summary') + (cardId === 'all' ? '' : ' · ' + (acct[cardId] || 'Account'));
      var blob = window.AlenjoXlsx.build({
        rows: rows, categories: allCategories(), colors: colors, budgets: bud, title: scope,
        exported: today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      });
      // "November 21 2026 Alenjo Transaction Data.xlsx"
      var name = MONTH_LONG[today.getMonth()] + ' ' + today.getDate() + ' ' + today.getFullYear() + ' Alenjo Transaction Data.xlsx';
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
      close();
    } catch (e) {
      console.error('Export failed:', e);
      showToast('Couldn’t make the Excel file. Try again.');
    } finally {
      btn.disabled = false; btn.querySelector('b').textContent = label;
    }
  }
})();

// ============================================
// ADD MANUAL TRANSACTION
// ============================================
var addTxSheet = $('#add-tx-sheet');

// Money out (a purchase) or money in (a deposit, paycheck, refund)
var addTxDir = 'out';
function setAddTxDir(dir) {
  addTxDir = dir;
  document.querySelectorAll('.add-tx-dir button').forEach(function(b) { b.setAttribute('aria-pressed', String(b.dataset.dir === dir)); });
  var cat = $('#add-tx-category');
  if (dir === 'in' && cat.value === 'OTHER') cat.value = 'INCOME';
  if (dir === 'out' && cat.value === 'INCOME') cat.value = 'OTHER';
}
document.querySelectorAll('.add-tx-dir button').forEach(function(b) {
  b.addEventListener('click', function() { setAddTxDir(b.dataset.dir); });
});

$('#btn-add-tx').addEventListener('click', function() {
  // Reset form
  $('#add-tx-name').value = '';
  $('#add-tx-amount').value = '';
  $('#add-tx-date').value = ymdLocal(new Date());
  // Only dates Activity shows: from the start of your history through today
  $('#add-tx-date').max = ymdLocal(new Date());
  if (txWindowFrom) $('#add-tx-date').min = txWindowFrom;
  $('#add-tx-category').value = 'OTHER';
  setAddTxDir('out');

  // Populate account dropdown with Cash first, then linked accounts
  var acctSelect = $('#add-tx-account');
  acctSelect.innerHTML = '<option value="cash" data-account-id="" data-plaid-item-id="">Cash</option>';
  if (cachedAccounts) {
    var usedAcct = {};
    txData.forEach(function(t) { if (t.plaid_account_id) usedAcct[t.plaid_account_id] = true; });
    cachedAccounts.forEach(function(a) {
      if (a.plaid_account_id && usedAcct[a.plaid_account_id] && !a.closed_at) {
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
  if (date > ymdLocal(new Date())) { showToast("Pick a date that isn't in the future"); return; }
  if (txWindowFrom && date < txWindowFrom) { showToast('Pick a date in the months Activity shows'); return; }

  // Plaid convention: positive = money out, negative = money in
  var amount = addTxDir === 'in' ? -amountVal : amountVal;

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
    if (result.error) {
      console.error('Insert manual tx error:', result.error);
      txData = txData.filter(function(t) { return t.id !== txId; });
      renderTransactionMonth();
      showToast("Couldn't save that transaction. Try again.");
    }
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
// Your category edits: catMap[original] = new name, or null when you deleted it
var catMap = {};
function normalizeCategory(cat) {
  var name = baseCategory(cat);
  for (var i = 0; i < 4 && Object.prototype.hasOwnProperty.call(catMap, name); i++) {
    if (catMap[name] === null) return 'Uncategorized';
    if (catMap[name] === name) break;
    name = catMap[name];
  }
  return name;
}
function baseCategory(cat) {
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
  txEditing = false; txDraft = {}; txDraftLogo = undefined;
  $('#txs-confirm').hidden = true;
  var action = txActions[tx.id] || {};
  renderMonthMove(tx);
  var noteEl = $('#tx-note');
  noteEl.value = action.note || '';
  noteEl._orig = noteEl.value;
  autoGrowNote();

  renderTxSheet(tx);

  // Reset sub-pickers
  $('#split-picker').hidden = true;
  $('#recat-picker').hidden = true;
  $('#edit-picker').hidden = true;
  $('#logo-picker').hidden = true;
  $('#tx-action-options').hidden = false;

  actionSheet.classList.add('visible');
}

// Fill the transaction sheet (called on open and after every change).
// In edit mode it shows your unsaved edits on top of what's saved.
function renderTxSheet(tx) {
  withTxPreview(function() { renderTxSheetInner(tx); });
  applyTxEditUi();
}
function renderTxSheetInner(tx) {
  var action = txActions[tx.id] || {}, eff = getEffectiveTx(tx);
  var bankName = tx.enriched_merchant_name || tx.merchant_name || tx.name || 'Unknown';
  var name = eff.nickname || bankName;
  $('#tx-action-merchant').textContent = name;
  $('#txs-name-adj').hidden = !eff.nickname;
  $('#txs-name-adj').textContent = 'Renamed';
  $('#txs-name-btn').hidden = false; $('#txs-name-input').hidden = true;
  var logo = txLogoUrl(tx, eff);
  $('#txs-avatar').setAttribute('data-i', name.charAt(0).toUpperCase());
  $('#txs-avatar').innerHTML = logo ? '<img src="' + esc(logo) + '" alt="" onerror="this.remove()">' : '';

  var parts = [];
  var acctNm = tx.plaid_account_id ? buildAccountMap()[tx.plaid_account_id] : 'Cash';
  if (acctNm) parts.push(acctNm);
  if (tx.enriched_location_city || tx.enriched_location_region) parts.push([tx.enriched_location_city, tx.enriched_location_region].filter(Boolean).join(', '));
  if (tx.enriched_payment_channel === 'online') parts.push('Online');
  else if (tx.enriched_payment_channel === 'in store') parts.push('In store');
  $('#tx-action-detail').textContent = parts.join(' · ');
  renderTxFacts(tx);

  var income = tx.amount < 0, total = Math.abs(tx.amount);
  var counted = (eff.isSplit || eff.isAdjusted) && !eff.excluded ? Math.abs(eff.amount) : total;
  var amtEl = $('#tx-action-amount');
  amtEl.textContent = (income ? '+' : '−') + formatMoney(counted);
  amtEl.className = 'txs-amt ' + (tx.pending ? 'is-pending' : income ? 'is-in' : 'is-out');
  $('#txs-amt-btn').hidden = false; $('#txs-amt-edit').hidden = true;
  var amtTag = $('#txs-amt-adj');
  amtTag.hidden = eff.excluded || !(eff.isSplit || eff.isAdjusted);
  amtTag.textContent = eff.isAdjusted ? 'Adjusted' : eff.splitWays ? 'Split ' + eff.splitWays + ' ways' : 'Split';
  amtTag.className = 'txs-adj ' + (eff.isAdjusted ? 'is-adjusted' : 'is-split');
  $('#txs-amt-sub').textContent = eff.removedByBank ? 'Removed by your bank · not counted' : eff.excluded ? (eff.actionType === 'reimbursed' ? 'Reimbursed · not counted in spending' : 'Ignored · not counted in spending')
    : tx.pending ? 'Pending' : '';

  $('#txs-cat-val').textContent = normalizeCategory(eff.category);
  $('#txs-cat-dot').hidden = !action.category_override;
  $('#txs-split-val').textContent = action.split_ways > 1 ? action.split_ways + ' ways' : action.split_portion > 0 ? 'Custom' : 'Off';
  document.querySelectorAll('#tx-action-options .action-toggle').forEach(function(btn) {
    btn.classList.toggle('active', action.action_type === btn.dataset.toggle);
    btn.setAttribute('aria-pressed', action.action_type === btn.dataset.toggle);
  });
  var changed = !!(action.action_type || action.split_ways || action.split_portion || action.amount_override != null || action.category_override || action.nickname || action.date_override || action.note);
  document.querySelector('.action-option-clear').hidden = !changed;
  $('#btn-delete-tx').hidden = !(tx.id && (tx.id.indexOf('manual_') === 0 || tx.removed_at));
  var delBtn = $('#btn-delete-tx');
  if (delBtn._armed) { clearTimeout(delBtn._t); delBtn._armed = false; delBtn.textContent = delBtn._label; }
  var st = $('#tx-action-status');
  if (tx.removed_at) {
    var when = new Date(tx.removed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    st.className = 'txs-removed';
    st.innerHTML = '<p><b>Your bank removed this on ' + esc(when) + '.</b> That usually means it was a duplicate or got reversed, so it isn’t counted. If it really happened, keep it.</p>' +
      '<button type="button" class="btn-primary-sm" id="txs-keep">Keep it</button>';
    st.hidden = false;
  } else {
    st.hidden = true; st.innerHTML = ''; st.className = '';
  }
  renderMonthMove(tx);
}

// ---- Edit mode: one pencil (top right) makes everything editable at once; Save applies it all ----
var txEditing = false, txDraft = {}, txDraftLogo;
function txBankName(tx) { return tx.enriched_merchant_name || tx.merchant_name || tx.name || ''; }
// Saved changes for this transaction with your unsaved edits on top
function txDraftAction() {
  var a = Object.assign({}, txActions[actionTxId] || {});
  Object.keys(txDraft).forEach(function(k) { if (k.charAt(0) !== '_') a[k] = txDraft[k]; });
  return a;
}
// Run fn as if the edits were saved (only touches this transaction and its store logo, then puts them back)
function withTxPreview(fn) {
  if (!txEditing || !actionTx) return fn();
  var id = actionTx.id, hadA = txActions.hasOwnProperty(id), oldA = txActions[id];
  var key = merchantKey(actionTx), logoOn = key && txDraftLogo !== undefined, hadL = logoOn && merchantLogos.hasOwnProperty(key), oldL = logoOn ? merchantLogos[key] : null;
  txActions[id] = txDraftAction();
  if (logoOn) { if (txDraftLogo === 'auto') delete merchantLogos[key]; else merchantLogos[key] = txDraftLogo; }
  try { return fn(); } finally {
    if (hadA) txActions[id] = oldA; else delete txActions[id];
    if (logoOn) { if (hadL) merchantLogos[key] = oldL; else delete merchantLogos[key]; }
  }
}
// From a picker: in edit mode, hold the change until Save; otherwise save now
function stageOrSave(updates) {
  if (!actionTxId) return;
  if (!txEditing) { saveMultiAction(actionTxId, updates, { quiet: true }); return; }
  Object.assign(txDraft, updates);
  if (updates.hasOwnProperty('split_ways') || updates.hasOwnProperty('split_portion') || updates.hasOwnProperty('amount_override')) delete txDraft._amt;
  showMainOptions();
  renderTxSheet(actionTx);
}
function txCountedAmount(tx) {
  var eff = getEffectiveTx(tx);
  return (eff.isSplit || eff.isAdjusted) && !eff.excluded ? Math.abs(eff.amount) : Math.abs(tx.amount);
}
function sameVal(a, b) {
  if (a == null || a === '') a = null; if (b == null || b === '') b = null;
  if (a === null || b === null) return a === b;
  if (!isNaN(parseFloat(a)) && !isNaN(parseFloat(b)) && typeof a !== 'boolean') return Math.abs(parseFloat(a) - parseFloat(b)) < 0.005 && String(a).replace(/[\d.\-]/g, '') === String(b).replace(/[\d.\-]/g, '');
  return String(a) === String(b);
}
// What Save would change. With validate, a bad amount comes back as an error message.
function txPendingEdits(validate) {
  var tx = actionTx, out = { updates: {}, logo: undefined, error: null };
  if (!tx || !txEditing) return out;
  var upd = {};
  Object.keys(txDraft).forEach(function(k) { if (k.charAt(0) !== '_') upd[k] = txDraft[k]; });
  if (txDraft.hasOwnProperty('_name')) {
    var v = String(txDraft._name).trim(), bank = txBankName(tx);
    upd.nickname = (!v || v === bank) ? null : v.slice(0, 80);
  }
  if (txDraft.hasOwnProperty('_amt')) {
    var total = Math.abs(tx.amount), n = parseFloat(txDraft._amt);
    var shown = withTxPreview(function() { return txCountedAmount(tx); });
    if (isNaN(n) || n < 0) { if (validate) out.error = 'Enter an amount'; }
    else if (n > total + 0.004) { if (validate) out.error = 'Can’t be more than ' + formatMoney(total); }
    else if (Math.abs(n - shown) >= 0.005) {
      upd.amount_override = Math.abs(n - total) < 0.005 ? null : Math.round(n * 100) / 100;
      upd.split_portion = null; upd.split_ways = null;
    }
  }
  var saved = txActions[tx.id] || {};
  Object.keys(upd).forEach(function(k) { if (!sameVal(upd[k], saved[k])) out.updates[k] = upd[k]; });
  // Splitting or adjusting something you'd ignored counts it again (same as before)
  if ((out.updates.split_ways || out.updates.split_portion || out.updates.category_override) && (saved.action_type === 'ignored' || saved.action_type === 'reimbursed')) out.updates.action_type = null;
  var key = merchantKey(tx);
  if (key && txDraftLogo !== undefined && txDraftLogo !== (merchantLogos[key] || 'auto')) out.logo = txDraftLogo;
  return out;
}
function txHasEdits() { var r = txPendingEdits(false); return Object.keys(r.updates).length > 0 || r.logo !== undefined; }
function setTxEditing(on) {
  txEditing = on; txDraft = {}; txDraftLogo = undefined;
  $('#txs-confirm').hidden = true;
  showMainOptions();
  if (actionTx) renderTxSheet(actionTx);
}
// Save everything at once. Returns false if something needs fixing first.
function saveTxEdits() {
  var r = txPendingEdits(true);
  if (r.error) { showToast(r.error); return false; }
  var tx = actionTx, any = Object.keys(r.updates).length > 0 || r.logo !== undefined;
  txEditing = false; txDraft = {}; txDraftLogo = undefined;
  if (r.logo !== undefined) {
    var key = merchantKey(tx);
    if (r.logo === 'auto') { delete merchantLogos[key]; sb.from('merchant_logos').delete().eq('merchant_key', key).then(function() {}); }
    else {
      merchantLogos[key] = r.logo;
      sb.from('merchant_logos').upsert({ merchant_key: key, domain: r.logo, updated_at: new Date().toISOString() }, { onConflict: 'user_id,merchant_key' })
        .then(function(res) { if (res.error) showToast('Couldn’t save the logo'); });
    }
    renderTransactionMonth();
  }
  if (Object.keys(r.updates).length) saveMultiAction(tx.id, r.updates, { quiet: true });
  showMainOptions();
  renderTxSheet(tx);
  if (any) showToast('Saved');
  return true;
}
// Inputs and buttons only act in edit mode
function applyTxEditUi() {
  var sheet = actionSheet.querySelector('.action-sheet');
  sheet.classList.toggle('is-editing', txEditing);
  var tog = $('#txs-edit-btn');
  tog.classList.toggle('is-on', txEditing);
  tog.setAttribute('aria-label', txEditing ? 'Cancel editing' : 'Edit');
  var done = $('#action-sheet-cancel');
  done.textContent = txEditing ? 'Save' : 'Done';
  done.classList.toggle('is-save', txEditing);
  $('#tx-date-input').disabled = !txEditing;
  if (!txEditing || !actionTx) return;
  var tx = actionTx;
  var name = $('#txs-name-input');
  $('#txs-name-btn').hidden = true; name.hidden = false;
  if (document.activeElement !== name) name.value = txDraft.hasOwnProperty('_name') ? txDraft._name : (withTxPreview(function() { return getEffectiveTx(tx).nickname; }) || txBankName(tx));
  var amt = $('#txs-amt-input');
  $('#txs-amt-btn').hidden = true; $('#txs-amt-edit').hidden = false;
  if (document.activeElement !== amt) amt.value = txDraft.hasOwnProperty('_amt') ? txDraft._amt : withTxPreview(function() { return txCountedAmount(tx); }).toFixed(2);
}
(function wireTxEditing() {
  var tog = $('#txs-edit-btn');
  if (!tog) return;
  tog.addEventListener('click', function() { if (actionTx) setTxEditing(!txEditing); });   // Cancel throws the edits away
  $('#txs-name-input').addEventListener('input', function() { if (txEditing) txDraft._name = this.value; });
  $('#txs-amt-input').addEventListener('input', function() { if (txEditing) txDraft._amt = this.value; });
  ['#txs-name-input', '#txs-amt-input'].forEach(function(sel) {
    $(sel).addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });
  });
  $('#txs-cat').addEventListener('click', function() { if (actionTx && txEditing) showRecatPicker(); });
  $('#txs-split').addEventListener('click', function() {
    if (!actionTx || !txEditing) return;
    showSubPicker('#split-picker');
    openSplitPicker();
  });
  // Closing with unsaved edits: Save, Don't save, or keep editing
  $('#txs-confirm-save').addEventListener('click', function() { $('#txs-confirm').hidden = true; if (saveTxEdits()) closeActionSheet(true); });
  $('#txs-confirm-discard').addEventListener('click', function() { $('#txs-confirm').hidden = true; txEditing = false; txDraft = {}; txDraftLogo = undefined; closeActionSheet(true); });
  $('#txs-confirm-keep').addEventListener('click', function() { $('#txs-confirm').hidden = true; });
  $('#txs-confirm').addEventListener('click', function(e) { if (e.target === this) this.hidden = true; });
})();

// Logo picker: tap the logo in the sheet, type, pick. Applies to every transaction from that store.
(function wireLogoPicker() {
  var btn = $('#txs-avatar-btn'), q = $('#logo-q'), out = $('#logo-results');
  if (!btn) return;
  var timer = null, seq = 0, lastResults = [];
  function tiles(results) {
    var current = withTxPreview(function() { return merchantLogos[merchantKey(actionTx)]; });
    var eff = getEffectiveTx(actionTx);
    var letter = ((eff.nickname || actionTx.merchant_name || actionTx.name || '?').replace(/^(to|from)\s+/i, '').trim().charAt(0) || '?').toUpperCase();
    var none = '<button type="button" class="logo-tile' + (current === 'none' ? ' on' : '') + '" data-domain="none">' +
      '<span class="logo-img" data-i="' + esc(letter) + '"></span><span class="logo-name">None</span><span class="logo-domain">Just the letter</span></button>';
    var term = q.value.trim().toLowerCase();
    var mine = customLogos.filter(function(l) { return !term || l.name.toLowerCase().indexOf(term) !== -1 || term.indexOf(l.name.toLowerCase()) !== -1; });
    var mineHtml = mine.map(function(l) {
      return '<div class="logo-tile-wrap"><button type="button" class="logo-tile' + (current === 'custom:' + l.id ? ' on' : '') + '" data-domain="custom:' + esc(l.id) + '">' +
        '<span class="logo-img mine" data-i="' + esc(l.name.charAt(0).toUpperCase()) + '">' + (l.url ? '<img src="' + esc(l.url) + '" alt="" onerror="this.remove()">' : '') + '</span>' +
        '<span class="logo-name">' + esc(l.name) + '</span><span class="logo-domain">Your logo</span></button>' +
        '<button type="button" class="logo-del" data-del-logo="' + esc(l.id) + '" aria-label="Delete ' + esc(l.name) + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
    }).join('');
    lastResults = results;
    var upload = '<button type="button" class="logo-tile logo-upload" data-upload>' +
      '<span class="logo-img"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>' +
      '<span class="logo-name">Upload</span><span class="logo-domain">Your own image</span></button>';
    var found = results;
    out.innerHTML = none + mineHtml + upload + (found.length ? found.map(function(r) {
      return '<button type="button" class="logo-tile' + (r.domain === current ? ' on' : '') + '" data-domain="' + esc(r.domain) + '">' +
        '<span class="logo-img" data-i="' + esc((r.name || r.domain).charAt(0).toUpperCase()) + '"><img src="' + esc(logoByDomain(r.domain, 96)) + '" alt="" loading="lazy" onerror="this.remove()"></span>' +
        '<span class="logo-name">' + esc(r.name) + '</span><span class="logo-domain">' + esc(r.domain) + '</span></button>';
    }).join('') : (mine.length ? '' : '<p class="logo-empty">' + (q.value.trim().length < 2 ? 'Type a store name to see logos.' : 'No logos found. Upload your own, or try a shorter name or the website, like “claude.ai”.') + '</p>'));
  }
  async function search(term) {
    var my = ++seq;
    term = term.trim();
    // Typed a website? Offer it directly.
    var direct = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(term) ? [{ name: term, domain: term.toLowerCase() }] : [];
    if (term.length < 2) { tiles([]); return; }
    out.classList.add('loading');
    try {
      var session = (await sb.auth.getSession()).data.session;
      var res = await fetch(SUPABASE_URL + '/functions/v1/logo-search?q=' + encodeURIComponent(term), { headers: { 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY } });
      var data = res.ok ? await res.json() : { results: [] };
      if (my !== seq) return;   // a newer search already started
      var seen = {}, list = direct.concat(data.results || []).filter(function(r) { if (seen[r.domain]) return false; seen[r.domain] = true; return true; });
      tiles(list);
    } catch (e) { if (my === seq) tiles(direct); }
    finally { if (my === seq) out.classList.remove('loading'); }
  }
  btn.addEventListener('click', function() {
    if (!actionTx || !txEditing) return;
    showSubPicker('#logo-picker');
    closeForm();
    var eff = withTxPreview(function() { return getEffectiveTx(actionTx); });
    q.value = (txDraft._name || '').trim() || eff.nickname || actionTx.merchant_name || (actionTx.name || '').replace(/^(to|from)\s+/i, '');
    $('#logo-reset').hidden = !withTxPreview(function() { return merchantLogos[merchantKey(actionTx)]; });
    search(q.value);
    setTimeout(function() { q.focus(); q.select(); }, 50);
  });
  q.addEventListener('input', function() { clearTimeout(timer); timer = setTimeout(function() { search(q.value); }, 250); });
  q.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); search(q.value); } });
  $('#logo-back').addEventListener('click', showMainOptions);
  function after() { if (!txEditing) renderTransactionMonth(); showMainOptions(); renderTxSheet(actionTx); }
  var file = $('#logo-file'), form = $('#logo-new'), nameIn = $('#logo-new-name'), prev = $('#logo-new-img'), pending = null;
  var frame = $('#logo-frame'), zoomIn = $('#logo-zoom');
  // Framing: the circle is exactly what shows next to transactions. Zoom 1 = whole image fits.
  var fr = { w: 1, h: 1, z: 1, x: 0, y: 0, bg: '' };
  function S() { return frame.clientWidth || 180; }
  function drawFrame() {
    var base = Math.min(S() / fr.w, S() / fr.h), W = fr.w * base * fr.z, H = fr.h * base * fr.z;
    prev.style.width = W + 'px'; prev.style.height = H + 'px';
    prev.style.transform = 'translate(' + (fr.x - W / 2) + 'px,' + (fr.y - H / 2) + 'px)';
    frame.style.background = fr.bg || '';
    zoomIn.value = fr.z;
  }
  function setZoom(z, cx, cy) {
    z = Math.max(0.4, Math.min(4, z));
    // keep the point under the fingers/centre still while zooming
    cx = cx || 0; cy = cy || 0;
    fr.x = cx - (cx - fr.x) * (z / fr.z); fr.y = cy - (cy - fr.y) * (z / fr.z); fr.z = z;
    drawFrame();
  }
  function resetFrame() { fr.z = 1; fr.x = 0; fr.y = 0; drawFrame(); }
  function setBg(bg) {
    fr.bg = bg;
    Array.prototype.forEach.call(form.querySelectorAll('[data-bg]'), function(b) { b.setAttribute('aria-checked', String(b.dataset.bg === bg)); });
    drawFrame();
  }
  form.querySelector('.logo-bg').addEventListener('click', function(e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-fit')) resetFrame(); else setBg(b.dataset.bg);
  });
  zoomIn.addEventListener('input', function() { setZoom(parseFloat(zoomIn.value)); });
  var pts = {}, last = null;
  function rel(e) { var r = frame.getBoundingClientRect(); return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }; }
  function gesture() {
    var ids = Object.keys(pts);
    if (ids.length >= 2) { var a = pts[ids[0]], b = pts[ids[1]]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; }
    var p = pts[ids[0]]; return p ? { x: p.x, y: p.y, d: 0 } : null;
  }
  frame.addEventListener('pointerdown', function(e) { e.preventDefault(); frame.setPointerCapture(e.pointerId); pts[e.pointerId] = rel(e); last = gesture(); });
  frame.addEventListener('pointermove', function(e) {
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = rel(e);
    var g = gesture(); if (!g || !last) { last = g; return; }
    fr.x += g.x - last.x; fr.y += g.y - last.y;
    if (g.d && last.d) setZoom(fr.z * g.d / last.d, g.x, g.y); else drawFrame();
    last = g;
  });
  function lift(e) { delete pts[e.pointerId]; last = gesture(); }
  frame.addEventListener('pointerup', lift); frame.addEventListener('pointercancel', lift);
  frame.addEventListener('wheel', function(e) { e.preventDefault(); var p = rel(e); setZoom(fr.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y); }, { passive: false });
  function exportFramed() {
    return new Promise(function(resolve, reject) {
      var OUT = 256, k = OUT / S(), c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
      var ctx = c.getContext('2d');
      if (fr.bg) { ctx.fillStyle = fr.bg; ctx.fillRect(0, 0, OUT, OUT); }
      var base = Math.min(S() / fr.w, S() / fr.h), W = fr.w * base * fr.z, H = fr.h * base * fr.z;
      ctx.drawImage(prev, (S() / 2 + fr.x - W / 2) * k, (S() / 2 + fr.y - H / 2) * k, W * k, H * k);
      c.toBlob(function(b) { if (!b) return reject(new Error('convert')); b.__framed = true; resolve(b); }, 'image/png');
    });
  }
  function closeForm() { form.hidden = true; out.hidden = false; q.closest('.logo-search').hidden = false; $('#logo-picker').classList.remove('framing'); pending = null; pts = {}; if (prev.src) { URL.revokeObjectURL(prev.src); prev.removeAttribute('src'); } }
  file.addEventListener('change', function() {
    var f = file.files && file.files[0]; file.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type) || f.size > 15 * 1024 * 1024) { showToast('Pick an image under 15 MB'); return; }
    pending = f;
    prev.onload = function() { fr.w = prev.naturalWidth || 1; fr.h = prev.naturalHeight || 1; setBg(''); resetFrame(); };
    prev.onerror = function() { showToast('Couldn’t open that image'); closeForm(); };
    prev.src = URL.createObjectURL(f);
    var eff = getEffectiveTx(actionTx);
    nameIn.value = eff.nickname || actionTx.merchant_name || q.value.trim() || (actionTx.name || '').replace(/^(to|from)\s+/i, '');
    out.hidden = true; q.closest('.logo-search').hidden = true; $('#logo-reset').hidden = true; $('#logo-picker').classList.add('framing'); form.hidden = false;
    setTimeout(function() { nameIn.focus(); nameIn.select(); }, 50);
  });
  $('#logo-new-cancel').addEventListener('click', closeForm);
  $('#logo-new-save').addEventListener('click', async function() {
    if (!pending || !actionTx) return;
    var name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var logo = await uploadCustomLogo(await exportFramed(), name);
      if (merchantKey(actionTx)) txDraftLogo = 'custom:' + logo.id;   // applied when you tap Save
      closeForm(); after();
    } catch (err) {
      console.error('logo upload', err); showToast('Couldn’t upload that image');
    } finally { btn.disabled = false; btn.textContent = 'Save'; }
  });
  out.addEventListener('click', function(e) {
    if (e.target.closest('[data-upload]')) { file.click(); return; }
    var del = e.target.closest('[data-del-logo]');
    if (del) {
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm'); del.textContent = 'Delete?';
        setTimeout(function() { if (del.isConnected && del.classList.contains('confirm')) tiles(lastResults); }, 3000);
        return;
      }
      deleteCustomLogo(del.dataset.delLogo).then(function() { showToast('Logo deleted'); tiles(lastResults); renderTxSheet(actionTx); });
      return;
    }
    var t = e.target.closest('.logo-tile');
    if (!t || !actionTx) return;
    if (!merchantKey(actionTx)) return;
    txDraftLogo = t.dataset.domain;   // applied when you tap Save
    after();
  });
  $('#logo-reset').addEventListener('click', function() {
    if (!actionTx) return;
    txDraftLogo = 'auto';
    after();
  });
})();

// Count a transaction in another month (e.g. rent paid on the 31st that posts on the 1st)
var MONTH_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function shiftMonth(ym, delta) {
  var p = ym.split('-'), d = new Date(+p[0], +p[1] - 1 + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() + 1, key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') };
}
function renderMonthMove(tx) {
  var eff = getEffectiveTx(tx), base = swipeDate(tx), moved = eff.date !== base;
  var p = eff.date.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
  $('#tx-date-value').textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  $('#tx-date-input').value = eff.date;
  $('#tx-date-reset').hidden = !moved;
  var sub = moved ? 'Changed by you · bank says ' + friendlyDay(base)
    : !tx.authorized_date ? (tx.pending ? 'Pending' : 'Posted ' + friendlyDay(tx.date)) + ' · bank didn\'t share the swipe date'
    : tx.pending ? 'Swiped · not posted yet'
    : base !== tx.date ? 'Swiped · posted ' + friendlyDay(tx.date)
    : 'Swiped and posted the same day';
  $('#tx-date-sub').textContent = sub;
  // The big date line: the day it counts on, plus the swipe time when the bank shares it
  var when = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).replace(/,/g, '');
  if (!moved && tx.authorized_datetime && /T\d/.test(tx.authorized_datetime)) {
    var t = new Date(tx.authorized_datetime);
    if (!isNaN(t)) when += ', ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  $('#txs-when-text').textContent = when;
}

// Transaction details: status, how it was paid, the card it was on, where, and the store's site
function renderTxFacts(tx) {
  $('#txs-status').textContent = tx.pending ? 'Pending' : tx.removed_at ? 'Removed by bank' : 'Completed';
  var ch = tx.enriched_payment_channel;
  $('#txs-paid').textContent = ch === 'in store' ? 'In store' : ch === 'online' ? 'Online' : !tx.plaid_account_id ? 'Added by you' : 'Other';
  // The card or account it was on, with your card art
  var acct = (cachedAccounts || []).filter(function(a) { return a.plaid_account_id && a.plaid_account_id === tx.plaid_account_id; })[0];
  var card = $('#txs-card');
  card.hidden = !acct;
  if (acct) {
    var design = acct.card_design_id ? getCardDesignById(acct.card_design_id) : null;
    var logo = !design && typeof getLogoUrl === 'function' ? getLogoUrl(acct) : null;
    var art = $('#txs-card-art');
    art.className = 'txs-card-art' + (design ? ' is-art' : logo ? ' is-logo' : '');
    art.style.backgroundImage = design ? 'url("' + design.url + '")' : logo ? 'url("' + logo + '")' : '';
    art.textContent = design || logo ? '' : (acct.institution || acct.name || '?').charAt(0).toUpperCase();
    $('#txs-card-name').textContent = acct.nickname || acct.name || 'Account';
    $('#txs-card-mask').textContent = [acct.institution, acct.mask ? shownMask(acct.mask) : ''].filter(Boolean).join(' · ');
    card.dataset.id = acct.id;
  }
  // Where: a small map when Plaid shares the spot, plus the address
  // Map and address are off: Plaid rarely shares them, and the city it does send is often
  // just the company's billing city (Amazon: Seattle). The website still shows.
  var lat = null, lon = null;
  var street = tx.enriched_location_address;
  var cityLine = [tx.enriched_location_city, [tx.enriched_location_region, tx.enriched_location_postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  var addr = '';
  var place = tx.merchant_name || tx.name || '';
  var mapQ = lat != null && lon != null ? 'll=' + lat + ',' + lon + '&q=' + encodeURIComponent(place) : 'q=' + encodeURIComponent([place, addr].filter(Boolean).join(', '));
  var map = $('#txs-map');
  if (lat != null && lon != null) {
    var dx = 0.006, dy = 0.003;
    map.href = 'https://maps.apple.com/?' + mapQ;
    map.innerHTML = '<iframe title="Map" loading="lazy" tabindex="-1" src="https://www.openstreetmap.org/export/embed.html?bbox=' +
      (lon - dx) + ',' + (lat - dy) + ',' + (lon + dx) + ',' + (lat + dy) + '&layer=mapnik"></iframe>' +
      '<span class="txs-map-pin" aria-hidden="true"><svg width="34" height="44" viewBox="0 0 24 32"><path d="M12 1C6 1 1.5 5.4 1.5 11.2 1.5 19 12 31 12 31s10.5-12 10.5-19.8C22.5 5.4 18 1 12 1z" fill="var(--accent)" stroke="rgba(0,0,0,.25)"/><circle cx="12" cy="11" r="4" fill="#fff" opacity=".9"/></svg></span>';
    map.hidden = false;
  } else { map.hidden = true; map.innerHTML = ''; }
  var a = $('#txs-addr');
  a.hidden = !addr;
  if (addr) { a.href = 'https://maps.apple.com/?' + mapQ; $('#txs-addr-text').textContent = addr; }
  var site = (tx.enriched_website || '').trim();
  var sEl = $('#txs-site');
  sEl.hidden = !site;
  if (site) {
    sEl.href = /^https?:\/\//.test(site) ? site : 'https://' + site;
    $('#txs-site-text').textContent = site.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  }
  $('#txs-places').hidden = !addr && !site;
}
(function() {
  var input = $('#tx-date-input');
  if (!input) return;
  // Open the calendar from anywhere on the date button
  input.parentNode.addEventListener('click', function(e) {
    if (!txEditing) { e.preventDefault(); return; }
    if (e.target !== input && input.showPicker) { e.preventDefault(); try { input.showPicker(); } catch (err) { input.focus(); } }
  });
  input.addEventListener('change', function() {
    if (!actionTx || !input.value || !txEditing) return;
    var base = swipeDate(actionTx), v = input.value;
    stageOrSave({ date_override: v === base ? null : v });
  });
  $('#tx-date-reset').addEventListener('click', function() {
    if (!actionTx || !txEditing) return;
    stageOrSave({ date_override: null });
  });
})();
function saveTxNote() {
  var el = $('#tx-note');
  if (!el || !actionTxId) return;
  var v = el.value.trim();
  if (v === (el._orig || '').trim()) return;
  el._orig = v;
  saveMultiAction(actionTxId, { note: v || null }, { silent: true });
}
function autoGrowNote() {
  var el = $('#tx-note');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(140, el.scrollHeight) + 'px';
}
(function() {
  var el = $('#tx-note');
  if (!el) return;
  el.addEventListener('input', autoGrowNote);
  el.addEventListener('blur', saveTxNote);
})();
// Tap the card in a transaction: open that account's settings
(function() {
  var c = $('#txs-card');
  if (!c) return;
  c.addEventListener('click', function() {
    var id = c.dataset.id;
    if (txEditing) return;
    closeActionSheet();
    setTimeout(function() {
      var home = document.querySelector('.account-card[data-id="' + id + '"]');
      if (home) home.click();
    }, 250);
  });
})();
// force: close now (edits already saved or thrown away)
function closeActionSheet(force) {
  if (force !== true && txEditing) {
    if (txHasEdits()) { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); $('#txs-confirm').hidden = false; return; }
    setTxEditing(false);
  }
  txEditing = false; txDraft = {}; txDraftLogo = undefined;
  $('#txs-confirm').hidden = true; $('#txs-reset-confirm').hidden = true;
  saveTxNote();
  actionSheet.classList.remove('visible');
  actionTxId = null;
  actionTx = null;
}

// Bottom button: Save in edit mode, Done otherwise
$('#action-sheet-cancel').addEventListener('click', function() { if (txEditing) saveTxEdits(); else closeActionSheet(); });
actionSheet.addEventListener('click', function(e) {
  if (e.target === actionSheet) closeActionSheet();
});

// Back to main options from any sub-picker
function showMainOptions() {
  $('#tx-action-options').hidden = false;
  $('#split-picker').hidden = true;
  $('#edit-picker').hidden = true;
  $('#recat-picker').hidden = true;
  if ($('#logo-picker')) $('#logo-picker').hidden = true;
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
  if ($('#logo-picker')) $('#logo-picker').hidden = true;
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
      openSplitPicker();
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
// Only in edit mode, and only after "Are you sure?"
document.querySelector('.action-option-clear').addEventListener('click', function() {
  if (!actionTxId || !txEditing) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  $('#txs-reset-confirm').hidden = false;
});
$('#txs-reset-no').addEventListener('click', function() { $('#txs-reset-confirm').hidden = true; });
$('#txs-reset-confirm').addEventListener('click', function(e) { if (e.target === this) this.hidden = true; });
$('#txs-reset-yes').addEventListener('click', function() {
  $('#txs-reset-confirm').hidden = true;
  if (!actionTxId) return;
  var id = actionTxId;
  setTxEditing(false);   // drop any unsaved edits too
  clearTxAction(id);
  showToast('Back to your bank’s details');
});

// Delete manual transaction
$('#btn-delete-tx').addEventListener('click', function() {
  if (!actionTxId) return;
  var delTx = txData.find(function(t) { return t.id === actionTxId; });
  if (!delTx || !(actionTxId.indexOf('manual_') === 0 || delTx.removed_at)) return;
  // Two taps: the first asks, the second deletes
  var btn = this;
  if (!btn._armed) {
    btn._armed = true; btn._label = btn.textContent; btn.textContent = 'Tap again to delete';
    clearTimeout(btn._t); btn._t = setTimeout(function() { btn._armed = false; btn.textContent = btn._label; }, 3000);
    return;
  }
  clearTimeout(btn._t); btn._armed = false; btn.textContent = btn._label;
  var deleteId = actionTxId;
  var savedAction = txActions[deleteId];
  if (txActions[deleteId]) sb.from('transaction_actions').delete().eq('user_id', currentUser.id).eq('transaction_id', deleteId).then(function() {});
  txData = txData.filter(function(tx) { return tx.id !== deleteId; });
  delete txActions[deleteId];
  showToast('Transaction deleted');
  renderTransactionMonth();
  closeActionSheet();
  // Delete from DB in background
  sb.from('synced_transactions').delete().eq('id', deleteId).eq('user_id', currentUser.id).then(function(result) {
    if (result.error) {
      console.error('Delete tx error:', result.error);
      txData.push(delTx);
      if (savedAction) txActions[deleteId] = savedAction;
      renderTransactionMonth();
      showToast("Couldn't delete it. Try again.");
    }
  });
});

// Keep a transaction your bank removed: it counts again
document.addEventListener('click', function(e) {
  if (!e.target.closest('#txs-keep') || !actionTx) return;
  var t = actionTx;
  t.removed_at = null;
  renderTxSheet(t);
  renderTransactionMonth();
  showToast('Kept · it counts again');
  sb.from('synced_transactions').update({ removed_at: null }).eq('id', t.id).eq('user_id', currentUser.id).then(function(r) {
    if (r.error) showToast('Could not save');
  });
});

// Split: type what you owe OR what you got back; the other fills in. Evenly buttons fill both.
var splitWaysPicked = null;
function splitTotal() { return actionTx ? Math.abs(actionTx.amount) : 0; }
function setSplitFields(mine, ways) {
  var total = splitTotal();
  mine = Math.max(0, Math.min(total, mine));
  $('#split-mine').value = mine.toFixed(2);
  $('#split-theirs').value = (total - mine).toFixed(2);
  splitWaysPicked = ways || null;
  document.querySelectorAll('.split-even button').forEach(function(b) { b.classList.toggle('on', +b.dataset.ways === splitWaysPicked); });
  updateSplitPreview();
}
function updateSplitPreview() {
  var mine = parseFloat($('#split-mine').value), theirs = parseFloat($('#split-theirs').value);
  $('#split-preview').textContent = isNaN(mine) ? '' : 'Counts ' + formatMoney(mine) + ' toward your spending' + (theirs > 0 ? ' · ' + formatMoney(theirs) + ' comes back to you' : '');
}
function openSplitPicker() {
  var a = txDraftAction(), total = splitTotal();
  $('#split-total').textContent = 'of ' + formatMoney(total);
  $('#split-custom-ways').value = '';
  if (a.split_ways > 1) setSplitFields(Math.ceil(total * 100 / a.split_ways) / 100, a.split_ways);
  else if (a.split_portion > 0) setSplitFields(parseFloat(a.split_portion), null);
  else { $('#split-mine').value = ''; $('#split-theirs').value = ''; splitWaysPicked = null; updateSplitPreview(); document.querySelectorAll('.split-even button').forEach(function(b) { b.classList.remove('on'); }); }
  $('#split-remove').hidden = !(a.split_ways > 1 || a.split_portion > 0);
  $('#split-to-adjusted').hidden = !(a.split_portion > 0 && !(a.split_ways > 1));
}
(function wireSplit() {
  var even = $('.split-even');
  if (!even) return;
  // Older edits were saved as splits; this turns one into an adjusted amount
  $('#split-to-adjusted').addEventListener('click', function() {
    var a = txDraftAction();
    if (!(a.split_portion > 0)) return;
    stageOrSave({ amount_override: parseFloat(a.split_portion), split_portion: null, split_ways: null });
  });
  even.addEventListener('click', function(e) {
    var b = e.target.closest('button[data-ways]');
    if (!b) return;
    var ways = +b.dataset.ways;
    $('#split-custom-ways').value = '';
    setSplitFields(Math.ceil(splitTotal() * 100 / ways) / 100, ways);
  });
  $('#split-custom-ways').addEventListener('input', function() {
    var ways = parseInt(this.value, 10);
    if (ways >= 2 && ways <= 50) setSplitFields(Math.ceil(splitTotal() * 100 / ways) / 100, ways);
  });
  $('#split-mine').addEventListener('input', function() {
    var v = parseFloat(this.value), total = splitTotal();
    splitWaysPicked = null; document.querySelectorAll('.split-even button').forEach(function(b) { b.classList.remove('on'); });
    $('#split-theirs').value = isNaN(v) ? '' : Math.max(0, total - v).toFixed(2);
    updateSplitPreview();
  });
  $('#split-theirs').addEventListener('input', function() {
    var v = parseFloat(this.value), total = splitTotal();
    splitWaysPicked = null; document.querySelectorAll('.split-even button').forEach(function(b) { b.classList.remove('on'); });
    $('#split-mine').value = isNaN(v) ? '' : Math.max(0, total - v).toFixed(2);
    updateSplitPreview();
  });
  $('#split-save').addEventListener('click', function() {
    if (!actionTxId) return;
    var total = splitTotal(), mine = parseFloat($('#split-mine').value);
    if (isNaN(mine)) { showToast('Enter what you owe or what you got back'); return; }
    if (mine > total + 0.004) { showToast('Can’t be more than ' + formatMoney(total)); return; }
    if (Math.abs(mine - total) < 0.005) { stageOrSave({ split_ways: null, split_portion: null }); return; }
    var updates = splitWaysPicked ? { split_ways: splitWaysPicked, split_portion: null, amount_override: null } : { split_ways: null, split_portion: Math.round(mine * 100) / 100, amount_override: null };
    stageOrSave(updates);
  });
})();

// Recurring picker

// Re-categorize picker
(function() {
  var rm = $('#split-remove');
  if (rm) rm.addEventListener('click', function() { stageOrSave({ split_ways: null, split_portion: null }); });
  var nc = $('#recat-custom-input');
  if (nc) nc.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); $('#recat-custom-apply').click(); } });
})();
// Every category you can pick: Plaid's, ones in your data, ones you made; renamed/deleted applied
function allCategories() {
  var src = {};
  Object.keys(CATEGORY_NAMES).forEach(function(k) { src[CATEGORY_NAMES[k]] = true; });
  txData.forEach(function(tx) { src[baseCategory(tx.enriched_category_primary || tx.category)] = true; });
  Object.keys(txActions).forEach(function(id) { var c = txActions[id] && txActions[id].category_override; if (c) src[baseCategory(c)] = true; });
  Object.keys(catMap).forEach(function(k) { src[k] = true; });
  var out = {};
  Object.keys(src).forEach(function(s) { var d = normalizeCategory(s); if (d && d !== 'Uncategorized') out[d] = true; });
  return Object.keys(out).sort(function(x, y) { return x.localeCompare(y); });
}
function saveCatMap(rows) {
  rows.forEach(function(r) { catMap[r.source] = r.display; });
  return sb.from('user_category_map').upsert(rows.map(function(r) { return { source: r.source, display: r.display, updated_at: new Date().toISOString() }; }), { onConflict: 'user_id,source' })
    .then(function(res) { if (res.error) showToast('Couldn’t save that category change'); });
}
// Rename: every original name that currently shows as oldName now shows as newName
function renameCategory(oldName, newName) {
  newName = newName.trim().slice(0, 40);
  if (!newName || newName === oldName) return;
  var rows = [{ source: oldName, display: newName }];
  Object.keys(catMap).forEach(function(s) { if (s !== oldName && catMap[s] !== null && normalizeCategory(s) === oldName) rows.push({ source: s, display: newName }); });
  if (!catMap.hasOwnProperty(newName) || catMap[newName] === null) rows.push({ source: newName, display: newName });
  saveCatMap(rows);
  Object.keys(budgets).forEach(function(m) {
    ['out', 'in'].forEach(function(d) {
      var bm = monthBudgets(m, d), b = bm[oldName];
      if (!b || bm[newName]) return;
      bm[newName] = b; delete bm[oldName];
      sb.from('category_budgets').upsert({ month: m, category: newName, direction: d, kind: b.kind, amount: b.amount, updated_at: new Date().toISOString() }, { onConflict: 'user_id,month,direction,category' })
        .then(function() { return sb.from('category_budgets').delete().eq('month', m).eq('direction', d).eq('category', oldName); });
    });
  });
}
// Delete: anything in that category shows as Uncategorized
function deleteCategory(name) {
  var sources = [name];
  var probe = {};
  Object.keys(CATEGORY_NAMES).forEach(function(k) { probe[CATEGORY_NAMES[k]] = true; });
  txData.forEach(function(tx) { probe[baseCategory(tx.enriched_category_primary || tx.category)] = true; });
  Object.keys(txActions).forEach(function(id) { var c = txActions[id] && txActions[id].category_override; if (c) probe[baseCategory(c)] = true; });
  Object.keys(catMap).forEach(function(k) { probe[k] = true; });
  Object.keys(probe).forEach(function(s) { if (s !== name && normalizeCategory(s) === name) sources.push(s); });
  saveCatMap(sources.map(function(s) { return { source: s, display: null }; }));
  var hadBudget = false;
  Object.keys(budgets).forEach(function(m) { ['out', 'in'].forEach(function(d) { if (budgets[m][d][name]) { hadBudget = true; delete budgets[m][d][name]; } }); });
  if (hadBudget) sb.from('category_budgets').delete().eq('category', name).then(function() {});
}
var catEditMode = false, catPendingDelete = null;
function showRecatPicker() {
  showSubPicker('#recat-picker');
  catEditMode = false; catPendingDelete = null;
  $('#recat-custom-input').value = '';
  renderRecatList();
}
function renderRecatList() { withTxPreview(renderRecatListInner); }
function renderRecatListInner() {
  var list = $('#recat-list');
  var current = normalizeCategory(getEffectiveTx(actionTx).category);
  var bankCat = normalizeCategory(actionTx.enriched_category_primary || actionTx.category);
  var override = (txActions[actionTxId] || {}).category_override;
  $('#recat-edit').textContent = catEditMode ? 'Done' : 'Edit';
  $('#recat-picker').classList.toggle('editing', catEditMode);
  var cats = allCategories();
  var pills = cats.map(function(c) {
    if (catEditMode) {
      return '<span class="cat-pill edit" data-cat="' + esc(c) + '">' +
        '<button type="button" class="cat-pill-name" data-rename="' + esc(c) + '" aria-label="Rename ' + esc(c) + '">' + esc(c) + '</button>' +
        '<button type="button" class="cat-pill-del' + (catPendingDelete === c ? ' confirm' : '') + '" data-del="' + esc(c) + '" aria-label="Delete ' + esc(c) + '">' + (catPendingDelete === c ? 'Delete?' : '×') + '</button></span>';
    }
    return '<button type="button" class="cat-pill' + (c === current ? ' on' : '') + '" data-cat="' + esc(c) + '" aria-pressed="' + (c === current) + '">' + esc(c) + '</button>';
  }).join('');
  list.innerHTML = (!catEditMode && override && bankCat !== current ? '<button type="button" class="cat-reset" data-reset="1">Use bank’s category · ' + esc(bankCat) + '</button>' : '') +
    '<div class="cat-pills">' + pills + '</div>' +
    (catEditMode ? '<p class="cat-help">Tap a name to rename it. Deleting a category moves its transactions to Uncategorized.</p>' : '');
}
(function wireRecat() {
  var list = $('#recat-list');
  if (!list) return;
  $('#recat-edit').addEventListener('click', function() { catEditMode = !catEditMode; catPendingDelete = null; renderRecatList(); });
  list.addEventListener('click', function(e) {
    if (!actionTxId) return;
    var t = e.target;
    if (t.closest('[data-reset]')) { stageOrSave({ category_override: null }); return; }
    var del = t.closest('[data-del]');
    if (del) {
      var name = del.dataset.del;
      if (catPendingDelete === name) {
        catPendingDelete = null;
        deleteCategory(name);
        showToast('Deleted ' + name);
        renderRecatList(); renderTransactionMonth(); renderTxSheet(actionTx);
      } else { catPendingDelete = name; renderRecatList(); }
      return;
    }
    var ren = t.closest('[data-rename]');
    if (ren) {
      var old = ren.dataset.rename, pill = ren.parentNode;
      pill.innerHTML = '<input class="cat-pill-input" maxlength="40" value="' + esc(old) + '" aria-label="New name for ' + esc(old) + '">';
      var inp = pill.querySelector('input');
      inp.focus(); inp.select();
      var done = false;
      var commit = function() {
        if (done) return; done = true;
        var v = inp.value.trim();
        if (v && v !== old) { renameCategory(old, v); showToast('Renamed to ' + v); renderTransactionMonth(); renderTxSheet(actionTx); }
        renderRecatList();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } if (ev.key === 'Escape') { done = true; renderRecatList(); } });
      return;
    }
    var pick = t.closest('.cat-pill[data-cat]:not(.edit)');
    if (pick) {
      var bankCat = normalizeCategory(actionTx.enriched_category_primary || actionTx.category);
      stageOrSave({ category_override: pick.dataset.cat === bankCat ? null : pick.dataset.cat });
    }
  });
})();

$('#recat-custom-apply').addEventListener('click', function() {
  var name = $('#recat-custom-input').value.trim().slice(0, 40);
  if (!name || !actionTxId) return;
  var existingCat = allCategories().find(function(c) { return c.toLowerCase() === name.toLowerCase(); });
  var cat = existingCat || name.charAt(0).toUpperCase() + name.slice(1);
  if (!existingCat) saveCatMap([{ source: cat, display: cat }]);   // remember it even before it's used
  $('#recat-custom-input').value = '';
  if (catEditMode) { renderRecatList(); showToast('Added ' + cat); return; }
  stageOrSave({ category_override: cat });
});

// Edit picker
function showEditPicker() {
  showSubPicker('#edit-picker');
  var action = txActions[actionTxId];
  $('#edit-nickname').value = (action && action.nickname) || '';
}

$('#edit-save').addEventListener('click', async function() {
  if (!actionTxId) return;
  var nickname = $('#edit-nickname').value.trim() || null;
  saveMultiAction(actionTxId, { nickname: nickname });
});

// Unified save that merges updates with existing action state
async function saveMultiAction(txId, updates, opts) {
  opts = opts || {};
  var existing = txActions[txId] || {};
  var row = {
    user_id: currentUser.id,
    transaction_id: txId,
    action_type: updates.hasOwnProperty('action_type') ? updates.action_type : (existing.action_type || null),
    split_ways: updates.hasOwnProperty('split_ways') ? updates.split_ways : (existing.split_ways != null ? existing.split_ways : null),
    split_portion: updates.hasOwnProperty('split_portion') ? updates.split_portion : (existing.split_portion != null ? existing.split_portion : null),
    amount_override: updates.hasOwnProperty('amount_override') ? updates.amount_override : (existing.amount_override != null ? existing.amount_override : null),
    category_override: updates.hasOwnProperty('category_override') ? updates.category_override : (existing.category_override != null ? existing.category_override : null),
    nickname: updates.hasOwnProperty('nickname') ? updates.nickname : (existing.nickname != null ? existing.nickname : null),
    note: updates.hasOwnProperty('note') ? updates.note : (existing.note != null ? existing.note : null),
    date_override: updates.hasOwnProperty('date_override') ? updates.date_override : (existing.date_override != null ? existing.date_override : null)
  };
  // Nothing left to remember: remove the record instead of saving an empty one
  var hasAny = ['action_type','split_ways','split_portion','amount_override','category_override','nickname','note','date_override'].some(function(k) { return row[k] != null && row[k] !== ''; });
  if (!hasAny) {
    if (!opts.quiet) showToast(opts.silent ? 'Note saved' : 'Saved');
    clearTxAction(txId);
    return;
  }
  // Update local state and render immediately
  txActions[txId] = row;
  if (!opts.quiet) showToast(opts.silent ? 'Note saved' : 'Saved');
  renderTransactionMonth();
  if (actionTx && actionTx.id === txId && actionSheet.classList.contains('visible')) { showMainOptions(); renderTxSheet(actionTx); }

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
  if (actionTx && actionTx.id === txId) { $('#tx-note').value = ''; $('#tx-note')._orig = ''; showMainOptions(); renderTxSheet(actionTx); }
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
// "today, 6:42 AM" / "yesterday, 9:10 PM" / "Nov 18, 9:10 PM"
function whenExact(ts) {
  var d = new Date(ts), t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  var day = new Date(d); day.setHours(0, 0, 0, 0);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var diff = Math.round((today - day) / 86400000);
  return (diff === 0 ? 'today' : diff === 1 ? 'yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + ', ' + t;
}
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
  if (hideMoney) return '****';
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
  var au = document.getElementById('act-updated');
  if (au && au.dataset.when) au.textContent = 'Updated ' + whenExact(au.dataset.when);   // "today" becomes "yesterday" overnight
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


// Tap outside a popup to close it, same as Cancel. Only counts when the tap also started
// outside: a drag that begins inside (selecting text, moving a crop) and ends on the
// backdrop must not close it.
(function wireBackdropClose() {
  var downOn = null;
  document.addEventListener('pointerdown', function(e) { downOn = e.target; }, true);
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t.classList || !(t.classList.contains('modal-overlay') || t.classList.contains('action-sheet-overlay'))) return;
    if (downOn !== t) { e.stopImmediatePropagation(); return; }
    if (t.classList.contains('modal-overlay') || t.id === 'disconnect-sheet' || t.id === 'purge-sheet' || t.id === 'budget-sheet' || t.id === 'export-sheet') {
      var cancel = t.querySelector('[id$="-cancel"]');
      if (cancel) cancel.click();
    }
  }, true);
  // Same as tapping outside: used by swipe-down below
  window.closePopupOverlay = function(t) {
    downOn = t;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };
})();

// Swipe a bottom popup down to close it (as well as tapping outside or Cancel).
// Only starts when the popup is scrolled to the top and the drag is mostly downward,
// and never from a slider, a sideways strip (card designs) or a crop/drawing area.
(function wireSwipeToClose() {
  var card = null, overlay = null, y0 = 0, x0 = 0, t0 = 0, dy = 0, dragging = false;
  function sheetOf(el) {
    var c = el.closest('.action-sheet, .modal-card');
    if (!c) return null;
    var ov = c.closest('.action-sheet-overlay, .modal-overlay');
    if (!ov || !ov.classList.contains('visible')) return null;
    if (getComputedStyle(ov).alignItems !== 'flex-end') return null;   // centred dialogs stay put
    return c;
  }
  document.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    var t = e.target;
    if (t.closest('input[type="range"], .card-design-picker, canvas, .card-crop-card, .card-refine-card, .act-legend, textarea')) return;
    card = sheetOf(t);
    if (!card) return;
    overlay = card.closest('.action-sheet-overlay, .modal-overlay');
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = Date.now(); dy = 0; dragging = false;
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    if (!card) return;
    var my = e.touches[0].clientY - y0, mx = e.touches[0].clientX - x0;
    if (!dragging) {
      if (my < 8 || Math.abs(mx) > my || card.scrollTop > 0) { if (Math.abs(my) > 8 || Math.abs(mx) > 8) card = null; return; }
      dragging = true;
      card.style.transition = 'none';
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    dy = Math.max(0, my);
    card.style.transform = 'translateY(' + dy + 'px)';
    e.preventDefault();
  }, { passive: false });
  function end() {
    if (!card) return;
    var c = card, ov = overlay, v = dy / Math.max(1, Date.now() - t0);
    card = null;
    if (!dragging) return;
    dragging = false;
    c.style.transition = '';
    var shut = dy > Math.min(140, c.offsetHeight * 0.3) || (v > 0.6 && dy > 40);
    // Let the popup's own closing animation carry on from where the finger left it
    requestAnimationFrame(function() { c.style.transform = ''; });
    if (shut) window.closePopupOverlay(ov);
  }
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
})();

// Settings > Your logos: rename in place, delete with a second tap
(function wireCustomLogosSettings() {
  var list = $('#custom-logos-list');
  if (!list) return;
  function save(input) {
    var row = input.closest('.mylogo'), logo = row && customLogoById(row.dataset.id);
    if (!logo) return;
    var name = input.value.trim().slice(0, 60);
    if (!name) { input.value = logo.name; return; }
    if (name === logo.name) return;
    logo.name = name;
    sb.from('custom_logos').update({ name: name }).eq('id', logo.id).then(function(r) { showToast(r.error ? 'Couldn’t rename' : 'Renamed'); });
  }
  list.addEventListener('focusout', function(e) { if (e.target.classList.contains('mylogo-name')) save(e.target); });
  list.addEventListener('keydown', function(e) { if (e.key === 'Enter' && e.target.classList.contains('mylogo-name')) { e.preventDefault(); e.target.blur(); } });
  list.addEventListener('click', function(e) {
    var del = e.target.closest('.mylogo-del');
    if (!del) return;
    if (!del.classList.contains('confirm')) {
      del.classList.add('confirm'); del.textContent = 'Sure?';
      setTimeout(function() { if (del.isConnected) { del.classList.remove('confirm'); del.textContent = 'Delete'; } }, 3000);
      return;
    }
    deleteCustomLogo(del.closest('.mylogo').dataset.id).then(function() { showToast('Logo deleted'); });
  });
})();

})();
