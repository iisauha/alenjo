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

function dismissSplash() {
  var splash = document.getElementById('splash-screen');
  if (!splash) return;
  splash.classList.add('fade-out');
  setTimeout(function() { splash.remove(); }, 300);
}

sb.auth.onAuthStateChange(async function(event, session) {
  if (session && session.user) {
    currentUser = session.user;
    showScreen('app');
    await Promise.all([loadProfile(), loadAccounts()]);
    dismissSplash();
  } else {
    currentUser = null;
    if (checkBetaAccess()) showScreen('login');
    else showScreen('beta');
    dismissSplash();
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
  var order = (userProfile.tab_order || ['snapshot', 'investments', 'transactions', 'recurring', 'settings']).filter(function(t) { return t !== 'loans'; });
  var labels = { snapshot: 'Snapshot', investments: 'Investments', transactions: 'Transactions', recurring: 'Recurring', settings: 'Settings' };

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
  var order = (userProfile.tab_order || ['snapshot', 'investments', 'transactions', 'recurring', 'settings']).filter(function(t) { return t !== 'loans'; });
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
$('#net-cash-value').addEventListener('click', function() {
  showAvailable = !showAvailable;
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
      onExit: function(err) {
        showLoading(false);
        if (err) {
          showError('Connection failed: ' + (err.display_message || err.error_message || 'Please try again'));
        }
      }
    });

    handler.open();
  } catch (err) {
    showError('Connection error: ' + err.message);
    showLoading(false);
  }
}

btnConnectPlaid.addEventListener('click', function() { openPlaidLink(['transactions', 'investments']); });
btnAddAccount.addEventListener('click', function() { openPlaidLink(['transactions', 'investments']); });
if ($('#btn-connect-investments')) $('#btn-connect-investments').addEventListener('click', function() { openPlaidLink(['transactions', 'investments']); });

// Grant investment consent for an existing item
async function grantInvestmentConsent() {
  // Find the plaid_item_id for investment accounts
  var invAccounts = cachedAccounts.filter(function(a) { return a.type === 'investment'; });
  if (invAccounts.length === 0) return;
  var itemId = invAccounts[0].plaid_item_id;
  if (!itemId) return;

  showLoading(true);
  try {
    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data.session;
    var res = await fetch(SUPABASE_URL + '/functions/v1/plaid-link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ action: 'update_consent', item_id: itemId })
    });
    var data = await res.json();
    if (!res.ok || !data.link_token) {
      showError('Failed to start consent flow: ' + (data.detail || data.error || 'Unknown error'));
      showLoading(false);
      return;
    }
    showLoading(false);
    var handler = Plaid.create({
      token: data.link_token,
      onSuccess: function() {
        loadAccounts();
      },
      onExit: function() {}
    });
    handler.open();
  } catch (err) {
    showError('Consent error: ' + err.message);
    showLoading(false);
  }
}

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

// Manual refresh button — full app reload
$('#btn-refresh-sync').addEventListener('click', function() {
  if (this.classList.contains('syncing')) return;
  this.classList.add('syncing');
  location.reload();
});

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
  sectionBanks.hidden = banks.length === 0;
  sectionSavings.hidden = true; // savings moved to investments tab
  sectionCredit.hidden = credits.length === 0;

  renderSection(listBanks, banks, 'bank');
  var bankSum = banks.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
  banksTotal.textContent = formatMoney(bankSum);
  banksTotal.className = 'section-total ' + (bankSum >= 0 ? 'balance-positive' : 'balance-negative');

  renderSection(listCredit, credits, 'credit');
  var creditSum = credits.reduce(function(s, a) { return s + getDisplayBalance(a, 'credit').amount; }, 0);
  creditTotal.textContent = (creditSum < 0 ? '-' : '') + formatMoney(Math.abs(creditSum));
  creditTotal.className = 'section-total ' + (creditSum >= 0 ? 'balance-negative' : 'balance-positive');

  // Load liabilities for credit cards + loans tab
  if (credits.length > 0 || accounts.length > 0) {
    loadLiabilities().then(function() {
      renderSection(listCredit, credits, 'credit');
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
  var list = $('#accounts-list');
  if (!cachedAccounts || cachedAccounts.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:0.75rem">No accounts connected.</p>';
    return;
  }

  // Group by plaid_item_id (institution)
  var byItem = {};
  cachedAccounts.forEach(function(a) {
    var key = a.plaid_item_id || 'unknown';
    if (!byItem[key]) byItem[key] = { institution: a.institution || 'Unknown', accounts: [] };
    byItem[key].accounts.push(a);
  });

  var html = '';
  Object.keys(byItem).forEach(function(itemId) {
    var group = byItem[itemId];
    var acctCount = group.accounts.length;
    var types = group.accounts.map(function(a) {
      return a.type === 'investment' ? 'Investment' : a.type === 'credit' ? 'Credit' : a.subtype === 'savings' ? 'Savings' : 'Checking';
    });
    var uniqueTypes = types.filter(function(t, i) { return types.indexOf(t) === i; });
    html += '<div class="settings-institution">';
    html += '<div class="settings-inst-header">';
    html += '<div class="settings-inst-info">';
    html += '<span class="settings-inst-name">' + esc(group.institution) + '</span>';
    html += '<span class="settings-inst-detail">' + acctCount + ' account' + (acctCount !== 1 ? 's' : '') + ' -- ' + uniqueTypes.join(', ') + '</span>';
    html += '</div>';
    html += '<button class="btn-disconnect-inst" data-item="' + esc(itemId) + '">Disconnect</button>';
    html += '</div>';
    html += '</div>';
  });
  list.innerHTML = html;
}

document.addEventListener('click', async function(e) {
  var btn = e.target.closest('.btn-disconnect-inst');
  if (!btn) return;
  var itemId = btn.dataset.item;
  var group = cachedAccounts.filter(function(a) { return a.plaid_item_id === itemId; });
  var instName = group.length > 0 ? (group[0].institution || 'this institution') : 'this institution';
  var acctCount = group.length;
  if (!confirm('Disconnect ' + instName + '? This removes all ' + acctCount + ' account' + (acctCount !== 1 ? 's' : '') + ' from Plaid and deletes their data.')) return;
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
      cachedHoldings = null;
      cachedLiabilities = null;
      renderAccounts(cachedAccounts);
    } else {
      btn.textContent = 'Error';
      btn.disabled = false;
    }
  } catch (err) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
});

