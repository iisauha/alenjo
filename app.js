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
var authForm = $('#auth-form');
var authEmail = $('#auth-email');
var authPassword = $('#auth-password');
var authSubmit = $('#auth-submit');
var authError = $('#auth-error');
var authToggleText = $('#auth-toggle-text');
var authToggleLink = $('#auth-toggle-link');
var btnConnectPlaid = $('#btn-connect-plaid');
var btnAddAccount = $('#btn-add-account');
var btnConnectInvesting = $('#btn-connect-investing');
var connectCta = $('#connect-cta');
var sectionBanks = $('#section-banks');
var sectionSavings = $('#section-savings');
var sectionCredit = $('#section-credit');
var listBanks = $('#list-banks');
var listSavings = $('#list-savings');
var listCredit = $('#list-credit');
var banksTotal = $('#banks-total');
var savingsTotal = $('#savings-total');
var creditTotal = $('#credit-total');
var loading = $('#loading');
var balanceToggle = $('#balance-toggle');
var headerAvatar = $('#header-avatar');
var headerName = $('#header-name');

var isSignUp = false;
var currentUser = null;
var userProfile = null;
var showAvailable = true;
var cachedAccounts = null;

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
    authError.style.borderColor = 'rgba(60, 130, 246, 0.3)';
    authError.style.background = 'rgba(60, 130, 246, 0.1)';
    authError.style.color = '#3C82F6';
    authError.hidden = false;
    authSubmit.disabled = false;
    return;
  }

  authSubmit.disabled = false;
});

sb.auth.onAuthStateChange(function(event, session) {
  if (session && session.user) {
    currentUser = session.user;
    showScreen('app');
    loadProfile();
    loadAccounts();
  } else {
    currentUser = null;
    if (checkBetaAccess()) showScreen('login');
    else showScreen('beta');
  }
});

// ============================================
// SCREENS & TABS
// ============================================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  $('#screen-' + name).classList.add('active');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var tab = $('#tab-' + tabName);
  if (tab) tab.classList.add('active');
  var nav = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
  if (nav) nav.classList.add('active');
}

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
  updateHeaderProfile();
  updateSettingsProfile();
  applyTabOrder();
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
  if (avatar && userProfile.avatar_url) {
    avatar.style.backgroundImage = 'url(' + userProfile.avatar_url + ')';
  }
}

function applyTabOrder() {
  if (!userProfile || !userProfile.tab_order) return;
  var nav = document.getElementById('bottom-nav');
  var order = userProfile.tab_order;
  order.forEach(function(tabName) {
    var btn = nav.querySelector('[data-tab="' + tabName + '"]');
    if (btn) nav.appendChild(btn);
  });
  renderTabOrder();
}

// Save name
$('#btn-save-name').addEventListener('click', async function() {
  var name = $('#settings-name').value.trim();
  if (!name) return;
  await sb.from('profiles').update({ display_name: name }).eq('id', currentUser.id);
  userProfile.display_name = name;
  updateHeaderProfile();
});

// Avatar upload
$('#btn-change-avatar').addEventListener('click', function() {
  $('#avatar-upload').click();
});

$('#avatar-upload').addEventListener('change', async function(e) {
  var file = e.target.files[0];
  if (!file) return;
  showLoading(true);

  var path = currentUser.id + '/avatar.' + file.name.split('.').pop();
  var uploadResult = await sb.storage.from('avatars').upload(path, file, { upsert: true });

  if (uploadResult.error) {
    console.error('Upload error:', uploadResult.error);
    showLoading(false);
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

// Tab reorder
function renderTabOrder() {
  var list = $('#tab-order-list');
  if (!list || !userProfile) return;
  var order = userProfile.tab_order || ['snapshot', 'investing', 'settings'];
  var labels = { snapshot: 'Snapshot', investing: 'Investing', settings: 'Settings' };

  list.innerHTML = order.map(function(tab, i) {
    return '<div class="tab-order-item" data-tab="' + tab + '">' +
      '<span>' + labels[tab] + '</span>' +
      '<div class="tab-order-arrows">' +
        (i > 0 ? '<button data-dir="up" data-tab="' + tab + '">&#9650;</button>' : '<button disabled>&#9650;</button>') +
        (i < order.length - 1 ? '<button data-dir="down" data-tab="' + tab + '">&#9660;</button>' : '<button disabled>&#9660;</button>') +
      '</div>' +
    '</div>';
  }).join('');
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('.tab-order-arrows button[data-dir]');
  if (!btn || !userProfile) return;
  var tab = btn.dataset.tab;
  var dir = btn.dataset.dir;
  var order = userProfile.tab_order || ['snapshot', 'investing', 'settings'];
  var idx = order.indexOf(tab);
  if (idx === -1) return;
  var newIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= order.length) return;
  order.splice(idx, 1);
  order.splice(newIdx, 0, tab);
  userProfile.tab_order = order;
  sb.from('profiles').update({ tab_order: order }).eq('id', currentUser.id);
  applyTabOrder();
});

// Logout from settings
$('#btn-settings-logout').addEventListener('click', async function() {
  await sb.auth.signOut();
});

// ============================================
// BALANCE TOGGLE
// ============================================
balanceToggle.addEventListener('click', function() {
  showAvailable = !showAvailable;
  balanceToggle.textContent = showAvailable ? 'Current' : 'After Pending';
  if (cachedAccounts) renderAccounts(cachedAccounts);
});

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
      showError('Failed to start Plaid: ' + (data.detail || data.error || 'Unknown error'));
      showLoading(false);
      return;
    }

    showLoading(false);

    var handler = Plaid.create({
      token: data.link_token,
      onSuccess: async function(publicToken, metadata) {
        showLoading(true);
        await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            action: 'exchange_token',
            public_token: publicToken,
            institution: metadata.institution
          })
        });
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

