import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase, ref, onValue, push, set, update, remove, get } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyA9hxi8keOUJG_mhdD4OSN32A1jypXrXEA",
  authDomain: "grading-dura.firebaseapp.com",
  projectId: "grading-dura",
  storageBucket: "grading-dura.firebasestorage.app",
  messagingSenderId: "455000354944",
  appId: "1:455000354944:web:69b96169f6174ec5a8b665",
  measurementId: "G-9J29KM9NHC"
};

const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch {}
const auth = getAuth(app);
const db = getDatabase(app);

const USERS = {
  staff: { role: "staff", email: "staff@dura.local", displayName: "Staff" },
  grading: { role: "grading", email: "grading@dura.local", displayName: "Grading" }
};
const ROLE_EMAILS = Object.fromEntries(Object.entries(USERS).map(([k,v])=>[k,v.email]));
const LEGACY_KEYS = ["ptksd_full_complex_v1","ptksd_full_complex_v2","grading_dura_state","grading_dura_app","pt_kedap_saayaq_dua"];

const defaultSuppliers = [
  { id: uid(), name: "CV LEMBAH HIJAU PERKASA", status: "active" },
  { id: uid(), name: "KOPERASI KARYA MANDIRI", status: "active" },
  { id: uid(), name: "TANI RAMPAH JAYA", status: "active" },
  { id: uid(), name: "PT PUTRA UTAMA LESTARI", status: "active" },
  { id: uid(), name: "PT MANUNGGAL ADI JAYA", status: "active" }
];

const pageMeta = {
  dashboard:["Dashboard","Ringkasan operasional grading, Tenera Dura, supplier, dan sopir."],
  grading:["Input Grading","Fokus utama pada % kematangan dan total potongan."],
  td:["Input Tenera Dura","Modul terpisah dari grading."],
  rekapGrading:["Rekap Grading","Data grading lengkap per transaksi."],
  rekapTD:["Rekap Tenera Dura","Data Tenera Dura lengkap per transaksi."],
  rekapData:["Rekap Data","Kesimpulan otomatis berdasarkan filter tanggal."],
  sheetGrading:["Spreadsheet Grading","Tarikan spreadsheet detail satu kolom satu data."],
  sheetTD:["Spreadsheet Tenera Dura","Spreadsheet detail untuk Tenera Dura."],
  performance:["Performance","Ranking grading, TD, dan gabungan."],
  analytics:["Analytics","Penyebab potongan dan insight manajerial."],
  supplier:["Supplier","Kelola master supplier."]
};

const state = { suppliers: [], grading: [], td: [], loading: true, user: null, synced: false, supplierReady: false };
let currentRole = "grading";
let selectedLoginRole = "staff";
let waContext = { module: "grading", kind: "summary" };

function uid(){ return "id-" + Math.random().toString(36).slice(2,9) + Date.now().toString(36); }
function num(v){ return Number(v || 0); }
function fixed(v){ return Number(v || 0).toFixed(2); }
function pct(v){ return `${fixed(v)}%`; }
function escapeHtml(s){ return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function dt(iso){ const d=new Date(iso); return {date:d.toLocaleDateString("id-ID"), time:d.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}; }
function dateOnly(iso){ return new Date(iso).toISOString().slice(0,10); }
function metric(label,val){ return `<div class="metric"><span>${label}</span><strong>${val}</strong></div>`; }
function stat(title,meta,score=0){ return `<div class="stat"><strong>${escapeHtml(title)}</strong><div class="meta">${meta}</div><div class="bar"><div style="width:${Math.min(100, Math.max(8, Math.abs(score)*4))}%"></div></div></div>`; }

function setStatus(message, type="info"){
  const el = document.getElementById("appStatus");
  if(!message){ el.className = "alert info hidden"; el.textContent = ""; return; }
  el.className = `alert ${type}`;
  el.textContent = message;
}
function currentUserMeta(){
  if(!state.user?.email) return null;
  return Object.values(USERS).find(x=>x.email===state.user.email) || null;
}

function readLegacySuppliers(){
  for(const key of LEGACY_KEYS){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) continue;
      const parsed = JSON.parse(raw);
      const suppliers = Array.isArray(parsed?.suppliers) ? parsed.suppliers : [];
      if(suppliers.length){
        return suppliers
          .filter(s=>s && (s.name || s.supplierName))
          .map(s=>({ id:s.id || uid(), name:String(s.name || s.supplierName).trim(), status:s.status || "active" }))
          .filter(s=>s.name);
      }
    }catch{}
  }
  return [];
}

async function ensureUsersNode(user){
  if(!user?.uid || !user?.email) return;
  const meta = Object.values(USERS).find(x=>x.email===user.email);
  if(!meta) return;
  await set(ref(db, `users/${user.uid}`), {
    uid: user.uid,
    email: user.email,
    role: meta.role,
    displayName: meta.displayName,
    lastLoginAt: new Date().toISOString()
  });
}


function setLoginRole(role){
  selectedLoginRole = role;
  document.querySelectorAll(".role-pick").forEach(btn=>btn.classList.toggle("active", btn.dataset.role===role));
  document.getElementById("loginEmail").value = ROLE_EMAILS[role];
  document.getElementById("loginInfo").textContent = `Masuk sebagai ${USERS[role].displayName} dengan email ${USERS[role].email}`;
  document.getElementById("loginError").classList.add("hidden");
}

document.querySelectorAll(".role-pick").forEach(btn=>btn.addEventListener("click",()=>setLoginRole(btn.dataset.role)));
setLoginRole("staff");

async function ensureSupplierSeed(){
  const snap = await get(ref(db, "suppliers"));
  const existing = normalizeCollection(snap.val());
  if(existing.length){
    state.supplierReady = true;
    return;
  }

  const legacySuppliers = readLegacySuppliers();
  const seedSource = legacySuppliers.length ? legacySuppliers : defaultSuppliers;
  const payload = {};
  seedSource.forEach(s=>payload[s.id] = { id:s.id, name:s.name, status:s.status || "active" });
  await set(ref(db, "suppliers"), payload);
  state.supplierReady = true;
  setStatus(legacySuppliers.length ? "Supplier lama berhasil dipindahkan ke Firebase." : "Supplier awal berhasil dibuat di Firebase.", "info");
}

function normalizeCollection(obj){
  return Object.entries(obj || {}).map(([id, value])=>({ id, ...(value||{}) }));
}

function subscribeData(){
  setStatus("Memuat data realtime dari Firebase...");
  onValue(ref(db, "suppliers"), snap=>{
    state.suppliers = normalizeCollection(snap.val()).sort((a,b)=>a.name.localeCompare(b.name));
    state.loading = false;
    state.synced = true;
    fillStatic();
    refreshAll();
    setStatus("");
  }, ()=>setStatus("Gagal memuat supplier dari Firebase.", "error"));
  onValue(ref(db, "grading"), snap=>{
    state.grading = normalizeCollection(snap.val()).sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0));
    refreshAll();
  }, ()=>setStatus("Gagal memuat data grading dari Firebase.", "error"));
  onValue(ref(db, "td"), snap=>{
    state.td = normalizeCollection(snap.val()).sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0));
    refreshAll();
  }, ()=>setStatus("Gagal memuat data Tenera Dura dari Firebase.", "error"));
}

