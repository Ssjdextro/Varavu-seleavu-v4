(function(){
  "use strict";

  const STORAGE_KEY = 'ledger_transactions_v1';   // same local cache the Ledger page uses
  const CAT_ICONS = {
    Food:'🍽', Transport:'🚗', Rent:'🏠', Utilities:'💡', Shopping:'🛍',
    Health:'💊', Entertainment:'🎬', Education:'📚', Other:'📦',
    Salary:'💼', Freelance:'✍️', Business:'📈', Gift:'🎁'
  };
  const PALETTE = ['#e2725b','#d4af37','#2dd4a7','#7fa8ff','#c792ea','#f0a08c','#5b95a8','#c9b458','#8a9bb8'];

  const $ = id => document.getElementById(id);
  const state = { tx: [], month: null, range: 6, ready: false };
  const charts = {};
  let firstPaint = true;

  // ---------- helpers ----------
  const fmtMoney = n => {
    const abs = Math.abs(n);
    const f = abs.toLocaleString('en-IN', {maximumFractionDigits:0});
    return (n < 0 ? '−₹' : '₹') + f;
  };
  const compact = v => v >= 100000 ? (v/100000).toFixed(v % 100000 ? 1 : 0) + 'L' : v >= 1000 ? (v/1000) + 'k' : v;
  const monthKey = d => d.slice(0,7);
  const monthLabel = (k, long) => {
    const [y,m] = k.split('-').map(Number);
    return new Date(y, m-1, 1).toLocaleDateString('en-US', long ? {month:'long', year:'numeric'} : {month:'short', year:'2-digit'});
  };
  const shortMonth = k => { const [y,m] = k.split('-').map(Number); return new Date(y, m-1, 1).toLocaleDateString('en-US', {month:'short'}); };
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
  const addMonths = (k, n) => { const [y,m] = k.split('-').map(Number); const d = new Date(y, m-1+n, 1); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); };
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sum = (list, type) => list.filter(t => t.type === type).reduce((s,t) => s + t.amount, 0);
  const inMonth = k => state.tx.filter(t => monthKey(t.date) === k);
  const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

  function setSync(mode, text){
    const pill = $('syncStatus');
    pill.classList.remove('connected','syncing','error');
    if(mode !== 'off') pill.classList.add(mode);
    $('syncStatusText').textContent = text;
  }

  function loadLocal(){
    try{ const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; }catch(e){ return []; }
  }
  function clean(list){
    return list.filter(t => t && typeof t.date === 'string' && t.date.length >= 7 && isFinite(+t.amount))
               .map(t => ({...t, amount:+t.amount, type: t.type === 'income' ? 'income' : 'expense', category: t.category || 'Other', description: t.description || ''}));
  }

  // ---------- data source: Firestore when signed in, local cache otherwise ----------
  let unsub = null;
  function start(){
    if(typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined'){
      setSync('error', 'Firebase not found — showing this device');
      return useLocal();
    }
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth(), db = firebase.firestore();
    auth.onAuthStateChanged(user => {
      if(unsub){ unsub(); unsub = null; }
      if(!user) return useLocal();
      $('localNote').hidden = true;
      setSync('syncing', 'Loading…');
      unsub = db.collection('users').doc(user.uid).collection('transactions').onSnapshot(snap => {
        state.tx = clean(snap.docs.map(d => d.data()));
        setSync('connected', 'Live · ' + (user.displayName || user.email || 'account'));
        refresh();
      }, err => {
        console.error('Firestore read error', err);
        state.tx = clean(loadLocal());
        setSync('error', 'Sync failed — showing local copy');
        refresh();
      });
    });
  }
  function useLocal(){
    state.tx = clean(loadLocal());
    $('localNote').hidden = false;
    setSync('off', 'Signed out — this device only');
    refresh();
  }

  // ---------- controls ----------
  function allMonthKeys(){
    const set = new Set(state.tx.map(t => monthKey(t.date)));
    set.add(monthKey(todayISO()));
    return [...set].sort();
  }
  function refresh(){
    const keys = allMonthKeys();
    if(!state.month || !keys.includes(state.month)) state.month = keys[keys.length-1];
    $('monthSel').innerHTML = keys.slice().reverse().map(k => `<option value="${k}"${k===state.month?' selected':''}>${monthLabel(k,true)}</option>`).join('');
    render();
  }
  $('monthSel').addEventListener('change', e => { state.month = e.target.value; render(); });
  $('rangeCtl').addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    state.range = b.dataset.range === 'all' ? 'all' : +b.dataset.range;
    $('rangeCtl').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    render();
  });
  window.addEventListener('themechange', () => { if(state.tx) render(true); });

  // ---------- range of months ending at the chosen month ----------
  function rangeKeys(){
    const keys = allMonthKeys();
    let n = state.range === 'all' ? null : state.range;
    const first = keys[0];
    const out = [];
    for(let i = 0; i < (n || 600); i++){
      const k = addMonths(state.month, -i);
      if(!n && k < first) break;
      out.unshift(k);
    }
    return out;
  }

  // ---------- count-up numbers ----------
  function setNum(el, value, fmt){
    if(reduceMotion || !firstPaint){ el.textContent = fmt(value); return; }
    const t0 = performance.now(), dur = 800;
    (function step(now){
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(value * (1 - Math.pow(1 - p, 3)));
      if(p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function delta(el, cur, prev, goodWhenUp, prevLabel){
    if(!prev){ el.innerHTML = prevLabel ? `<span>No data for ${prevLabel}</span>` : ''; return; }
    const pct = (cur - prev) / Math.abs(prev) * 100;
    if(!isFinite(pct)) { el.innerHTML = ''; return; }
    const up = pct >= 0, good = up === goodWhenUp;
    el.innerHTML = `<b class="${Math.abs(pct) < 0.5 ? '' : good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%</b> vs ${prevLabel}`;
  }

  // ---------- render ----------
  function render(themeOnly){
    const k = state.month, prevK = addMonths(k, -1);
    const cur = inMonth(k), prev = inMonth(prevK);
    const inc = sum(cur,'income'), exp = sum(cur,'expense'), net = inc - exp;
    const pInc = sum(prev,'income'), pExp = sum(prev,'expense'), pNet = pInc - pExp;
    const rate = inc > 0 ? net / inc * 100 : null;
    const pRate = pInc > 0 ? pNet / pInc * 100 : null;
    const pl = shortMonth(prevK);

    setNum($('kIncome'), inc, fmtMoney);
    setNum($('kExpense'), exp, fmtMoney);
    setNum($('kNet'), net, fmtMoney);
    $('kNet').classList.toggle('expense', net < 0);
    $('kNet').classList.toggle('neutral', net >= 0);
    if(rate === null) $('kRate').textContent = '—'; else setNum($('kRate'), rate, v => Math.round(v) + '%');
    delta($('dIncome'), inc, pInc, true, pl);
    delta($('dExpense'), exp, pExp, false, pl);
    delta($('dNet'), net, pNet, true, pl);
    $('dRate').innerHTML = rate === null ? 'No income filed this month'
      : pRate === null ? '' : `<b class="${rate >= pRate ? 'good' : 'bad'}">${rate >= pRate ? '▲' : '▼'} ${Math.abs(rate - pRate).toFixed(0)} pts</b> vs ${pl}`;

    renderInsights(cur, k);
    renderCharts(cur, k);
    firstPaint = false;
  }

  function renderInsights(cur, k){
    const keys = rangeKeys();
    const rows = keys.map(m => { const l = inMonth(m); return {m, inc:sum(l,'income'), exp:sum(l,'expense')}; });
    const withExp = rows.filter(r => r.exp > 0);
    const avg = withExp.length ? withExp.reduce((s,r) => s + r.exp, 0) / withExp.length : 0;
    const withData = rows.filter(r => r.inc || r.exp);
    const best = withData.length ? withData.reduce((b,r) => (r.inc - r.exp) > (b.inc - b.exp) ? r : b, withData[0]) : null;

    const catTotals = {};
    keys.forEach(m => inMonth(m).filter(t => t.type === 'expense').forEach(t => catTotals[t.category] = (catTotals[t.category]||0) + t.amount));
    const top = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0];

    const expenses = cur.filter(t => t.type === 'expense');
    const big = expenses.slice().sort((a,b) => b.amount - a.amount)[0];

    const [y,m] = k.split('-').map(Number);
    const isNow = k === monthKey(todayISO());
    const days = isNow ? new Date().getDate() : new Date(y, m, 0).getDate();
    const perDay = expenses.length ? sum(cur,'expense') / days : 0;

    const cards = [
      {l:'Average monthly spend', v: avg ? fmtMoney(avg) : '—', s: withExp.length ? `across ${withExp.length} month${withExp.length>1?'s':''} in range` : 'no expenses yet'},
      {l:'Best month', v: best ? monthLabel(best.m, true) : '—', s: best ? `${fmtMoney(best.inc - best.exp)} saved` : 'nothing on record'},
      {l:'Top spending category', v: top ? `${CAT_ICONS[top[0]]||''} ${top[0]}` : '—', s: top ? `${fmtMoney(top[1])} in range` : 'no expenses yet'},
      {l:'Average per day', v: perDay ? fmtMoney(perDay) : '—', s: big ? `largest: ${big.description.slice(0,22)} · ${fmtMoney(big.amount)}` : 'in ' + shortMonth(k)}
    ];
    $('insights').innerHTML = cards.map(c => `<div class="insight"><div class="insight-label">${c.l}</div><div class="insight-value">${esc(c.v)}</div><div class="insight-sub">${esc(c.s)}</div></div>`).join('');
  }

  // ---------- charts ----------
  function mount(id, config, empty){
    const canvas = $(id), msg = canvas.parentElement.querySelector('.chart-empty');
    if(charts[id]){ charts[id].destroy(); delete charts[id]; }
    canvas.style.display = empty ? 'none' : '';
    msg.hidden = !empty;
    if(empty) return;
    if(typeof Chart === 'undefined'){ canvas.style.display = 'none'; msg.hidden = false; msg.textContent = 'Charts could not load — check your connection.'; return; }
    config.options = Object.assign({responsive:true, maintainAspectRatio:false}, config.options);
    if(reduceMotion) config.options.animation = false;
    try{
      charts[id] = new Chart(canvas, config);
    }catch(err){
      console.error('Chart failed: ' + id, err);
      canvas.style.display = 'none';
      msg.hidden = false;
      msg.textContent = 'This chart could not be drawn.';
    }
  }

  function renderCharts(cur, k){
    const text = css('--text-dim'), grid = css('--border'), ink = css('--ink');
    const inc = css('--income'), exp = css('--expense'), gold = css('--gold'), surf = css('--surface-solid') || '#fff';
    const font = {family:"'Plus Jakarta Sans'", size:11.5};
    const tip = { backgroundColor:css('--surface-solid'), titleColor:ink, bodyColor:css('--text'), borderColor:css('--border-2'), borderWidth:1, padding:10, cornerRadius:10, boxPadding:4 };
    const legend = { position:'bottom', labels:{color:text, usePointStyle:true, boxWidth:8, boxHeight:8, padding:14, font} };
    const axis = { ticks:{color:text, font}, grid:{color:grid}, border:{display:false} };
    const money = ctx => ' ' + ctx.dataset.label + ': ' + fmtMoney(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed);
    Chart.defaults.font.family = "'Plus Jakarta Sans'";

    // 1. income vs expenses + net line
    const keys = rangeKeys();
    const rows = keys.map(m => { const l = inMonth(m); return {inc:sum(l,'income'), exp:sum(l,'expense')}; });
    $('trendSub').textContent = keys.length + (keys.length === 1 ? ' month' : ' months');
    mount('trendChart', {
      type:'bar',
      data:{ labels: keys.map(m => monthLabel(m)), datasets:[
        {type:'bar', label:'Income', data:rows.map(r=>r.inc), backgroundColor:inc, borderRadius:6, maxBarThickness:28},
        {type:'bar', label:'Expenses', data:rows.map(r=>r.exp), backgroundColor:exp, borderRadius:6, maxBarThickness:28},
        {type:'line', label:'Net saved', data:rows.map(r=>r.inc-r.exp), borderColor:gold, backgroundColor:gold, borderWidth:2.5, tension:0.35, pointRadius:3.5, pointBackgroundColor:gold}
      ]},
      options:{ interaction:{mode:'index', intersect:false},
        plugins:{legend, tooltip:{...tip, callbacks:{label:money}}},
        scales:{x:{...axis, grid:{display:false}}, y:{...axis, ticks:{...axis.ticks, callback:v=>'₹'+compact(v)}}} }
    }, !rows.some(r => r.inc || r.exp));

    // 2. category donut (selected month)
    const expenses = cur.filter(t => t.type === 'expense');
    const totals = {};
    expenses.forEach(t => totals[t.category] = (totals[t.category]||0) + t.amount);
    const cats = Object.entries(totals).sort((a,b) => b[1]-a[1]);
    $('catSub').textContent = monthLabel(k);
    mount('catChart', {
      type:'doughnut',
      data:{ labels:cats.map(c=>c[0]), datasets:[{data:cats.map(c=>c[1]), backgroundColor:cats.map((_,i)=>PALETTE[i%PALETTE.length]), borderColor:surf, borderWidth:3, hoverOffset:8}] },
      options:{ cutout:'66%', plugins:{legend, tooltip:{...tip, callbacks:{label:c=>' '+c.label+': '+fmtMoney(c.parsed)}}} }
    }, !cats.length);

    // 3. daily spend + running total
    const [y,m] = k.split('-').map(Number), dim = new Date(y, m, 0).getDate();
    const daily = Array(dim).fill(0);
    expenses.forEach(t => { const d = +t.date.slice(8,10); if(d>=1 && d<=dim) daily[d-1] += t.amount; });
    let run = 0; const cumul = daily.map(v => run += v);
    mount('dailyChart', {
      type:'bar',
      data:{ labels:daily.map((_,i)=>i+1), datasets:[
        {type:'bar', label:'Spent that day', data:daily, backgroundColor:exp+'cc', borderRadius:4, yAxisID:'y', order:2},
        {type:'line', label:'Running total', data:cumul, borderColor:gold, borderWidth:2.5, pointRadius:0, pointHoverRadius:5, tension:0.3, yAxisID:'y1', order:1}
      ]},
      options:{ interaction:{mode:'index', intersect:false},
        plugins:{legend, tooltip:{...tip, callbacks:{title:i=>shortMonth(k)+' '+i[0].label, label:money}}},
        scales:{ x:{...axis, grid:{display:false}, ticks:{...axis.ticks, maxTicksLimit:10}},
          y:{...axis, ticks:{...axis.ticks, callback:v=>'₹'+compact(v)}},
          y1:{position:'right', grid:{display:false}, border:{display:false}, ticks:{color:text, font, callback:v=>'₹'+compact(v)}} } }
    }, !expenses.length);

    // 4. biggest categories across the range
    const rt = {};
    keys.forEach(mk => inMonth(mk).filter(t=>t.type==='expense').forEach(t => rt[t.category] = (rt[t.category]||0) + t.amount));
    const top = Object.entries(rt).sort((a,b)=>b[1]-a[1]).slice(0,6);
    $('topSub').textContent = state.range === 'all' ? 'all time' : 'last ' + state.range + ' months';
    mount('topChart', {
      type:'bar',
      data:{ labels:top.map(c=>(CAT_ICONS[c[0]]||'')+' '+c[0]), datasets:[{label:'Spent', data:top.map(c=>c[1]), backgroundColor:top.map((_,i)=>PALETTE[i%PALETTE.length]), borderRadius:8, maxBarThickness:26}] },
      options:{ indexAxis:'y', plugins:{legend:{display:false}, tooltip:{...tip, callbacks:{label:c=>' '+fmtMoney(c.parsed.x)}}},
        scales:{ x:{...axis, ticks:{...axis.ticks, callback:v=>'₹'+compact(v)}}, y:{...axis, grid:{display:false}} } }
    }, !top.length);

    // 5. savings rate by month
    const rates = rows.map(r => r.inc > 0 ? Math.round((r.inc - r.exp) / r.inc * 1000) / 10 : null);
    const g = $('rateChart').getContext('2d').createLinearGradient(0,0,0,220);
    g.addColorStop(0, inc + '55'); g.addColorStop(1, inc + '00');
    mount('rateChart', {
      type:'line',
      data:{ labels:keys.map(mk=>monthLabel(mk)), datasets:[{label:'Savings rate', data:rates, borderColor:inc, backgroundColor:g, fill:true, tension:0.35, borderWidth:2.5, pointRadius:4, pointBackgroundColor:inc, spanGaps:true}] },
      options:{ interaction:{mode:'index', intersect:false}, plugins:{legend:{display:false}, tooltip:{...tip, callbacks:{label:c=>' '+c.parsed.y+'% of income kept'}}},
        scales:{ x:{...axis, grid:{display:false}}, y:{...axis, suggestedMin:0, suggestedMax:100, ticks:{...axis.ticks, callback:v=>v+'%'}} } }
    }, !rates.some(r => r !== null));
  }

  start();
})();