btnConnectPlaid.addEventListener('click', function() { openPlaidLink(['transactions']); });
btnAddAccount.addEventListener('click', function() { openPlaidLink(['transactions']); });
btnConnectInvesting.addEventListener('click', function() { openPlaidLink(['investments']); });

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
  // DEBUG: show first account's keys and logo domain
  if (cachedAccounts.length > 0) {
    var a = cachedAccounts[0];
    var debugEl = document.getElementById('snapshot-error');
    debugEl.textContent = 'DEBUG keys: ' + Object.keys(a).join(', ') + ' | logo_domain: ' + JSON.stringify(a.institution_logo_domain);
    debugEl.hidden = false;
  }
  renderAccounts(cachedAccounts);
  resolveLogos();

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
  return 'https://img.logo.dev/' + account.institution_logo_domain + '?token=' + LOGO_KEY + '&size=80&format=png';
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
function renderAccounts(accounts) {
  var banks = accounts.filter(function(a) { return a.type === 'depository' && a.subtype !== 'savings'; });
  var savings = accounts.filter(function(a) { return a.type === 'depository' && a.subtype === 'savings'; });
  var credits = accounts.filter(function(a) { return a.type === 'credit'; });

  var hasAccounts = accounts.length > 0;
  connectCta.hidden = hasAccounts;
  btnAddAccount.hidden = !hasAccounts;
  sectionBanks.hidden = banks.length === 0;
  sectionSavings.hidden = savings.length === 0;
  sectionCredit.hidden = credits.length === 0;
  balanceToggle.hidden = !hasAccounts;

  renderSection(listBanks, banks, 'bank');
  var bankSum = banks.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
  banksTotal.textContent = formatMoney(bankSum);
  banksTotal.className = 'section-total ' + (bankSum >= 0 ? 'balance-positive' : 'balance-negative');

  renderSection(listSavings, savings, 'bank');
  var savingsSum = savings.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
  savingsTotal.textContent = formatMoney(savingsSum);
  savingsTotal.className = 'section-total ' + (savingsSum >= 0 ? 'balance-positive' : 'balance-negative');

  renderSection(listCredit, credits, 'credit');
  var creditSum = credits.reduce(function(s, a) { return s + getDisplayBalance(a, 'credit').amount; }, 0);
  creditTotal.textContent = formatMoney(creditSum);
  creditTotal.className = 'section-total balance-negative';
}

function renderSection(listEl, items, type) {
  var sorted = items.slice().sort(function(a, b) {
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

    listEl.addEventListener('scroll', function() {
      var cardWidth = listEl.firstElementChild ? listEl.firstElementChild.offsetWidth : 1;
      var idx = Math.round(listEl.scrollLeft / cardWidth);
      dots.querySelectorAll('.scroll-dot').forEach(function(d, j) {
        d.classList.toggle('active', j === idx);
      });
    });
  }
}

function accountCard(account, type) {
  var bal = getDisplayBalance(account, type);
  var logoUrl = getLogoUrl(account);
  var timestamp = formatTimestamp(account.balance_last_updated_at);
  var displayName = account.nickname || account.name || 'Account';

  return '<div class="account-card" data-id="' + account.id + '">' +
    '<div class="account-top">' +
      '<span class="account-name" data-id="' + account.id + '">' + esc(displayName) + '</span>' +
      '<div class="account-balance">' +
        '<div class="amount ' + (type === 'credit' ? 'balance-negative' : 'balance-positive') + '">' + formatMoney(bal.amount) + '</div>' +
        '<div class="label">' + timestamp + '</div>' +
      '</div>' +
    '</div>' +
    '<span class="account-institution">' + esc(account.institution || '') + '</span>' +
    (account.mask ? '<span class="account-mask">****' + esc(account.mask) + '</span>' : '') +
    (logoUrl ? '<img class="account-logo" src="' + logoUrl + '" alt="" onerror="this.style.display=\'none\'">' : '<span class="account-debug" style="color:#E84D4D;font-size:0.6rem;">no logo: ' + esc(account.institution_logo_domain || 'null') + '</span>') +
  '</div>';
}

// Nickname editing
document.addEventListener('click', function(e) {
  var nameEl = e.target.closest('.account-name');
  if (!nameEl || !nameEl.dataset.id) return;

  var accountId = nameEl.dataset.id;
  var current = nameEl.textContent;
  var input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'nickname-input';
  input.maxLength = 40;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  function save() {
    var newName = input.value.trim();
    if (newName && newName !== current) {
      sb.from('accounts').update({ nickname: newName }).eq('id', accountId).then(function() {
        if (cachedAccounts) {
          cachedAccounts.forEach(function(a) {
            if (a.id === accountId) a.nickname = newName;
          });
        }
      });
    }
    var span = document.createElement('span');
    span.className = 'account-name';
    span.dataset.id = accountId;
    span.textContent = newName || current;
    input.replaceWith(span);
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
});

// ============================================
// INVESTING (placeholder — will populate when data exists)
// ============================================
// TODO: Edge function for /investments/holdings/get and /investments/transactions/get
// For now the tab shows the connect brokerage CTA

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
    showScreen('app');
    loadProfile();
    loadAccounts();
  } else if (checkBetaAccess()) {
    showScreen('login');
  }
})();

})();