function activeSuppliers(){ return state.suppliers.filter(s => s.status === "active"); }
function driverNames(){ return [...new Set([...state.grading.map(x=>x.driver), ...state.td.map(x=>x.driver)].filter(Boolean))].sort(); }

function calculateGrading(data){
  const totalBunches = num(data.totalBunches);
  const mentah=num(data.mentah), mengkal=num(data.mengkal), overripe=num(data.overripe), busuk=num(data.busuk), kosong=num(data.kosong), partheno=num(data.partheno), tikus=num(data.tikus);
  const totalCategories = mentah+mengkal+overripe+busuk+kosong+partheno+tikus;
  const masak = totalBunches-totalCategories;
  const toPct = v => totalBunches>0 ? (v/totalBunches)*100 : 0;
  const percentages = { masak:toPct(Math.max(masak,0)), mentah:toPct(mentah), mengkal:toPct(mengkal), overripe:toPct(overripe), busuk:toPct(busuk), kosong:toPct(kosong), partheno:toPct(partheno), tikus:toPct(tikus) };
  const deductions = {
    dasar:3, mentah:percentages.mentah*0.5, mengkal:percentages.mengkal*0.15,
    overripe:percentages.overripe>5 ? (percentages.overripe-5)*0.25 : 0,
    busuk:percentages.busuk, kosong:percentages.kosong, partheno:percentages.partheno*0.15, tikus:percentages.tikus*0.15
  };
  const totalDeduction = Object.values(deductions).reduce((a,b)=>a+b,0);
  let validation = {type:"info", message:"Perhitungan siap disimpan."};
  if(totalCategories>totalBunches) validation = {type:"error", message:"ERROR: Total kategori melebihi Total Janjang."};
  else if(masak<0) validation = {type:"error", message:"ERROR: Masak otomatis negatif."};
  else if(!data.driver || !data.plate || !data.supplier || totalBunches<=0) validation = {type:"warning", message:"WARNING: Lengkapi field wajib dan pastikan input logis."};
  let status="BAIK", statusClass="ok";
  if(totalDeduction>15){ status="BURUK"; statusClass="bad"; }
  else if(totalDeduction>8){ status="PERLU PERHATIAN"; statusClass="warn"; }
  return { totalBunches, mentah, mengkal, overripe, busuk, kosong, partheno, tikus, masak, percentages, deductions, totalDeduction, status, statusClass, validation };
}
function calculateTD(data){
  const tenera=num(data.tenera), dura=num(data.dura), total=tenera+dura;
  const pctTenera = total>0 ? (tenera/total)*100 : 0;
  const pctDura = total>0 ? (dura/total)*100 : 0;
  return { tenera, dura, total, pctTenera, pctDura };
}

