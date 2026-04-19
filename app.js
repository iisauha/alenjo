(function() {
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
var cachedBalances = { available: 0, savings: 0, investments: 0 };

// ============================================
// AUTH (sign-in only, no new signups)
// ============================================
authForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  authSubmit.disabled = true;
  authError.hidden = true;

  var email = authEmail.value.trim();
  var password = authPassword.value;

  var result = await sb.auth.signInWithPassword({ email: email, password: password });

  if (result.error) {
    authError.textContent = result.error.message;
    authError.hidden = false;
    authSubmit.disabled = false;
    authSubmit.textContent = 'Sign In';
    return;
  }

  authSubmit.textContent = 'Sign In';
  authSubmit.disabled = false;
});

// Auto-submit on FaceID/password autofill
// Wait for both fields, then give iOS a moment to commit the values before submitting
var autofillPoller = null;
var autofillReady = false;
function startAutofillWatch() {
  if (autofillPoller) return;
  var checks = 0;
  autofillPoller = setInterval(function() {
    checks++;
    if (authEmail.value && authPassword.value && !autofillReady) {
      autofillReady = true;
      clearInterval(autofillPoller);
      autofillPoller = null;
      document.activeElement.blur();
      // Let iOS fully commit autofill values before reading them
      setTimeout(function() {
        if (!authSubmit.disabled) {
          authSubmit.disabled = true;
          authSubmit.textContent = 'Signing in...';
          authForm.requestSubmit();
        }
      }, 250);
    }
    if (checks > 50) { clearInterval(autofillPoller); autofillPoller = null; }
  }, 30);
}
authEmail.addEventListener('change', startAutofillWatch);
authPassword.addEventListener('change', startAutofillWatch);

// Sign out any existing session on load so user must log in every time
// Then listen for fresh sign-ins only
sb.auth.signOut().then(function() {
  showScreen('login');

  sb.auth.onAuthStateChange(function(event, session) {
    if (event === 'SIGNED_IN' && session && session.user) {
      currentUser = session.user;
      Promise.all([loadProfile(), loadAccounts()]).then(function() {
        return loadTransactions();
      }).then(function() {
        return loadRecurringBills();
      }).catch(function(e) {
        console.error('Init error:', e);
      }).then(function() {
        showScreen('app');
      });
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      showScreen('login');
    }
  });
});

// ============================================
// SCREENS & TABS
// ============================================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  $('#screen-' + name).classList.add('active');
  if (name === 'app') {
    var savedTab = localStorage.getItem('alenjo_active_tab');
    if (savedTab === 'investments' || savedTab === 'settings') savedTab = 'snapshot';
    if (savedTab) switchTab(savedTab);
  }
}

function switchTab(tabName) {
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
  // Remove old tabs that no longer exist
  var validTabs = ['snapshot', 'transactions', 'recurring'];
  order = order.filter(function(t) { return validTabs.indexOf(t) !== -1; });
  // Ensure all valid tabs are present
  validTabs.forEach(function(t) {
    if (order.indexOf(t) === -1) order.push(t);
  });
  userProfile.tab_order = order;
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
  var order = (userProfile.tab_order || ['snapshot', 'transactions', 'recurring']).filter(function(t) { return t === 'snapshot' || t === 'transactions' || t === 'recurring'; });
  var labels = { snapshot: 'Snapshot', transactions: 'Transactions', recurring: 'Recurring' };

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
  var order = (userProfile.tab_order || ['snapshot', 'transactions', 'recurring', 'settings']).filter(function(t) { return t === 'snapshot' || t === 'transactions' || t === 'recurring' || t === 'settings'; });
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
    if (cachedAccounts) renderAccounts(cachedAccounts);
  });
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
if ($('#btn-connect-investments')) $('#btn-connect-investments').addEventListener('click', function() { openPlaidLink(['transactions']); });

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
      showError('Could not update account permissions. ' + (data.detail || data.error || 'Check your connection and try again.'));
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
    showError('Could not update account permissions. ' + err.message);
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

function computeBalanceTotals(accounts, holdings) {
  var banks = accounts.filter(function(a) { return a.type === 'depository' && a.subtype !== 'savings'; });
  var savings = accounts.filter(function(a) { return a.type === 'depository' && a.subtype === 'savings'; });
  var credits = accounts.filter(function(a) { return a.type === 'credit'; });
  var investments = accounts.filter(function(a) { return a.type === 'investment'; });

  function bankAmount(a, mode) {
    var current = parseFloat(a.balance_current || 0);
    var avail = a.balance_available != null ? parseFloat(a.balance_available) : null;
    if (mode === 'posted') return current;
    return avail != null ? avail : current;
  }
  function creditAmount(a, mode) {
    var current = parseFloat(a.balance_current || 0);
    var avail = a.balance_available != null ? parseFloat(a.balance_available) : null;
    var limit = a.balance_limit != null ? parseFloat(a.balance_limit) : null;
    if (mode === 'posted') return current;
    if (limit != null && avail != null) return limit - avail;
    return current;
  }
  function investAmount(a) {
    if (holdings) {
      var val = 0;
      holdings.forEach(function(h) {
        if (h.account_id === a.id) val += h.institution_value || (h.quantity * (h.institution_price || h.close_price || 0));
      });
      if (val > 0) return val;
    }
    return parseFloat(a.balance_current || 0);
  }

  var out = {};
  ['posted', 'after_pending'].forEach(function(mode) {
    var bankSum = banks.reduce(function(s, a) { return s + bankAmount(a, mode); }, 0);
    var creditSum = credits.reduce(function(s, a) { return s + creditAmount(a, mode); }, 0);
    var savingsSum = savings.reduce(function(s, a) { return s + bankAmount(a, mode); }, 0);
    var investSum = investments.reduce(function(s, a) { return s + investAmount(a); }, 0);
    out[mode] = {
      available: bankSum - creditSum,
      networth: bankSum - creditSum + savingsSum + investSum
    };
  });
  return out;
}

// Balance snapshots are now written server-side every 5 min via pg_cron
// (public.write_all_balance_snapshots). computeBalanceTotals is retained
// for future features that may need client-side totals.

// ============================================
// RENDER ACCOUNTS
// ============================================
function renderAccounts(accounts) {
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
  banksTotal.textContent = formatMoney(bankSum);
  banksTotal.className = 'section-total ' + (bankSum >= 0 ? 'balance-positive' : 'balance-negative');

  renderSection(listCredit, credits, 'credit');
  var creditSum = credits.reduce(function(s, a) { return s + getDisplayBalance(a, 'credit').amount; }, 0);
  creditTotal.textContent = (creditSum < 0 ? '-' : '') + formatMoney(Math.abs(creditSum));
  creditTotal.className = 'section-total ' + (creditSum >= 0 ? 'balance-negative' : 'balance-positive');

  if (credits.length > 0 || accounts.length > 0) {
    loadLiabilities().then(function() {
      renderSection(listCredit, credits, 'credit');
    });
  }

  renderSection($('#list-inv-savings'), savings, 'bank');
  renderSection($('#list-inv-investments'), investments, 'bank');
  updateInvestmentTotals(savings, investments);

  if (investments.length > 0) {
    loadHoldings().then(function() {
      renderSection($('#list-inv-investments'), investments, 'bank');
      updateInvestmentTotals(savings, investments);
    });
  }

  // Available Cash (banks - credit) and Net Worth (everything)
  var netCashEl = $('#net-cash');
  if (hasAnyAccounts) {
    var savingsSum = savings.reduce(function(s, a) { return s + getDisplayBalance(a, 'bank').amount; }, 0);
    var investSum = 0;
    investments.forEach(function(a) { investSum += getDisplayBalance(a, 'bank').amount; });
    var availableCash = bankSum - creditSum;
    var netWorth = bankSum - creditSum + savingsSum + investSum;
    var suggestionAccounts = [];
    savings.forEach(function(a) {
      var bal = getDisplayBalance(a, 'bank').amount;
      if (bal > 0) suggestionAccounts.push({ name: a.nickname || a.name || 'Savings', institution: a.institution || '', amount: bal, type: 'savings' });
    });
    cachedBalances = { available: availableCash, checking: bankSum, creditOwed: creditSum, savings: savingsSum, investments: investSum, suggestionAccounts: suggestionAccounts };
    netCashEl.hidden = false;

    var availEl = $('#available-value');
    if (availEl) {
      availEl.textContent = (availableCash < 0 ? '-' : '') + formatMoney(availableCash);
      availEl.className = 'hero-stat-value ' + (availableCash >= 0 ? 'balance-positive' : 'balance-negative');
    }
    var nwEl = $('#networth-value');
    if (nwEl) {
      nwEl.textContent = (netWorth < 0 ? '-' : '') + formatMoney(netWorth);
      nwEl.className = 'hero-stat-value ' + (netWorth >= 0 ? 'balance-positive' : 'balance-negative');
    }
  } else {
    netCashEl.hidden = true;
  }

  updateSyncInfo();
  renderAccountsSettings();
  if (hasAnyAccounts) requestAnimationFrame(function() { initBalanceChart(); });
}