async function updateSyncInfo() {
  var billingSection = $('#section-billing');
  var billingEl = $('#billing-info');
  if (!cachedAccounts || cachedAccounts.length === 0) {
    billingEl.innerHTML = '<p style="color:var(--text-dim);font-size:0.75rem">Connect an account to see billing.</p>';
    return;
  }
  // Count by type
  var bankAccounts = cachedAccounts.filter(function(a) { return a.type === 'depository'; });
  var creditAccounts = cachedAccounts.filter(function(a) { return a.type === 'credit'; });
  var invAccounts = cachedAccounts.filter(function(a) { return a.type === 'investment'; });
  var txAccounts = bankAccounts.length + creditAccounts.length;
  var totalAccounts = cachedAccounts.length;

  // Plaid per-account rates
  var txRate = 0.30;
  var invHoldingsRate = 0.18;
  var invTxRate = 0.35;
  var liabRate = 0.20;
  var txCost = txAccounts * txRate;
  var invHoldingsCost = invAccounts.length * invHoldingsRate;
  var invTxCost = invAccounts.length * invTxRate;
  var liabCost = creditAccounts.length * liabRate;
  var monthlyEstimate = txCost + invHoldingsCost + invTxCost + liabCost;

  var html = '';

  // Conversational intro
  var parts = [];
  if (bankAccounts.length > 0) parts.push(bankAccounts.length + ' bank');
  if (creditAccounts.length > 0) parts.push(creditAccounts.length + ' credit card');
  if (invAccounts.length > 0) parts.push(invAccounts.length + ' investment');
  html += '<p class="billing-intro">We want to be transparent about what it costs to run your account. You have <strong>' + totalAccounts + ' account' + (totalAccounts !== 1 ? 's' : '') + '</strong> connected' + (parts.length > 0 ? ' (' + parts.join(', ') + ')' : '') + '. We use Plaid to sync your data securely with your bank. Here is exactly what that costs.</p>';

  // Explain each product, then show the charge
  if (txAccounts > 0) {
    html += '<div class="sync-info-row"><span>Transaction syncing</span><span>$' + txCost.toFixed(2) + '</span></div>';
    html += '<p class="billing-explain">Automatically pulls your purchases and deposits from ' + txAccounts + ' account' + (txAccounts !== 1 ? 's' : '') + '. Plaid charges $' + txRate.toFixed(2) + '/account/month.</p>';
  }

  if (creditAccounts.length > 0) {
    html += '<div class="sync-info-row"><span>Credit card details</span><span>$' + liabCost.toFixed(2) + '</span></div>';
    html += '<p class="billing-explain">Shows your APR, minimum payment, due dates, and utilization for ' + creditAccounts.length + ' card' + (creditAccounts.length !== 1 ? 's' : '') + '. Plaid charges $' + liabRate.toFixed(2) + '/card/month.</p>';
  }

  if (invAccounts.length > 0) {
    html += '<div class="sync-info-row"><span>Investment data</span><span>$' + (invHoldingsCost + invTxCost).toFixed(2) + '</span></div>';
    html += '<p class="billing-explain">Tracks your holdings, portfolio value, and investment activity for ' + invAccounts.length + ' account' + (invAccounts.length !== 1 ? 's' : '') + '. Plaid charges $' + (invHoldingsRate + invTxRate).toFixed(2) + '/account/month.</p>';
  }

  // Total -- same row style, no extra wrapper
  html += '<div class="sync-info-row sync-info-total"><span>This month</span><span>$' + monthlyEstimate.toFixed(2) + '</span></div>';

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
    var overrides = getCardOverrides(account.id);
    var limit = account.balance_limit ? parseFloat(account.balance_limit) : 0;
    var limitManual = false;
    if (!limit && overrides.limit) {
      limit = overrides.limit;
      limitManual = true;
    }
    var used = bal.amount;

    liabHtml = '<div class="card-liabilities">';

    // Show utilization bar if credit limit is available (from Plaid or manual)
    if (limit > 0) {
      var utilPct = Math.min((used / limit) * 100, 100);
      var utilClass = utilPct > 75 ? 'util-high' : utilPct > 30 ? 'util-mid' : 'util-low';
      liabHtml +=
        '<div class="liab-util-wrap">' +
          '<div class="liab-util-bar"><div class="liab-util-fill ' + utilClass + '" style="width:' + utilPct.toFixed(1) + '%"></div></div>' +
          '<div class="liab-util-labels"><span>' + formatMoney(used) + ' / ' + formatMoney(limit) + (limitManual ? ' <span class="manual-tag">(manual)</span>' : '') + '</span><span>' + utilPct.toFixed(0) + '% used</span></div>' +
        '</div>';
    }

    // Show detailed liabilities data if available from Plaid Liabilities product
    var liab = cachedLiabilities ? cachedLiabilities.find(function(l) { return l.account_id === account.id; }) : null;
    var details = '';
    var apr = (liab && liab.apr_purchase) ? parseFloat(liab.apr_purchase) : overrides.apr || null;
    var aprManual = !(liab && liab.apr_purchase) && overrides.apr;
    if (apr) details += '<div class="liab-detail"><span>Purchase APR</span><span>' + apr.toFixed(2) + '%' + (aprManual ? ' <span class="manual-tag">(manual)</span>' : '') + '</span></div>';

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

    if (overrides.stmtDate) details += '<div class="liab-detail"><span>Statement Date</span><span>' + ordinalDay(overrides.stmtDate) + ' of month <span class="manual-tag">(manual)</span></span></div>';

    if (liab && liab.is_overdue && hasMinPayment) details += '<div class="liab-detail liab-urgent"><span>Status</span><span>OVERDUE</span></div>';

    if (details) liabHtml += details;
    if (!liab && !details) {
      liabHtml += '<div class="liab-detail liab-unavailable"><span>Card details not available from this institution</span></div>';
    }

    liabHtml += '</div>';
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
        '<div class="amount ' + (type === 'credit' ? (bal.amount < 0 ? 'balance-positive' : 'balance-negative') : 'balance-positive') + '">' + (bal.amount < 0 ? '-' : '') + formatMoney(Math.abs(bal.amount)) + '</div>' +
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

function ordinalDay(d) {
  d = parseInt(d);
  var s = ['th','st','nd','rd'];
  var v = d % 100;
  return d + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Card detail overrides (localStorage)
function getCardOverrides(accountId) {
  try {
    var all = JSON.parse(localStorage.getItem('alenjo_card_overrides') || '{}');
    return all[accountId] || {};
  } catch (e) { return {}; }
}

function setCardOverrides(accountId, data) {
  try {
    var all = JSON.parse(localStorage.getItem('alenjo_card_overrides') || '{}');
    if (!data || (!data.limit && !data.apr && !data.stmtDate)) {
      delete all[accountId];
    } else {
      all[accountId] = data;
    }
    localStorage.setItem('alenjo_card_overrides', JSON.stringify(all));
  } catch (e) { console.error('Override save error:', e); }
}

// Account edit modal (nickname + card overrides)
var accountEditModal = $('#account-edit-modal');
var nicknameInput = $('#nickname-input');
var editingAccountId = null;

document.addEventListener('click', function(e) {
  var nameEl = e.target.closest('.account-name');
  if (!nameEl || !nameEl.dataset.id) return;
  editingAccountId = nameEl.dataset.id;
  nicknameInput.value = nameEl.textContent;

  // Check if this is a credit card with missing data
  var acct = cachedAccounts ? cachedAccounts.find(function(a) { return a.id === editingAccountId; }) : null;
  var overridesSection = $('#card-overrides-section');
  var showOverrides = false;

  if (acct && acct.type === 'credit') {
    var liab = cachedLiabilities ? cachedLiabilities.find(function(l) { return l.account_id === editingAccountId; }) : null;
    var hasLimit = !!(acct.balance_limit && parseFloat(acct.balance_limit) > 0);
    var hasApr = !!(liab && liab.apr_purchase);
    var hasStmtDate = !!(liab && liab.next_payment_due_date);

    var ov = getCardOverrides(editingAccountId);

    // Only show fields that are missing from Plaid
    var limitRow = $('#override-limit-row');
    var aprRow = $('#override-apr-row');
    var dateRow = $('#override-date-row');

    limitRow.style.display = hasLimit ? 'none' : '';
    aprRow.style.display = hasApr ? 'none' : '';
    dateRow.style.display = hasStmtDate ? 'none' : '';

    if (!hasLimit || !hasApr || !hasStmtDate) {
      showOverrides = true;
      if (!hasLimit) $('#override-limit').value = ov.limit || '';
      if (!hasApr) $('#override-apr').value = ov.apr || '';
      if (!hasStmtDate) $('#override-stmt-date').value = ov.stmtDate || '';
    }
  }

  overridesSection.style.display = showOverrides ? '' : 'none';
  accountEditModal.classList.add('visible');
  nicknameInput.focus();
  nicknameInput.select();
});

$('#account-edit-save').addEventListener('click', function() {
  if (!editingAccountId) return;

  // Save nickname
  var newName = nicknameInput.value.trim();
  if (newName) {
    sb.from('accounts').update({ nickname: newName }).eq('id', editingAccountId).then(function() {
      if (cachedAccounts) {
        cachedAccounts.forEach(function(a) {
          if (a.id === editingAccountId) a.nickname = newName;
        });
        renderAccounts(cachedAccounts);
      }
    });
  }

  // Save card overrides if visible
  if ($('#card-overrides-section').style.display !== 'none') {
    var lim = parseFloat($('#override-limit').value) || 0;
    var apr = parseFloat($('#override-apr').value) || 0;
    var stmtDate = parseInt($('#override-stmt-date').value) || 0;
    setCardOverrides(editingAccountId, { limit: lim, apr: apr, stmtDate: stmtDate });
    if (cachedAccounts) renderAccounts(cachedAccounts);
  }

  accountEditModal.classList.remove('visible');
  editingAccountId = null;
});

$('#account-edit-cancel').addEventListener('click', function() {
  accountEditModal.classList.remove('visible');
  editingAccountId = null;
});

nicknameInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); $('#account-edit-save').click(); }
  if (e.key === 'Escape') { $('#account-edit-cancel').click(); }
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

  // Determine data window: first connection - 2 months, capped at 24 months
  var now = new Date();
  var dataStartDate = new Date(now.getFullYear(), now.getMonth() - 2, 1); // default 3 months
  var fcResult = await sb.rpc('get_first_connection_date');
  if (fcResult.data) {
    var fc = new Date(fcResult.data);
    fc.setMonth(fc.getMonth() - 2);
    dataStartDate = fc;
  }
  var cap = new Date(now.getFullYear(), now.getMonth() - 24, 1);
  if (dataStartDate < cap) dataStartDate = cap;
  var dataStartStr = dataStartDate.toISOString().split('T')[0];

  // Fetch transactions within data window
  var result = await sb
    .from('synced_transactions')
    .select('*')
    .gte('date', dataStartStr)
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
  var actionsResult = await sb.from('transaction_actions').select('transaction_id, action_type, split_ways, split_portion, category_override, nickname, date_override, is_recurring, recurring_group, recurring_next_date, recurring_amount_mode');
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

  var searchInput = $('#tx-search');
  var searchTimer = null;
  searchInput.addEventListener('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderTransactionMonth, 200);
  });

  $('#btn-toggle-ignored').addEventListener('click', function() {
    showIgnoredTx = !showIgnoredTx;
    this.textContent = showIgnoredTx ? 'Hide Ignored' : 'Show Ignored';
    this.classList.toggle('active', showIgnoredTx);
    renderTransactionMonth();
  });

  // Background sync is handled by throttledSync() from loadAccounts
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
    result.reimbursement = Math.abs(tx.amount) - Math.abs(tx.amount) / action.split_ways;
    if (!result.excluded) result.amount = tx.amount / action.split_ways;
  }
  if (action.category_override) {
    result.isRecategorized = true;
    result.category = action.category_override;
  }
  return result;
}

