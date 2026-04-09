(function() {
// ============================================
// BETA GATE
// ============================================
var BETA_HASH = '165ad56f32e7b8044384c703d9e1acd559394a32e89ef76035c0de5723c65502';
var betaForm = document.getElementById('beta-form');
var betaPin = document.getElementById('beta-pin');
var betaError = document.getElementById('beta-error');

async function sha256(str) {
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function checkBetaAccess() {
  return sessionStorage.getItem('alenjo_beta') === 'granted';
}

if (checkBetaAccess()) {
  document.getElementById('screen-beta').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
}

betaForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  betaError.hidden = true;
  var hash = await sha256(betaPin.value);
  if (hash === BETA_HASH) {
    sessionStorage.setItem('alenjo_beta', 'granted');
    document.getElementById('screen-beta').classList.remove('active');
    document.getElementById('screen-login').classList.add('active');
  } else {
    betaError.textContent = 'Invalid access code.';
    betaError.hidden = false;
  }
});

// ============================================
// SUPABASE INIT
// ============================================
var SUPABASE_URL = 'https://itkufrockebnlzcroigc.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0a3Vmcm9ja2Vibmx6Y3JvaWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2OTczNjYsImV4cCI6MjA5MTI3MzM2Nn0.mhOwZBwegogIb-yjYzxS4ROQdc4Tc8xLMNlHcDfozzI';

var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// DOM REFS
// ============================================
var $ = function(sel) { return document.querySelector(sel); };
var screenLogin = $('#screen-login');
var screenSnapshot = $('#screen-snapshot');
var authForm = $('#auth-form');
var authEmail = $('#auth-email');
var authPassword = $('#auth-password');
var authSubmit = $('#auth-submit');
var authError = $('#auth-error');
var authToggleText = $('#auth-toggle-text');
var authToggleLink = $('#auth-toggle-link');
var btnLogout = $('#btn-logout');
var btnConnectPlaid = $('#btn-connect-plaid');
var btnAddAccount = $('#btn-add-account');
var connectCta = $('#connect-cta');
var sectionBanks = $('#section-banks');
var sectionCredit = $('#section-credit');
var listBanks = $('#list-banks');
var listCredit = $('#list-credit');
var banksTotal = $('#banks-total');
var creditTotal = $('#credit-total');
var loading = $('#loading');
var balanceToggle = $('#balance-toggle');

var isSignUp = false;
var currentUser = null;
var showAvailable = true; // true = available/current, false = after pending

// ============================================
// AUTH
// ============================================
authToggleLink.addEventListener('click', function(e) {
  e.preventDefault();
  isSignUp = !isSignUp;
  authSubmit.textContent = isSignUp ? 'Sign Up' : 'Sign In';
  authToggleText.textContent = isSignUp ? 'Already have an account?' : "Don't have an account?";
  authToggleLink.textContent = isSignUp ? 'Sign In' : 'Sign Up';
  authError.hidden = true;
});

authForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  authSubmit.disabled = true;
  authError.hidden = true;

  var email = authEmail.value.trim();
  var password = authPassword.value;

  var result;
  if (isSignUp) {
    result = await sb.auth.signUp({ email: email, password: password });
  } else {
    result = await sb.auth.signInWithPassword({ email: email, password: password });
  }

  if (result.error) {
    authError.textContent = result.error.message;
    authError.hidden = false;
    authSubmit.disabled = false;
    return;
  }

  if (isSignUp && result.data && result.data.user && !result.data.session) {
    authError.textContent = 'Check your email to confirm your account.';
    authError.style.borderColor = 'rgba(77, 143, 232, 0.3)';
    authError.style.background = 'rgba(77, 143, 232, 0.1)';
    authError.style.color = '#4D8FE8';
    authError.hidden = false;
    authSubmit.disabled = false;
    return;
  }

  authSubmit.disabled = false;
});

btnLogout.addEventListener('click', async function() {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange(function(event, session) {
  if (session && session.user) {
    currentUser = session.user;
    showScreen('snapshot');
    loadAccounts();
  } else {
    currentUser = null;
    if (checkBetaAccess()) showScreen('login');
    else showScreen('beta');
  }
});

// ============================================
// SCREENS
// ============================================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  $('#screen-' + name).classList.add('active');
}

// ============================================
// BALANCE TOGGLE
// ============================================
balanceToggle.addEventListener('click', function() {
  showAvailable = !showAvailable;
  balanceToggle.textContent = showAvailable ? 'Showing: Available' : 'Showing: After Pending';
  if (cachedAccounts) renderAccounts(cachedAccounts);
});

var cachedAccounts = null;

// ============================================
// PLAID LINK
// ============================================
async function openPlaidLink() {
  showLoading(true);

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
      body: JSON.stringify({ action: 'create_link_token' })
    });

    var data = await res.json();

    if (!res.ok || !data.link_token) {
      showError('Failed to start Plaid: ' + (data.detail || data.error || 'Unknown error'));
      showLoading(false);
      return;
    }

    showLoading(false);

    var handler = Plaid.create({
      token: data.link_token,
      onSuccess: async function(publicToken, metadata) {
        showLoading(true);
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
        if (!exchangeRes.ok) {
          showError('Failed to connect: ' + (exchangeData.detail || exchangeData.error));
        }
        await loadAccounts();
        showLoading(false);
      },
      onExit: function() {}
    });

    handler.open();
  } catch (err) {
    showError('Connection error: ' + err.message);
    showLoading(false);
  }
}

