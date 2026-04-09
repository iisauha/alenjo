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
// (removed investing button ref)
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
  // Ensure new tabs are present in saved order
  var dirty = false;
  if (order.indexOf('investments') === -1) {
    var snapIdx = order.indexOf('snapshot');
    order.splice(snapIdx !== -1 ? snapIdx + 1 : 1, 0, 'investments');
    dirty = true;
  }
  if (order.indexOf('loans') === -1) {
    var invIdx = order.indexOf('investments');
    order.splice(invIdx !== -1 ? invIdx + 1 : 2, 0, 'loans');
    dirty = true;
  }
  if (order.indexOf('recurring') === -1) {
    var txIdx = order.indexOf('transactions');
    order.splice(txIdx !== -1 ? txIdx + 1 : order.length - 1, 0, 'recurring');
    dirty = true;
  }
  if (dirty) {
    userProfile.tab_order = order;
    sb.from('profiles').update({ tab_order: order }).eq('id', currentUser.id);
  }
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
  var order = userProfile.tab_order || ['snapshot', 'investments', 'loans', 'transactions', 'recurring', 'settings'];
  var labels = { snapshot: 'Snapshot', investments: 'Investments', loans: 'Loans', transactions: 'Transactions', recurring: 'Recurring', settings: 'Settings' };

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
  var order = userProfile.tab_order || ['snapshot', 'investments', 'loans', 'transactions', 'recurring', 'settings'];
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
      onExit: function() {}
    });

    handler.open();
  } catch (err) {
    showError('Connection error: ' + err.message);
    showLoading(false);
  }
}

btnConnectPlaid.addEventListener('click', function() { openPlaidLink(['transactions', 'liabilities']); });
btnAddAccount.addEventListener('click', function() { openPlaidLink(['transactions', 'liabilities']); });
if ($('#btn-connect-investments')) $('#btn-connect-investments').addEventListener('click', function() { openPlaidLink(['investments']); });
if ($('#btn-add-investment')) $('#btn-add-investment').addEventListener('click', function() { openPlaidLink(['investments']); });
if ($('#btn-connect-loans')) $('#btn-connect-loans').addEventListener('click', function() { openPlaidLink(['transactions', 'liabilities']); });

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

  // Background sync (includes balance update via free /accounts/get)
  if (cachedAccounts.length > 0) {
    throttledSync();
    startSyncInterval();
  }

  loadingAccounts = false;
}

// Dynamic sync cooldown based on connected Plaid items
// Plaid allows 30 req/min/item. Each sync = 3 calls/item.
// We stay conservative: 1 item = 5min, scale up slightly with more items.
var syncInFlight = false;
var syncIntervalId = null;

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
  backgroundSync().finally(function() { syncInFlight = false; });
}