function fillStatic(){
  const activeOptions = activeSuppliers();
  document.getElementById("gradingSupplier").innerHTML = '<option value="">' + (activeOptions.length ? 'Pilih supplier' : 'Supplier belum tersedia') + '</option>' + activeOptions.map(s=>`<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
  const supplierOptions = '<option value="">Semua Supplier</option>' + state.suppliers.map(s=>`<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
  document.getElementById("rekapGradingSupplier").innerHTML = supplierOptions;
  document.getElementById("rekapDataSupplier").innerHTML = supplierOptions;
  document.getElementById("waSupplier").innerHTML = supplierOptions;
  const opts = driverNames().map(n=>`<option value="${escapeHtml(n)}"></option>`).join("");
  document.getElementById("driverList").innerHTML = opts;
  document.getElementById("tdDriverList").innerHTML = opts;
}

function applyRoleUI(){
  document.getElementById("roleLabel").textContent = currentRole.toUpperCase();
  document.getElementById("userEmail").textContent = state.user?.email || ROLE_EMAILS[currentRole];
  document.querySelectorAll(".staff-only,.staff-only-page").forEach(el=>el.classList.toggle("hidden", currentRole!=="staff"));
  if(currentRole!=="staff"){
    const active = document.querySelector(".menu-item.active")?.dataset.page;
    if(["sheetGrading","sheetTD","performance","analytics","supplier"].includes(active)) switchPage("dashboard");
  }
}

function switchPage(page){
  document.querySelectorAll(".menu-item").forEach(b=>b.classList.remove("active"));
  const btn = document.querySelector(`.menu-item[data-page="${page}"]`);
  if(btn) btn.classList.add("active");
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  document.getElementById("pageTitle").textContent = pageMeta[page][0];
  document.getElementById("pageSubtitle").textContent = pageMeta[page][1];
  document.getElementById("summaryCards").classList.toggle("hidden", page !== "dashboard");
  closeSidebarOnMobile();
}

function supplierStats(rows=state.grading){
  const map={};
  rows.forEach(r=>{
    if(!map[r.supplier]) map[r.supplier] = { name:r.supplier, count:0, totalJanjang:0, masakPct:0, totalDed:0, maxDed:-Infinity, minDed:Infinity };
    const x=map[r.supplier]; x.count++; x.totalJanjang+=num(r.totalBunches); x.masakPct+=num(r.percentages?.masak); x.totalDed+=num(r.totalDeduction); x.maxDed=Math.max(x.maxDed,num(r.totalDeduction)); x.minDed=Math.min(x.minDed,num(r.totalDeduction));
  });
  return Object.values(map).map(x=>({...x, avgMasak:x.count?x.masakPct/x.count:0, avgDed:x.count?x.totalDed/x.count:0})).sort((a,b)=>a.avgDed-b.avgDed);
}
function driverStats(rows=state.grading){
  const map={};
  rows.forEach(r=>{
    if(!map[r.driver]) map[r.driver] = { name:r.driver, count:0, totalJanjang:0, masakPct:0, totalDed:0, suppliers:{} };
    const x=map[r.driver]; x.count++; x.totalJanjang+=num(r.totalBunches); x.masakPct+=num(r.percentages?.masak); x.totalDed+=num(r.totalDeduction); x.suppliers[r.supplier]=(x.suppliers[r.supplier]||0)+1;
  });
  return Object.values(map).map(x=>({...x, avgMasak:x.count?x.masakPct/x.count:0, avgDed:x.count?x.totalDed/x.count:0, topSupplier:Object.entries(x.suppliers).sort((a,b)=>b[1]-a[1])[0]?.[0]||"-"})).sort((a,b)=>b.totalJanjang-a.totalJanjang);
}
function tdDriverStats(rows=state.td){
  const map={};
  rows.forEach(r=>{
    if(!map[r.driver]) map[r.driver] = { name:r.driver, count:0, total:0, totalTenera:0, totalDura:0, plates:{} };
    const x=map[r.driver]; x.count++; x.total+=num(r.total); x.totalTenera+=num(r.pctTenera); x.totalDura+=num(r.pctDura); x.plates[r.plate]=(x.plates[r.plate]||0)+1;
  });
  return Object.values(map).map(x=>({...x, avgTenera:x.count?x.totalTenera/x.count:0, avgDura:x.count?x.totalDura/x.count:0, topPlate:Object.entries(x.plates).sort((a,b)=>b[1]-a[1])[0]?.[0]||"-"})).sort((a,b)=>b.total-a.total);
}
function causeTotals(rows=state.grading){
  const out={mentah:0,mengkal:0,overripe:0,busuk:0,kosong:0,partheno:0,tikus:0};
  rows.forEach(r=>Object.keys(out).forEach(k=>out[k]+=num(r.deductions?.[k])));
  return out;
}
function insights(rows=state.grading){
  if(!rows.length) return ["Belum ada data grading. Mulai input transaksi pertama."];
  const avgMasak = rows.reduce((a,x)=>a+num(x.percentages?.masak),0)/rows.length;
  const avgDed = rows.reduce((a,x)=>a+num(x.totalDeduction),0)/rows.length;
  const worst = [...rows].sort((a,b)=>num(b.totalDeduction)-num(a.totalDeduction))[0];
  const cause = Object.entries(causeTotals(rows)).sort((a,b)=>b[1]-a[1])[0];
  return [
    `Rata-rata kematangan saat ini ${pct(avgMasak)}.`,
    `Rata-rata total potongan saat ini ${pct(avgDed)}.`,
    worst ? `Potongan tertinggi berasal dari ${worst.driver} (${pct(worst.totalDeduction)}).` : "Belum ada potongan tertinggi.",
    cause ? `Penyebab potongan terbesar adalah ${cause[0]} (${pct(cause[1])}).` : "Belum ada penyebab dominan."
  ];
}

function renderSummaryCards(){
  const g=state.grading, td=state.td;
  const totalJanjang=g.reduce((a,x)=>a+num(x.totalBunches),0);
  const avgMasak=g.length?g.reduce((a,x)=>a+num(x.percentages?.masak),0)/g.length:0;
  const avgDed=g.length?g.reduce((a,x)=>a+num(x.totalDeduction),0)/g.length:0;
  const avgT=td.length?td.reduce((a,x)=>a+num(x.pctTenera),0)/td.length:0;
  document.getElementById("summaryCards").innerHTML = `
    <div class="summary-card"><span class="label">Total Janjang</span><span class="value">${totalJanjang}</span><span class="sub">Akumulasi grading</span></div>
    <div class="summary-card"><span class="label">Rata-rata % Masak</span><span class="value">${pct(avgMasak)}</span><span class="sub">Fokus kematangan</span></div>
    <div class="summary-card hot"><span class="label">Rata-rata Potongan</span><span class="value">${pct(avgDed)}</span><span class="sub">Fokus utama UI</span></div>
    <div class="summary-card"><span class="label">Rata-rata % Tenera</span><span class="value">${pct(avgT)}</span><span class="sub">Modul Tenera Dura</span></div>`;
}

function renderDashboard(){
  const g=state.grading, td=state.td;
  const avgMasak=g.length?g.reduce((a,x)=>a+num(x.percentages?.masak),0)/g.length:0;
  const avgDed=g.length?g.reduce((a,x)=>a+num(x.totalDeduction),0)/g.length:0;
  const avgT=td.length?td.reduce((a,x)=>a+num(x.pctTenera),0)/td.length:0;
  const avgD=td.length?td.reduce((a,x)=>a+num(x.pctDura),0)/td.length:0;
  document.getElementById("dashGrading").innerHTML = [metric("Transaksi",g.length), metric("Rata-rata % Masak",pct(avgMasak)), metric("Rata-rata Potongan",pct(avgDed)), metric("Total Janjang",g.reduce((a,x)=>a+num(x.totalBunches),0))].join("");
  document.getElementById("dashTD").innerHTML = [metric("Data TD",td.length), metric("Rata-rata % Tenera",pct(avgT)), metric("Rata-rata % Dura",pct(avgD)), metric("Total TD",td.reduce((a,x)=>a+num(x.total),0))].join("");
  document.getElementById("dashInsights").innerHTML = insights().map(t=>`<div class="stat">${t}</div>`).join("");
  document.getElementById("dashSuppliers").innerHTML = supplierStats().slice(0,6).map(x=>stat(x.name,`Transaksi: ${x.count} | % Masak: ${pct(x.avgMasak)} | Potongan: ${pct(x.avgDed)}`,x.avgMasak)).join("") || `<div class="stat">Belum ada data supplier.</div>`;
  document.getElementById("dashDrivers").innerHTML = driverStats().slice(0,6).map(x=>stat(x.name,`Janjang: ${x.totalJanjang} | Supplier utama: ${x.topSupplier} | Potongan: ${pct(x.avgDed)}`,x.avgMasak)).join("") || `<div class="stat">Belum ada data sopir.</div>`;
}

function historyHint(name){
  const last=[...state.grading].find(x=>x.driver?.toLowerCase()===name.toLowerCase());
  if(!last){ document.getElementById("driverHint").textContent="Belum ada histori sopir."; return; }
  document.getElementById("gradingPlate").value = last.plate || "";
  document.getElementById("gradingSupplier").value = last.supplier || "";
  document.getElementById("driverHint").textContent = `Histori terakhir: Plat ${last.plate} | Supplier ${last.supplier}`;
}

function renderGradingLive(){
  const data=Object.fromEntries(new FormData(document.getElementById("gradingForm")).entries());
  const calc=calculateGrading(data);
  document.getElementById("gradingTotalDeduction").textContent = pct(calc.totalDeduction);
  const st=document.getElementById("gradingStatus"); st.textContent=calc.status; st.className=`status ${calc.statusClass}`;
  document.getElementById("gradingLiveCards").innerHTML = [metric("% Masak",pct(calc.percentages.masak)),metric("% Mentah",pct(calc.percentages.mentah)),metric("% Mengkal",pct(calc.percentages.mengkal)),metric("% Overripe",pct(calc.percentages.overripe))].join("");
  const map = [
    ["Masak",calc.masak,calc.percentages.masak,0],["Mentah",calc.mentah,calc.percentages.mentah,calc.deductions.mentah],["Mengkal",calc.mengkal,calc.percentages.mengkal,calc.deductions.mengkal],["Overripe",calc.overripe,calc.percentages.overripe,calc.deductions.overripe],["Busuk",calc.busuk,calc.percentages.busuk,calc.deductions.busuk],["Tandan Kosong",calc.kosong,calc.percentages.kosong,calc.deductions.kosong],["Parthenocarpi",calc.partheno,calc.percentages.partheno,calc.deductions.partheno],["Makan Tikus",calc.tikus,calc.percentages.tikus,calc.deductions.tikus],["Potongan Dasar","-","-",calc.deductions.dasar]
  ];
  document.getElementById("gradingBreakdown").innerHTML = map.map(([label,j,p,d])=>`<tr><td>${label}</td><td>${j}</td><td>${typeof p==='number'?pct(p):p}</td><td>${pct(d)}</td></tr>`).join("");
  const v=document.getElementById("gradingValidation"); v.textContent=calc.validation.message; v.className=`alert ${calc.validation.type}`;
}

function renderTDLive(){
  const data=Object.fromEntries(new FormData(document.getElementById("tdForm")).entries());
  const calc=calculateTD(data);
  document.getElementById("tdTotal").textContent = calc.total;
  document.getElementById("tdPctTenera").textContent = pct(calc.pctTenera);
  document.getElementById("tdPctDura").textContent = pct(calc.pctDura);
  document.getElementById("tdDominant").textContent = calc.pctTenera===calc.pctDura?"-":calc.pctTenera>calc.pctDura?"Tenera":"Dura";
  document.getElementById("tdBarTenera").style.width = `${calc.pctTenera}%`;
  document.getElementById("tdBarDura").style.width = `${calc.pctDura}%`;
  document.getElementById("tdDonut").style.background = `conic-gradient(var(--primary) ${calc.pctTenera*3.6}deg,#efc56e 0)`;
  document.getElementById("tdDonutText").textContent = pct(calc.pctTenera);
}

function filterDate(rows,start,end){
  return rows.filter(r=>{
    const d = dateOnly(r.createdAt);
    if(start && d<start) return false;
    if(end && d>end) return false;
    return true;
  });
}
function getFilteredGrading(){
  let rows = filterDate(state.grading, document.getElementById("rekapGradingStart").value, document.getElementById("rekapGradingEnd").value);
  const q=document.getElementById("rekapGradingSearch").value.toLowerCase(), s=document.getElementById("rekapGradingSupplier").value;
  rows = rows.filter(r=>(!q || `${r.driver} ${r.plate} ${r.supplier}`.toLowerCase().includes(q)) && (!s || r.supplier===s));
  return rows;
}
function renderRekapGrading(){
  const rows = getFilteredGrading();
  document.getElementById("rekapGradingTable").innerHTML = rows.map(r=>{const n=dt(r.createdAt); return `<tr data-detail-type="grading" data-detail-id="${r.id}"><td>${n.date}</td><td>${n.time}</td><td>${escapeHtml(r.driver)}</td><td>${escapeHtml(r.plate)}</td><td>${escapeHtml(r.supplier)}</td><td>${r.totalBunches}</td><td>${pct(r.percentages.masak)}</td><td>${pct(r.totalDeduction)}</td><td>${r.revised?'Revisi':'-'}</td></tr>`;}).join("") || `<tr><td colspan="9">Tidak ada data grading.</td></tr>`;
}
function getFilteredTD(){
  let rows = filterDate(state.td, document.getElementById("rekapTDStart").value, document.getElementById("rekapTDEnd").value);
  const q=document.getElementById("rekapTDSearch").value.toLowerCase();
  rows = rows.filter(r=>!q || `${r.driver} ${r.plate}`.toLowerCase().includes(q));
  return rows;
}
function renderRekapTD(){
  const rows = getFilteredTD();
  document.getElementById("rekapTDTable").innerHTML = rows.map(r=>{const n=dt(r.createdAt); return `<tr data-detail-type="td" data-detail-id="${r.id}"><td>${n.date}</td><td>${n.time}</td><td>${escapeHtml(r.driver)}</td><td>${escapeHtml(r.plate)}</td><td>${r.tenera}</td><td>${r.dura}</td><td>${pct(r.pctTenera)}</td><td>${pct(r.pctDura)}</td><td>${r.revised?'Revisi':'-'}</td></tr>`;}).join("") || `<tr><td colspan="9">Tidak ada data Tenera Dura.</td></tr>`;
}

function getRekapDataFiltered(){
  const start=document.getElementById("rekapDataStart").value, end=document.getElementById("rekapDataEnd").value, supplier=document.getElementById("rekapDataSupplier").value, driver=document.getElementById("rekapDataDriver").value.toLowerCase();
  const g = filterDate(state.grading,start,end).filter(r=>(!supplier || r.supplier===supplier) && (!driver || r.driver.toLowerCase().includes(driver)));
  const td = filterDate(state.td,start,end).filter(r=>!driver || r.driver.toLowerCase().includes(driver));
  return {start,end,g,td};
}
function renderRekapData(){
  const {start,end,g,td} = getRekapDataFiltered();
  const avgMasak = g.length?g.reduce((a,x)=>a+num(x.percentages.masak),0)/g.length:0;
  const avgDed = g.length?g.reduce((a,x)=>a+num(x.totalDeduction),0)/g.length:0;
  const avgT = td.length?td.reduce((a,x)=>a+num(x.pctTenera),0)/td.length:0;
  const avgD = td.length?td.reduce((a,x)=>a+num(x.pctDura),0)/td.length:0;
  const cause = Object.entries(causeTotals(g)).sort((a,b)=>b[1]-a[1])[0]?.[0] || "-";
  const bestSupplier = supplierStats(g)[0]?.name || "-";
  const topDriver = driverStats(g)[0]?.name || "-";
  const topTDDriver = tdDriverStats(td)[0]?.name || "-";
  document.getElementById("rekapDataGradingSummary").innerHTML = [stat("Periode", `${start||'-'} s/d ${end||'-'}`),stat("Transaksi", `${g.length} transaksi | Total Janjang: ${g.reduce((a,x)=>a+num(x.totalBunches),0)}`),stat("Kematangan", `Rata-rata % Masak: ${pct(avgMasak)}`, avgMasak),stat("Potongan", `Rata-rata Potongan: ${pct(avgDed)} | Penyebab: ${cause}`, avgDed),stat("Highlight", `Supplier terbaik: ${bestSupplier} | Sopir terbanyak: ${topDriver}`)].join("");
  document.getElementById("rekapDataTDSummary").innerHTML = [stat("Periode", `${start||'-'} s/d ${end||'-'}`),stat("Transaksi TD", `${td.length} transaksi | Total TD: ${td.reduce((a,x)=>a+num(x.total),0)}`),stat("Komposisi", `Rata-rata % Tenera: ${pct(avgT)} | Rata-rata % Dura: ${pct(avgD)}`, avgT),stat("Highlight", `Sopir TD terbanyak: ${topTDDriver}`)].join("");
  document.getElementById("rekapDataSupplierTable").innerHTML = supplierStats(g).map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${x.count}</td><td>${x.totalJanjang}</td><td>${pct(x.avgMasak)}</td><td>${pct(x.avgDed)}</td></tr>`).join("") || `<tr><td colspan="5">Tidak ada data supplier.</td></tr>`;
  const tdStats = tdDriverStats(td);
  const drows = driverStats(g).map(x=>({...x, tdCount: tdStats.find(t=>t.name===x.name)?.count || 0}));
  document.getElementById("rekapDataDriverTable").innerHTML = drows.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${x.count}</td><td>${x.totalJanjang}</td><td>${pct(x.avgMasak)}</td><td>${x.tdCount}</td></tr>`).join("") || `<tr><td colspan="5">Tidak ada data sopir.</td></tr>`;
}