btnConnectPlaid.addEventListener('click', openPlaidLink);
btnAddAccount.addEventListener('click', openPlaidLink);

// ============================================
// LOAD ACCOUNTS
// ============================================
async function loadAccounts() {
  var result = await sb.rpc('get_user_accounts');

  if (result.error) {
    console.error('Error loading accounts:', result.error);
    return;
  }

  cachedAccounts = result.data || [];
  renderAccounts(cachedAccounts);

  // Refresh balances from Plaid in the background
  if (cachedAccounts.length > 0) {
    refreshBalances();
  }
}

async function refreshBalances() {
  try {
    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data.session;
    if (!session) return;

    var res = await fetch(SUPABASE_URL + '/functions/v1/refresh-balances', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY
      }
    });

    var data = await res.json();
    if (data.success && data.updated > 0) {
      // Reload with fresh balances
      var result = await sb.rpc('get_user_accounts');
      if (!result.error) {
        cachedAccounts = result.data || [];
        renderAccounts(cachedAccounts);
      }
    }
  } catch (err) {
    console.error('Balance refresh error:', err);
  }
}

// ============================================
// RENDER ACCOUNTS
// ============================================
function renderAccounts(accounts) {
  var banks = accounts.filter(function(a) { return a.type === 'depository'; });
  var credits = accounts.filter(function(a) { return a.type === 'credit'; });

  var hasAccounts = accounts.length > 0;
  connectCta.hidden = hasAccounts;
  btnAddAccount.hidden = !hasAccounts;
  sectionBanks.hidden = banks.length === 0;
  sectionCredit.hidden = credits.length === 0;
  balanceToggle.hidden = !hasAccounts;

  // Banks
  listBanks.innerHTML = banks.map(function(a) { return accountCard(a, 'bank'); }).join('');
  var bankSum = banks.reduce(function(s, a) {
    var bal = showAvailable ? (a.balance_available || a.balance_current) : a.balance_current;
    return s + parseFloat(bal || 0);
  }, 0);
  banksTotal.textContent = formatMoney(bankSum);
  banksTotal.className = 'section-total ' + (bankSum >= 0 ? 'balance-positive' : 'balance-negative');

  // Credit Cards
  listCredit.innerHTML = credits.map(function(a) { return accountCard(a, 'credit'); }).join('');
  var creditSum = credits.reduce(function(s, a) { return s + parseFloat(a.balance_current || 0); }, 0);
  creditTotal.textContent = formatMoney(creditSum);
  creditTotal.className = 'section-total balance-negative';
}

function accountCard(account, type) {
  var balanceLabel, displayBalance;

  if (type === 'credit') {
    displayBalance = parseFloat(account.balance_current || 0);
    balanceLabel = 'Owed';
  } else {
    if (showAvailable) {
      displayBalance = parseFloat(account.balance_available || account.balance_current || 0);
      balanceLabel = 'Available';
    } else {
      displayBalance = parseFloat(account.balance_current || 0);
      balanceLabel = 'Current';
    }
  }

  return '<div class="account-card">' +
    '<div class="account-info">' +
      '<span class="account-name">' + esc(account.name || 'Account') + '</span>' +
      (account.mask ? '<span class="account-mask">' + esc(account.subtype || '') + ' ****' + esc(account.mask) + '</span>' : '') +
      (account.institution ? '<span class="account-institution">' + esc(account.institution) + '</span>' : '') +
    '</div>' +
    '<div class="account-balance">' +
      '<div class="amount ' + (type === 'credit' ? 'balance-negative' : 'balance-positive') + '">' + formatMoney(displayBalance) + '</div>' +
      '<div class="label">' + balanceLabel + '</div>' +
    '</div>' +
  '</div>';
}

// ============================================
// UTILS
// ============================================
function formatMoney(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Math.abs(amount));
}

function esc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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

// ============================================
// SERVICE WORKER CLEANUP
// ============================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    regs.forEach(function(reg) { reg.unregister(); });
  });
  caches.keys().then(function(keys) { keys.forEach(function(k) { caches.delete(k); }); });
}

// ============================================
// INIT
// ============================================
(async function() {
  var result = await sb.auth.getSession();
  if (result.data.session && result.data.session.user) {
    currentUser = result.data.session.user;
    showScreen('snapshot');
    loadAccounts();
  } else if (checkBetaAccess()) {
    showScreen('login');
  }
})();

})();