// Start recurring sync timer when accounts exist
function startSyncInterval() {
  if (syncIntervalId) clearInterval(syncIntervalId);
  var cooldown = getSyncCooldown();
  syncIntervalId = setInterval(function() {
    if (currentUser && cachedAccounts && cachedAccounts.length > 0) {
      throttledSync();
    }
  }, cooldown);
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

    // Reload accounts with fresh balances
    var result = await sb.rpc('get_user_accounts');
    if (!result.error) {
      cachedAccounts = result.data || [];
      renderAccounts(cachedAccounts);
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
  var investments = accounts.filter(function(a) { return a.type === 'investment'; });

  // Snapshot tab: banks + credit only
  var hasBankAccounts = banks.length > 0 || credits.length > 0;
  connectCta.hidden = hasBankAccounts;
  btnAddAccount.hidden = !hasBankAccounts;
  sectionBanks.hidden = banks.length === 0;
  sectionSavings.hidden = true; // savings moved to investments tab
  sectionCredit.hidden = credits.length === 0;
  balanceToggle.hidden = !hasBankAccounts;

  renderSection(listBanks, banks, 'bank');
  var bankSum = banks.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
  banksTotal.textContent = formatMoney(bankSum);
  banksTotal.className = 'section-total ' + (bankSum >= 0 ? 'balance-positive' : 'balance-negative');

  renderSection(listCredit, credits, 'credit');
  var creditSum = credits.reduce(function(s, a) { return s + getDisplayBalance(a, 'credit').amount; }, 0);
  creditTotal.textContent = formatMoney(creditSum);
  creditTotal.className = 'section-total balance-negative';

  // Load liabilities for credit cards + loans tab
  if (credits.length > 0 || accounts.length > 0) {
    loadLiabilities().then(function() {
      renderSection(listCredit, credits, 'credit');
      renderLoansTab();
    });
  }

  // Net cash = banks - credit owed (savings excluded, shown in investments)
  var netCashEl = $('#net-cash');
  var netCashValue = $('#net-cash-value');
  if (hasBankAccounts) {
    var netCash = bankSum - creditSum;
    netCashEl.hidden = false;
    netCashValue.textContent = (netCash < 0 ? '-' : '') + formatMoney(netCash);
    netCashValue.className = 'net-cash-value ' + (netCash >= 0 ? 'balance-positive' : 'balance-negative');
  } else {
    netCashEl.hidden = true;
  }

  // Investments tab: savings + investment accounts
  var hasInvAccounts = savings.length > 0 || investments.length > 0;
  $('#inv-empty').hidden = hasInvAccounts;
  $('#inv-content').hidden = !hasInvAccounts;

  var invSavingsSection = $('#section-inv-savings');
  var invInvestmentsSection = $('#section-inv-investments');
  invSavingsSection.hidden = savings.length === 0;
  invInvestmentsSection.hidden = investments.length === 0;

  renderSection($('#list-inv-savings'), savings, 'bank');
  renderSection($('#list-inv-investments'), investments, 'bank');
  updateInvestmentTotals(savings, investments, hasInvAccounts);

  // Load holdings then re-render investment cards with consistent balances
  if (investments.length > 0) {
    loadHoldings().then(function() {
      renderSection($('#list-inv-investments'), investments, 'bank');
      updateInvestmentTotals(savings, investments, hasInvAccounts);
    });
  }

  updateSyncInfo();
  renderAccountsSettings();
}

function updateInvestmentTotals(savings, investments, hasInvAccounts) {
  var savingsSum = savings.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
  $('#inv-savings-total').textContent = formatMoney(savingsSum);
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
  $('#inv-investments-total').textContent = formatMoney(investSum);
  $('#inv-investments-total').className = 'section-total balance-positive';

  var portfolioTotal = savingsSum + investSum;
  $('#inv-total-value').textContent = formatMoney(portfolioTotal);
  $('#inv-total-value').className = 'net-cash-value balance-positive';
  $('#inv-total-card').hidden = !hasInvAccounts;
}

function renderAccountsSettings() {
  var section = $('#section-accounts');
  var list = $('#accounts-list');
  // Always show section -- disconnect button needed even when accounts are hidden
  section.hidden = false;
  if (!cachedAccounts || cachedAccounts.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:0.75rem">No visible accounts. Use Disconnect All to remove hidden items from Plaid.</p>';
    return;
  }
  list.innerHTML = cachedAccounts.map(function(a) {
    var name = a.nickname || a.name || 'Account';
    var typeLabel = a.type === 'investment' ? 'Investment' : a.type === 'credit' ? 'Credit' : a.subtype === 'savings' ? 'Savings' : 'Checking';
    return '<div class="account-manage-row">' +
      '<div class="account-manage-info">' +
        '<span class="account-manage-name">' + esc(name) + '</span>' +
        '<span class="account-manage-type">' + typeLabel + (a.mask ? ' ****' + esc(a.mask) : '') + '</span>' +
      '</div>' +
      '<button class="btn-remove-account" data-id="' + a.id + '">Remove</button>' +
    '</div>';
  }).join('');
}

document.addEventListener('click', async function(e) {
  var btn = e.target.closest('.btn-remove-account');
  if (!btn) return;
  var id = btn.dataset.id;
  if (!confirm('Remove this account? This will disconnect it from Plaid.')) return;
  btn.disabled = true;
  btn.textContent = '...';
  await sb.from('accounts').update({ is_hidden: true }).eq('id', id);
  if (cachedAccounts) {
    cachedAccounts = cachedAccounts.filter(function(a) { return a.id !== id; });
    renderAccounts(cachedAccounts);
  }
});

// Disconnect all accounts from Plaid
if ($('#btn-disconnect-all')) {
  $('#btn-disconnect-all').addEventListener('click', async function() {
    if (!confirm('Disconnect ALL accounts from Plaid? This removes them from Plaid billing and deletes all data. You will need to reconnect.')) return;
    this.disabled = true;
    this.textContent = 'Disconnecting...';
    try {
      var sessionResult = await sb.auth.getSession();
      var session = sessionResult.data.session;
      var res = await fetch(SUPABASE_URL + '/functions/v1/cleanup-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': SUPABASE_ANON_KEY
        }
      });
      var data = await res.json();
      cachedAccounts = [];
      cachedHoldings = null;
      cachedLiabilities = null;
      renderAccounts([]);
      this.textContent = 'Disconnected ' + (data.removed || 0) + ' items';
    } catch (err) {
      this.textContent = 'Error: ' + err.message;
    }
  });
}

function updateSyncInfo() {
  var billingSection = $('#section-billing');
  var billingEl = $('#billing-info');
  if (!cachedAccounts || cachedAccounts.length === 0) {
    billingSection.hidden = true;
    return;
  }
  billingSection.hidden = false;

  // Count by type
  var txAccounts = cachedAccounts.filter(function(a) { return a.type === 'depository' || a.type === 'credit'; });
  var creditAccounts = cachedAccounts.filter(function(a) { return a.type === 'credit'; });
  var invAccounts = cachedAccounts.filter(function(a) { return a.type === 'investment'; });
  var txCount = txAccounts.length;
  var creditCount = creditAccounts.length;
  var invCount = invAccounts.length;

  var txRate = 0.30;
  var recurringRate = 0.15;
  var invHoldingsRate = 0.18;
  var invTxRate = 0.35;
  var liabRate = 0.20;

  var txCost = txCount * txRate;
  var recurringCost = txCount * recurringRate;
  var invHoldingsCost = invCount * invHoldingsRate;
  var invTxCost = invCount * invTxRate;
  var liabCost = creditCount * liabRate;
  var monthlyEstimate = txCost + recurringCost + invHoldingsCost + invTxCost + liabCost;

  var html =
    '<div class="sync-info-row"><span>Bank/credit accounts</span><span>' + txCount + '</span></div>';

  if (txCount > 0) {
    html +=
      '<div class="sync-info-row"><span>Transactions</span><span>' + txCount + ' x $' + txRate.toFixed(2) + ' = $' + txCost.toFixed(2) + '</span></div>' +
      '<div class="sync-info-row"><span>Recurring Transactions</span><span>' + txCount + ' x $' + recurringRate.toFixed(2) + ' = $' + recurringCost.toFixed(2) + '</span></div>';
  }

  if (creditCount > 0) {
    html +=
      '<div class="sync-info-row"><span>Liabilities</span><span>' + creditCount + ' x $' + liabRate.toFixed(2) + ' = $' + liabCost.toFixed(2) + '</span></div>';
  }

  if (invCount > 0) {
    html +=
      '<div class="sync-info-row"><span>Investment accounts</span><span>' + invCount + '</span></div>' +
      '<div class="sync-info-row"><span>Investments Holdings</span><span>' + invCount + ' x $' + invHoldingsRate.toFixed(2) + ' = $' + invHoldingsCost.toFixed(2) + '</span></div>' +
      '<div class="sync-info-row"><span>Investments Transactions</span><span>' + invCount + ' x $' + invTxRate.toFixed(2) + ' = $' + invTxCost.toFixed(2) + '</span></div>';
  }

  html += '<div class="sync-info-row sync-info-total"><span>Estimated monthly total</span><span>$' + monthlyEstimate.toFixed(2) + '/mo</span></div>';

  billingEl.innerHTML = html;
}

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