function renderSheetGrading(){
  const q=document.getElementById("sheetGradingSearch").value.toLowerCase();
  const rows=state.grading.filter(r=>!q || JSON.stringify(r).toLowerCase().includes(q));
  const cols=[ ["date","Tanggal"],["time","Jam"],["driver","Sopir"],["plate","Plat"],["supplier","Supplier"],["totalBunches","Total Janjang"],["masak","Masak"],["pctMasak","% Masak"],["mentah","Mentah"],["pctMentah","% Mentah"],["mengkal","Mengkal"],["pctMengkal","% Mengkal"],["overripe","Overripe"],["pctOverripe","% Overripe"],["busuk","Busuk"],["pctBusuk","% Busuk"],["kosong","Tandan Kosong"],["pctKosong","% Tandan Kosong"],["partheno","Parthenocarpi"],["pctPartheno","% Parthenocarpi"],["tikus","Makan Tikus"],["pctTikus","% Makan Tikus"],["totalDeduction","Total Potongan"],["revised","Revisi"],["action","Aksi"] ];
  document.getElementById("sheetGradingTable").innerHTML = `<thead><tr>${cols.map(c=>`<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>{ const n=dt(r.createdAt); const v={date:n.date,time:n.time,driver:r.driver,plate:r.plate,supplier:r.supplier,totalBunches:r.totalBunches,masak:r.masak,pctMasak:fixed(r.percentages.masak),mentah:r.mentah,pctMentah:fixed(r.percentages.mentah),mengkal:r.mengkal,pctMengkal:fixed(r.percentages.mengkal),overripe:r.overripe,pctOverripe:fixed(r.percentages.overripe),busuk:r.busuk,pctBusuk:fixed(r.percentages.busuk),kosong:r.kosong,pctKosong:fixed(r.percentages.kosong),partheno:r.partheno,pctPartheno:fixed(r.percentages.partheno),tikus:r.tikus,pctTikus:fixed(r.percentages.tikus),totalDeduction:fixed(r.totalDeduction),revised:r.revised?'Ya':'-'}; return `<tr data-id="${r.id}">${cols.map(([k])=>{ if(k==="action") return `<td><button class="text-btn danger" data-delete-grading="${r.id}">Hapus</button></td>`; const editable=["driver","plate","supplier","totalBunches","mentah","mengkal","overripe","busuk","kosong","partheno","tikus"].includes(k); return `<td ${editable?`class="editable" contenteditable="true" data-key="${k}"`:''}>${escapeHtml(v[k])}</td>`; }).join('')}</tr>`; }).join('')}</tbody>`;
}
function renderSheetTD(){
  const q=document.getElementById("sheetTDSearch").value.toLowerCase();
  const rows=state.td.filter(r=>!q || JSON.stringify(r).toLowerCase().includes(q));
  const cols=[["date","Tanggal"],["time","Jam"],["driver","Sopir"],["plate","Plat"],["tenera","Tenera"],["dura","Dura"],["total","Total TD"],["pctTenera","% Tenera"],["pctDura","% Dura"],["revised","Revisi"],["action","Aksi"]];
  document.getElementById("sheetTDTable").innerHTML = `<thead><tr>${cols.map(c=>`<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>{ const n=dt(r.createdAt); const v={date:n.date,time:n.time,driver:r.driver,plate:r.plate,tenera:r.tenera,dura:r.dura,total:r.total,pctTenera:fixed(r.pctTenera),pctDura:fixed(r.pctDura),revised:r.revised?'Ya':'-'}; return `<tr data-id="${r.id}">${cols.map(([k])=>{ if(k==="action") return `<td><button class="text-btn danger" data-delete-td="${r.id}">Hapus</button></td>`; const editable=["driver","plate","tenera","dura"].includes(k); return `<td ${editable?`class="editable" contenteditable="true" data-key="${k}"`:''}>${escapeHtml(v[k])}</td>`; }).join('')}</tr>`; }).join('')}</tbody>`;
}

function renderPerformance(){
  const mode=document.getElementById("performanceMode").value, view=document.getElementById("performanceView").value;
  const head=document.getElementById("performanceHead"), body=document.getElementById("performanceBody");
  if(mode==="grading" && view==="supplier"){
    const rows=supplierStats(); head.innerHTML=`<tr><th>Ranking</th><th>Supplier</th><th>Transaksi</th><th>Total Janjang</th><th>% Masak</th><th>Potongan</th></tr>`;
    body.innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${r.count}</td><td>${r.totalJanjang}</td><td>${pct(r.avgMasak)}</td><td>${pct(r.avgDed)}</td></tr>`).join("") || `<tr><td colspan="6">Tidak ada data.</td></tr>`;
  } else if(mode==="grading" && view==="driver"){
    const rows=driverStats(); head.innerHTML=`<tr><th>Ranking</th><th>Sopir</th><th>Transaksi</th><th>Total Janjang</th><th>% Masak</th><th>Potongan</th><th>Supplier Utama</th></tr>`;
    body.innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${r.count}</td><td>${r.totalJanjang}</td><td>${pct(r.avgMasak)}</td><td>${pct(r.avgDed)}</td><td>${escapeHtml(r.topSupplier)}</td></tr>`).join("") || `<tr><td colspan="7">Tidak ada data.</td></tr>`;
  } else if(mode==="td" && view==="driver"){
    const rows=tdDriverStats(); head.innerHTML=`<tr><th>Ranking</th><th>Sopir</th><th>Data TD</th><th>Total TD</th><th>% Tenera</th><th>% Dura</th><th>Plat Terbanyak</th></tr>`;
    body.innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${r.count}</td><td>${r.total}</td><td>${pct(r.avgTenera)}</td><td>${pct(r.avgDura)}</td><td>${escapeHtml(r.topPlate)}</td></tr>`).join("") || `<tr><td colspan="7">Tidak ada data.</td></tr>`;
  } else {
    const rows=driverStats().map(g=>{const t=tdDriverStats().find(x=>x.name===g.name); const gradingScore=100-g.avgDed; const tdScore=t?t.avgTenera:0; return {name:g.name, gradingScore, tdScore, combined:(gradingScore+tdScore)/2, count:g.count, tdCount:t?.count||0};}).sort((a,b)=>b.combined-a.combined);
    head.innerHTML=`<tr><th>Ranking</th><th>Sopir</th><th>Score Grading</th><th>Score TD</th><th>Score Gabungan</th></tr>`;
    body.innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${fixed(r.gradingScore)}</td><td>${fixed(r.tdScore)}</td><td>${fixed(r.combined)}</td></tr>`).join("") || `<tr><td colspan="5">Tidak ada data.</td></tr>`;
  }
}
function renderAnalytics(){
  document.getElementById("analyticsCauses").innerHTML=Object.entries(causeTotals()).sort((a,b)=>b[1]-a[1]).map(([k,v])=>stat(k,`Akumulasi potongan: ${pct(v)}`,v)).join("") || `<div class="stat">Belum ada data.</div>`;
  document.getElementById("analyticsInsights").innerHTML=insights().map(t=>`<div class="stat">${t}</div>`).join("");
}
function renderSuppliers(){
  document.getElementById("supplierList").innerHTML = state.suppliers.length
    ? state.suppliers.map(s=>`<div class="supplier-item"><div><strong>${escapeHtml(s.name)}</strong><br><span class="mini-badge ${s.status==='inactive'?'inactive':''}">${s.status==='active'?'Aktif':'Nonaktif'}</span></div><div><button class="text-btn" data-edit-supplier="${s.id}">Edit</button><button class="text-btn" data-toggle-supplier="${s.id}">${s.status==='active'?'Nonaktifkan':'Aktifkan'}</button></div></div>`).join("")
    : `<div class="empty-state">Belum ada supplier di Firebase. Tambahkan supplier baru dari form di sebelah kiri.</div>`;
}