function updateInvestmentTotals(savings, investments) {
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
}

// ============================================
// BALANCE CHART
// ============================================
var balanceChart = null;
var balanceChartRange = localStorage.getItem('alenjo_chart_range') || '1W';
var balanceChartRows = [];
var balanceChartLoading = false;
var balanceChartScrubbing = false;
var balanceChartLiveValues = null;

function getChartMetricFields() {
  // showAvailable=true means "posted/current" mode; false means "after pending"
  if (showAvailable) {
    return { available: 'available_amount', networth: 'net_worth_amount' };
  }
  return { available: 'available_after_pending', networth: 'net_worth_after_pending' };
}

function ensureChartReady() {
  return new Promise(function(resolve) {
    if (typeof Chart !== 'undefined') return resolve();
    var tries = 0;
    var t = setInterval(function() {
      if (typeof Chart !== 'undefined' || tries++ > 40) {
        clearInterval(t);
        resolve();
      }
    }, 100);
  });
}

async function initBalanceChart() {
  await ensureChartReady();
  if (typeof Chart === 'undefined') return;
  var canvas = document.getElementById('balance-chart');
  if (!canvas || balanceChart) return;

  var ctx = canvas.getContext('2d');
  balanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Available',
          data: [],
          borderColor: '#3C82F6',
          backgroundColor: 'rgba(60,130,246,0.05)',
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 18,
          tension: 0,
          stepped: false,
          fill: false,
          spanGaps: true,
          parsing: false
        },
        {
          label: 'Net Worth',
          data: [],
          borderColor: '#2ECC71',
          backgroundColor: 'rgba(46,204,113,0.05)',
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 18,
          tension: 0,
          stepped: false,
          fill: false,
          spanGaps: true,
          parsing: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeOutCubic' },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, bottom: 6 } },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          type: 'linear',
          display: true,
          grid: { color: 'rgba(140,165,220,0.045)', drawTicks: false },
          ticks: { display: false },
          border: { display: false }
        },
        y: { display: false, grace: '5%' }
      }
    },
    plugins: [endpointGlowPlugin, scrubIndicatorPlugin]
  });

  attachScrubHandlers(canvas);
  wireRangeButtons();
  wireChartMetricToggle();
  window.onBalanceSnapshotWritten = function() { loadBalanceHistory(balanceChartRange); };

  loadBalanceHistory(balanceChartRange);
}