var loansPieChart = null;

function renderLoansTab() {
  var content = $('#loans-content');
  var empty = $('#loans-empty');
  if (!content || !empty) return;

  // Get non-credit liabilities (student loans, mortgages) + manual loans
  var loans = (cachedLiabilities || []).filter(function(l) { return l.liability_type !== 'credit'; });
  // TODO: add manual loans from localStorage or DB

  if (loans.length === 0) {
    empty.hidden = false;
    content.hidden = true;
    return;
  }

  empty.hidden = true;
  content.hidden = false;

  // Pie chart data
  var totalDebt = 0;
  var chartLabels = [];
  var chartAmounts = [];
  var chartColors = ['#3C82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6'];

  loans.forEach(function(l) {
    var balance = parseFloat(l.balance_current || 0);
    var name = l.nickname || l.account_name || l.loan_name || 'Loan';
    totalDebt += balance;
    chartLabels.push(name);
    chartAmounts.push(balance);
  });

  // Render pie chart
  var canvas = document.getElementById('loans-pie-chart');
  if (loansPieChart) loansPieChart.destroy();

  if (chartAmounts.length > 0 && typeof Chart !== 'undefined') {
    loansPieChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: chartLabels,
        datasets: [{
          data: chartAmounts,
          backgroundColor: chartColors.slice(0, chartLabels.length),
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '60%',
        animation: { animateRotate: true, duration: 800 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var pct = totalDebt > 0 ? ((ctx.parsed / totalDebt) * 100).toFixed(1) : 0;
                return ctx.label + ': ' + formatMoney(ctx.parsed) + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    });
  }

  // Render total
  $('#loans-total-value').textContent = formatMoney(totalDebt);

  // Render loan cards
  var listHtml = '';
  loans.forEach(function(l, i) {
    var balance = parseFloat(l.balance_current || 0);
    var name = l.nickname || l.account_name || l.loan_name || 'Loan';
    var color = chartColors[i % chartColors.length];
    var typeLabel = l.liability_type === 'student' ? 'Student Loan' : l.liability_type === 'mortgage' ? 'Mortgage' : 'Loan';

    listHtml += '<div class="loan-card">' +
      '<div class="loan-card-header">' +
        '<span class="loan-dot" style="background:' + color + '"></span>' +
        '<div class="loan-card-info">' +
          '<span class="loan-card-name">' + esc(name) + '</span>' +
          '<span class="loan-card-type">' + typeLabel + (l.institution ? ' - ' + esc(l.institution) : '') + '</span>' +
        '</div>' +
        '<span class="loan-card-balance">' + formatMoney(balance) + '</span>' +
      '</div>';

    var details = '';
    if (l.interest_rate) details += '<div class="liab-detail"><span>Interest Rate</span><span>' + parseFloat(l.interest_rate).toFixed(2) + '%</span></div>';
    if (l.minimum_payment_amount) details += '<div class="liab-detail"><span>Min Payment</span><span>$' + parseFloat(l.minimum_payment_amount).toFixed(2) + '</span></div>';
    if (l.next_payment_due_date) details += '<div class="liab-detail"><span>Next Due</span><span>' + formatLiabDate(l.next_payment_due_date) + '</span></div>';
    if (l.origination_principal) details += '<div class="liab-detail"><span>Original Amount</span><span>' + formatMoney(parseFloat(l.origination_principal)) + '</span></div>';
    if (l.expected_payoff_date) details += '<div class="liab-detail"><span>Payoff Date</span><span>' + formatLiabDate(l.expected_payoff_date) + '</span></div>';
    if (l.loan_term) details += '<div class="liab-detail"><span>Term</span><span>' + esc(l.loan_term) + '</span></div>';
    if (l.repayment_plan) details += '<div class="liab-detail"><span>Plan</span><span>' + esc(l.repayment_plan) + '</span></div>';
    if (l.ytd_interest_paid) details += '<div class="liab-detail"><span>YTD Interest</span><span>$' + parseFloat(l.ytd_interest_paid).toFixed(2) + '</span></div>';
    if (l.ytd_principal_paid) details += '<div class="liab-detail"><span>YTD Principal</span><span>$' + parseFloat(l.ytd_principal_paid).toFixed(2) + '</span></div>';
    if (l.property_address) details += '<div class="liab-detail"><span>Property</span><span>' + esc(l.property_address) + '</span></div>';

    if (details) listHtml += '<div class="loan-card-details">' + details + '</div>';
    listHtml += '</div>';
  });

  $('#loans-list').innerHTML = listHtml;
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
    }
  }

  // Liabilities detail for credit cards
  var liabHtml = '';
  if (type === 'credit') {
    var limit = account.balance_limit ? parseFloat(account.balance_limit) : 0;
    var used = bal.amount;

    // Always show utilization bar from account data (no liabilities product needed)
    if (limit > 0) {
      var utilPct = Math.min((used / limit) * 100, 100);
      var utilClass = utilPct > 75 ? 'util-high' : utilPct > 30 ? 'util-mid' : 'util-low';
      liabHtml = '<div class="card-liabilities">' +
        '<div class="liab-util-wrap">' +
          '<div class="liab-util-bar"><div class="liab-util-fill ' + utilClass + '" style="width:' + utilPct.toFixed(1) + '%"></div></div>' +
          '<div class="liab-util-labels"><span>' + formatMoney(used) + ' / ' + formatMoney(limit) + '</span><span>' + utilPct.toFixed(0) + '% used</span></div>' +
        '</div>';

      // Show detailed liabilities data if available from Plaid Liabilities product
      var liab = cachedLiabilities ? cachedLiabilities.find(function(l) { return l.account_id === account.id; }) : null;
      if (liab) {
        var details = '';
        if (liab.apr_purchase) details += '<div class="liab-detail"><span>Purchase APR</span><span>' + parseFloat(liab.apr_purchase).toFixed(2) + '%</span></div>';
        if (liab.minimum_payment_amount) details += '<div class="liab-detail"><span>Min Payment</span><span>$' + parseFloat(liab.minimum_payment_amount).toFixed(2) + '</span></div>';
        if (liab.next_payment_due_date) {
          var dueDate = new Date(liab.next_payment_due_date + 'T00:00:00');
          var now = new Date();
          var daysUntil = Math.ceil((dueDate - now) / 86400000);
          var dueClass = daysUntil <= 3 ? 'liab-urgent' : daysUntil <= 7 ? 'liab-soon' : '';
          details += '<div class="liab-detail ' + dueClass + '"><span>Due</span><span>' + formatLiabDate(liab.next_payment_due_date) + (daysUntil >= 0 ? ' (' + daysUntil + 'd)' : ' (overdue)') + '</span></div>';
        }
        if (liab.last_payment_amount) details += '<div class="liab-detail"><span>Last Payment</span><span>$' + parseFloat(liab.last_payment_amount).toFixed(2) + '</span></div>';
        if (liab.last_statement_balance) details += '<div class="liab-detail"><span>Statement Bal</span><span>$' + parseFloat(liab.last_statement_balance).toFixed(2) + '</span></div>';
        if (liab.is_overdue) details += '<div class="liab-detail liab-urgent"><span>Status</span><span>OVERDUE</span></div>';
        if (details) liabHtml += details;
      }

      liabHtml += '</div>';
    }
  }

  return '<div class="account-card" data-id="' + account.id + '">' +
    '<div class="account-top">' +
      '<div class="account-left">' +
        '<span class="account-name" data-id="' + account.id + '">' + esc(displayName) + '</span>' +
        '<span class="account-institution">' + esc(account.institution || '') + '</span>' +
        (account.mask ? '<span class="account-mask">****' + esc(account.mask) + '</span>' : '') +
        (logoUrl ? '<div class="account-logo" style="background-image:url(' + logoUrl + ')"></div>' : '') +
      '</div>' +
      '<div class="account-balance">' +
        '<div class="amount ' + (type === 'credit' ? 'balance-negative' : 'balance-positive') + '">' + formatMoney(bal.amount) + '</div>' +
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