function markRevised(row){ row.revised=true; row.revisedAt=new Date().toISOString(); }
async function saveGrading(row){ await set(ref(db, `grading/${row.id}`), row); }
async function saveTD(row){ await set(ref(db, `td/${row.id}`), row); }
async function saveSupplier(row){ const clean={ id:row.id, name:String(row.name||"").trim(), status:row.status||"active" }; await set(ref(db, `suppliers/${clean.id}`), clean); }

function exportTable(filename, headers, rows){
  const html=`<html><head><meta charset="UTF-8"></head><body><table border="1"><tr>${headers.map(h=>`<th style="font-weight:bold;background:#ececec">${h}</th>`).join("")}</tr>${rows.map(r=>`<tr>${r.map(v=>`<td>${String(v??"")}</td>`).join("")}</tr>`).join("")}</table></body></html>`;
  const blob=new Blob([html],{type:"application/vnd.ms-excel"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
}
function exportGrading(){
  const rows=getFilteredGrading();
  const headers=["Tanggal","Jam","Sopir","Plat","Supplier","Total Janjang","Masak","% Masak","Mentah","Mengkal","Overripe","Busuk","Tandan Kosong","Parthenocarpi","Makan Tikus","Total Potongan","Revisi"];
  const data=rows.map(r=>{const n=dt(r.createdAt); return [n.date,n.time,r.driver,r.plate,r.supplier,r.totalBunches,r.masak,fixed(r.percentages.masak),r.mentah,r.mengkal,r.overripe,r.busuk,r.kosong,r.partheno,r.tikus,fixed(r.totalDeduction),r.revised?'Ya':'-'];});
  exportTable("grading-pt-kedap-saayaq-dua.xls", headers, data);
}
function exportTD(){
  const rows=getFilteredTD();
  const headers=["Tanggal","Jam","Sopir","Plat","Tenera","Dura","Total TD","% Tenera","% Dura","Revisi"];
  const data=rows.map(r=>{const n=dt(r.createdAt); return [n.date,n.time,r.driver,r.plate,r.tenera,r.dura,r.total,fixed(r.pctTenera),fixed(r.pctDura),r.revised?'Ya':'-'];});
  exportTable("tenera-dura-pt-kedap-saayaq-dua.xls", headers, data);
}
function waOpen(text){ window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,"_blank"); }

function rowsByDriver(rows, module){
  const map = {};
  rows.forEach(r=>{
    if(!map[r.driver]) map[r.driver] = [];
    map[r.driver].push(r);
  });
  return Object.entries(map).map(([driver,list])=>{
    if(module==="grading"){
      return `• ${driver}\n  Transaksi: ${list.length}\n  Total Janjang: ${list.reduce((a,x)=>a+num(x.totalBunches),0)}\n  Rata-rata % Masak: ${pct(list.reduce((a,x)=>a+num(x.percentages.masak),0)/list.length)}\n  Rata-rata Potongan: ${pct(list.reduce((a,x)=>a+num(x.totalDeduction),0)/list.length)}`;
    }
    return `• ${driver}\n  Transaksi: ${list.length}\n  Total TD: ${list.reduce((a,x)=>a+num(x.total),0)}\n  Rata-rata % Tenera: ${pct(list.reduce((a,x)=>a+num(x.pctTenera),0)/list.length)}\n  Rata-rata % Dura: ${pct(list.reduce((a,x)=>a+num(x.pctDura),0)/list.length)}`;
  }).join("\n\n");
}

function buildWAFromContext(ctx){
  const start = document.getElementById("waStart").value;
  const end = document.getElementById("waEnd").value;
  const supplier = document.getElementById("waSupplier").value;
  const mode = document.getElementById("waMode").value;
  let rows = ctx.module === "grading" ? filterDate(state.grading, start, end) : filterDate(state.td, start, end);
  if(ctx.module === "grading" && supplier) rows = rows.filter(r=>r.supplier===supplier);
  const title = ctx.module === "grading" ? "REKAP GRADING" : "REKAP TENERA DURA";
  const kindText = ctx.kind === "summary" ? "RINGKASAN" : "DETAIL";
  const filterText = ctx.module === "grading" ? (supplier || "Semua Supplier") : "Semua Supplier";
  if(!rows.length){
    return `📋 ${title} - ${kindText}\nPeriode: ${start||'-'} s/d ${end||'-'}\nFilter Supplier: ${filterText}\nMode: ${mode === 'driver' ? 'Per Sopir' : 'Keseluruhan'}\n\nTidak ada data sesuai filter.`;
  }
  if(ctx.kind === "summary"){
    if(ctx.module === "grading"){
      const avgMasak = rows.reduce((a,x)=>a+num(x.percentages.masak),0)/rows.length;
      const avgDed = rows.reduce((a,x)=>a+num(x.totalDeduction),0)/rows.length;
      const body = mode === "driver" ? `\n\n${rowsByDriver(rows, "grading")}` : `\nJumlah Transaksi: ${rows.length}\nTotal Janjang: ${rows.reduce((a,x)=>a+num(x.totalBunches),0)}\nRata-rata % Masak: ${pct(avgMasak)}\nRata-rata Potongan: ${pct(avgDed)}`;
      return `📋 ${title} - RINGKASAN\nPeriode: ${start||'-'} s/d ${end||'-'}\nFilter Supplier: ${filterText}\nMode: ${mode === 'driver' ? 'Per Sopir' : 'Keseluruhan'}\n${body}`;
    }
    const avgT = rows.reduce((a,x)=>a+num(x.pctTenera),0)/rows.length;
    const avgD = rows.reduce((a,x)=>a+num(x.pctDura),0)/rows.length;
    const body = mode === "driver" ? `\n\n${rowsByDriver(rows, "td")}` : `\nJumlah Transaksi: ${rows.length}\nTotal TD: ${rows.reduce((a,x)=>a+num(x.total),0)}\nRata-rata % Tenera: ${pct(avgT)}\nRata-rata % Dura: ${pct(avgD)}`;
    return `📋 ${title} - RINGKASAN\nPeriode: ${start||'-'} s/d ${end||'-'}\nFilter Supplier: ${filterText}\nMode: ${mode === 'driver' ? 'Per Sopir' : 'Keseluruhan'}\n${body}`;
  }
  if(mode === "driver"){
    return `📋 ${title} - DETAIL\nPeriode: ${start||'-'} s/d ${end||'-'}\nFilter Supplier: ${filterText}\nMode: Per Sopir\n\n${rowsByDriver(rows, ctx.module)}`;
  }
  const detail = rows.slice(0,30).map((r,i)=> ctx.module === "grading"
    ? `${i+1}. ${r.driver} | ${r.plate} | ${r.supplier} | Janjang ${r.totalBunches} | % Masak ${pct(r.percentages.masak)} | Pot ${pct(r.totalDeduction)}`
    : `${i+1}. ${r.driver} | ${r.plate} | Tenera ${r.tenera} | Dura ${r.dura} | % Tenera ${pct(r.pctTenera)} | % Dura ${pct(r.pctDura)}`).join("\n");
  return `📋 ${title} - DETAIL\nPeriode: ${start||'-'} s/d ${end||'-'}\nFilter Supplier: ${filterText}\nMode: Keseluruhan\n\n${detail}`;
}

function openWAModal(module, kind){
  waContext = { module, kind };
  document.getElementById("waModalTitle").textContent = `${module === 'grading' ? 'Rekap Grading' : 'Rekap Tenera Dura'} - ${kind === 'summary' ? 'Kirim Ringkasan' : 'Kirim Detail'}`;
  document.getElementById("waTypeText").value = kind === 'summary' ? 'Kirim Ringkasan' : 'Kirim Detail';
  document.getElementById("waSupplierWrap").classList.toggle("hidden", module !== "grading");
  document.getElementById("waStart").value = module === "grading" ? document.getElementById("rekapGradingStart").value : document.getElementById("rekapTDStart").value;
  document.getElementById("waEnd").value = module === "grading" ? document.getElementById("rekapGradingEnd").value : document.getElementById("rekapTDEnd").value;
  document.getElementById("waSupplier").value = module === "grading" ? document.getElementById("rekapGradingSupplier").value : "";
  document.getElementById("waMode").value = "all";
  document.getElementById("waPreview").textContent = buildWAFromContext(waContext);
  document.getElementById("waModal").classList.add("open");
}

function showDetail(type,id){
  const r=(type==="grading"?state.grading:state.td).find(x=>x.id===id); if(!r) return;
  if(type==="grading"){
    document.getElementById("detailBody").innerHTML = `<div class="detail-grid"><div class="detail-box"><span>Tanggal</span><strong>${dt(r.createdAt).date}</strong></div><div class="detail-box"><span>Jam</span><strong>${dt(r.createdAt).time}</strong></div><div class="detail-box"><span>Sopir</span><strong>${escapeHtml(r.driver)}</strong></div><div class="detail-box"><span>Plat</span><strong>${escapeHtml(r.plate)}</strong></div><div class="detail-box"><span>Supplier</span><strong>${escapeHtml(r.supplier)}</strong></div><div class="detail-box"><span>Total Janjang</span><strong>${r.totalBunches}</strong></div><div class="detail-box"><span>% Masak</span><strong>${pct(r.percentages.masak)}</strong></div><div class="detail-box"><span>Total Potongan</span><strong>${pct(r.totalDeduction)}</strong></div><div class="detail-box"><span>Revisi</span><strong>${r.revised?'Ya':'-'}</strong></div></div>`;
  } else {
    document.getElementById("detailBody").innerHTML = `<div class="detail-grid"><div class="detail-box"><span>Tanggal</span><strong>${dt(r.createdAt).date}</strong></div><div class="detail-box"><span>Jam</span><strong>${dt(r.createdAt).time}</strong></div><div class="detail-box"><span>Sopir</span><strong>${escapeHtml(r.driver)}</strong></div><div class="detail-box"><span>Plat</span><strong>${escapeHtml(r.plate)}</strong></div><div class="detail-box"><span>Tenera</span><strong>${r.tenera}</strong></div><div class="detail-box"><span>Dura</span><strong>${r.dura}</strong></div><div class="detail-box"><span>Total TD</span><strong>${r.total}</strong></div><div class="detail-box"><span>% Tenera</span><strong>${pct(r.pctTenera)}</strong></div><div class="detail-box"><span>% Dura</span><strong>${pct(r.pctDura)}</strong></div></div>`;
  }
  document.getElementById("detailModal").classList.add("open");
}

function refreshAll(){
  if(state.loading){ setStatus("Memuat data realtime dari Firebase..."); return; }
  fillStatic();
  applyRoleUI();
  renderSummaryCards();
  renderDashboard();
  renderGradingLive();
  renderTDLive();
  renderRekapGrading();
  renderRekapTD();
  renderRekapData();
  if(currentRole==="staff"){
    renderSheetGrading();
    renderSheetTD();
    renderPerformance();
    renderAnalytics();
    renderSuppliers();
  }
}

function openSidebar(){ document.getElementById("app").classList.add("sidebar-open"); }
function closeSidebarOnMobile(){ if(window.innerWidth <= 900) document.getElementById("app").classList.remove("sidebar-open"); }
document.getElementById("menuToggle").addEventListener("click",()=>document.getElementById("app").classList.toggle("sidebar-open"));
document.getElementById("mobileOverlay").addEventListener("click",closeSidebarOnMobile);
window.addEventListener("resize",()=>{ if(window.innerWidth > 900) document.getElementById("app").classList.remove("sidebar-open"); });

document.querySelectorAll(".menu-item").forEach(btn=>btn.addEventListener("click",()=>switchPage(btn.dataset.page)));

document.getElementById("loginForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const email = ROLE_EMAILS[selectedLoginRole];
  const password = document.getElementById("loginPassword").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    document.getElementById("loginPassword").value = "";
  } catch(err){
    const el = document.getElementById("loginError");
    el.textContent = `Login gagal: ${err.message}`;
    el.classList.remove("hidden");
  }
});