var endpointGlowPlugin = {
  id: 'endpointGlow',
  afterDatasetsDraw: function(chart) {
    if (balanceChartScrubbing) return;
    var ctx = chart.ctx;
    chart.data.datasets.forEach(function(ds, i) {
      var meta = chart.getDatasetMeta(i);
      if (!meta || !meta.data || meta.data.length === 0) return;
      var last = meta.data[meta.data.length - 1];
      if (!last) return;
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = ds.borderColor;
      ctx.shadowColor = ds.borderColor;
      ctx.shadowBlur = 12;
      ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
};

var scrubIndicatorPlugin = {
  id: 'scrubIndicator',
  afterDatasetsDraw: function(chart) {
    if (!balanceChartScrubbing || chart._scrubIndex == null) return;
    var idx = chart._scrubIndex;
    var ctx = chart.ctx;
    var area = chart.chartArea;
    var x = null;
    chart.data.datasets.forEach(function(ds, i) {
      var meta = chart.getDatasetMeta(i);
      if (!meta || !meta.data || !meta.data[idx]) return;
      var pt = meta.data[idx];
      x = pt.x;
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = ds.borderColor;
      ctx.shadowColor = ds.borderColor;
      ctx.shadowBlur = 10;
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    if (x != null) {
      ctx.save();
      ctx.strokeStyle = 'rgba(230,235,244,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      ctx.restore();
    }
  }
};

async function loadBalanceHistory(range) {
  if (balanceChartLoading) return;
  balanceChartLoading = true;
  try {
    var res = await sb.rpc('get_balance_history', { p_range: range });
    if (res.error) { console.error('history rpc error', res.error); return; }
    balanceChartRows = res.data || [];
    renderChartFromRows();
  } finally {
    balanceChartLoading = false;
  }
}

function getRangeStartMs(range) {
  var now = Date.now();
  var d = new Date();
  switch (range) {
    case '1W': return now - 7 * 86400000;
    case '1M': return now - 30 * 86400000;
    case '3M': return now - 90 * 86400000;
    case 'YTD': return new Date(d.getFullYear(), 0, 1).getTime();
    case '1Y': return now - 365 * 86400000;
    case 'ALL':
      if (balanceChartRows.length > 0) return new Date(balanceChartRows[0].bucket).getTime();
      return now - 86400000;
    default: return now - 7 * 86400000;
  }
}

function renderChartFromRows() {
  if (!balanceChart) return;
  var fields = getChartMetricFields();
  var nowMs = Date.now();
  var rangeStartMs = getRangeStartMs(balanceChartRange);

  var availData = [];
  var nwData = [];
  balanceChartRows.forEach(function(r) {
    var ts = new Date(r.bucket).getTime();
    var av = r[fields.available];
    var nw = r[fields.networth];
    availData.push({ x: ts, y: av != null ? parseFloat(av) : null });
    nwData.push({ x: ts, y: nw != null ? parseFloat(nw) : null });
  });

  // Extend the line to "now" with the latest value so a constant balance
  // renders as a full horizontal line across the window.
  function appendNow(arr) {
    if (arr.length === 0) return;
    var last = arr[arr.length - 1];
    if (last.y != null && last.x < nowMs) arr.push({ x: nowMs, y: last.y });
  }
  appendNow(availData);
  appendNow(nwData);

  balanceChart.data.datasets[0].data = availData;
  balanceChart.data.datasets[1].data = nwData;
  // Axis min = later of (range start, first data point). So for ranges larger
  // than the tracked time the line fills the full canvas, and over time the
  // axis stretches back until the range cap kicks in.
  var firstDataMs = balanceChartRows.length > 0 ? new Date(balanceChartRows[0].bucket).getTime() : nowMs;
  balanceChart.options.scales.x.min = Math.max(rangeStartMs, firstDataMs);
  balanceChart.options.scales.x.max = nowMs;
  balanceChart.update();

  var emptyEl = document.getElementById('balance-chart-empty');
  if (emptyEl) emptyEl.hidden = balanceChartRows.length >= 1;
}

function wireRangeButtons() {
  var btns = document.querySelectorAll('.balance-chart-ranges .range-btn');
  btns.forEach(function(b) {
    if (b.dataset.range === balanceChartRange) b.classList.add('active');
    else b.classList.remove('active');
    b.addEventListener('click', function() {
      if (balanceChartScrubbing) return;
      btns.forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active');
      balanceChartRange = b.dataset.range;
      localStorage.setItem('alenjo_chart_range', balanceChartRange);
      loadBalanceHistory(balanceChartRange);
    });
  });
}

function wireChartMetricToggle() {
  // When user taps Available or Net Worth, showAvailable flips (existing behavior).
  // We re-render chart lines with the new mode's values.
  var hookFired = false;
  var origHandler = null;
  document.querySelectorAll('.hero-stat').forEach(function(btn) {
    btn.addEventListener('click', function() {
      // After the existing handler flips showAvailable + re-renders accounts,
      // we also re-render chart lines. Use microtask to run after the existing handler.
      setTimeout(function() { renderChartFromRows(); }, 0);
    });
  });
}

// ---------- Scrub interaction ----------
function attachScrubHandlers(canvas) {
  var card = document.getElementById('net-cash');
  var deltaEl = document.getElementById('balance-chart-delta');
  var availEl = document.getElementById('available-value');
  var nwEl = document.getElementById('networth-value');

  function captureLiveValues() {
    balanceChartLiveValues = {
      avail: availEl ? availEl.textContent : '',
      nw: nwEl ? nwEl.textContent : '',
      availClass: availEl ? availEl.className : '',
      nwClass: nwEl ? nwEl.className : ''
    };
  }

  function restoreLiveValues() {
    if (!balanceChartLiveValues) return;
    if (availEl) { availEl.textContent = balanceChartLiveValues.avail; availEl.className = balanceChartLiveValues.availClass; }
    if (nwEl) { nwEl.textContent = balanceChartLiveValues.nw; nwEl.className = balanceChartLiveValues.nwClass; }
    deltaEl.hidden = true;
    card.classList.remove('scrubbing');
    balanceChartScrubbing = false;
    balanceChart._scrubIndex = null;
    balanceChart.update('none');
  }

  function xToIndex(xPx) {
    if (!balanceChart) return -1;
    var area = balanceChart.chartArea;
    var meta = balanceChart.getDatasetMeta(0);
    if (!meta || !meta.data || meta.data.length === 0) return -1;
    if (xPx < area.left) xPx = area.left;
    if (xPx > area.right) xPx = area.right;
    // Find nearest data point by x pixel
    var best = 0, bestDist = Infinity;
    for (var i = 0; i < meta.data.length; i++) {
      var px = meta.data[i].x;
      var d = Math.abs(px - xPx);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  var lastIndex = -1;
  function updateScrubFromX(clientX) {
    if (!balanceChart || balanceChartRows.length === 0) return;
    var rect = canvas.getBoundingClientRect();
    var xPx = clientX - rect.left;
    var idx = xToIndex(xPx);
    if (idx < 0) return;
    if (idx !== lastIndex) {
      lastIndex = idx;
      if (navigator.vibrate) navigator.vibrate(3);
    }
    balanceChart._scrubIndex = idx;
    balanceChart.update('none');

    var fields = getChartMetricFields();
    // idx may point at the synthetic "now" point appended after the last real row.
    var rowIdx = Math.min(idx, balanceChartRows.length - 1);
    var row = balanceChartRows[rowIdx];
    var startRow = balanceChartRows[0];
    var isSynthetic = idx >= balanceChartRows.length;
    var availNow = row[fields.available] != null ? parseFloat(row[fields.available]) : null;
    var nwNow = row[fields.networth] != null ? parseFloat(row[fields.networth]) : null;

    if (availEl && availNow != null) {
      availEl.textContent = (availNow < 0 ? '-' : '') + formatMoney(availNow);
      availEl.className = 'hero-stat-value ' + (availNow >= 0 ? 'balance-positive' : 'balance-negative');
    }
    if (nwEl && nwNow != null) {
      nwEl.textContent = (nwNow < 0 ? '-' : '') + formatMoney(nwNow);
      nwEl.className = 'hero-stat-value ' + (nwNow >= 0 ? 'balance-positive' : 'balance-negative');
    }

    // Delta from window start → scrubbed point. Use networth as primary reference.
    var startNW = startRow[fields.networth] != null ? parseFloat(startRow[fields.networth]) : null;
    if (startNW != null && nwNow != null) {
      var delta = nwNow - startNW;
      var pct = startNW !== 0 ? (delta / Math.abs(startNW)) * 100 : 0;
      var up = delta >= 0;
      var labelDate = isSynthetic ? new Date() : new Date(row.bucket);
      var includeTime = balanceChartRange === '1W' || balanceChartRange === '1M';
      var dateStr = isSynthetic ? 'Now' : labelDate.toLocaleDateString(undefined,
        includeTime ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });
      deltaEl.className = 'balance-chart-delta ' + (up ? 'up' : 'down');
      deltaEl.innerHTML = '<span class="delta-arrow">' + (up ? '▲' : '▼') + '</span>' +
        (delta < 0 ? '-' : '') + '$' + Math.abs(delta).toFixed(2) +
        ' (' + Math.abs(pct).toFixed(2) + '%) · ' + dateStr;
      deltaEl.hidden = false;
    }
  }

  function onStart(clientX) {
    if (balanceChartRows.length < 2) return;
    captureLiveValues();
    balanceChartScrubbing = true;
    card.classList.add('scrubbing');
    lastIndex = -1;
    if (navigator.vibrate) navigator.vibrate(8);
    updateScrubFromX(clientX);
  }

  function onMove(clientX) {
    if (!balanceChartScrubbing) return;
    updateScrubFromX(clientX);
  }

  function onEnd() {
    if (!balanceChartScrubbing) return;
    restoreLiveValues();
  }

  canvas.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    onStart(e.touches[0].clientX);
  }, { passive: false });
  canvas.addEventListener('touchmove', function(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    onMove(e.touches[0].clientX);
  }, { passive: false });
  canvas.addEventListener('touchend', onEnd);
  canvas.addEventListener('touchcancel', onEnd);

  var mouseDown = false;
  canvas.addEventListener('mousedown', function(e) { mouseDown = true; onStart(e.clientX); });
  canvas.addEventListener('mousemove', function(e) { if (mouseDown) onMove(e.clientX); });
  window.addEventListener('mouseup', function() { if (mouseDown) { mouseDown = false; onEnd(); } });
  canvas.addEventListener('mouseleave', function() { if (mouseDown) { mouseDown = false; onEnd(); } });
}

async function renderAccountsSettings() {
  var list = $('#accounts-list');
  if (!cachedAccounts || cachedAccounts.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:var(--text-sm)">No accounts linked yet.</p>';
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
    var typeCounts = {};
    group.accounts.forEach(function(a) {
      var t = a.type === 'investment' ? 'investment' : a.type === 'credit' ? 'credit card' : a.subtype === 'savings' ? 'savings' : 'checking';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    var typeList = Object.keys(typeCounts).map(function(t) {
      var n = typeCounts[t];
      if (t === 'credit card') return n + ' credit card' + (n !== 1 ? 's' : '');
      if (t === 'checking') return n + ' checking account' + (n !== 1 ? 's' : '');
      if (t === 'savings') return n + ' savings account' + (n !== 1 ? 's' : '');
      if (t === 'investment') return n + ' investment account' + (n !== 1 ? 's' : '');
      return n + ' ' + t;
    }).join(', ');
    html += '<div class="settings-institution">';
    html += '<div class="settings-inst-header">';
    html += '<div class="settings-inst-info">';
    html += '<span class="settings-inst-name">' + esc(group.institution) + '</span>';
    html += '<span class="settings-inst-detail">' + typeList + '</span>';
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

async function updateSyncInfo() {
  var billingSection = $('#section-billing');
  var billingEl = $('#billing-info');
  if (!cachedAccounts || cachedAccounts.length === 0) {
    billingEl.innerHTML = '<p style="color:var(--text-dim);font-size:var(--text-sm)">Link an account to see your billing details.</p>';
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
  if (bankAccounts.length > 0) parts.push(bankAccounts.length + ' bank' + (bankAccounts.length !== 1 ? 's' : ''));
  if (creditAccounts.length > 0) parts.push(creditAccounts.length + ' credit card' + (creditAccounts.length !== 1 ? 's' : ''));
  if (invAccounts.length > 0) parts.push(invAccounts.length + ' investment' + (invAccounts.length !== 1 ? 's' : ''));
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
      var utilPct = used <= 0 ? 0 : Math.min((used / limit) * 100, 100);
      var utilClass = used <= 0 ? 'util-low' : utilPct > 75 ? 'util-high' : utilPct > 30 ? 'util-mid' : 'util-low';
      var usedDisplay = used < 0 ? '-' + formatMoney(Math.abs(used)) : formatMoney(used);
      var utilLabel = used < 0 ? 'credit' : utilPct.toFixed(0) + '% used';
      liabHtml +=
        '<div class="liab-util-wrap">' +
          '<div class="liab-util-bar"><div class="liab-util-fill ' + utilClass + '" style="width:' + utilPct.toFixed(1) + '%"></div></div>' +
          '<div class="liab-util-labels"><span>' + usedDisplay + ' / ' + formatMoney(limit) + (limitManual ? ' <span class="manual-tag">(manual)</span>' : '') + '</span><span>' + utilLabel + '</span></div>' +
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
      liabHtml += '<div class="liab-detail liab-unavailable"><span>This card\'s issuer doesn\'t currently share specific card details. You can add some manually by tapping the card name above.</span></div>';
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

  // Save card overrides if visible
  if ($('#card-overrides-section').style.display !== 'none') {
    var lim = parseFloat($('#override-limit').value) || 0;
    var apr = parseFloat($('#override-apr').value) || 0;
    var stmtDate = parseInt($('#override-stmt-date').value) || 0;
    setCardOverrides(editingAccountId, { limit: lim, apr: apr, stmtDate: stmtDate });
  }

  if (cachedAccounts) renderAccounts(cachedAccounts);
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
    txEmpty.querySelector('p').textContent = 'No transactions yet. Your bank may take a few minutes to send data after connecting.';
    return;
  }

  txData = result.data;
  txEmpty.hidden = true;
  txContent.hidden = false;

  // Load user actions and ignore rules
  var actionsResult = await sb.from('transaction_actions').select('transaction_id, action_type, split_ways, split_portion, category_override, nickname, date_override, is_recurring, recurring_group, recurring_next_date, recurring_amount_mode, recurring_paused, recurring_deleted');
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

  // Set initial button state every load, but only bind listeners once
  var btnIgnored = $('#btn-toggle-ignored');
  btnIgnored.textContent = showIgnoredTx ? 'Hide Ignored' : 'Show Ignored';
  btnIgnored.classList.toggle('active', showIgnoredTx);

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
      this.textContent = showIgnoredTx ? 'Hide Ignored' : 'Show Ignored';
      this.classList.toggle('active', showIgnoredTx);
      renderTransactionMonth();
    });
  }

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
var showIgnoredTx = localStorage.getItem('alenjo_show_ignored') === 'true';
function updatePieCenter(label, amount, pct) {
  var el = document.getElementById('tx-pie-center');
  if (!el) return;
  if (label) {
    el.innerHTML = '<div class="pie-center-label">' + esc(label) + '</div>' +
      '<div class="pie-center-amount">' + formatMoney(amount) + '</div>' +
      '<div class="pie-center-pct">' + pct + '</div>';
  } else {
    el.innerHTML = '<div class="pie-center-label">Total</div>' +
      '<div class="pie-center-amount">' + formatMoney(amount) + '</div>';
  }
}

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

  // Update center text overlay for pie chart
  if (activeCategoryFilter && byCategory[activeCategoryFilter]) {
    var catAmt = byCategory[activeCategoryFilter];
    var catPct = totalExpenses > 0 ? formatPct((catAmt / totalExpenses) * 100) : '0.00%';
    updatePieCenter(activeCategoryFilter, catAmt, catPct);
  } else {
    updatePieCenter(null, totalExpenses, '');
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
          animation: { animateRotate: true, animateScale: false, duration: 600, easing: 'easeOutQuart' },
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
    document.getElementById('tx-pie-center').innerHTML = '';
  }

  // Render category legend
  legend.innerHTML = catEntries.map(function(entry, i) {
    var cat = entry[0];
    var amt = entry[1];
    var pct = totalExpenses > 0 ? formatPct((amt / totalExpenses) * 100) : '0.00%';
    var isActive = activeCategoryFilter === cat;
    return '<div class="cat-legend-item' + (isActive ? ' active' : '') + '" data-cat="' + esc(cat) + '">' +
      '<span class="cat-dot" style="background:' + CATEGORY_COLORS[i % CATEGORY_COLORS.length] + '"></span>' +
      '<span class="cat-name">' + esc(cat) + '</span>' +
      '<span class="cat-pct">' + pct + '</span>' +
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

    html += '<div class="' + rowClass + '" style="--row-i:' + (displayTx.indexOf(tx)) + '" data-txid="' + esc(tx.id) + '">' +
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
  var currentCat = '';
  filtered.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    var cat = normalizeCategory(eff.category).replace(/"/g, '""');
    var merchant = (eff.nickname || tx.merchant_name || tx.name || 'Unknown').replace(/"/g, '""');
    var type = tx.amount < 0 ? 'Income' : 'Expense';
    var splitInfo = eff.isSplit ? (eff.splitWays ? eff.splitWays + '-way' : 'Custom') : '';
    var reimbursed = eff.actionType === 'reimbursed' ? 'Yes' : '';
    csvRows.push(
      '"' + cat + '",' + tx.date + ',"' + merchant + '",' +
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
    cachedAccounts.forEach(function(a) {
      if (a.plaid_account_id) {
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
  if (!portion || portion <= 0 || portion >= Math.abs(actionTx.amount)) return;
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
  var picker = $('#recat-picker');
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
  var picker = $('#edit-picker');
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
  sb.from('transaction_actions').upsert(row, { onConflict: 'user_id,transaction_id' }).then(function(result) {
    if (result.error) console.error('Failed to save action:', result.error);
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

// ============================================
// AUTO-MATCH RECURRING
// ============================================
async function autoMatchRecurring(groupKey, merchantKey) {
  var toTag = [];
  txData.forEach(function(tx) {
    if (tx.id === actionTxId) return; // already saved above
    var existing = txActions[tx.id];
    if (existing && existing.is_recurring) return; // already recurring
    var txMerchant = normalizeMerchant(tx.merchant_name || tx.name);
    if (txMerchant === merchantKey) {
      toTag.push(tx);
    }
  });
  if (toTag.length === 0) return;
  var rows = toTag.map(function(tx) {
    var existing = txActions[tx.id] || {};
    return {
      user_id: currentUser.id,
      transaction_id: tx.id,
      action_type: existing.action_type || null,
      split_ways: existing.split_ways || null,
      split_portion: existing.split_portion || null,
      category_override: existing.category_override || null,
      nickname: existing.nickname || null,
      date_override: existing.date_override || null,
      is_recurring: true,
      recurring_group: groupKey,
      recurring_next_date: existing.recurring_next_date || null,
      recurring_amount_mode: existing.recurring_amount_mode || 'recent',
      recurring_paused: existing.recurring_paused || false,
      recurring_deleted: existing.recurring_deleted || false
    };
  });
  // Update local state and render immediately
  rows.forEach(function(r) { txActions[r.transaction_id] = r; });
  showToast(toTag.length + ' past transaction' + (toTag.length > 1 ? 's' : '') + ' matched');
  renderTransactionMonth();
  // Save to DB in background
  sb.from('transaction_actions').upsert(rows, { onConflict: 'user_id,transaction_id' }).then(function(result) {
    if (result.error) console.error('Auto-match recurring error:', result.error);
  });
}

function normalizeMerchant(name) {
  if (!name) return '';
  return name.toLowerCase().trim();
}

// Load transactions when switching to that tab
document.getElementById('bottom-nav').addEventListener('click', function(e) {
  var btn = e.target.closest('.nav-item');
  if (btn && btn.dataset.tab === 'transactions' && txData.length === 0) {
    loadTransactions();
  }
  if (btn && btn.dataset.tab === 'recurring') {
    loadRecurringBills();
  }
});

// ============================================
// RECURRING BILLS
// ============================================
var recBills = [];
var recBillsLoaded = false;
var recHorizonDays = 31;

async function loadRecurringBills() {
  var recLoading = $('#rec-loading');
  var recEmpty = $('#rec-empty');
  var recContent = $('#rec-content');

  if (recBillsLoaded) {
    renderRecurringBills();
    return;
  }

  if (recLoading) recLoading.classList.add('visible');
  if (recEmpty) recEmpty.hidden = true;
  if (recContent) recContent.hidden = true;

  // Load transaction data if needed (for search later)
  if (txData.length === 0) {
    var result = await sb.from('synced_transactions').select('*').order('date', { ascending: false }).limit(5000);
    if (result.data && result.data.length > 0) txData = result.data;
    if (Object.keys(txActions).length === 0) {
      var actionsResult = await sb.from('transaction_actions').select('transaction_id, action_type, split_ways, split_portion, category_override, nickname, date_override, is_recurring, recurring_group, recurring_next_date, recurring_amount_mode, recurring_paused, recurring_deleted');
      if (actionsResult.data) actionsResult.data.forEach(function(row) { txActions[row.transaction_id] = row; });
    }
  }

  // Load recurring bills from database
  var billsResult = await sb.from('recurring_bills').select('*').order('next_due_date', { ascending: true });
  if (billsResult.data) recBills = billsResult.data;

  recBillsLoaded = true;
  if (recLoading) recLoading.classList.remove('visible');
  renderRecurringBills();
}

function computeNextDueDate(anchorDate, frequency, frequencyDays, afterDate) {
  var anchor = parseLocalDate(anchorDate);
  var after = afterDate ? parseLocalDate(afterDate) : new Date();
  after.setHours(0, 0, 0, 0);

  if (frequency === 'custom' && frequencyDays) {
    var d = new Date(anchor);
    while (d <= after) d.setDate(d.getDate() + frequencyDays);
    return formatLocalDate(d);
  }

  var monthStep = { biweekly: 0, monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[frequency] || 1;

  if (frequency === 'biweekly') {
    var d = new Date(anchor);
    while (d <= after) d.setDate(d.getDate() + 14);
    return formatLocalDate(d);
  }

  // Month-based frequencies
  var d = new Date(anchor);
  while (d <= after) {
    d.setMonth(d.getMonth() + monthStep);
  }
  return formatLocalDate(d);
}

function parseLocalDate(str) {
  var p = str.split('-');
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
}

function formatLocalDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getFrequencyLabel(freq, days) {
  var labels = { biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Every 3 months', semiannual: 'Every 6 months', annual: 'Yearly' };
  if (freq === 'custom' && days) return 'Every ' + days + ' days';
  return labels[freq] || freq;
}

function getDaysUntilDue(bill) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var due = parseLocalDate(bill.next_due_date);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

// A recurring bill only has one active occurrence at a time (the next_due_date).
// The user must confirm it before the next occurrence appears.
// This returns 1 if the bill's next_due_date falls within the horizon (or is overdue), 0 otherwise.
function countOccurrencesInHorizon(bill, horizonDays) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var end = new Date(today.getTime() + horizonDays * 86400000);
  var d = parseLocalDate(bill.next_due_date);
  d.setHours(0, 0, 0, 0);

  // Show if overdue or within the horizon window
  if (d <= end) return 1;
  return 0;
}

function renderRecurringBills() {
  var recEmpty = $('#rec-empty');
  var recContent = $('#rec-content');
  var summaryEl = $('#rec-summary');
  var listEl = $('#rec-list');

  if (recBills.length === 0) {
    if (recEmpty) recEmpty.hidden = false;
    if (recContent) recContent.hidden = true;
    return;
  }

  if (recEmpty) recEmpty.hidden = true;
  if (recContent) recContent.hidden = false;

  // Compute actual totals within the horizon (multiple occurrences counted)
  var totalIncome = 0;
  var totalExpenses = 0;
  recBills.forEach(function(b) {
    var occurrences = countOccurrencesInHorizon(b, recHorizonDays);
    var totalForBill = parseFloat(b.amount) * occurrences;
    if (b.is_income) totalIncome += totalForBill;
    else totalExpenses += totalForBill;
  });

  var horizonLabel = '31 days';

  if (summaryEl) {
    var summaryHtml = '<div class="tx-month-summary">' +
      (totalIncome > 0 ? '<div class="tx-summary-item"><span class="tx-summary-label">Income (' + horizonLabel + ')</span><span class="tx-summary-value balance-positive">+' + formatMoney(totalIncome) + '</span></div>' : '') +
      '<div class="tx-summary-item"><span class="tx-summary-label">Expenses (' + horizonLabel + ')</span><span class="tx-summary-value balance-negative">-' + formatMoney(totalExpenses) + '</span></div>' +
    '</div>';

    // Budget projection
    var availCash = cachedBalances.available;
    var surplus = availCash + totalIncome - totalExpenses;
    var availLabel = (availCash < 0 ? '-' : '') + formatMoney(Math.abs(availCash));

    if (totalExpenses > 0 || totalIncome > 0) {
      var checkingLabel = formatMoney(Math.abs(cachedBalances.checking));
      var creditOwed = cachedBalances.creditOwed;

      if (surplus < 0) {
        var needed = Math.abs(surplus);
        summaryHtml += '<div class="rec-projection rec-projection-warn">';
        summaryHtml += '<div class="rec-projection-header"><span class="rec-projection-title">Heads up</span><span class="rec-projection-shortfall">~' + formatMoney(needed) + ' short</span></div>';
        summaryHtml += '<div class="rec-projection-body">';
        summaryHtml += 'You have ' + checkingLabel + ' across your checking accounts';
        if (creditOwed > 0) summaryHtml += ' and currently owe ' + formatMoney(creditOwed) + ' on your credit cards';
        summaryHtml += '.';
        if (totalIncome > 0) summaryHtml += ' You\'re expecting ' + formatMoney(totalIncome) + ' in income.';
        summaryHtml += ' You have about ' + formatMoney(totalExpenses) + ' in bills coming up over the next ' + horizonLabel + '.';
        summaryHtml += ' Based on that, things may be a little tight. You might want to set aside some extra funds to stay covered.';
        summaryHtml += '</div>';

        var suggestions = cachedBalances.suggestionAccounts || [];
        if (suggestions.length > 0) {
          summaryHtml += '<div class="rec-projection-suggest">You could transfer from</div>';
          summaryHtml += '<div class="rec-projection-accounts">';
          suggestions.forEach(function(s) {
            var instLabel = s.institution ? '<span class="rec-projection-inst">' + esc(s.institution) + '</span>' : '';
            summaryHtml += '<div class="rec-projection-account"><div class="rec-projection-account-info"><span class="rec-projection-account-name">' + esc(s.name) + '</span>' + instLabel + '</div><span class="balance-positive">' + formatMoney(s.amount) + '</span></div>';
          });
          summaryHtml += '</div>';
        }
        summaryHtml += '</div>';
      } else {
        summaryHtml += '<div class="rec-projection rec-projection-ok">';
        summaryHtml += '<div class="rec-projection-header"><span class="rec-projection-title">Looking good</span>';
        if (surplus > 0) summaryHtml += '<span class="rec-projection-surplus">+' + formatMoney(surplus) + ' buffer</span>';
        summaryHtml += '</div>';
        summaryHtml += '<div class="rec-projection-body">';
        summaryHtml += 'You have ' + checkingLabel + ' in your checking accounts';
        if (creditOwed > 0) summaryHtml += ' and owe ' + formatMoney(creditOwed) + ' on credit cards';
        summaryHtml += '.';
        if (totalIncome > 0) summaryHtml += ' With ' + formatMoney(totalIncome) + ' in expected income,';
        summaryHtml += ' you\'re well covered for the ' + formatMoney(totalExpenses) + ' in bills over the next ' + horizonLabel + '.';
        summaryHtml += '</div>';
        summaryHtml += '</div>';
      }
    }

    summaryEl.innerHTML = summaryHtml;
  }

  // Filter bills that have at least one occurrence in the horizon
  var filtered = recBills.filter(function(b) {
    return countOccurrencesInHorizon(b, recHorizonDays) > 0;
  });

  var sorted = filtered.slice().sort(function(a, b) {
    return getDaysUntilDue(a) - getDaysUntilDue(b);
  });

  var html = '';

  var overdueItems = sorted.filter(function(b) { return getDaysUntilDue(b) <= 0; });
  var upcomingItems = sorted.filter(function(b) { return getDaysUntilDue(b) > 0; });

  if (overdueItems.length > 0) {
    html += '<div class="rec-section"><h3 class="rec-section-title" style="color:var(--danger)">Needs Attention</h3>';
    overdueItems.forEach(function(bill) { html += renderBillRow(bill); });
    html += '</div>';
  }

  var upIncome = upcomingItems.filter(function(b) { return b.is_income; });
  if (upIncome.length > 0) {
    html += '<div class="rec-section"><h3 class="rec-section-title balance-positive">Income</h3>';
    upIncome.forEach(function(bill) { html += renderBillRow(bill); });
    html += '</div>';
  }

  var upExpenses = upcomingItems.filter(function(b) { return !b.is_income; });
  if (upExpenses.length > 0) {
    html += '<div class="rec-section"><h3 class="rec-section-title balance-negative">Expenses</h3>';
    upExpenses.forEach(function(bill) { html += renderBillRow(bill); });
    html += '</div>';
  }

  if (filtered.length === 0 && recBills.length > 0) {
    html += '<div class="rec-search-empty">No bills in the next 31 days</div>';
  }

  if (listEl) listEl.innerHTML = html;

  // Tap row to open detail sheet
  listEl.querySelectorAll('.rec-row').forEach(function(row) {
    row.addEventListener('click', function() {
      openRecDetailSheet(row.dataset.billId);
    });
  });
}

function renderBillRow(bill) {
  var days = getDaysUntilDue(bill);
  var isIncome = bill.is_income;
  var amt = parseFloat(bill.amount);

  var statusLabel = '';
  var rowExtraClass = '';
  if (days < 0) {
    var absDays = Math.abs(days);
    statusLabel = '<span class="rec-overdue">' + absDays + ' day' + (absDays === 1 ? '' : 's') + ' ago</span>';
    rowExtraClass = ' rec-row-overdue';
  } else if (days === 0) {
    statusLabel = '<span class="rec-overdue">Today</span>';
    rowExtraClass = ' rec-row-overdue';
  } else if (days <= 7) {
    statusLabel = '<span class="rec-due-soon">In ' + days + ' day' + (days === 1 ? '' : 's') + '</span>';
  } else {
    statusLabel = '<span class="rec-expected">In ' + days + ' days</span>';
  }

  var freqLabel = getFrequencyLabel(bill.frequency, bill.frequency_days);

  return '<div class="rec-row' + rowExtraClass + '" data-bill-id="' + bill.id + '">' +
    '<div class="rec-info">' +
      '<span class="rec-merchant">' + esc(bill.name) + '</span>' +
      '<span class="rec-freq">' + esc(freqLabel) + '</span>' +
    '</div>' +
    '<div class="rec-right">' +
      '<span class="rec-amount ' + (isIncome ? 'balance-positive' : 'balance-negative') + '">' +
        (isIncome ? '+' : '-') + formatMoney(amt) +
      '</span>' +
      statusLabel +
    '</div>' +
  '</div>';
}

// Confirm modal
var recConfirmModal = $('#rec-confirm-modal');
var recConfirmCallback = null;

function showConfirmModal(billName, nextDateStr, callback) {
  var modal = recConfirmModal;
  var textEl = $('#rec-confirm-text');
  textEl.innerHTML = 'Mark <strong>' + esc(billName) + '</strong> as paid? It won\'t appear again until <strong>' + nextDateStr + '</strong>.';
  recConfirmCallback = callback;
  modal.classList.add('visible');
}

$('#rec-confirm-no').addEventListener('click', function() {
  recConfirmModal.classList.remove('visible');
  recConfirmCallback = null;
});

$('#rec-confirm-yes').addEventListener('click', function() {
  recConfirmModal.classList.remove('visible');
  if (recConfirmCallback) recConfirmCallback();
  recConfirmCallback = null;
});

recConfirmModal.addEventListener('click', function(e) {
  if (e.target === recConfirmModal) {
    recConfirmModal.classList.remove('visible');
    recConfirmCallback = null;
  }
});

function confirmBill(billId) {
  var bill = recBills.find(function(b) { return b.id === billId; });
  if (!bill) return;

  var today = formatLocalDate(new Date());
  var newNext = computeNextDueDate(bill.anchor_date, bill.frequency, bill.frequency_days, today);

  bill.last_confirmed_date = today;
  bill.next_due_date = newNext;
  showToast('Bill marked as paid');
  renderRecurringBills();

  sb.from('recurring_bills').update({
    last_confirmed_date: today,
    next_due_date: newNext
  }).eq('id', billId).then(function(result) {
    if (result.error) console.error('Confirm bill error:', result.error);
  });
}

function confirmBillAndClose(billId) {
  confirmBill(billId);
  closeRecDetailSheet();
}

function deleteBill(billId) {
  recBills = recBills.filter(function(b) { return b.id !== billId; });
  showToast('Bill deleted');
  renderRecurringBills();

  sb.from('recurring_bills').delete().eq('id', billId).then(function(result) {
    if (result.error) console.error('Delete bill error:', result.error);
  });
}

function deleteBillAndClose(billId) {
  deleteBill(billId);
  closeRecDetailSheet();
}

// ============================================
// RECURRING DETAIL SHEET
// ============================================
var recDetailSheet = $('#rec-detail-sheet');

function openRecDetailSheet(billId) {
  var bill = recBills.find(function(b) { return b.id === billId; });
  if (!bill) return;

  var days = getDaysUntilDue(bill);
  var amt = parseFloat(bill.amount);
  var isIncome = bill.is_income;

  $('#rec-detail-name').textContent = bill.name;
  $('#rec-detail-amount').textContent = (isIncome ? '+' : '-') + formatMoney(amt);
  $('#rec-detail-amount').className = 'action-sheet-subtitle ' + (isIncome ? 'balance-positive' : 'balance-negative');

  // Status
  var statusEl = $('#rec-detail-status');
  if (days < 0) {
    var absDays = Math.abs(days);
    statusEl.innerHTML = '<span class="rec-overdue">' + absDays + ' day' + (absDays === 1 ? '' : 's') + ' ago</span>';
  } else if (days === 0) {
    statusEl.innerHTML = '<span class="rec-overdue">Today</span>';
  } else if (days <= 7) {
    statusEl.innerHTML = '<span class="rec-due-soon">In ' + days + ' day' + (days === 1 ? '' : 's') + '</span>';
  } else {
    statusEl.innerHTML = '<span class="rec-expected">In ' + days + ' days</span>';
  }

  // Info
  var infoEl = $('#rec-detail-info');
  var freqLabel = getFrequencyLabel(bill.frequency, bill.frequency_days);
  var nextDate = parseLocalDate(bill.next_due_date);
  var nextStr = nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  var infoHtml = '<div class="rec-detail-row"><span class="rec-detail-label">Frequency</span><span>' + esc(freqLabel) + '</span></div>';
  infoHtml += '<div class="rec-detail-row"><span class="rec-detail-label">Next date</span><span>' + nextStr + '</span></div>';
  if (bill.last_confirmed_date) {
    var confDate = parseLocalDate(bill.last_confirmed_date);
    infoHtml += '<div class="rec-detail-row"><span class="rec-detail-label">Last confirmed</span><span>' + confDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</span></div>';
  }
  infoEl.innerHTML = infoHtml;

  // Actions
  var actionsEl = $('#rec-detail-actions');
  var actionsHtml = '';
  actionsHtml += '<button class="btn-primary" id="rec-detail-confirm" style="width:100%;margin-bottom:0.5rem">Mark as Paid</button>';
  actionsHtml += '<button class="btn-secondary" id="rec-detail-edit" style="width:100%;margin-bottom:0.5rem">Edit</button>';
  actionsHtml += '<button class="btn-danger" id="rec-detail-delete" style="width:100%">Delete</button>';
  actionsEl.innerHTML = actionsHtml;

  // Compute the next date after confirmation for the modal message
  var today = formatLocalDate(new Date());
  var futureNext = computeNextDueDate(bill.anchor_date, bill.frequency, bill.frequency_days, today);
  var futureDate = parseLocalDate(futureNext);
  var futureStr = futureDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Bind actions
  $('#rec-detail-confirm').addEventListener('click', function() {
    closeRecDetailSheet();
    showConfirmModal(bill.name, futureStr, function() {
      confirmBill(billId);
    });
  });
  $('#rec-detail-edit').addEventListener('click', function() { editBill(billId); });
  $('#rec-detail-delete').addEventListener('click', function() { deleteBillAndClose(billId); });

  recDetailSheet.classList.add('visible');
}

function closeRecDetailSheet() {
  recDetailSheet.classList.remove('visible');
}

$('#rec-detail-cancel').addEventListener('click', closeRecDetailSheet);
recDetailSheet.addEventListener('click', function(e) {
  if (e.target === recDetailSheet) closeRecDetailSheet();
});

var recEditingBillId = null;

function editBill(billId) {
  var bill = recBills.find(function(b) { return b.id === billId; });
  if (!bill) return;

  recEditingBillId = billId;
  closeRecDetailSheet();

  // Open add sheet in edit mode, pre-populated
  recAddState = {
    name: bill.name,
    matchingTxs: [],
    amount: parseFloat(bill.amount),
    amountMode: 'custom',
    isIncome: bill.is_income,
    frequency: bill.frequency,
    frequencyDays: bill.frequency_days,
    anchorDate: bill.next_due_date
  };

  recSelectedMerchants = {};
  recSearchInput.value = '';
  recSearchResults.innerHTML = '';

  // Go straight to the search step so they can search for new merchants or proceed
  // Show current bill info with option to search more
  recSearchResults.innerHTML = '<div class="rec-edit-current">' +
    '<div class="rec-edit-current-header">Currently: <strong>' + esc(bill.name) + '</strong></div>' +
    '<div class="rec-edit-current-detail">' + formatMoney(bill.amount) + ' / ' + getFrequencyLabel(bill.frequency, bill.frequency_days) + '</div>' +
    '<p class="rec-edit-hint">Search to add more merchants, or skip to edit amount and frequency.</p>' +
    '<button class="btn-primary-sm" id="rec-edit-skip" style="margin-top:0.5rem">Skip to Amount</button>' +
  '</div>';

  updateRecSearchFooter();
  showRecStep('search');
  recAddSheet.classList.add('visible');

  $('#rec-edit-skip').addEventListener('click', function() {
    // Go to amount step with current values pre-filled
    var amt = parseFloat(bill.amount);
    recAddState.amount = amt;
    recAddState.amountMode = 'custom';

    // Update income/expense toggle
    var expBtn = $('#rec-type-expense');
    var incBtn = $('#rec-type-income');
    if (bill.is_income) {
      incBtn.classList.add('active');
      expBtn.classList.remove('active');
    } else {
      expBtn.classList.add('active');
      incBtn.classList.remove('active');
    }

    // Render amount step showing just the custom value
    var infoEl = $('#rec-amount-info');
    infoEl.innerHTML = '<span class="rec-amount-name">' + esc(bill.name) + '</span>' +
      '<span class="rec-amount-meta">Editing existing bill</span>';

    var modesEl = $('#rec-amount-modes');
    modesEl.innerHTML = '<button class="recurring-mode-btn active" data-mode="custom">Custom</button>';
    $('#rec-custom-amount-row').hidden = false;
    $('#rec-custom-amount').value = amt.toFixed(2);
    var selectedAmtEl = $('#rec-selected-amount');
    selectedAmtEl.textContent = 'Amount: ' + formatMoney(amt);

    $('#rec-custom-amount').addEventListener('input', function() {
      var v = parseFloat(this.value);
      if (!isNaN(v) && v > 0) {
        recAddState.amount = v;
        selectedAmtEl.textContent = 'Amount: ' + formatMoney(v);
      }
    });

    showRecStep('amount');
  });
}

// ============================================
// RECURRING ADD FLOW
// ============================================
var recAddSheet = $('#rec-add-sheet');
var recSearchInput = $('#rec-search-input');
var recSearchResults = $('#rec-search-results');
var recStepSearch = $('#rec-step-search');
var recStepAmount = $('#rec-step-amount');
var recStepFreq = $('#rec-step-freq');
var recStepType = $('#rec-step-type');

var recAddState = {
  name: '',
  matchingTxs: [],
  amount: 0,
  amountMode: 'recent',
  isIncome: false,
  frequency: 'monthly',
  frequencyDays: null,
  anchorDate: ''
};

var recSelectedMerchants = {}; // key -> match object
var recLastSearchResults = [];

function openRecAddSheet() {
  recEditingBillId = null;
  recAddState = { name: '', matchingTxs: [], amount: 0, amountMode: 'recent', isIncome: false, frequency: 'monthly', frequencyDays: null, anchorDate: '' };
  recSelectedMerchants = {};
  recLastSearchResults = [];
  recSearchInput.value = '';
  recSearchResults.innerHTML = '';
  updateRecSearchFooter();
  showRecStep('search');
  recAddSheet.classList.add('visible');
  setTimeout(function() { recSearchInput.focus(); }, 300);
}

function updateRecSearchFooter() {
  var existing = document.getElementById('rec-search-footer');
  var count = Object.keys(recSelectedMerchants).length;
  if (count === 0) {
    if (existing) existing.remove();
    return;
  }
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'rec-search-footer';
    existing.className = 'rec-search-footer';
    recStepSearch.appendChild(existing);
  }
  var names = Object.keys(recSelectedMerchants).map(function(k) { return recSelectedMerchants[k].name; });
  var label = names.length === 1 ? names[0] : names.length + ' selected';
  existing.innerHTML = '<div class="rec-search-footer-info"><span class="rec-search-footer-label">' + esc(label) + '</span>' +
    (names.length > 1 ? '<span class="rec-search-footer-names">' + names.map(esc).join(', ') + '</span>' : '') +
    '</div><button class="btn-primary-sm" id="rec-search-continue">Continue</button>';
  $('#rec-search-continue').addEventListener('click', function() {
    proceedWithSelectedMerchants();
  });
}

function closeRecAddSheet() {
  recAddSheet.classList.remove('visible');
}

function showRecStep(step) {
  [recStepSearch, recStepAmount, recStepFreq].forEach(function(el) { el.hidden = true; });
  recStepType.hidden = true;
  if (step === 'search') { recStepSearch.hidden = false; recStepType.hidden = true; }
  else if (step === 'amount') { recStepAmount.hidden = false; recStepType.hidden = false; }
  else if (step === 'freq') recStepFreq.hidden = false;
}

// Add button handlers
var btnAddRec = $('#btn-add-recurring');
var btnAddRecEmpty = $('#btn-add-recurring-empty');
if (btnAddRec) btnAddRec.addEventListener('click', openRecAddSheet);
if (btnAddRecEmpty) btnAddRecEmpty.addEventListener('click', openRecAddSheet);

// Cancel
$('#rec-add-cancel').addEventListener('click', closeRecAddSheet);
recAddSheet.addEventListener('click', function(e) {
  if (e.target === recAddSheet) closeRecAddSheet();
});

// Search input with debounce
var recSearchTimer = null;
recSearchInput.addEventListener('input', function() {
  clearTimeout(recSearchTimer);
  recSearchTimer = setTimeout(function() {
    var query = recSearchInput.value.trim().toLowerCase();
    if (query.length < 1) { recSearchResults.innerHTML = ''; return; }

    // Search transactions by name or amount
    var isNumQuery = /^\$?[\d,.]+$/.test(query);
    var numQuery = isNumQuery ? parseFloat(query.replace(/[$,]/g, '')) : 0;

    // Group transactions by merchant name, using user-modified effective amounts
    var merchants = {};
    txData.forEach(function(tx) {
      var eff = getEffectiveTx(tx);
      // Skip excluded (ignored/reimbursed) transactions
      if (eff.excluded) return;
      var displayName = eff.nickname || tx.merchant_name || tx.enriched_merchant_name || tx.name || '';
      var key = (tx.merchant_name || tx.enriched_merchant_name || tx.name || '').toLowerCase().trim();
      if (!key) return;

      var effAmt = Math.abs(eff.amount);
      var matchesName = key.indexOf(query) !== -1 || displayName.toLowerCase().indexOf(query) !== -1;
      var matchesAmount = isNumQuery && Math.abs(effAmt - numQuery) < 1;

      if (!matchesName && !matchesAmount) return;

      if (!merchants[key]) {
        merchants[key] = { name: displayName, txs: [], isIncome: eff.amount < 0 };
      }
      merchants[key].txs.push(tx);
    });

    // Build result list using effective amounts
    var results = Object.keys(merchants).map(function(key) {
      var m = merchants[key];
      m.txs.sort(function(a, b) { return b.date > a.date ? 1 : b.date < a.date ? -1 : 0; });
      var amounts = m.txs.map(function(t) { return Math.abs(getEffectiveTx(t).amount); });
      return { key: key, name: m.name, count: m.txs.length, recentAmount: amounts[0], isIncome: m.isIncome, txs: m.txs, amounts: amounts };
    });

    // Sort by transaction count (most frequent first)
    results.sort(function(a, b) { return b.count - a.count; });

    // Limit to 20
    results = results.slice(0, 20);

    recLastSearchResults = results;
    renderRecSearchItems(results);

    if (results.length === 0) {
      recSearchResults.innerHTML = '<div class="rec-search-empty">No matching transactions</div>';
    }
  }, 150);
});

function renderRecSearchItems(results) {
  recSearchResults.innerHTML = results.map(function(r) {
    var isSelected = !!recSelectedMerchants[r.key];
    return '<button class="rec-search-item' + (isSelected ? ' rec-search-item-selected' : '') + '" data-key="' + esc(r.key) + '">' +
      '<div class="rec-search-item-check">' + (isSelected ? '<span class="rec-check-on"></span>' : '<span class="rec-check-off"></span>') + '</div>' +
      '<div class="rec-search-item-info">' +
        '<span class="rec-search-item-name">' + esc(r.name) + '</span>' +
        '<span class="rec-search-item-meta">' + r.count + ' transaction' + (r.count === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<span class="rec-search-item-amount">' + formatMoney(r.recentAmount) + '</span>' +
    '</button>';
  }).join('');

  // Toggle selection on click
  recSearchResults.querySelectorAll('.rec-search-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var key = item.dataset.key;
      if (recSelectedMerchants[key]) {
        delete recSelectedMerchants[key];
      } else {
        var match = results.find(function(r) { return r.key === key; });
        if (match) recSelectedMerchants[key] = match;
      }
      renderRecSearchItems(results);
      updateRecSearchFooter();
    });
  });
}

function proceedWithSelectedMerchants() {
  var keys = Object.keys(recSelectedMerchants);
  if (keys.length === 0) return;

  // Combine all selected merchants into one match
  var allTxs = [];
  var names = [];
  var isIncome = false;

  keys.forEach(function(key) {
    var m = recSelectedMerchants[key];
    allTxs = allTxs.concat(m.txs);
    names.push(m.name);
    if (m.isIncome) isIncome = true;
  });

  // Sort transactions by date desc
  allTxs.sort(function(a, b) { return b.date > a.date ? 1 : b.date < a.date ? -1 : 0; });

  // Recompute amounts from sorted transactions using effective (user-modified) values
  var allAmounts = allTxs.map(function(t) { return Math.abs(getEffectiveTx(t).amount); });

  var primaryName = names[0];

  var combined = {
    key: keys.join('+'),
    name: primaryName,
    names: names,
    count: allTxs.length,
    recentAmount: allAmounts[0],
    isIncome: isIncome,
    txs: allTxs,
    amounts: allAmounts
  };

  showMerchantTxDetail(combined);
}

function showMerchantTxDetail(match) {
  var txs = match.txs.slice(0, 20);
  var html = '<div class="rec-tx-detail">';
  html += '<div class="rec-tx-detail-header">';
  html += '<button class="rec-tx-detail-back" id="rec-tx-back">&larr;</button>';
  if (match.names && match.names.length > 1) {
    html += '<span class="rec-tx-detail-name">' + match.names.map(esc).join(', ') + '</span>';
  } else {
    html += '<span class="rec-tx-detail-name">' + esc(match.name) + '</span>';
  }
  html += '</div>';
  html += '<div class="rec-tx-detail-summary">' + match.txs.length + ' transaction' + (match.txs.length === 1 ? '' : 's') + ' found</div>';
  html += '<div class="rec-tx-detail-list">';
  txs.forEach(function(tx) {
    var eff = getEffectiveTx(tx);
    var d = parseLocalDate(eff.date);
    var dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var merchantName = eff.nickname || tx.merchant_name || tx.enriched_merchant_name || tx.name || '';
    var amt = Math.abs(eff.amount);
    var isIncome = eff.amount < 0;
    var splitTag = eff.isSplit ? ' <span class="rec-tx-detail-tag">split</span>' : '';
    html += '<div class="rec-tx-detail-item">';
    html += '<div class="rec-tx-detail-item-left"><span class="rec-tx-detail-date">' + dateStr + '</span>';
    if (match.names && match.names.length > 1) {
      html += '<span class="rec-tx-detail-merchant">' + esc(merchantName) + '</span>';
    }
    html += '</div>';
    html += '<span class="rec-tx-detail-amt ' + (isIncome ? 'balance-positive' : 'balance-negative') + '">' + (isIncome ? '+' : '-') + formatMoney(amt) + splitTag + '</span>';
    html += '</div>';
  });
  if (match.txs.length > 20) {
    html += '<div class="rec-tx-detail-more">and ' + (match.txs.length - 20) + ' more</div>';
  }
  html += '</div>';
  html += '<button class="btn-primary" id="rec-tx-select" style="width:100%;margin-top:0.75rem">Use This</button>';
  html += '</div>';

  recSearchResults.innerHTML = html;

  $('#rec-tx-back').addEventListener('click', function() {
    renderRecSearchItems(recLastSearchResults);
    updateRecSearchFooter();
  });

  $('#rec-tx-select').addEventListener('click', function() {
    selectRecTransaction(match);
  });
}

function selectRecTransaction(match) {
  recAddState.name = match.name;
  recAddState.matchingTxs = match.txs;
  recAddState.isIncome = match.isIncome;

  // Compute amount options
  var amounts = match.amounts;
  var recentAmt = amounts[0];
  var avgAmt = amounts.reduce(function(s, a) { return s + a; }, 0) / amounts.length;

  // Most frequent: find the mode (round to nearest cent)
  var freqMap = {};
  amounts.forEach(function(a) {
    var rounded = Math.round(a * 100) / 100;
    freqMap[rounded] = (freqMap[rounded] || 0) + 1;
  });
  var modeAmt = recentAmt;
  var modeCount = 0;
  Object.keys(freqMap).forEach(function(k) {
    if (freqMap[k] > modeCount) { modeCount = freqMap[k]; modeAmt = parseFloat(k); }
  });

  // Set default
  recAddState.amount = recentAmt;
  recAddState.amountMode = 'recent';

  // Update income/expense toggle
  var expBtn = $('#rec-type-expense');
  var incBtn = $('#rec-type-income');
  if (match.isIncome) {
    incBtn.classList.add('active');
    expBtn.classList.remove('active');
  } else {
    expBtn.classList.add('active');
    incBtn.classList.remove('active');
  }

  // Render amount step
  var infoEl = $('#rec-amount-info');
  infoEl.innerHTML = '<span class="rec-amount-name">' + esc(match.name) + '</span>' +
    '<span class="rec-amount-meta">' + amounts.length + ' transaction' + (amounts.length === 1 ? '' : 's') + ' found</span>';

  var modesEl = $('#rec-amount-modes');
  var modesHtml = '';
  modesHtml += '<button class="recurring-mode-btn active" data-mode="recent">Most Recent<br><strong>' + formatMoney(recentAmt) + '</strong></button>';
  if (amounts.length > 1) {
    modesHtml += '<button class="recurring-mode-btn" data-mode="average">Average<br><strong>' + formatMoney(avgAmt) + '</strong></button>';
    modesHtml += '<button class="recurring-mode-btn" data-mode="frequent">Most Frequent<br><strong>' + formatMoney(modeAmt) + '</strong></button>';
  }
  modesHtml += '<button class="recurring-mode-btn" data-mode="custom">Custom</button>';
  modesEl.innerHTML = modesHtml;

  var selectedAmtEl = $('#rec-selected-amount');
  selectedAmtEl.textContent = 'Amount: ' + formatMoney(recentAmt);

  // Mode button handlers
  modesEl.querySelectorAll('.recurring-mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      modesEl.querySelectorAll('.recurring-mode-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var mode = btn.dataset.mode;
      recAddState.amountMode = mode;
      var customRow = $('#rec-custom-amount-row');

      if (mode === 'recent') { recAddState.amount = recentAmt; customRow.hidden = true; }
      else if (mode === 'average') { recAddState.amount = avgAmt; customRow.hidden = true; }
      else if (mode === 'frequent') { recAddState.amount = modeAmt; customRow.hidden = true; }
      else if (mode === 'custom') { customRow.hidden = false; var ci = $('#rec-custom-amount'); ci.focus(); }

      if (mode !== 'custom') selectedAmtEl.textContent = 'Amount: ' + formatMoney(recAddState.amount);
    });
  });

  // Custom amount input
  $('#rec-custom-amount').addEventListener('input', function() {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v > 0) {
      recAddState.amount = v;
      selectedAmtEl.textContent = 'Amount: ' + formatMoney(v);
    }
  });

  $('#rec-custom-amount-row').hidden = true;
  showRecStep('amount');
}

// Income/Expense toggle
$('#rec-type-expense').addEventListener('click', function() {
  recAddState.isIncome = false;
  this.classList.add('active');
  $('#rec-type-income').classList.remove('active');
});
$('#rec-type-income').addEventListener('click', function() {
  recAddState.isIncome = true;
  this.classList.add('active');
  $('#rec-type-expense').classList.remove('active');
});

// Amount step navigation
$('#rec-amount-back').addEventListener('click', function() { showRecStep('search'); });
$('#rec-amount-next').addEventListener('click', function() {
  // If editing, preserve the saved frequency and date; otherwise default
  if (recEditingBillId && recAddState.anchorDate) {
    $('#rec-anchor-date').value = recAddState.anchorDate;
  } else {
    var today = formatLocalDate(new Date());
    $('#rec-anchor-date').value = today;
    recAddState.anchorDate = today;
  }

  // Set frequency buttons to match saved state
  var freq = recAddState.frequency || 'monthly';
  document.querySelectorAll('#rec-freq-options .recurring-date-btn').forEach(function(b) { b.classList.remove('active'); });
  var freqBtn = document.querySelector('#rec-freq-options [data-freq="' + freq + '"]');
  if (freqBtn) freqBtn.classList.add('active');
  else document.querySelector('#rec-freq-options [data-freq="monthly"]').classList.add('active');

  $('#rec-custom-freq-row').hidden = freq !== 'custom';
  if (freq === 'custom' && recAddState.frequencyDays) {
    $('#rec-custom-freq-days').value = recAddState.frequencyDays;
  }

  showRecStep('freq');
});

// Frequency step
document.querySelectorAll('#rec-freq-options .recurring-date-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#rec-freq-options .recurring-date-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    recAddState.frequency = btn.dataset.freq;
    $('#rec-custom-freq-row').hidden = btn.dataset.freq !== 'custom';
    if (btn.dataset.freq === 'custom') $('#rec-custom-freq-days').focus();
  });
});

$('#rec-custom-freq-days').addEventListener('input', function() {
  var v = parseInt(this.value);
  if (!isNaN(v) && v > 0) recAddState.frequencyDays = v;
});

$('#rec-anchor-date').addEventListener('change', function() {
  recAddState.anchorDate = this.value;
});

// Frequency back
$('#rec-freq-back').addEventListener('click', function() { showRecStep('amount'); });

// Save
$('#rec-freq-save').addEventListener('click', async function() {
  if (!recAddState.name || !recAddState.amount || !recAddState.anchorDate) {
    if (!recAddState.name) showToast('Enter a name for this bill');
    else if (!recAddState.amount) showToast('Set an amount for this bill');
    else showToast('Pick a next due date');
    return;
  }
  if (recAddState.frequency === 'custom' && (!recAddState.frequencyDays || recAddState.frequencyDays < 1)) {
    showToast('Enter a number of days (1-730)');
    return;
  }

  // The date the user entered is the next due date directly
  var nextDue = recAddState.anchorDate;

  var row = {
    name: recAddState.name,
    amount: Math.round(recAddState.amount * 100) / 100,
    is_income: recAddState.isIncome,
    frequency: recAddState.frequency,
    frequency_days: recAddState.frequency === 'custom' ? recAddState.frequencyDays : null,
    anchor_date: nextDue,
    next_due_date: nextDue
  };

  if (recEditingBillId) {
    // Update existing bill -- render immediately
    var idx = recBills.findIndex(function(b) { return b.id === recEditingBillId; });
    if (idx !== -1) Object.assign(recBills[idx], row);
    var editId = recEditingBillId;
    recEditingBillId = null;
    showToast('Bill updated');
    closeRecAddSheet();
    renderRecurringBills();
    sb.from('recurring_bills').update(row).eq('id', editId).then(function(result) {
      if (result.error) console.error('Update bill error:', result.error);
    });
  } else {
    // Insert new bill -- need DB for the generated id
    row.user_id = currentUser.id;
    var result = await sb.from('recurring_bills').insert(row).select();
    if (result.data && result.data[0]) {
      recBills.push(result.data[0]);
    }
    showToast('Recurring bill added');
    closeRecAddSheet();
    renderRecurringBills();
  }
});

// Legend section toggle
var legendToggle = $('#btn-toggle-legend');
if (legendToggle) legendToggle.addEventListener('click', function() {
  this.closest('.tx-legend-section').classList.toggle('collapsed');
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

// ============================================
// SERVICE WORKER CLEANUP
// ============================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    regs.forEach(function(reg) { reg.unregister(); });
  });
  caches.keys().then(function(keys) { keys.forEach(function(k) { caches.delete(k); }); });
}


})();