// Nickname editing via modal
var nicknameModal = $('#nickname-modal');
var nicknameInput = $('#nickname-input');
var editingAccountId = null;

document.addEventListener('click', function(e) {
  var nameEl = e.target.closest('.account-name');
  if (!nameEl || !nameEl.dataset.id) return;
  editingAccountId = nameEl.dataset.id;
  nicknameInput.value = nameEl.textContent;
  nicknameModal.classList.add('visible');
  nicknameInput.focus();
  nicknameInput.select();
});

$('#nickname-save').addEventListener('click', function() {
  var newName = nicknameInput.value.trim();
  if (newName && editingAccountId) {
    sb.from('accounts').update({ nickname: newName }).eq('id', editingAccountId).then(function() {
      if (cachedAccounts) {
        cachedAccounts.forEach(function(a) {
          if (a.id === editingAccountId) a.nickname = newName;
        });
        renderAccounts(cachedAccounts);
      }
    });
  }
  nicknameModal.classList.remove('visible');
  editingAccountId = null;
});

$('#nickname-cancel').addEventListener('click', function() {
  nicknameModal.classList.remove('visible');
  editingAccountId = null;
});

nicknameInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); $('#nickname-save').click(); }
  if (e.key === 'Escape') { $('#nickname-cancel').click(); }
});

// ============================================
// TRANSACTIONS
// ============================================
var txData = [];
var txMonths = [];
var txActions = {};
var ignoreRules = {};
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

  // Fetch transactions from DB (last 12 months)
  var cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  var cutoffStr = cutoff.toISOString().split('T')[0];

  var result = await sb
    .from('synced_transactions')
    .select('*')
    .gte('date', cutoffStr)
    .order('date', { ascending: false });

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
    txEmpty.querySelector('p').textContent = 'No transactions yet. Try again in a moment.';
    return;
  }

  txData = result.data;
  txEmpty.hidden = true;
  txContent.hidden = false;

  // Load user actions and ignore rules
  var actionsResult = await sb.from('transaction_actions').select('transaction_id, action_type, split_ways, category_override');
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

  // Build month list — always include current month
  var monthSet = {};
  var now = new Date();
  var currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  monthSet[currentMonth] = true;
  txData.forEach(function(tx) {
    var m = tx.date.substring(0, 7);
    monthSet[m] = true;
  });
  txMonths = Object.keys(monthSet).sort().reverse();

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
  cardFilter.innerHTML = '<option value="all">All Accounts</option>';
  if (cachedAccounts) {
    cachedAccounts.forEach(function(a) {
      if (a.plaid_account_id) {
        cardFilter.innerHTML += '<option value="' + esc(a.plaid_account_id) + '">' + esc(a.nickname || a.name || 'Account') + '</option>';
      }
    });
  }

  renderTransactionMonth();

  filter.addEventListener('change', renderTransactionMonth);
  cardFilter.addEventListener('change', renderTransactionMonth);

  // Background sync is handled by throttledSync() from loadAccounts
}

function getEffectiveTx(tx) {
  var action = txActions[tx.id];
  var result = { excluded: false, amount: tx.amount, category: tx.category, actionType: action ? action.action_type : null, splitWays: action ? action.split_ways : null };
  if (!action) return result;
  if (action.action_type === 'ignored' || action.action_type === 'reimbursed') {
    result.excluded = true;
    result.amount = 0;
  } else if (action.action_type === 'split') {
    result.amount = tx.amount / action.split_ways;
  } else if (action.action_type === 'recategorized') {
    result.category = action.category_override;
  }
  return result;
}