document.getElementById("logoutBtn").addEventListener("click",()=>signOut(auth));

onAuthStateChanged(auth, async user=>{
  if(user){
    const meta = Object.values(USERS).find(x=>x.email===user.email);
    if(!meta){
      await signOut(auth);
      setStatus("Akun ini tidak terdaftar sebagai staff atau grading.", "error");
      const el = document.getElementById("loginError");
      el.textContent = "Akun Firebase ini tidak dikenali oleh sistem.";
      el.classList.remove("hidden");
      return;
    }
    state.user = user;
    currentRole = meta.role;
    document.getElementById("loginEmail").value = user.email;
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    await ensureUsersNode(user);
    await ensureSupplierSeed();
    if(!state.synced) subscribeData();
    refreshAll();
  } else {
    state.user = null;
    document.getElementById("app").classList.add("hidden");
    document.getElementById("loginScreen").classList.remove("hidden");
    setLoginRole(selectedLoginRole);
  }
});

document.getElementById("gradingDriver").addEventListener("input",e=>{ historyHint(e.target.value.trim()); renderGradingLive(); });
document.getElementById("gradingForm").addEventListener("input",renderGradingLive);
document.getElementById("tdForm").addEventListener("input",renderTDLive);

document.getElementById("gradingForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(e.target).entries());
  const calc=calculateGrading(data);
  if(calc.validation.type==="error"){ renderGradingLive(); return; }
  const id = push(ref(db, "grading")).key;
  await saveGrading({ id, createdAt:new Date().toISOString(), revised:false, revisedAt:null, ...data, ...calc });
  e.target.reset(); e.target.totalBunches.value=0; e.target.querySelectorAll(".cat").forEach(x=>x.value=0); document.getElementById("driverHint").textContent="Belum ada histori sopir."; renderGradingLive();
});

