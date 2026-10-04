(function(){
  "use strict";

  const STORAGE_KEY = 'ledger_transactions_v1';
  const EXPENSE_CATS = ['Food','Transport','Rent','Utilities','Shopping','Health','Entertainment','Education','Other'];
  const INCOME_CATS = ['Salary','Freelance','Business','Gift','Other'];

  let state = {
    transactions: [],
    selectedMonth: null, // 'YYYY-MM'
    currentType: 'income'
  };

  // ---------- Sync status UI ----------
  function setSyncStatus(mode, text){
    // mode: 'off' | 'connected' | 'syncing' | 'error'
    const pill = document.getElementById('syncStatus');
    const label = document.getElementById('syncStatusText');
    if(!pill || !label) return;
    pill.classList.remove('connected','syncing','error');
    if(mode !== 'off') pill.classList.add(mode);
    label.textContent = text;
  }

  // ---------- Local cache (fallback + offline safety net) ----------
  function loadLocalCache(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(e){
      return [];
    }
  }
  function saveLocalCache(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
    }catch(e){ /* storage unavailable, fail silently */ }
  }

  // ---------- Firebase (Auth + Firestore) ----------
  let auth, db;
  let currentUser = null;
  let unsubscribeSnapshot = null;
  let migratedThisSession = false;

  function isSignedIn(){ return !!currentUser; }

  function initFirebase(){
    if(typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined'){
      console.warn('Firebase SDK or firebaseConfig not found — check index.html and firebase-config.js.');
      return false;
    }
    if(firebaseConfig.apiKey === 'YOUR_API_KEY'){
      console.warn('firebase-config.js still has placeholder values — sign-in/cloud sync will not work until it is filled in (see SETUP.md).');
    }
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    return true;
  }

  function txCollection(uid){
    return db.collection('users').doc(uid).collection('transactions');
  }

  async function signIn(){
    const provider = new firebase.auth.GoogleAuthProvider();
    try{
      await auth.signInWithPopup(provider);
    }catch(err){
      console.error('Sign-in failed', err);
      alert('Sign-in failed: ' + (err.message || err));
    }
  }

  async function signOutUser(){
    if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    try{ await auth.signOut(); }catch(err){ console.error('Sign-out failed', err); }
  }

  // If someone used the app while signed out and then signs in with an
  // empty cloud ledger, offer their local entries a one-time ride to the cloud.
  async function migrateLocalToCloud(uid){
    const local = loadLocalCache();
    if(!local.length) return;
    const batch = db.batch();
    const col = txCollection(uid);
    local.forEach(t => batch.set(col.doc(t.id), t));
    try{ await batch.commit(); }catch(err){ console.error('Migration to cloud failed', err); }
  }

  function startListening(uid){
    setSyncStatus('syncing', 'Syncing…');
    unsubscribeSnapshot = txCollection(uid).onSnapshot(async (snapshot) => {
      if(snapshot.empty && !migratedThisSession && loadLocalCache().length){
        migratedThisSession = true;
        await migrateLocalToCloud(uid);
        return; // the migration writes will re-trigger this listener
      }
      state.transactions = snapshot.docs.map(doc => doc.data());
      saveLocalCache();
      renderAll();
      const who = (currentUser && (currentUser.displayName || currentUser.email)) || 'account';
      setSyncStatus('connected', 'Synced as ' + who);
    }, (err) => {
      console.error('Firestore sync error', err);
      state.transactions = loadLocalCache();
      renderAll();
      setSyncStatus('error', 'Sync failed — showing local copy');
    });
  }

  function handleAuthChange(user){
    currentUser = user;
    updateAccountUI();

    if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }

    if(user){
      migratedThisSession = false;
      startListening(user.uid);
    }else{
      state.transactions = loadLocalCache();
      setSyncStatus('off', 'Signed out — saved on this device');
      renderAll();
    }
  }

  // ---------- Helpers ----------
  function fmtMoney(n){
    const abs = Math.abs(n);
    const formatted = abs.toLocaleString('en-IN', {maximumFractionDigits:2, minimumFractionDigits: abs % 1 === 0 ? 0 : 2});
    return (n < 0 ? '−₹' : '₹') + formatted;
  }
  function monthKey(dateStr){
    return dateStr.slice(0,7); // YYYY-MM
  }
  function monthLabel(key){
    const [y,m] = key.split('-').map(Number);
    const d = new Date(y, m-1, 1);
    return d.toLocaleDateString('en-US', {month:'short', year:'numeric'});
  }
  function todayISO(){
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off*60000).toISOString().slice(0,10);
  }
  function fmtDate(dateStr){
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', {day:'numeric', month:'short'});
  }
  function uid(){
    return 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }
  const CAT_ICONS = {
    Food:'🍽', Transport:'🚗', Rent:'🏠', Utilities:'💡', Shopping:'🛍',
    Health:'💊', Entertainment:'🎬', Education:'📚', Other:'📦',
    Salary:'💼', Freelance:'✍️', Business:'📈', Gift:'🎁'
  };

  // ---------- Month list ----------
  function getAllMonthKeys(){
    const keys = new Set(state.transactions.map(t => monthKey(t.date)));
    keys.add(monthKey(todayISO()));
    return Array.from(keys).sort(); // ascending
  }

  function ensureSelectedMonth(){
    const keys = getAllMonthKeys();
    if(!state.selectedMonth || !keys.includes(state.selectedMonth)){
      state.selectedMonth = keys[keys.length - 1];
    }
  }

  // ---------- Rendering ----------
  function renderMonthNav(){
    const nav = document.getElementById('monthNav');
    const keys = getAllMonthKeys();
    nav.innerHTML = '';
    keys.forEach(key => {
      const btn = document.createElement('button');
      btn.className = 'month-tab' + (key === state.selectedMonth ? ' active' : '');
      btn.textContent = monthLabel(key);
      btn.setAttribute('aria-pressed', key === state.selectedMonth ? 'true' : 'false');
      btn.addEventListener('click', () => {
        state.selectedMonth = key;
        renderAll();
      });
      nav.appendChild(btn);
    });
    // scroll active tab into view
    const activeTab = nav.querySelector('.month-tab.active');
    if(activeTab) activeTab.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
  }

  function getMonthTransactions(){
    return state.transactions
      .filter(t => monthKey(t.date) === state.selectedMonth)
      .sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  function renderSummary(monthTx){
    const income = monthTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    const balance = income - expense;

    document.getElementById('totalIncome').textContent = fmtMoney(income);
    document.getElementById('totalExpense').textContent = fmtMoney(expense);
    const balEl = document.getElementById('totalBalance');
    balEl.textContent = fmtMoney(balance);
    balEl.classList.toggle('negative', balance < 0);
  }

  function renderList(monthTx){
    const listEl = document.getElementById('txList');
    document.getElementById('listTitle').textContent = state.selectedMonth ? monthLabel(state.selectedMonth) + ' entries' : 'Entries';
    document.getElementById('listCount').textContent = monthTx.length + (monthTx.length === 1 ? ' entry' : ' entries');

    if(monthTx.length === 0){
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="icon">📖</div>
          <strong>Blank page</strong>
          <p>Nothing filed for this month yet. Add your first income or expense entry to start the ledger.</p>
        </div>`;
      return;
    }

    listEl.innerHTML = '';
    monthTx.forEach(t => {
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML = `
        <div class="tx-icon ${t.type}">${CAT_ICONS[t.category] || '•'}</div>
        <div class="tx-mid">
          <div class="tx-desc">${escapeHtml(t.description)}</div>
          <div class="tx-meta"><span>${t.category}</span><span>·</span><span>${fmtDate(t.date)}</span></div>
        </div>
        <div class="tx-amount ${t.type}">${t.type === 'expense' ? '−' : '+'}${fmtMoney(t.amount).replace('₹','₹')}</div>
        <button class="tx-del" aria-label="Delete entry" data-id="${t.id}">✕</button>
      `;
      listEl.appendChild(row);
    });

    listEl.querySelectorAll('.tx-del').forEach(btn => {
      btn.addEventListener('click', () => askDelete(btn.dataset.id));
    });
  }

  // ---------- Delete confirmation ----------
  const confirmBackdrop = document.getElementById('confirmBackdrop');
  const confirmSummary = document.getElementById('confirmSummary');
  let pendingDeleteId = null;
  let confirmReturnFocus = null;

  function askDelete(id){
    const t = state.transactions.find(x => x.id === id);
    if(!t) return;
    pendingDeleteId = id;
    confirmReturnFocus = document.activeElement;
    confirmSummary.innerHTML = `
      <div class="tx-icon ${t.type}">${CAT_ICONS[t.category] || '•'}</div>
      <div class="confirm-summary-mid">
        <div class="confirm-summary-desc">${escapeHtml(t.description)}</div>
        <div class="confirm-summary-meta">${escapeHtml(t.category)} · ${fmtDate(t.date)}</div>
      </div>
      <div class="tx-amount ${t.type}">${t.type === 'expense' ? '−' : '+'}${fmtMoney(t.amount)}</div>`;
    confirmBackdrop.classList.add('open');
    setTimeout(() => document.getElementById('confirmCancel').focus(), 120);
  }
  function closeConfirm(){
    confirmBackdrop.classList.remove('open');
    pendingDeleteId = null;
    if(confirmReturnFocus && confirmReturnFocus.focus) confirmReturnFocus.focus();
  }
  async function deleteEntry(id){
    state.transactions = state.transactions.filter(t => t.id !== id);
    saveLocalCache();
    renderAll();

    if(isSignedIn()){
      setSyncStatus('syncing', 'Deleting…');
      try{
        await txCollection(currentUser.uid).doc(id).delete();
        // onSnapshot will confirm and reset the pill to "Synced"
      }catch(err){
        console.error('Delete failed', err);
        setSyncStatus('error', 'Delete failed to sync — reload to retry');
      }
    }
  }

  document.getElementById('confirmCancel').addEventListener('click', closeConfirm);
  document.getElementById('confirmDelete').addEventListener('click', () => {
    const id = pendingDeleteId;
    closeConfirm();
    if(id) deleteEntry(id);
  });
  confirmBackdrop.addEventListener('click', (e) => { if(e.target === confirmBackdrop) closeConfirm(); });
  document.addEventListener('keydown', (e) => {
    if(!confirmBackdrop.classList.contains('open')) return;
    if(e.key === 'Escape') closeConfirm();
    if(e.key === 'Tab'){ // keep focus inside the dialog
      const btns = [document.getElementById('confirmCancel'), document.getElementById('confirmDelete')];
      const i = btns.indexOf(document.activeElement);
      e.preventDefault();
      btns[(i + (e.shiftKey ? -1 : 1) + 2) % 2].focus();
    }
  });

  function renderCategoryBreakdown(monthTx){
    const body = document.getElementById('catBody');
    const expenses = monthTx.filter(t => t.type === 'expense');
    if(expenses.length === 0){
      body.innerHTML = `<div class="cat-empty">No expenses filed this month — the breakdown will appear once you add some.</div>`;
      return;
    }
    const totals = {};
    expenses.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
    const entries = Object.entries(totals).sort((a,b) => b[1] - a[1]);
    const max = entries[0][1];

    body.innerHTML = '';
    entries.forEach(([cat, amt]) => {
      const row = document.createElement('div');
      row.className = 'cat-row';
      row.innerHTML = `
        <div class="cat-row-top">
          <span class="cat-name">${CAT_ICONS[cat] || ''} ${cat}</span>
          <span class="cat-amt">${fmtMoney(amt)}</span>
        </div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:0%"></div></div>
      `;
      body.appendChild(row);
      requestAnimationFrame(() => {
        row.querySelector('.cat-bar-fill').style.width = (amt / max * 100) + '%';
      });
    });
  }

  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderAll(){
    ensureSelectedMonth();
    renderMonthNav();
    const monthTx = getMonthTransactions();
    renderSummary(monthTx);
    renderList(monthTx);
    renderCategoryBreakdown(monthTx);
  }

  // ---------- Modal / form ----------
  const backdrop = document.getElementById('modalBackdrop');
  const form = document.getElementById('txForm');
  const categorySelect = document.getElementById('category');
  const btnIncome = document.getElementById('btnIncome');
  const btnExpense = document.getElementById('btnExpense');
  const submitBtn = document.getElementById('submitBtn');

  function populateCategories(){
    const cats = state.currentType === 'income' ? INCOME_CATS : EXPENSE_CATS;
    categorySelect.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  function setType(type){
    state.currentType = type;
    btnIncome.classList.toggle('active', type === 'income');
    btnExpense.classList.toggle('active', type === 'expense');
    submitBtn.textContent = type === 'income' ? 'Add income' : 'Add expense';
    populateCategories();
  }

  function openModal(){
    setType('income');
    document.getElementById('amount').value = '';
    document.getElementById('description').value = '';
    document.getElementById('date').value = todayISO();
    backdrop.classList.add('open');
    setTimeout(() => document.getElementById('amount').focus(), 150);
  }
  function closeModal(){
    backdrop.classList.remove('open');
  }

  document.getElementById('openAdd').addEventListener('click', openModal);
  document.getElementById('closeModal').addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if(e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && backdrop.classList.contains('open')) closeModal(); });

  btnIncome.addEventListener('click', () => setType('income'));
  btnExpense.addEventListener('click', () => setType('expense'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('amount').value);
    const description = document.getElementById('description').value.trim();
    const category = categorySelect.value;
    const date = document.getElementById('date').value;

    if(!amount || amount <= 0 || !description || !date) return;

    const tx = {
      id: uid(),
      type: state.currentType,
      amount: amount,
      description: description,
      category: category,
      date: date
    };

    // Optimistic update: show it immediately, sync in the background.
    state.transactions.push(tx);
    saveLocalCache();
    state.selectedMonth = monthKey(date);
    closeModal();
    renderAll();

    if(isSignedIn()){
      setSyncStatus('syncing', 'Saving…');
      try{
        await txCollection(currentUser.uid).doc(tx.id).set(tx);
        // onSnapshot will confirm and reset the pill to "Synced"
      }catch(err){
        console.error('Save failed', err);
        setSyncStatus('error', 'Save failed — kept locally, will retry on reload');
      }
    }
  });

  // ---------- Export to Excel ----------
  const exportBackdrop = document.getElementById('exportModalBackdrop');
  const openExportBtn = document.getElementById('openExport');

  function openExportModal(){
    ensureSelectedMonth();
    const label = document.getElementById('exportMonthLabel');
    if(label) label.textContent = state.selectedMonth ? monthLabel(state.selectedMonth) : 'This month';
    exportBackdrop.classList.add('open');
  }
  function closeExportModal(){ exportBackdrop.classList.remove('open'); }

  if(openExportBtn) openExportBtn.addEventListener('click', openExportModal);
  document.getElementById('closeExportModal').addEventListener('click', closeExportModal);
  exportBackdrop.addEventListener('click', (e) => { if(e.target === exportBackdrop) closeExportModal(); });

  function sortedTx(list){
    return [...list].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  function txRowsForSheet(list){
    return sortedTx(list).map(t => ({
      Date: t.date,
      Type: t.type === 'income' ? 'Income' : 'Expense',
      Category: t.category,
      Description: t.description,
      'Amount (INR)': t.amount
    }));
  }

  function categorySummaryRows(list){
    const totals = {};
    list.forEach(t => {
      const key = t.type + '|' + t.category;
      totals[key] = (totals[key] || 0) + t.amount;
    });
    return Object.keys(totals).sort().map(key => {
      const [type, cat] = key.split('|');
      return {
        Type: type === 'income' ? 'Income' : 'Expense',
        Category: cat,
        'Total (INR)': totals[key]
      };
    });
  }

  function monthlySummaryRows(){
    const totals = {};
    state.transactions.forEach(t => {
      const key = monthKey(t.date);
      if(!totals[key]) totals[key] = {income:0, expense:0};
      totals[key][t.type] += t.amount;
    });
    return Object.keys(totals).sort().map(key => ({
      Month: monthLabel(key),
      Income: totals[key].income,
      Expenses: totals[key].expense,
      Balance: totals[key].income - totals[key].expense
    }));
  }

  function addSheet(wb, rows, name, colWidths){
    const ws = XLSX.utils.json_to_sheet(rows);
    if(colWidths) ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  function exportToExcel(scope){
    if(typeof XLSX === 'undefined'){
      alert('The export library failed to load — check your internet connection and try again.');
      return;
    }
    const list = scope === 'month' ? getMonthTransactions() : state.transactions;
    if(!list.length){
      alert('Nothing to export yet — add an entry first.');
      return;
    }

    const wb = XLSX.utils.book_new();
    addSheet(wb, txRowsForSheet(list), 'Transactions',
      [{wch:12},{wch:9},{wch:16},{wch:36},{wch:14}]);
    addSheet(wb, categorySummaryRows(list), 'Category Summary',
      [{wch:9},{wch:16},{wch:14}]);
    if(scope === 'all'){
      addSheet(wb, monthlySummaryRows(), 'Monthly Summary',
        [{wch:14},{wch:14},{wch:14},{wch:14}]);
    }

    const suffix = scope === 'month' ? (state.selectedMonth || 'this-month') : 'all-time';
    XLSX.writeFile(wb, `the-ledger_${suffix}.xlsx`);
    closeExportModal();
  }

  document.getElementById('exportOptions').querySelectorAll('.export-option').forEach(btn => {
    btn.addEventListener('click', () => exportToExcel(btn.dataset.scope));
  });

  // ---------- Account modal (sign in / sign out) ----------
  const accountBackdrop = document.getElementById('accountModalBackdrop');
  const accountBody = document.getElementById('accountBody');
  const syncStatusBtn = document.getElementById('syncStatus');

  function openAccountModal(){
    accountBackdrop.classList.add('open');
  }
  function closeAccountModal(){
    accountBackdrop.classList.remove('open');
  }

  syncStatusBtn.addEventListener('click', openAccountModal);
  document.getElementById('closeAccountModal').addEventListener('click', closeAccountModal);
  accountBackdrop.addEventListener('click', (e) => { if(e.target === accountBackdrop) closeAccountModal(); });

  function updateAccountUI(){
    if(!accountBody) return;

    if(currentUser){
      accountBody.innerHTML = `
        <div class="account-signedin">
          <div class="user-row">
            <img class="user-avatar" src="${currentUser.photoURL || ''}" alt="" onerror="this.style.visibility='hidden'">
            <div>
              <div class="user-name">${escapeHtml(currentUser.displayName || 'Signed in')}</div>
              <div class="user-email">${escapeHtml(currentUser.email || '')}</div>
            </div>
          </div>
          <p class="sheet-blurb">Your entries sync automatically to the cloud and stay available on any device you sign into.</p>
          <button type="button" class="disconnect-btn" id="signOutBtn">Sign out</button>
        </div>`;
      document.getElementById('signOutBtn').addEventListener('click', () => {
        signOutUser();
        closeAccountModal();
      });
    }else{
      accountBody.innerHTML = `
        <p class="sheet-blurb">Sign in with Google to save your entries to the cloud and access them from any device. Without signing in, entries are only saved in this browser.</p>
        <button type="button" class="google-btn" id="googleSignInBtn">
          <span class="google-dot" aria-hidden="true"></span> Continue with Google
        </button>`;
      document.getElementById('googleSignInBtn').addEventListener('click', signIn);
    }
  }

  // ---------- Init ----------
  state.transactions = loadLocalCache();
  renderAll();
  updateAccountUI();

  if(initFirebase()){
    auth.onAuthStateChanged(handleAuthChange);
  }else{
    setSyncStatus('error', 'Firebase not configured — see SETUP.md');
  }
})();