var txPieChart = null;
var activeCategoryFilter = null;

var CATEGORY_COLORS = [
  '#3C82F6', '#4DE88F', '#E84D4D', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#EF4444', '#A855F7', '#22D3EE', '#FB923C'
];

function renderTransactionMonth() {
  var month = $('#tx-month-filter').value;
  var cardId = $('#tx-card-filter').value;
  var breakdown = $('#tx-breakdown');
  var legend = $('#tx-category-legend');

  // Filter by month
  var filtered = txData.filter(function(tx) {
    return tx.date.substring(0, 7) === month;
  });

  // Filter by card using plaid_account_id
  if (cardId !== 'all') {
    filtered = filtered.filter(function(tx) { return tx.plaid_account_id === cardId; });
  }

  // Filter by active category if pie slice clicked
  var displayTx = filtered;
  if (activeCategoryFilter) {
    displayTx = filtered.filter(function(tx) {
      var eff = getEffectiveTx(tx);
      return normalizeCategory(eff.category) === activeCategoryFilter;
    });
  }

  // Expenses only for pie chart — use effective amounts, skip excluded
  var byCategory = {};
  filtered.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    if (eff.excluded || eff.amount <= 0) return;
    var cat = normalizeCategory(eff.category);
    if (!byCategory[cat]) byCategory[cat] = 0;
    byCategory[cat] += eff.amount;
  });

  // Sort categories by amount
  var catEntries = Object.entries(byCategory).sort(function(a, b) { return b[1] - a[1]; });
  var catLabels = catEntries.map(function(e) { return e[0]; });
  var catAmounts = catEntries.map(function(e) { return e[1]; });
  var totalExpenses = catAmounts.reduce(function(s, a) { return s + a; }, 0);

  // Render pie chart
  var canvas = document.getElementById('tx-pie-chart');
  if (txPieChart) txPieChart.destroy();

  if (catEntries.length > 0 && typeof Chart !== 'undefined') {
    txPieChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catAmounts,
          backgroundColor: CATEGORY_COLORS.slice(0, catLabels.length),
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '55%',
        animation: { animateRotate: true, duration: 800 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var pct = ((ctx.parsed / totalExpenses) * 100).toFixed(1);
                return ctx.label + ': ' + formatMoney(ctx.parsed) + ' (' + pct + '%)';
              }
            }
          }
        },
        onClick: function(e, elements) {
          if (elements.length > 0) {
            var idx = elements[0].index;
            var clickedCat = catLabels[idx];
            if (activeCategoryFilter === clickedCat) {
              activeCategoryFilter = null;
            } else {
              activeCategoryFilter = clickedCat;
            }
            renderTransactionMonth();
          }
        }
      }
    });
  }

  // Render category legend
  legend.innerHTML = catEntries.map(function(entry, i) {
    var cat = entry[0];
    var amt = entry[1];
    var pct = totalExpenses > 0 ? ((amt / totalExpenses) * 100).toFixed(0) : 0;
    var isActive = activeCategoryFilter === cat;
    return '<div class="cat-legend-item' + (isActive ? ' active' : '') + '" data-cat="' + esc(cat) + '">' +
      '<span class="cat-dot" style="background:' + CATEGORY_COLORS[i % CATEGORY_COLORS.length] + '"></span>' +
      '<span class="cat-name">' + esc(cat) + '</span>' +
      '<span class="cat-pct">' + pct + '%</span>' +
      '<span class="cat-amt">' + formatMoney(amt) + '</span>' +
    '</div>';
  }).join('');

  // Click legend items to filter too
  legend.querySelectorAll('.cat-legend-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var cat = el.dataset.cat;
      if (activeCategoryFilter === cat) {
        activeCategoryFilter = null;
      } else {
        activeCategoryFilter = cat;
      }
      renderTransactionMonth();
    });
  });

  // Month summary — use effective values
  var totalSpent = 0;
  var totalIncome = 0;
  filtered.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    if (eff.excluded) return;
    if (eff.amount > 0) totalSpent += eff.amount;
    else totalIncome += Math.abs(eff.amount);
  });

  var html = '<div class="tx-month-summary">' +
    '<div class="tx-summary-item"><span class="tx-summary-label">Spent</span><span class="tx-summary-value balance-negative">' + formatMoney(totalSpent) + '</span></div>' +
    '<div class="tx-summary-item"><span class="tx-summary-label">Income</span><span class="tx-summary-value balance-positive">' + formatMoney(totalIncome) + '</span></div>' +
  '</div>';

  // Sort transactions: most recent first by date, then by datetime
  displayTx.sort(function(a, b) {
    var da = a.authorized_datetime || a.authorized_date || a.date;
    var db = b.authorized_datetime || b.authorized_date || b.date;
    if (da > db) return -1;
    if (da < db) return 1;
    return 0;
  });

  // Render transactions
  displayTx.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    var authDate = tx.authorized_date ? formatTxDate(tx.authorized_date, tx.authorized_datetime) : null;
    var postDate = formatTxDate(tx.date, tx.authorized_datetime);
    var dateHtml = '';
    if (tx.pending) {
      dateHtml = '<span class="tx-pending-badge">Pending</span> ' + (authDate || postDate);
    } else if (authDate && authDate !== postDate) {
      dateHtml = postDate + ' <span class="tx-auth-date">(auth ' + authDate + ')</span>';
    } else {
      dateHtml = postDate;
    }

    var rowClass = 'tx-row';
    var badge = '';
    if (eff.actionType === 'split') {
      badge = '<span class="tx-badge tx-badge-split">' + eff.splitWays + '-way split</span>';
      rowClass += ' tx-actioned';
    } else if (eff.actionType === 'reimbursed') {
      badge = '<span class="tx-badge tx-badge-reimbursed">Reimbursed</span>';
      rowClass += ' tx-actioned tx-excluded';
    } else if (eff.actionType === 'ignored') {
      badge = '<span class="tx-badge tx-badge-ignored">Ignored</span>';
      rowClass += ' tx-actioned tx-excluded';
    } else if (eff.actionType === 'recategorized') {
      badge = '<span class="tx-badge tx-badge-recat">' + esc(normalizeCategory(eff.category)) + '</span>';
      rowClass += ' tx-actioned';
    }

    var amountHtml = '';
    if (eff.actionType === 'split') {
      amountHtml = '<span class="tx-amount-original">' + (tx.amount < 0 ? '+' : '-') + formatMoney(Math.abs(tx.amount)) + '</span>' +
        '<span class="tx-amount ' + (tx.amount < 0 ? 'balance-positive' : 'balance-negative') + '">' +
          (tx.amount < 0 ? '+' : '-') + formatMoney(Math.abs(eff.amount)) +
        '</span>';
    } else {
      amountHtml = '<span class="tx-amount ' + (tx.amount < 0 ? 'balance-positive' : 'balance-negative') + '">' +
        (tx.amount < 0 ? '+' : '-') + formatMoney(Math.abs(tx.amount)) +
      '</span>';
    }

    html += '<div class="' + rowClass + '" data-txid="' + esc(tx.id) + '">' +
      '<div class="tx-info">' +
        '<span class="tx-merchant">' + esc(tx.merchant_name || tx.name || 'Unknown') + '</span>' +
        (badge ? badge : '<span class="tx-category">' + esc(normalizeCategory(eff.category)) + '</span>') +
      '</div>' +
      '<div class="tx-right">' +
        amountHtml +
        '<span class="tx-date">' + dateHtml + '</span>' +
      '</div>' +
    '</div>';
  });

  if (activeCategoryFilter) {
    html = '<button class="tx-clear-filter" onclick="window._clearCatFilter()">Showing: ' + esc(activeCategoryFilter) + ' (tap to clear)</button>' + html;
  }

  breakdown.innerHTML = html;
}