document.getElementById("tdForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(e.target).entries());
  const calc=calculateTD(data);
  const id = push(ref(db, "td")).key;
  await saveTD({ id, createdAt:new Date().toISOString(), revised:false, revisedAt:null, ...data, ...calc });
  e.target.reset(); e.target.tenera.value=0; e.target.dura.value=0; renderTDLive();
});

document.getElementById("resetGradingBtn").addEventListener("click",()=>{ const f=document.getElementById("gradingForm"); f.reset(); f.totalBunches.value=0; f.querySelectorAll(".cat").forEach(x=>x.value=0); document.getElementById("driverHint").textContent="Belum ada histori sopir."; renderGradingLive(); });
document.getElementById("resetTDBtn").addEventListener("click",()=>{ const f=document.getElementById("tdForm"); f.reset(); f.tenera.value=0; f.dura.value=0; renderTDLive(); });
document.getElementById("copyLastGrading").addEventListener("click",()=>{ const last=state.grading[0]; if(!last) return; const f=document.getElementById("gradingForm"); f.driver.value=last.driver; f.plate.value=last.plate; f.supplier.value=last.supplier; ["totalBunches","mentah","mengkal","overripe","busuk","kosong","partheno","tikus"].forEach(k=>f[k].value=last[k]); historyHint(last.driver); renderGradingLive(); });
document.getElementById("copyLastTD").addEventListener("click",()=>{ const last=state.td[0]; if(!last) return; const f=document.getElementById("tdForm"); f.driver.value=last.driver; f.plate.value=last.plate; f.tenera.value=last.tenera; f.dura.value=last.dura; renderTDLive(); });

