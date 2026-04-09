// ============================================
// SUPABASE INIT
// ============================================
const SUPABASE_URL = 'https://itkufrockebnlzcroigc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0a3Vmcm9ja2Vibmx6Y3JvaWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2OTczNjYsImV4cCI6MjA5MTI3MzM2Nn0.mhOwZBwegogIb-yjYzxS4ROQdc4Tc8xLMNlHcDfozzI';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// DOM REFS
// ============================================
const $ = (sel) => document.querySelector(sel);
const screenLogin = $('#screen-login');
const screenSnapshot = $('#screen-snapshot');
const authForm = $('#auth-form');
const authEmail = $('#auth-email');
const authPassword = $('#auth-password');
const authSubmit = $('#auth-submit');
const authError = $('#auth-error');
const authToggleText = $('#auth-toggle-text');
const authToggleLink = $('#auth-toggle-link');
const btnLogout = $('#btn-logout');
const btnConnectPlaid = $('#btn-connect-plaid');
const btnAddAccount = $('#btn-add-account');
const connectCta = $('#connect-cta');
const sectionBanks = $('#section-banks');
const sectionCredit = $('#section-credit');
const listBanks = $('#list-banks');
const listCredit = $('#list-credit');
const banksTotal = $('#banks-total');
const creditTotal = $('#credit-total');
const loading = $('#loading');

let isSignUp = false;
let currentUser = null;

// ============================================
// AUTH
// ============================================
authToggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  isSignUp = !isSignUp;
  authSubmit.textContent = isSignUp ? 'Sign Up' : 'Sign In';
  authToggleText.textContent = isSignUp ? 'Already have an account?' : "Don't have an account?";
  authToggleLink.textContent = isSignUp ? 'Sign In' : 'Sign Up';
  authError.hidden = true;
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authSubmit.disabled = true;
  authError.hidden = true;

  const email = authEmail.value.trim();
  const password = authPassword.value;

  let result;
  if (isSignUp) {
    result = await sb.auth.signUp({ email, password });
  } else {
    result = await sb.auth.signInWithPassword({ email, password });
  }

  if (result.error) {
    authError.textContent = result.error.message;
    authError.hidden = false;
    authSubmit.disabled = false;
    return;
  }

  if (isSignUp && result.data?.user && !result.data.session) {
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

btnLogout.addEventListener('click', async () => {
  await sb.auth.signOut();
});

// Listen for auth state changes
sb.auth.onAuthStateChange((event, session) => {
  if (session?.user) {
    currentUser = session.user;
    showScreen('snapshot');
    loadAccounts();
  } else {
    currentUser = null;
    showScreen('login');
  }
});

// ============================================
// SCREENS
// ============================================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
}

// ============================================
// PLAID LINK
// ============================================
async function openPlaidLink() {
  showLoading(true);

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/plaid-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action: 'create_link_token' })
    });

    const { link_token } = await res.json();
    showLoading(false);

    const handler = Plaid.create({
      token: link_token,
      onSuccess: async (publicToken, metadata) => {
        showLoading(true);
        await fetch(`${SUPABASE_URL}/functions/v1/plaid-link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            action: 'exchange_token',
            public_token: publicToken,
            institution: metadata.institution
          })
        });
        await loadAccounts();
        showLoading(false);
      },
      onExit: () => {}
    });

    handler.open();
  } catch (err) {
    console.error('Plaid Link error:', err);
    showLoading(false);
  }
}

btnConnectPlaid.addEventListener('click', openPlaidLink);
btnAddAccount.addEventListener('click', openPlaidLink);

// ============================================
// LOAD ACCOUNTS
// ============================================
async function loadAccounts() {
  const { data: accounts, error } = await sb
    .from('accounts')
    .select(`
      id,
      type,
      subtype,
      is_hidden,
      name_enc,
      mask_enc,
      balance_current_enc,
      balance_available_enc,
      balance_limit_enc,
      official_name_enc,
      plaid_item_id,
      plaid_items (
        institution_name_enc
      )
    `)
    .eq('is_hidden', false)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error loading accounts:', error);
    return;
  }

  // Decrypt account data
  const decrypted = await Promise.all(accounts.map(async (a) => {
    const fields = await decryptFields({
      name: a.name_enc,
      mask: a.mask_enc,
      balance_current: a.balance_current_enc,
      balance_available: a.balance_available_enc,
      balance_limit: a.balance_limit_enc,
      institution: a.plaid_items?.institution_name_enc
    });
    return { ...a, ...fields };
  }));

  renderAccounts(decrypted);
}

async function decryptFields(encFields) {
  const result = {};
  for (const [key, val] of Object.entries(encFields)) {
    if (!val) { result[key] = null; continue; }
    const { data, error } = await sb.rpc('decrypt_text', { cipher: val });
    result[key] = error ? null : data;
  }
  return result;
}

// ============================================
// RENDER ACCOUNTS
// ============================================
function renderAccounts(accounts) {
  const banks = accounts.filter((a) => a.type === 'depository');
  const credits = accounts.filter((a) => a.type === 'credit');

  const hasAccounts = accounts.length > 0;
  connectCta.hidden = hasAccounts;
  btnAddAccount.hidden = !hasAccounts;
  sectionBanks.hidden = banks.length === 0;
  sectionCredit.hidden = credits.length === 0;

  // Banks
  listBanks.innerHTML = banks.map((a) => accountCard(a, 'bank')).join('');
  const bankSum = banks.reduce((s, a) => s + parseFloat(a.balance_current || 0), 0);
  banksTotal.textContent = formatMoney(bankSum);
  banksTotal.className = `section-total ${bankSum >= 0 ? 'balance-positive' : 'balance-negative'}`;

  // Credit Cards
  listCredit.innerHTML = credits.map((a) => accountCard(a, 'credit')).join('');
  const creditSum = credits.reduce((s, a) => s + parseFloat(a.balance_current || 0), 0);
  creditTotal.textContent = formatMoney(creditSum);
  creditTotal.className = `section-total balance-negative`;
}

function accountCard(account, type) {
  const balance = parseFloat(account.balance_current || 0);
  const balanceLabel = type === 'credit' ? 'Owed' : 'Available';
  const displayBalance = type === 'bank'
    ? parseFloat(account.balance_available || account.balance_current || 0)
    : balance;

  return `
    <div class="account-card">
      <div class="account-info">
        <span class="account-name">${esc(account.name || 'Account')}</span>
        ${account.mask ? `<span class="account-mask">${esc(account.subtype || '')} ****${esc(account.mask)}</span>` : ''}
        ${account.institution ? `<span class="account-institution">${esc(account.institution)}</span>` : ''}
      </div>
      <div class="account-balance">
        <div class="amount ${type === 'credit' ? 'balance-negative' : 'balance-positive'}">${formatMoney(displayBalance)}</div>
        <div class="label">${balanceLabel}</div>
      </div>
    </div>
  `;
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
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showLoading(show) {
  loading.classList.toggle('visible', show);
}

// ============================================
// SERVICE WORKER
// ============================================
// Unregister any old service workers to prevent caching issues during development
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
}

// ============================================
// INIT - check existing session
// ============================================
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    showScreen('snapshot');
    loadAccounts();
  } else {
    showScreen('login');
  }
})();