window._clearCatFilter = function() {
  activeCategoryFilter = null;
  renderTransactionMonth();
};

// CSV Export — exports currently filtered transactions
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
      return normalizeCategory(tx.category) === activeCategoryFilter;
    });
  }

  if (filtered.length === 0) return;

  var csvRows = ['Date,Merchant,Category,Amount,Effective Amount,Type,Status,Pending'];
  filtered.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    var merchant = (tx.merchant_name || tx.name || 'Unknown').replace(/"/g, '""');
    var cat = normalizeCategory(eff.category).replace(/"/g, '""');
    var type = tx.amount < 0 ? 'Income' : 'Expense';
    var status = eff.actionType || 'normal';
    csvRows.push(
      tx.date + ',"' + merchant + '","' + cat + '",' +
      tx.amount.toFixed(2) + ',' + eff.amount.toFixed(2) + ',' + type + ',' + status + ',' + (tx.pending ? 'Yes' : 'No')
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

function normalizeCategory(cat) {
  if (!cat) return 'Other';
  return cat.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
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
  var eff = getEffectiveTx(tx);

  $('#tx-action-merchant').textContent = tx.merchant_name || tx.name || 'Unknown';
  $('#tx-action-amount').textContent = (tx.amount < 0 ? '+' : '-') + formatMoney(Math.abs(tx.amount));
  $('#tx-action-amount').className = 'action-sheet-subtitle ' + (tx.amount < 0 ? 'balance-positive' : 'balance-negative');

  // Show current status if actioned
  var statusEl = $('#tx-action-status');
  if (eff.actionType) {
    var statusText = '';
    if (eff.actionType === 'split') statusText = 'Currently: ' + eff.splitWays + '-way split -- your share ' + formatMoney(Math.abs(eff.amount));
    else if (eff.actionType === 'reimbursed') statusText = 'Currently: Reimbursed';
    else if (eff.actionType === 'ignored') statusText = 'Currently: Ignored';
    else if (eff.actionType === 'recategorized') statusText = 'Currently: Re-categorized to ' + normalizeCategory(eff.category);
    statusEl.textContent = statusText;
    statusEl.hidden = false;
    document.querySelector('.action-option-clear').hidden = false;
  } else {
    statusEl.hidden = true;
    document.querySelector('.action-option-clear').hidden = true;
  }

  // Highlight active action
  document.querySelectorAll('.action-option').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.action === eff.actionType);
  });

  // Reset sub-pickers
  $('#split-picker').hidden = true;
  $('#recat-picker').hidden = true;
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

// Action option clicks
document.querySelectorAll('#tx-action-options .action-option').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var action = btn.dataset.action;
    if (!actionTxId) return;

    if (action === 'clear') {
      clearTxAction(actionTxId);
      return;
    }
    if (action === 'split') {
      $('#tx-action-options').hidden = true;
      $('#split-picker').hidden = false;
      $('#split-preview').textContent = '';
      return;
    }
    if (action === 'recategorized') {
      showRecatPicker();
      return;
    }
    // reimbursed or ignored — save immediately
    saveTxAction(actionTxId, action, {});
  });
});

// Split picker
document.querySelectorAll('#split-picker button[data-ways]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var ways = parseInt(btn.dataset.ways);
    var share = Math.abs(actionTx.amount) / ways;
    $('#split-preview').textContent = 'Your share: ' + formatMoney(share);
    saveTxAction(actionTxId, 'split', { splitWays: ways });
  });
});