["rekapGradingSearch"].forEach(id=>document.getElementById(id).addEventListener("input",renderRekapGrading));
["rekapGradingSupplier","rekapGradingStart","rekapGradingEnd"].forEach(id=>document.getElementById(id).addEventListener("change",renderRekapGrading));
["rekapTDSearch"].forEach(id=>document.getElementById(id).addEventListener("input",renderRekapTD));
["rekapTDStart","rekapTDEnd"].forEach(id=>document.getElementById(id).addEventListener("change",renderRekapTD));
document.getElementById("rekapDataRunBtn").addEventListener("click",renderRekapData);
document.getElementById("rekapDataResetBtn").addEventListener("click",()=>{ ["rekapDataStart","rekapDataEnd","rekapDataSupplier","rekapDataDriver"].forEach(id=>document.getElementById(id).value=""); renderRekapData(); });
document.getElementById("sheetGradingSearch").addEventListener("input",renderSheetGrading);
document.getElementById("sheetTDSearch").addEventListener("input",renderSheetTD);
document.getElementById("performanceMode").addEventListener("change",renderPerformance);
document.getElementById("performanceView").addEventListener("change",renderPerformance);
document.getElementById("exportGradingBtn").addEventListener("click",exportGrading);
document.getElementById("exportTDBtn").addEventListener("click",exportTD);
document.getElementById("sendGradingSummaryBtn").addEventListener("click",()=>openWAModal("grading","summary"));
document.getElementById("sendGradingDetailBtn").addEventListener("click",()=>openWAModal("grading","detail"));
document.getElementById("sendTDSummaryBtn").addEventListener("click",()=>openWAModal("td","summary"));
document.getElementById("sendTDDetailBtn").addEventListener("click",()=>openWAModal("td","detail"));
["waStart","waEnd","waSupplier","waMode"].forEach(id=>document.getElementById(id).addEventListener("change",()=>{ document.getElementById("waPreview").textContent = buildWAFromContext(waContext); }));
document.getElementById("confirmWaBtn").addEventListener("click",()=>waOpen(buildWAFromContext(waContext)));
document.getElementById("closeWaModalBtn").addEventListener("click",()=>document.getElementById("waModal").classList.remove("open"));
document.getElementById("waModal").addEventListener("click",e=>{ if(e.target.id==="waModal") document.getElementById("waModal").classList.remove("open"); });
document.getElementById("waFilteredGradingBtn").addEventListener("click",()=>waOpen(document.getElementById("rekapDataGradingSummary").innerText));
document.getElementById("waFilteredTDBtn").addEventListener("click",()=>waOpen(document.getElementById("rekapDataTDSummary").innerText));
document.getElementById("waPerformanceSummaryBtn").addEventListener("click",()=>waOpen(document.getElementById("performanceBody").innerText));
document.getElementById("waPerformanceDataBtn").addEventListener("click",()=>waOpen(document.getElementById("performanceBody").innerText));

document.getElementById("supplierForm").addEventListener("submit", async e=>{
  e.preventDefault();
  if(currentRole!=="staff") return;
  const fd=Object.fromEntries(new FormData(e.target).entries());
  const name = String(fd.supplierName || "").trim();
  if(!name){
    setStatus("Nama supplier wajib diisi.", "warning");
    return;
  }
  const duplicate = state.suppliers.find(s => s.name.toLowerCase() === name.toLowerCase() && s.id !== fd.supplierId);
  if(duplicate){
    setStatus("Nama supplier sudah ada. Gunakan edit jika ingin mengubah data yang sama.", "warning");
    return;
  }
  const row = { id: fd.supplierId || uid(), name, status: fd.supplierStatus || "active" };
  try{
    await saveSupplier(row);
    e.target.reset();
    setStatus(`Supplier ${name} berhasil disimpan ke Firebase.`, "info");
  }catch(err){
    setStatus(`Gagal menyimpan supplier: ${err.message}`, "error");
  }
});
document.getElementById("resetSupplierBtn").addEventListener("click",()=>document.getElementById("supplierForm").reset());

document.addEventListener("click", async e=>{
  const row=e.target.closest("tr[data-detail-id]");
  if(row) showDetail(row.dataset.detailType,row.dataset.detailId);
  const editId=e.target.dataset.editSupplier;
  if(editId && currentRole==="staff"){
    const s=state.suppliers.find(x=>x.id===editId); if(!s) return;
    const f=document.getElementById("supplierForm"); f.supplierId.value=s.id; f.supplierName.value=s.name; f.supplierStatus.value=s.status; switchPage("supplier");
  }
  const toggleId=e.target.dataset.toggleSupplier;
  if(toggleId && currentRole==="staff"){
    const s=state.suppliers.find(x=>x.id===toggleId); if(!s) return;
    await saveSupplier({ ...s, status:s.status==="active"?"inactive":"active" });
  }
  const delG=e.target.dataset.deleteGrading;
  if(delG && currentRole==="staff" && confirm("Hapus data grading ini?")) await remove(ref(db, `grading/${delG}`));
  const delTD=e.target.dataset.deleteTd;
  if(delTD && currentRole==="staff" && confirm("Hapus data Tenera Dura ini?")) await remove(ref(db, `td/${delTD}`));
});

document.getElementById("sheetGradingTable").addEventListener("focusout", async e=>{
  if(currentRole!=="staff") return;
  const cell=e.target.closest("td.editable"); if(!cell) return;
  const tr=cell.closest("tr"); const row=state.grading.find(x=>x.id===tr.dataset.id); if(!row) return;
  const key=cell.dataset.key, val=cell.textContent.trim();
  if(["driver","plate","supplier"].includes(key)) row[key]=val; else row[key]=Number(val||0);
  Object.assign(row, calculateGrading(row)); markRevised(row); await saveGrading(row);
});

document.getElementById("sheetTDTable").addEventListener("focusout", async e=>{
  if(currentRole!=="staff") return;
  const cell=e.target.closest("td.editable"); if(!cell) return;
  const tr=cell.closest("tr"); const row=state.td.find(x=>x.id===tr.dataset.id); if(!row) return;
  const key=cell.dataset.key, val=cell.textContent.trim();
  if(["driver","plate"].includes(key)) row[key]=val; else row[key]=Number(val||0);
  Object.assign(row, calculateTD(row)); markRevised(row); await saveTD(row);
});

document.getElementById("closeModalBtn").addEventListener("click",()=>document.getElementById("detailModal").classList.remove("open"));
document.getElementById("detailModal").addEventListener("click",e=>{ if(e.target.id==="detailModal") document.getElementById("detailModal").classList.remove("open"); });
document.getElementById("globalSearch").addEventListener("input",e=>{
  document.getElementById("rekapGradingSearch").value=e.target.value;
  document.getElementById("rekapTDSearch").value=e.target.value;
  document.getElementById("sheetGradingSearch").value=e.target.value;
  document.getElementById("sheetTDSearch").value=e.target.value;
  renderRekapGrading(); renderRekapTD(); if(currentRole==="staff"){ renderSheetGrading(); renderSheetTD(); }
});

switchPage("dashboard");
renderGradingLive();
renderTDLive();