var txPieChart = null;
var txPieLastMonth = null;
var activeCategoryFilter = null;
var showIgnoredTx = false;
var txPieCenterData = { label: null, amount: 0, pct: '' };

// Register center text plugin globally for the doughnut chart
var txCenterTextPlugin = {
  id: 'txCenterText',
  afterDraw: function(chart) {
    if (txPieCenterData.amount === 0 && !txPieCenterData.label) return;
    var ctx = chart.ctx;
    var centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
    var centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (txPieCenterData.label) {
      // Category selected: show name, amount, %
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(txPieCenterData.label, centerX, centerY - 18);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(formatMoney(txPieCenterData.amount), centerX, centerY + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(txPieCenterData.pct, centerX, centerY + 19);
    } else {
      // No category: show total
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('Total', centerX, centerY - 12);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(formatMoney(txPieCenterData.amount), centerX, centerY + 8);
    }
    ctx.restore();
  }
};
if (typeof Chart !== 'undefined') Chart.register(txCenterTextPlugin);

var CATEGORY_COLORS = [
  '#3C82F6', '#4DE88F', '#E84D4D', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#EF4444', '#A855F7', '#22D3EE', '#FB923C'
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

  // Update center text data for pie chart
  if (activeCategoryFilter && byCategory[activeCategoryFilter]) {
    var catAmt = byCategory[activeCategoryFilter];
    txPieCenterData = { label: activeCategoryFilter, amount: catAmt, pct: totalExpenses > 0 ? ((catAmt / totalExpenses) * 100).toFixed(0) + '%' : '0%' };
  } else {
    txPieCenterData = { label: null, amount: totalExpenses, pct: '' };
  }

  // Render pie chart — update in place to avoid re-spin
  var canvas = document.getElementById('tx-pie-chart');

  var monthChanged = txPieLastMonth !== month;
  txPieLastMonth = month;

  if (catEntries.length > 0 && typeof Chart !== 'undefined') {
    if (txPieChart && !monthChanged) {
      // Update data in place — no re-spin on category click
      txPieChart.data.labels = catLabels;
      txPieChart.data.datasets[0].data = catAmounts;
      txPieChart.data.datasets[0].backgroundColor = CATEGORY_COLORS.slice(0, catLabels.length);
      txPieChart.options.animation = false;
      txPieChart.update();
    } else {
      if (txPieChart) txPieChart.destroy();
      txPieChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: catLabels,
          datasets: [{
            data: catAmounts,
            backgroundColor: CATEGORY_COLORS.slice(0, catLabels.length),
            borderWidth: 0,
            hoverOffset: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '58%',
          layout: { padding: 0 },
          animation: { animateRotate: true, duration: 800 },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false }
          },
          onClick: function(e, elements) {
            if (elements.length > 0) {
              var idx = elements[0].index;
              var clickedCat = txPieChart.data.labels[idx];
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
  } else if (txPieChart) {
    txPieChart.destroy();
    txPieChart = null;
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

  // Build category-to-color map from pie chart order
  var categoryColorMap = {};
  catEntries.forEach(function(entry, i) {
    categoryColorMap[entry[0]] = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
  });

  var purchaseCount = displayTx.length;
  var html = '<div class="tx-purchase-count">' + purchaseCount + ' transaction' + (purchaseCount !== 1 ? 's' : '') + '</div>';

  // Sort transactions: most recent first by effective date
  displayTx.sort(function(a, b) {
    var effA = getEffectiveTx(a);
    var effB = getEffectiveTx(b);
    var da = effA.date || a.authorized_datetime || a.authorized_date || a.date;
    var db = effB.date || b.authorized_datetime || b.authorized_date || b.date;
    if (da > db) return -1;
    if (da < db) return 1;
    return 0;
  });

  // Render transactions
  displayTx.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    var postedDate = tx.date;
    var authDate = tx.authorized_date;
    var dateHtml = '';
    if (authDate && authDate !== postedDate) {
      dateHtml = '<span class="tx-date-line">Auth ' + formatTxDate(authDate, null) + '</span>' +
        '<span class="tx-date-line">Posted ' + formatTxDate(postedDate, null) + '</span>';
    } else {
      dateHtml = '<span class="tx-date-line">' + formatTxDate(postedDate, null) + '</span>';
    }

    var displayName = eff.nickname || tx.enriched_merchant_name || tx.merchant_name || tx.name || 'Unknown';

    var rowClass = 'tx-row';
    var badges = '';
    if (eff.excluded) rowClass += ' tx-actioned tx-excluded';
    else if (eff.isSplit || eff.isRecurring || eff.isRecategorized) rowClass += ' tx-actioned';

    if (eff.actionType === 'reimbursed') badges += '<span class="tx-badge tx-badge-reimbursed">Reimbursed</span>';
    if (eff.actionType === 'ignored') badges += '<span class="tx-badge tx-badge-ignored">Ignored</span>';
    if (eff.isSplit) {
      var splitLabel = eff.splitWays ? eff.splitWays + '-way split' : 'Split';
      badges += '<span class="tx-badge tx-badge-split">' + splitLabel + ' (+' + formatMoney(eff.reimbursement) + ' back)</span>';
    }
    if (eff.isRecurring) badges += '<span class="tx-badge tx-badge-recurring">Recurring</span>';

    var amountClass = tx.pending ? 'tx-amount-pending' : (tx.amount < 0 ? 'balance-positive' : 'balance-negative');
    var amountHtml = '';
    if (eff.isSplit && !eff.excluded) {
      amountHtml = '<span class="tx-amount-original">' + (tx.amount < 0 ? '+' : '-') + formatMoney(Math.abs(tx.amount)) + '</span>' +
        '<span class="tx-amount ' + amountClass + '">' +
          (tx.amount < 0 ? '+' : '-') + formatMoney(Math.abs(eff.amount)) +
        '</span>';
    } else {
      amountHtml = '<span class="tx-amount ' + amountClass + '">' +
        (tx.amount < 0 ? '+' : '-') + formatMoney(Math.abs(tx.amount)) +
      '</span>';
    }

    var cardLabel = '';
    if (showCardName && tx.plaid_account_id && accountMap[tx.plaid_account_id]) {
      cardLabel = '<span class="tx-card-label">' + esc(accountMap[tx.plaid_account_id]) + '</span>';
    }

    var logoHtml = tx.enriched_logo_url ? '<img class="tx-logo" src="' + esc(tx.enriched_logo_url) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    var locationHtml = '';
    if (tx.enriched_location_city || tx.enriched_location_region) {
      var locParts = [tx.enriched_location_city, tx.enriched_location_region].filter(Boolean);
      locationHtml = '<span class="tx-location">' + esc(locParts.join(', ')) + '</span>';
    }

    html += '<div class="' + rowClass + '" data-txid="' + esc(tx.id) + '">' +
      logoHtml +
      '<div class="tx-info">' +
        '<span class="tx-merchant">' + esc(displayName) + '</span>' +
        '<div class="tx-badges">' +
          '<span class="tx-cat-chip" style="--cat-color:' + (categoryColorMap[normalizeCategory(eff.category)] || '#6C7078') + '">' + esc(normalizeCategory(eff.category)) + '</span>' +
          badges +
        '</div>' +
        cardLabel +
        locationHtml +
      '</div>' +
      '<div class="tx-right">' +
        amountHtml +
        '<div class="tx-dates">' + dateHtml + '</div>' +
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
  if (action.is_recurring) statusParts.push('Recurring');
  if (action.category_override) statusParts.push('Re-categorized');

  var statusEl = $('#tx-action-status');
  var hasActions = statusParts.length > 0;
  statusEl.textContent = hasActions ? 'Currently: ' + statusParts.join(', ') : '';
  statusEl.hidden = !hasActions;
  document.querySelector('.action-option-clear').hidden = !hasActions;

  // Highlight active toggles
  document.querySelectorAll('.action-toggle').forEach(function(btn) {
    var t = btn.dataset.toggle;
    var isActive = false;
    if (t === 'split') isActive = action.split_ways > 1;
    else if (t === 'recurring') isActive = !!action.is_recurring;
    else if (t === 'recategorized') isActive = !!action.category_override;
    else if (t === 'reimbursed') isActive = action.action_type === 'reimbursed';
    else if (t === 'ignored') isActive = action.action_type === 'ignored';
    btn.classList.toggle('active', isActive);
  });

  // Reset sub-pickers
  $('#split-picker').hidden = true;
  $('#recat-picker').hidden = true;
  $('#edit-picker').hidden = true;
  $('#recurring-picker').hidden = true;
  $('#recurring-date-picker').hidden = true;
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
      $('#tx-action-options').hidden = true;
      $('#split-picker').hidden = false;
      $('#split-preview').textContent = '';
      $('#split-custom-row').hidden = true;
      $('#split-portion-row').hidden = true;
      return;
    }

    if (toggle === 'recurring') {
      if (existing.is_recurring) {
        // Already recurring: show date picker with existing preferences to edit
        pendingRecurringGroup = existing.recurring_group || (actionTx.merchant_name || actionTx.name || 'Unknown').toLowerCase().trim();
        showRecurringDatePicker(existing);
        return;
      }
      // Show recurring picker to match or create new
      showRecurringPicker();
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

// Split picker - quick split buttons (2-way, 3-way)
document.querySelectorAll('#split-picker button[data-ways]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var ways = parseInt(btn.dataset.ways);
    var share = Math.abs(actionTx.amount) / ways;
    var reimburse = Math.abs(actionTx.amount) - share;
    $('#split-preview').textContent = 'Your share: ' + formatMoney(share) + ' -- Getting back: ' + formatMoney(reimburse);
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
  $('#split-preview').textContent = 'Your share: ' + formatMoney(share) + ' -- Getting back: ' + formatMoney(reimburse);
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
  if (!portion || portion <= 0 || portion >= Math.abs(actionTx.amount)) return;
  var reimburse = Math.abs(actionTx.amount) - portion;
  $('#split-preview').textContent = 'Your portion: ' + formatMoney(portion) + ' -- Getting back: ' + formatMoney(reimburse);
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
var pendingRecurringGroup = null;

function showRecurringPicker() {
  $('#tx-action-options').hidden = true;
  var picker = $('#recurring-picker');
  picker.hidden = false;
  var list = $('#recurring-match-list');

  // Find existing recurring groups from txActions
  var groups = {};
  txData.forEach(function(tx) {
    var a = txActions[tx.id];
    if (!a || !a.is_recurring) return;
    var groupKey = a.recurring_group || (tx.merchant_name || tx.name || 'Unknown').toLowerCase().trim();
    if (!groups[groupKey]) {
      groups[groupKey] = {
        name: a.nickname || tx.merchant_name || tx.name || 'Unknown',
        key: groupKey,
        lastAmount: Math.abs(tx.amount),
        lastDate: tx.date
      };
    }
    if (tx.date > groups[groupKey].lastDate) {
      groups[groupKey].lastAmount = Math.abs(tx.amount);
      groups[groupKey].lastDate = tx.date;
      if (a.nickname) groups[groupKey].name = a.nickname;
    }
  });

  var groupList = Object.values(groups).sort(function(a, b) { return a.name.localeCompare(b.name); });

  if (groupList.length > 0) {
    list.innerHTML = groupList.map(function(g) {
      return '<button class="recat-option" data-group="' + esc(g.key) + '">' + esc(g.name) + ' (' + formatMoney(g.lastAmount) + ')</button>';
    }).join('');

    list.querySelectorAll('.recat-option').forEach(function(btn) {
      btn.addEventListener('click', function() {
        pendingRecurringGroup = btn.dataset.group;
        showRecurringDatePicker();
      });
    });
  } else {
    list.innerHTML = '<p style="font-size:0.75rem;color:var(--text-dim)">No existing recurring items yet</p>';
  }
}

$('#recurring-new').addEventListener('click', function() {
  if (!actionTxId) return;
  pendingRecurringGroup = (actionTx.merchant_name || actionTx.name || 'Unknown').toLowerCase().trim();
  showRecurringDatePicker();
});

var pendingRecurringMode = 'recent';

function showRecurringDatePicker(existing) {
  $('#recurring-picker').hidden = true;
  $('#tx-action-options').hidden = true;
  $('#recurring-date-picker').hidden = false;

  var mode = (existing && existing.recurring_amount_mode) || 'recent';
  var nextDate = (existing && existing.recurring_next_date) || '';
  pendingRecurringMode = mode;

  $('#recurring-custom-date').value = nextDate;
  $('#recurring-remove').hidden = !(existing && existing.is_recurring);

  document.querySelectorAll('.recurring-mode-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.mode === mode);
  });

  // Check if nextDate matches any preset offset
  document.querySelectorAll('.recurring-date-btn').forEach(function(b) {
    b.classList.remove('active');
    if (nextDate) {
      var offset = parseInt(b.dataset.offset);
      var d = new Date();
      d.setDate(d.getDate() + offset);
      var presetStr = d.toISOString().split('T')[0];
      if (presetStr === nextDate) b.classList.add('active');
    }
  });
}

// Amount mode toggle
document.querySelectorAll('.recurring-mode-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    pendingRecurringMode = btn.dataset.mode;
    document.querySelectorAll('.recurring-mode-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  });
});

// Preset date buttons
document.querySelectorAll('.recurring-date-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.recurring-date-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var offset = parseInt(btn.dataset.offset);
    if (isNaN(offset)) {
      // Custom button -- show date picker
      $('#custom-date-wrap').hidden = false;
      $('#recurring-custom-date').value = '';
    } else {
      // Preset -- calculate date, hide custom picker
      var d = new Date();
      d.setDate(d.getDate() + offset);
      $('#recurring-custom-date').value = d.toISOString().split('T')[0];
      $('#custom-date-wrap').hidden = true;
    }
  });
});

$('#recurring-date-save').addEventListener('click', function() {
  if (!actionTxId || !pendingRecurringGroup) return;
  var nextDate = $('#recurring-custom-date').value || null;
  finishRecurringSave(nextDate);
});

$('#recurring-date-skip').addEventListener('click', function() {
  if (!actionTxId || !pendingRecurringGroup) return;
  finishRecurringSave(null);
});

$('#recurring-remove').addEventListener('click', function() {
  if (!actionTxId) return;
  saveMultiAction(actionTxId, { is_recurring: false, recurring_group: null, recurring_next_date: null, recurring_amount_mode: 'recent' });
  pendingRecurringGroup = null;
});

function finishRecurringSave(nextDate) {
  var updates = { is_recurring: true, recurring_group: pendingRecurringGroup, recurring_next_date: nextDate, recurring_amount_mode: pendingRecurringMode };
  saveMultiAction(actionTxId, updates);
  pendingRecurringGroup = null;
}

// Re-categorize picker
function showRecatPicker() {
  $('#tx-action-options').hidden = true;
  var picker = $('#recat-picker');
  picker.hidden = false;
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
}

// Edit picker
function showEditPicker() {
  $('#tx-action-options').hidden = true;
  var picker = $('#edit-picker');
  picker.hidden = false;
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
    recurring_amount_mode: updates.hasOwnProperty('recurring_amount_mode') ? updates.recurring_amount_mode : (existing.recurring_amount_mode || 'recent')
  };
  var saveResult = await sb.from('transaction_actions').upsert(row, { onConflict: 'user_id,transaction_id' });
  if (saveResult.error) {
    console.error('Failed to save action:', saveResult.error);
    // Retry once
    var retryResult = await sb.from('transaction_actions').upsert(row, { onConflict: 'user_id,transaction_id' });
    if (retryResult.error) console.error('Retry also failed:', retryResult.error);
  }
  txActions[txId] = row;

  if (row.action_type === 'ignored') {
    checkIgnorePattern(txId);
  }

  renderTransactionMonth();
  closeActionSheet();
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
// RECURRING (user-tagged)
// ============================================
var recLoaded = false;

async function loadRecurring() {
  var recEmpty = $('#rec-empty');
  var recContent = $('#rec-content');

  // Load transaction data if not already loaded
  if (txData.length === 0) {
    var result = await sb.from('synced_transactions').select('*').order('date', { ascending: false }).limit(5000);
    if (result.data && result.data.length > 0) {
      txData = result.data;
    }
    // Load actions if not loaded
    if (Object.keys(txActions).length === 0) {
      var actionsResult = await sb.from('transaction_actions').select('transaction_id, action_type, split_ways, split_portion, category_override, nickname, date_override, is_recurring, recurring_group, recurring_next_date, recurring_amount_mode');
      if (actionsResult.data) {
        actionsResult.data.forEach(function(row) { txActions[row.transaction_id] = row; });
      }
    }
  }

  if (txData.length === 0) {
    recEmpty.hidden = false;
    recContent.hidden = true;
    return;
  }

  renderRecurring();
}

function renderRecurring() {
  var recEmpty = $('#rec-empty');
  var recContent = $('#rec-content');
  var summaryEl = $('#rec-summary');
  var listEl = $('#rec-list');

  // Group recurring-tagged transactions by recurring_group
  var groups = {};
  txData.forEach(function(tx) {
    var action = txActions[tx.id];
    if (!action || !action.is_recurring) return;
    var groupKey = action.recurring_group || (tx.merchant_name || tx.name || 'Unknown').toLowerCase().trim();
    if (!groups[groupKey]) {
      groups[groupKey] = { name: null, txs: [] };
    }
    groups[groupKey].txs.push(tx);
  });

  var recurringItems = [];
  Object.keys(groups).forEach(function(key) {
    var group = groups[key];
    // Sort by date descending to get most recent
    group.txs.sort(function(a, b) { return b.date > a.date ? 1 : b.date < a.date ? -1 : 0; });
    var mostRecent = group.txs[0];
    var action = txActions[mostRecent.id] || {};
    var eff = getEffectiveTx(mostRecent);
    var displayName = eff.nickname || mostRecent.merchant_name || mostRecent.name || 'Unknown';
    var isIncome = mostRecent.amount < 0;
    var amountMode = action.recurring_amount_mode || 'recent';
    var amount;
    var isEstimate = false;

    function getSplitAmount(t) {
      var a = txActions[t.id];
      var raw = Math.abs(t.amount);
      return (a && a.split_ways > 1) ? raw / a.split_ways : raw;
    }

    if (amountMode === 'average' && group.txs.length > 1) {
      var total = group.txs.reduce(function(s, t) {
        return s + getSplitAmount(t);
      }, 0);
      amount = total / group.txs.length;
      isEstimate = true;
    } else {
      amount = getSplitAmount(mostRecent);
    }

    recurringItems.push({
      name: displayName,
      category: normalizeCategory(eff.category),
      amount: amount,
      isIncome: isIncome,
      isEstimate: isEstimate,
      lastDate: mostRecent.date,
      nextDate: action.recurring_next_date || null,
      count: group.txs.length,
      isSplit: eff.isSplit,
      splitWays: eff.splitWays
    });
  });

  if (recurringItems.length === 0) {
    recEmpty.hidden = false;
    recContent.hidden = true;
    return;
  }

  recEmpty.hidden = true;
  recContent.hidden = false;

  // Split into income vs expenses
  var incomeItems = recurringItems.filter(function(r) { return r.isIncome; });
  var expenseItems = recurringItems.filter(function(r) { return !r.isIncome; });
  incomeItems.sort(function(a, b) { return b.amount - a.amount; });
  expenseItems.sort(function(a, b) { return b.amount - a.amount; });

  var totalIncome = incomeItems.reduce(function(s, i) { return s + i.amount; }, 0);
  var totalExpenses = expenseItems.reduce(function(s, i) { return s + i.amount; }, 0);

  summaryEl.innerHTML = '<div class="tx-month-summary">' +
    (totalIncome > 0 ? '<div class="tx-summary-item"><span class="tx-summary-label">Recurring Income</span><span class="tx-summary-value balance-positive">' + formatMoney(totalIncome) + '/mo</span></div>' : '') +
    '<div class="tx-summary-item"><span class="tx-summary-label">Recurring Costs</span><span class="tx-summary-value balance-negative">' + formatMoney(totalExpenses) + '/mo</span></div>' +
  '</div>';

  var html = '';
  if (incomeItems.length > 0) {
    html += '<div class="rec-section"><h3 class="rec-section-title balance-positive">Income</h3>';
    incomeItems.forEach(function(item) { html += renderRecurringRow(item, true); });
    html += '</div>';
  }
  if (expenseItems.length > 0) {
    html += '<div class="rec-section"><h3 class="rec-section-title balance-negative">Costs</h3>';
    expenseItems.forEach(function(item) { html += renderRecurringRow(item, false); });
    html += '</div>';
  }
  listEl.innerHTML = html;
  recLoaded = true;
}

function renderRecurringRow(item, isIncome) {
  var splitLabel = item.isSplit ? ' (' + (item.splitWays ? item.splitWays + '-way split' : 'Split') + ')' : '';
  var nextLabel = '';
  if (item.nextDate) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var parts = item.nextDate.split('-');
    var next = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    var diffDays = Math.round((next - today) / 86400000);
    if (diffDays < 0) nextLabel = '<span class="rec-overdue">Overdue by ' + Math.abs(diffDays) + 'd</span>';
    else if (diffDays === 0) nextLabel = '<span class="rec-due-soon">Expected today</span>';
    else if (diffDays <= 3) nextLabel = '<span class="rec-due-soon">Expected in ' + diffDays + 'd</span>';
    else nextLabel = '<span class="rec-expected">Expected in ' + diffDays + 'd</span>';
  }
  return '<div class="rec-row">' +
    '<div class="rec-info">' +
      '<span class="rec-merchant">' + esc(item.name) + '</span>' +
      '<span class="rec-freq">' + esc(item.category) + splitLabel + '</span>' +
      (nextLabel ? nextLabel : '') +
    '</div>' +
    '<div class="rec-right">' +
      '<span class="rec-amount ' + (isIncome ? 'balance-positive' : 'balance-negative') + '">' +
        (item.isEstimate ? '~' : '') + (isIncome ? '+' : '-') + formatMoney(item.amount) +
      '</span>' +
      '<span class="rec-avg">' + (item.isEstimate ? 'avg/mo' : '/mo') + '</span>' +
    '</div>' +
  '</div>';
}

// Load recurring when switching to that tab
document.getElementById('bottom-nav').addEventListener('click', function(e) {
  var btn = e.target.closest('.nav-item');
  if (btn && btn.dataset.tab === 'recurring') {
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