// Re-categorize picker
function showRecatPicker() {
  $('#tx-action-options').hidden = true;
  var picker = $('#recat-picker');
  picker.hidden = false;
  var list = $('#recat-list');

  var allCats = {};
  txData.forEach(function(tx) {
    var cat = normalizeCategory(tx.category);
    allCats[cat] = true;
  });
  var catList = Object.keys(allCats).sort();

  list.innerHTML = catList.map(function(cat) {
    return '<button class="recat-option" data-cat="' + esc(cat) + '">' + esc(cat) + '</button>';
  }).join('');

  list.querySelectorAll('.recat-option').forEach(function(btn) {
    btn.addEventListener('click', function() {
      saveTxAction(actionTxId, 'recategorized', { categoryOverride: btn.dataset.cat });
    });
  });
}

async function saveTxAction(txId, actionType, extra, skipUI) {
  var row = {
    user_id: currentUser.id,
    transaction_id: txId,
    action_type: actionType,
    split_ways: extra.splitWays || null,
    category_override: extra.categoryOverride || null
  };
  await sb.from('transaction_actions').upsert(row, { onConflict: 'user_id,transaction_id' });
  txActions[txId] = row;

  if (actionType === 'ignored') {
    checkIgnorePattern(txId);
  }

  if (!skipUI) {
    renderTransactionMonth();
    closeActionSheet();
  }
}

async function clearTxAction(txId) {
  await sb.from('transaction_actions').delete().eq('user_id', currentUser.id).eq('transaction_id', txId);
  delete txActions[txId];
  renderTransactionMonth();
  closeActionSheet();
}

// ============================================
// AUTO-SUGGEST IGNORE
// ============================================
function normalizeMerchant(name) {
  if (!name) return '';
  return name.toLowerCase().trim();
}

function checkIgnorePattern(txId) {
  var tx = txData.find(function(t) { return t.id === txId; });
  if (!tx) return;
  var merchantKey = normalizeMerchant(tx.merchant_name || tx.name);
  if (!merchantKey || ignoreRules[merchantKey]) return;

  var merchantTxIds = txData.filter(function(t) {
    return normalizeMerchant(t.merchant_name || t.name) === merchantKey;
  }).map(function(t) { return t.id; });

  var ignoredCount = merchantTxIds.filter(function(id) {
    var a = txActions[id];
    return a && a.action_type === 'ignored';
  }).length;

  if (ignoredCount >= 3 || (ignoredCount >= 2 && ignoredCount === merchantTxIds.length)) {
    showIgnoreSuggestion(merchantKey, tx.merchant_name || tx.name, ignoredCount);
  }
}

function showIgnoreSuggestion(merchantKey, displayName, count) {
  var existing = document.getElementById('ignore-suggestion');
  if (existing) existing.remove();

  var banner = document.createElement('div');
  banner.id = 'ignore-suggestion';
  banner.className = 'ignore-suggestion';
  banner.innerHTML =
    '<div class="ignore-suggestion-text">' +
      '<strong>Auto-ignore ' + esc(displayName) + '?</strong>' +
      '<span>You\'ve ignored ' + count + ' transactions from this merchant</span>' +
    '</div>' +
    '<div class="ignore-suggestion-actions">' +
      '<button class="btn-primary-sm" id="ignore-suggestion-yes">Yes</button>' +
      '<button class="btn-secondary-sm" id="ignore-suggestion-no">Dismiss</button>' +
    '</div>';

  var txContent = document.getElementById('tx-content');
  txContent.insertBefore(banner, txContent.children[1]);

  document.getElementById('ignore-suggestion-yes').addEventListener('click', async function() {
    await createIgnoreRule(merchantKey);
    banner.remove();
  });
  document.getElementById('ignore-suggestion-no').addEventListener('click', function() {
    banner.remove();
  });
}

async function createIgnoreRule(merchantKey) {
  await sb.from('merchant_ignore_rules').upsert({
    user_id: currentUser.id,
    merchant_name: merchantKey,
    is_active: true
  }, { onConflict: 'user_id,merchant_name' });
  ignoreRules[merchantKey] = true;

  var toIgnore = txData.filter(function(tx) {
    var key = normalizeMerchant(tx.merchant_name || tx.name);
    return key === merchantKey && !txActions[tx.id];
  });
  if (toIgnore.length > 0) {
    var rows = toIgnore.map(function(tx) {
      return { user_id: currentUser.id, transaction_id: tx.id, action_type: 'ignored' };
    });
    await sb.from('transaction_actions').upsert(rows, { onConflict: 'user_id,transaction_id' });
    toIgnore.forEach(function(tx) { txActions[tx.id] = { action_type: 'ignored' }; });
  }
  renderTransactionMonth();
}

// Load transactions when switching to that tab
document.getElementById('bottom-nav').addEventListener('click', function(e) {
  var btn = e.target.closest('.nav-item');
  if (btn && btn.dataset.tab === 'transactions' && txData.length === 0) {
    loadTransactions();
  }
});

// ============================================
// RECURRING
// ============================================
var recData = [];
var recLoaded = false;

async function loadRecurring() {
  var recEmpty = $('#rec-empty');
  var recContent = $('#rec-content');

  if (!cachedAccounts || cachedAccounts.length === 0) {
    recEmpty.hidden = false;
    recContent.hidden = true;
    return;
  }

  // Reuse txData if already loaded, otherwise fetch
  if (txData.length === 0) {
    var cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);
    var cutoffStr = cutoff.toISOString().split('T')[0];
    var result = await sb
      .from('synced_transactions')
      .select('*')
      .gte('date', cutoffStr)
      .order('date', { ascending: false });
    if (result.error || !result.data || result.data.length === 0) {
      recEmpty.hidden = false;
      recContent.hidden = true;
      recEmpty.querySelector('p').textContent = 'No transaction data yet. Visit Transactions first to sync.';
      return;
    }
    recData = result.data;
  } else {
    recData = txData;
  }

  recEmpty.hidden = true;
  recContent.hidden = false;

  var cardFilter = $('#rec-card-filter');
  cardFilter.innerHTML = '<option value="all">All Accounts</option>';
  if (cachedAccounts) {
    cachedAccounts.forEach(function(a) {
      if (a.plaid_account_id) {
        cardFilter.innerHTML += '<option value="' + esc(a.plaid_account_id) + '">' + esc(a.nickname || a.name || 'Account') + '</option>';
      }
    });
  }

  renderRecurring();

  cardFilter.addEventListener('change', renderRecurring);
  recLoaded = true;
}

