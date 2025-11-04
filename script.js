/* Mini Web App — Gestionale Magazzino con Drive Sync, PDF e Logo */
/* Versione aggiornata con pulsante "Elimina Articolo" */

const LS_KEY = 'warehouse_app_v2';
const LOW_STOCK_THRESHOLD = 4;
const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxO_qN24tzT3Wz9dLeoRAnqz8IX6Hla9_oK9P8IauZxwMPNnd26osy25zyQhuyO6qAB/exec";

/* ---------------------------
   Store (database locale)
   --------------------------- */
let store = {
  items: [],
  transactions: [],
  snapshots: [],
  logoDataUrl: '',
  companyName: ''
};

/* ---------------------------
   Persistence
   --------------------------- */
function loadStore(){
  const raw = localStorage.getItem(LS_KEY);
  if(raw){
    try { store = JSON.parse(raw); }
    catch(e){ console.error('Errore caricamento dati:', e); localStorage.removeItem(LS_KEY); }
  }
}
function saveStore(){ localStorage.setItem(LS_KEY, JSON.stringify(store)); }

/* ---------------------------
   Utils
   --------------------------- */
function uid(){ return 'TX' + Date.now() + Math.floor(Math.random()*999); }
function fmt(n){ return Number(n||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function findItem(sku){ return store.items.find(i=>i.sku===sku); }

function computeInventory(){
  const map = {};
  store.items.forEach(it => { map[it.sku] = { ...it, in:0, out:0, broken:0 }; });
  store.transactions.forEach(tx=>{
    if(!map[tx.sku]) return;
    if(tx.type==='IN') map[tx.sku].in += Number(tx.qty);
    if(tx.type==='OUT') map[tx.sku].out += Number(tx.qty);
    if(tx.type==='ROTTURA') map[tx.sku].broken += Number(tx.qty);
  });
  return Object.values(map).map(it=>{
    const stock = Number(it.stockInit||0) + Number(it.in) - Number(it.out) - Number(it.broken);
    return {...it, stock, value: stock * Number(it.costPrice||0), soldTotal: it.out, brokenTotal: it.broken};
  });
}

/* ---------------------------
   UI Rendering
   --------------------------- */
const txSkuSelect = document.getElementById('txSku');
let trendChart;

function refreshSkuSelect(){
  txSkuSelect.innerHTML = '<option value="">-- seleziona SKU --</option>';
  store.items.forEach(it=>{
    const o = document.createElement('option'); o.value = it.sku; o.textContent = it.sku + ' — ' + it.name;
    txSkuSelect.appendChild(o);
  });
  document.getElementById('companyName').value = store.companyName || '';
}

function renderInventory(){
  const tbody = document.querySelector('#inventoryTable tbody');
  tbody.innerHTML = '';
  const rows = computeInventory();
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="small">${r.sku}</td>
      <td>${r.name}</td>
      <td class="small">${r.position||''}</td>
      <td>${r.stock} ${r.stock<=LOW_STOCK_THRESHOLD ? '<span class="low">BASSO</span>':''}</td>
      <td class="small">€ ${fmt(r.costPrice)}</td>
      <td class="small">€ ${fmt(r.value)}</td>
      <td>
        <button class="ghost" onclick="editItem('${r.sku}')">Modifica</button>
        <button class="danger" onclick="deleteItem('${r.sku}')">Elimina</button>
      </td>`;
    tbody.appendChild(tr);
  });

  const totalUnits = rows.reduce((s,r)=>s + Number(r.stock),0);
  const totalValue = rows.reduce((s,r)=>s + Number(r.value),0);
  const totalLoss = rows.reduce((s,r)=>s + (Number(r.brokenTotal||0)*Number(r.costPrice||0)),0);
  const totalSoldValue = store.transactions.filter(t=>t.type==='OUT' && t.confirmed).reduce((s,t)=>s + (Number(t.qty)*Number(t.price||0)),0);

  document.getElementById('statSkus').textContent = rows.length;
  document.getElementById('statUnits').textContent = totalUnits;
  document.getElementById('statValue').textContent = '€ ' + fmt(totalValue);
  document.getElementById('statLoss').textContent = '€ ' + fmt(totalLoss);
  document.getElementById('statSold').textContent = '€ ' + fmt(totalSoldValue);

  const low = rows.filter(r => r.stock <= LOW_STOCK_THRESHOLD && r.stock >= 0);
  const alertEl = document.getElementById('alertLow');
  if(low.length){
    alertEl.classList.remove('hidden');
    alertEl.innerHTML = '<strong>Attenzione — scorte basse:</strong><br>' + low.map(i=>`${i.sku} (${i.name}) — ${i.stock} pz`).join('<br>');
  } else { alertEl.classList.add('hidden'); }

  renderTrendChart(rows);
}

function renderTransactions(){
  const tbody = document.querySelector('#transactionsTable tbody');
  tbody.innerHTML = '';
  store.transactions.slice().reverse().forEach(tx=>{
    const tr = document.createElement('tr');
    const d = new Date(tx.ts);
    tr.innerHTML = `<td class="small">${d.toLocaleString()}</td>
      <td class="small">${tx.sku}</td>
      <td class="small">${tx.type}</td>
      <td>${tx.qty}</td>
      <td class="small">${tx.price?('€ ' + fmt(tx.price)) : ''}</td>
      <td class="small">${tx.confirmed ? 'SI' : 'NO'}</td>
      <td><button class="ghost" onclick="editTx('${tx.id}')">Modifica</button>
          ${tx.confirmed ? '' : `<button onclick="confirmTx('${tx.id}')">Conferma</button>`}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------------------------
   Funzioni articoli
   --------------------------- */
function editItem(sku){
  const it = findItem(sku);
  if(!it) return;
  document.getElementById('sku').value = it.sku;
  document.getElementById('name').value = it.name;
  document.getElementById('position').value = it.position;
  document.getElementById('stockInit').value = it.stockInit;
  document.getElementById('costPrice').value = it.costPrice;
  document.getElementById('sellPrice').value = it.sellPrice;
  window.scrollTo({top:0,behavior:'smooth'});
}

function deleteItem(sku){
  if(!confirm(`Vuoi davvero eliminare l'articolo con SKU: ${sku}?`)) return;
  store.items = store.items.filter(it => it.sku !== sku);
  store.transactions = store.transactions.filter(tx => tx.sku !== sku);
  saveStore();
  refreshAll();
  alert(`Articolo ${sku} eliminato con successo.`);
}

/* ---------------------------
   Transazioni
   --------------------------- */
function addTransaction(){
  const sku = document.getElementById('txSku').value;
  const type = document.getElementById('txType').value;
  const qty = Number(document.getElementById('txQty').value);
  const price = Number(document.getElementById('txSellPrice').value || 0);
  if(!sku || !qty){ alert('Dati mancanti'); return; }

  store.transactions.push({
    id: uid(),
    ts: Date.now(),
    sku, type, qty, price,
    confirmed: (type!=='OUT')
  });
  saveStore();
  refreshAll();
}

function confirmTx(id){
  const tx = store.transactions.find(t=>t.id===id);
  if(tx){ tx.confirmed = true; saveStore(); refreshAll(); }
}

/* ---------------------------
   Grafico
   --------------------------- */
function renderTrendChart(rows){
  const now = new Date();
  const totalUnits = rows.reduce((s,r)=>s + Number(r.stock),0);
  store.snapshots.push({ ts: now.getTime(), totalUnits });
  if(store.snapshots.length > 50) store.snapshots.shift();
  saveStore();

  const ctx = document.getElementById('trendChart');
  if(trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: store.snapshots.map(s => new Date(s.ts).toLocaleTimeString()),
      datasets: [{
        label: 'Totale unità in magazzino',
        data: store.snapshots.map(s=>s.totalUnits),
        borderWidth: 2,
        fill: false
      }]
    },
    options: { responsive:true, scales:{ y:{ beginAtZero:true } } }
  });
}

/* ---------------------------
   Export / Import / PDF / Sync
   --------------------------- */
function exportJson(){
  const blob = new Blob([JSON.stringify(store)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'magazzino.json'; a.click();
  URL.revokeObjectURL(url);
}

function importJson(file){
  const reader = new FileReader();
  reader.onload = e => {
    try{
      store = JSON.parse(e.target.result);
      saveStore(); refreshAll();
    }catch(err){ alert('File non valido'); }
  };
  reader.readAsText(file);
}

function exportPdf(){
  const area = document.body;
  html2canvas(area).then(canvas=>{
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jspdf.jsPDF('p','mm','a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const imgWidth = pageWidth;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    pdf.save('magazzino.pdf');
  });
}

async function syncNow(){
  if(!WEBAPP_URL){ alert('Nessun URL WebApp impostato'); return; }
  try{
    await fetch(WEBAPP_URL, {
      method:'POST',
      body: JSON.stringify(store),
      headers:{'Content-Type':'application/json'}
    });
    alert('Sincronizzazione completata.');
  }catch(e){ alert('Errore di sincronizzazione.'); }
}

/* ---------------------------
   Eventi UI
   --------------------------- */
document.getElementById('addItemBtn').addEventListener('click', ()=>{
  const sku = document.getElementById('sku').value.trim();
  if(!sku){ alert('Inserisci SKU'); return; }
  const name = document.getElementById('name').value.trim();
  const position = document.getElementById('position').value.trim();
  const stockInit = Number(document.getElementById('stockInit').value || 0);
  const costPrice = Number(document.getElementById('costPrice').value || 0);
  const sellPrice = Number(document.getElementById('sellPrice').value || 0);
  const existing = findItem(sku);
  if(existing){
    existing.name = name; existing.position = position; existing.stockInit = stockInit; existing.costPrice = costPrice; existing.sellPrice = sellPrice;
  } else {
    store.items.push({ sku, name, position, stockInit, costPrice, sellPrice });
  }
  saveStore(); refreshAll();
  document.getElementById('clearItemBtn').click();
});

document.getElementById('clearItemBtn').addEventListener('click', ()=>{
  ['sku','name','position','stockInit','costPrice','sellPrice'].forEach(id=>document.getElementById(id).value='');
});

document.getElementById('addTxBtn').addEventListener('click', addTransaction);
document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
document.getElementById('importJsonBtn').addEventListener('click', ()=>document.getElementById('jsonFileInput').click());
document.getElementById('jsonFileInput').addEventListener('change', e=>importJson(e.target.files[0]));
document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);
document.getElementById('syncNowBtn').addEventListener('click', syncNow);

/* ---------------------------
   Inizializzazione
   --------------------------- */
function refreshAll(){
  refreshSkuSelect();
  renderInventory();
  renderTransactions();
}
window.onload = function(){
  loadStore();
  refreshAll();
};
window.editItem = editItem;
window.deleteItem = deleteItem;
window.confirmTx = confirmTx;