function detectRecurring(transactions) {
  // Group by normalized merchant name, skip excluded
  var byMerchant = {};
  transactions.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    if (eff.excluded) return;
    var key = (tx.merchant_name || tx.name || 'Unknown').toLowerCase().trim();
    if (!byMerchant[key]) byMerchant[key] = { name: tx.merchant_name || tx.name || 'Unknown', txs: [], effs: [] };
    byMerchant[key].txs.push(tx);
    byMerchant[key].effs.push(eff);
  });

  var recurring = [];
  Object.keys(byMerchant).forEach(function(key) {
    var group = byMerchant[key];

    // Get per-month totals using effective amounts
    var monthTotals = {};
    group.effs.forEach(function(eff, i) {
      var m = group.txs[i].date.substring(0, 7);
      if (!monthTotals[m]) monthTotals[m] = 0;
      monthTotals[m] += eff.amount;
    });
    var months = Object.keys(monthTotals);
    if (months.length < 2) return;

    var totalAmount = group.effs.reduce(function(s, eff) { return s + eff.amount; }, 0);
    var avgAmount = totalAmount / months.length; // per-month average
    var isIncome = avgAmount < 0;

    // Find the most recent transaction date
    var lastDate = group.txs.reduce(function(latest, tx) {
      return tx.date > latest ? tx.date : latest;
    }, '');

    recurring.push({
      merchant: group.name,
      isIncome: isIncome,
      monthCount: months.length,
      amount: Math.abs(avgAmount),
      lastDate: lastDate
    });
  });

  return recurring;
}

function renderRecurring() {
  var cardId = $('#rec-card-filter').value;
  var summaryEl = $('#rec-summary');
  var incomeEl = $('#rec-income-section');
  var expenseEl = $('#rec-expense-section');

  // Filter by card
  var filtered = recData;
  if (cardId !== 'all') {
    filtered = filtered.filter(function(tx) { return tx.plaid_account_id === cardId; });
  }

  var allRecurring = detectRecurring(filtered);

  var incomeItems = allRecurring.filter(function(r) { return r.isIncome; });
  var expenseItems = allRecurring.filter(function(r) { return !r.isIncome; });

  // Sort by amount descending
  incomeItems.sort(function(a, b) { return b.amount - a.amount; });
  expenseItems.sort(function(a, b) { return b.amount - a.amount; });

  var totalIncome = incomeItems.reduce(function(s, i) { return s + i.amount; }, 0);
  var totalExpenses = expenseItems.reduce(function(s, i) { return s + i.amount; }, 0);

  // Summary
  summaryEl.innerHTML = '<div class="tx-month-summary">' +
    '<div class="tx-summary-item"><span class="tx-summary-label">Recurring Income</span><span class="tx-summary-value balance-positive">' + formatMoney(totalIncome) + '/mo</span></div>' +
    '<div class="tx-summary-item"><span class="tx-summary-label">Recurring Costs</span><span class="tx-summary-value balance-negative">' + formatMoney(totalExpenses) + '/mo</span></div>' +
  '</div>';

  // Render income section
  if (incomeItems.length > 0) {
    var incHtml = '<div class="rec-section"><h3 class="rec-section-title balance-positive">Income</h3>';
    incomeItems.forEach(function(item) {
      incHtml += renderRecurringRow(item, true);
    });
    incHtml += '</div>';
    incomeEl.innerHTML = incHtml;
  } else {
    incomeEl.innerHTML = '';
  }

  // Render expense section
  if (expenseItems.length > 0) {
    var expHtml = '<div class="rec-section"><h3 class="rec-section-title balance-negative">Costs</h3>';
    expenseItems.forEach(function(item) {
      expHtml += renderRecurringRow(item, false);
    });
    expHtml += '</div>';
    expenseEl.innerHTML = expHtml;
  } else {
    expenseEl.innerHTML = '';
  }

  if (incomeItems.length === 0 && expenseItems.length === 0) {
    incomeEl.innerHTML = '<div class="empty-state">No recurring transactions detected yet</div>';
  }
}

function renderRecurringRow(item, isIncome) {
  var freq = item.monthCount >= 10 ? 'Monthly' : item.monthCount + ' months';
  return '<div class="rec-row">' +
    '<div class="rec-info">' +
      '<span class="rec-merchant">' + esc(item.merchant) + '</span>' +
      '<span class="rec-freq">' + freq + ' -- last ' + formatTxDate(item.lastDate) + '</span>' +
    '</div>' +
    '<div class="rec-right">' +
      '<span class="rec-amount ' + (isIncome ? 'balance-positive' : 'balance-negative') + '">' +
        (isIncome ? '+' : '-') + formatMoney(item.amount) +
      '</span>' +
      '<span class="rec-avg">/mo</span>' +
    '</div>' +
  '</div>';
}

// Load recurring when switching to that tab
document.getElementById('bottom-nav').addEventListener('click', function(e) {
  var btn = e.target.closest('.nav-item');
  if (btn && btn.dataset.tab === 'recurring' && !recLoaded) {
    loadRecurring();
  }
});

// ============================================
// AI CHAT (inline on Snapshot)
// ============================================

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

// Tick all visible relative timestamps every 60s (no API calls)
setInterval(function() {
  document.querySelectorAll('[data-ts]').forEach(function(el) {
    var ts = el.getAttribute('data-ts');
    var prefix = el.getAttribute('data-ts-prefix') || '';
    var formatted = formatTimestamp(ts);
    if (formatted) el.textContent = prefix + formatted;
  });
}, 60000);

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
