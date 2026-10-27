import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const root=document.querySelector('#root');
const SPV_AREAS=['AREA-SULSEL','AREA-SULTENG','AREA-SULBAR','AREA-KALTIM','AREA-SULUT','AREA-SULTRA'];
const POS=[['display','Display'],['reject','Reject'],['rak_utama','Rak Utama'],['rak_cadangan','Rak Cadangan']];
const state={user:null,me:null,stores:[],dashboard:[],page:'dashboard',store:'',cycle:null,online:true,badges:{},
 dash:{tab:'kpi',store:'',type:'',range:{kind:'all',from:'',to:''}},
 sch:{store:'',range:{kind:'month',from:'',to:''},rows:[]},
 exp:{store:'',range:{kind:'month',from:'',to:''},rows:[],sel:new Set()},
 count:{offset:0,search:'',filter:'ALL',team:'',data:null,open:false,sel:new Set(),listQ:'',rows:[]},
 validation:{offset:0,search:'',filter:'VARIANCE',acc:'ALL',status:'ALL',data:null,open:false,cycle:'',listQ:'',rows:[]},
 builder:null};
let upRows=[];
let inflight=0;
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const n=v=>new Intl.NumberFormat('id-ID').format(Number(v)||0);
const signed=v=>(Number(v)>0?'+':'')+n(v);
const P=v=>v===null||v===undefined?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:1}).format(Number(v)*100)+'%';
const rp=(v,sign=false)=>{const x=Number(v)||0;return (x<0?'-':(sign&&x>0?'+':''))+'Rp '+n(Math.abs(x))};
const bytes=b=>{const x=Number(b)||0;if(x<1024)return x+' B';if(x<1048576)return (x/1024).toFixed(1)+' KB';if(x<1073741824)return (x/1048576).toFixed(1)+' MB';return (x/1073741824).toFixed(2)+' GB'};
const $=sel=>document.querySelector(sel);
const $$=sel=>Array.from(document.querySelectorAll(sel));
const toast=(s,isErr=false)=>{const el=$('#toast');el.textContent=s;el.className='toast'+(isErr?' error':'');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.add('hidden'),5500)};
const busy=d=>{inflight=Math.max(0,inflight+d);const p=$('#progress');if(p)p.classList.toggle('on',inflight>0)};
const rpc=async(name,args={})=>{busy(1);try{const {data,error}=await sb.rpc('tsi_so_'+name,args);if(error){if(!error.code)state.online=false;throw new Error(error.message||'Terjadi kesalahan server')}state.online=true;return data}finally{busy(-1)}};
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fmtDate=d=>d?new Date(d+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}):'—';
const ini=s=>((String(s||'?').split('@')[0]).match(/[a-zA-Z0-9]/g)||['?']).slice(0,2).join('').toUpperCase();
const ROLE_LABEL={admin:'Admin',spv:'SPV',store:'Store'};
const TONE={SCHEDULED:'blue',COUNTING:'blue',RECOUNT:'orange',SUBMITTED:'orange',APPROVED:'green','BELUM SO':'gray',BELUM:'gray',SELISIH:'red',TALLY:'green'};
const STATUS_LABEL={SUBMITTED:'Validasi SPV',BELUM:'BELUM'};
const chip=(s,label)=>`<span class="chip ${TONE[s]||'gray'}"><i></i>${escapeHTML(label||STATUS_LABEL[s]||s||'BELUM SO')}</span>`;
const labelStore=code=>state.stores.find(x=>x.code===code)?.name||code;
const wrap=html=>root.innerHTML=html;
const isAdmin=()=>state.me.role==='admin';
const canManage=()=>state.me.role==='admin'||state.me.role==='spv';
const btn=(label,act,kind='',attrs={})=>`<button class="btn ${kind}" data-act="${act}"${Object.entries(attrs).map(([k,v])=>` data-${k}="${escapeHTML(v)}"`).join('')}>${label}</button>`;
const ACT={};
const CHG={};
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-act]');if(!el)return;const fn=ACT[el.dataset.act];if(!fn)return;
 e.preventDefault();if(el.classList.contains('is-busy'))return;
 el.classList.add('is-busy');el.disabled=true;
 try{await fn(el)}catch(err){toast(err.message,true)}finally{if(el.isConnected){el.disabled=false;el.classList.remove('is-busy')}}
});
document.addEventListener('change',async e=>{const el=e.target.closest('[data-change]');if(!el)return;const fn=CHG[el.dataset.change];if(!fn)return;try{await fn(el)}catch(err){toast(err.message,true)}});
document.addEventListener('input',e=>{
 if(e.target.id==='cListSearch'){state.count.listQ=e.target.value;drawCountRows()}
 else if(e.target.id==='vListSearch'){state.validation.listQ=e.target.value;drawValRows()}
 else if(e.target.closest('#countTable tr[data-sku]')){countDraftSync(e.target.closest('tr'))}
});

function loginView(message=''){
 state.me=null;state.user=null;wrap(`<section class="login-bg"><div class="login-card"><div class="brand"><div class="logo">38</div><div><strong>TIGALAPAN INDONESIA<small>STOCK OPNAME • SUPABASE</small></strong></div></div><h1>Masuk aplikasi SO</h1><p class="small muted">Masuk menggunakan akun Gmail toko atau email perusahaan yang telah terdaftar di Supabase Auth. Admin harus mengaktifkan role serta toko Anda.</p><form id="loginForm" class="login-form"><div class="field"><label>Email</label><input class="input" id="email" type="email" autocomplete="email" required placeholder="alamat@gmail.com"/></div><div class="field"><label>Password Supabase</label><input class="input" id="password" type="password" minlength="6" autocomplete="current-password" required placeholder="Password akun SO"/></div><div class="login-actions"><button class="btn primary" type="submit">Masuk</button><button class="btn" id="signUpBtn" type="button">Daftar akun</button></div><button class="btn" id="googleBtn" type="button">Masuk dengan Google (opsional)</button></form><p class="footerhint">${escapeHTML(message||'Catatan: Google OAuth perlu diaktifkan terlebih dahulu di Supabase. Akun baru belum dapat membaca data sampai disetujui Admin.')}</p></div></section>`);
 $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const email=$('#email').value.trim(),password=$('#password').value;try{const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;await start()}catch(ex){toast(ex.message,true)}});
 $('#signUpBtn').addEventListener('click',async()=>{const email=$('#email').value.trim(),password=$('#password').value;if(!email||password.length<6){toast('Isi email dan password minimal 6 karakter.',true);return}const {error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.href.split('?')[0]}});toast(error?error.message:'Pendaftaran diproses. Periksa email konfirmasi, lalu minta Admin mengaktifkan akun.',!!error)});
 $('#googleBtn').addEventListener('click',async()=>{const {error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.href.split('?')[0]}});if(error)toast(error.message,true)});
}
async function start(){
 const {data:{user}}=await sb.auth.getUser();if(!user){loginView();return}state.user=user;
 try{state.me=await rpc('me');state.stores=state.me.stores||[];state.store=state.me.store_code||state.stores[0]?.code||'';state.page='dashboard';await refreshDashboard();shell();await render()}catch(ex){loginView('Login berhasil, tetapi '+ex.message+' User ID: '+user.id);toast(ex.message,true)}
}

const PAGE={
 dashboard:['Dashboard','Ringkasan operasional Stock Opname'],
 schedule:['SO Schedule','Jadwal Partial dan Grand Stock Opname per toko'],
 count:['SO Counting','Hitung stok per posisi di desktop, tablet, atau smartphone'],
 validation:['Validasi SPV','Review hasil counting toko, validasi selisih, lalu approve SO'],
 export:['Export & Pembersihan','Export hasil SO APPROVED ke CSV untuk Drive, lalu bersihkan detail dari database'],
 upload:['Upload Inventory','Ganti inventory aktif toko. System qty SO yang berjalan ikut diperbarui'],
 admin:['Manajemen Akses','Aktivasi user, SPV Mapping per toko, dan audit aktivitas']};
// Store: Dashboard, Schedule (lihat), Counting, Upload. SPV: semua kecuali Manajemen Akses. Admin: semua.
function menu(){const p=state.me.role;return [
 ['dashboard','Dashboard','⌂','MAIN'],
 ['schedule','SO Schedule','▦','STOCK OPNAME'],
 ['count','Counting','☑','STOCK OPNAME'],
 ...(p!=='store'?[['validation','Validasi SPV','✓','STOCK OPNAME']]:[]),
 ...(p!=='store'?[['export','Export & Pembersihan','⤓','REPORT & SETTINGS']]:[]),
 ['upload','Upload Inventory','⇧','INVENTORY & PLANNING'],
 ...(p==='admin'?[['admin','Manajemen Akses','⚙','REPORT & SETTINGS']]:[])]}
function shell(){
 wrap(`<div class="progress" id="progress"><i></i></div><section class="app" id="app">
 <aside class="sidebar">
  <div class="side-head"><div class="brand-card"><div class="logo">38</div><div class="brand-text"><strong>TIGALAPAN</strong><small>STOCK OPNAME SYSTEM</small></div></div><button class="collapse" id="collapseBtn" title="Perkecil / perbesar menu">‹</button></div>
  <nav class="nav" id="nav"></nav>
  <div class="side-foot"><div class="avatar">${escapeHTML(ini(state.me.email))}</div><div class="who"><strong>${escapeHTML(state.me.email)}</strong><small>${ROLE_LABEL[state.me.role]} · ${state.me.role==='store'?escapeHTML(labelStore(state.me.store_code)):'Semua area'}</small></div></div>
 </aside>
 <main class="main">
  <header class="topbar"><div class="titles"><h1 id="topTitle"></h1><p id="topSubtitle"></p></div>
   <div class="top-actions"><span class="sys" id="sysPill"><i></i>System Online</span><button class="btn pill" id="refreshBtn" data-act="refresh">↻ Refresh</button><button class="btn pill ghost" id="logout" data-act="logout">Keluar</button></div>
  </header>
  <div class="content" id="content"></div>
 </main></section>`);
 $('#collapseBtn').onclick=()=>$('#app').classList.toggle('collapsed');
}
ACT['refresh']=async()=>{await render()};
ACT['logout']=async()=>{await sb.auth.signOut();loginView()};
function updateNav(){const el=$('#nav');if(!el)return;let last='',html='';const b=state.badges;
 for(const [id,title,icon,section] of menu()){
  if(section!==last){html+=`<div class="nav-sec">${section}</div>`;last=section}
  const cnt=b[id]?`<b class="nbadge">${n(b[id])}</b>`:'';
  html+=`<button data-page="${id}" class="${state.page===id?'active':''}" title="${title}"><span class="ico">${icon}</span><span class="lbl">${title}</span>${cnt}</button>`;
 }
 el.innerHTML=html;
 el.querySelectorAll('[data-page]').forEach(btnEl=>btnEl.onclick=async()=>{state.page=btnEl.dataset.page;state.validation.open=false;state.count.open=false;state.count.sel=new Set();await render()});
}
const loadingHTML=(t='Memuat data…')=>`<div class="card loading-card"><span class="spinner"></span>${t}</div>`;
async function render(){
 if(!state.me)return;
 const m=PAGE[state.page]||PAGE.dashboard;$('#topTitle').textContent=m[0];$('#topSubtitle').textContent=m[1];
 $('#content').innerHTML=loadingHTML();
 try{
  await loadBadges();updateNav();
  if(state.page==='dashboard')await showDashboard();
  if(state.page==='schedule')await showSchedule();
  if(state.page==='count')await showCount();
  if(state.page==='validation')await showValidation();
  if(state.page==='export')await showExport();
  if(state.page==='upload')await showUpload();
  if(state.page==='admin')await showAdmin();
 }catch(ex){$('#content').innerHTML=`<div class="card"><div class="note warning">${escapeHTML(ex.message)}</div></div>`;toast(ex.message,true)}
 const pill=$('#sysPill');if(pill){pill.classList.toggle('off',!state.online);pill.lastChild.textContent=state.online?'System Online':'Koneksi terputus'}
}
async function loadBadges(){try{const k=await rpc('kpi',{});state.badges={schedule:k.so_scheduled+k.so_running,count:k.so_running+k.so_scheduled,validation:k.so_submitted}}catch(e){state.badges={}}}
function storeOptions(sel,all){return `${all?'<option value="">Semua Store</option>':''}${state.stores.map(s=>`<option value="${escapeHTML(s.code)}" ${s.code===sel?'selected':''}>${escapeHTML(s.name)}</option>`).join('')}`}
function current(){return state.dashboard.find(x=>x.code===state.store)||null}
function storeCard(s){const pv=s.total?Math.round(100*s.done/s.total):0;
 return `<div class="store-card"><div class="sc-head"><div><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(s.code)} • ${escapeHTML(s.area||'')}</small></div>${chip(s.status,s.status==='BELUM SO'?'BELUM SO':undefined)}</div>
 <div class="sc-line"><span>${n(s.done)} / ${n(s.total)} SKU selesai</span><b>${pv}%</b></div><div class="bar"><span style="width:${pv}%"></span></div>
 ${s.accuracy!==null&&s.accuracy!==undefined?`<div class="sc-acc"><span>SKU ${P(s.accuracy)}</span><span>Qty ${P(s.qty_accuracy)}</span><span>Nilai ${P(s.value_accuracy)}</span></div>`:''}</div>`}
async function refreshDashboard(){const res=await rpc('dashboard');state.dashboard=res.stores||[];state.cycle=state.dashboard.find(x=>x.code===state.store)?.cycle_id||null}

// ===== Rentang tanggal: Minggu, Bulan, Tahun, 30/90 hari, atau tanggal sendiri =====
const RANGE_LABEL={all:'Semua Periode',week:'Minggu Ini',month:'Bulan Ini',year:'Tahun Ini',d30:'30 Hari Terakhir',d90:'90 Hari Terakhir',custom:'Rentang Tanggal'};
function rangeBounds(r){
 const t=new Date();const today=iso(t);
 switch(r.kind){
  case 'week':{const d=new Date(t);const dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow);return[iso(d),today]}
  case 'month':return[iso(new Date(t.getFullYear(),t.getMonth(),1)),today];
  case 'year':return[iso(new Date(t.getFullYear(),0,1)),today];
  case 'd30':return[iso(new Date(Date.now()-29*864e5)),today];
  case 'd90':return[iso(new Date(Date.now()-89*864e5)),today];
  case 'custom':return[r.from||null,r.to||null];
  default:return[null,null];
 }
}
function rangeControlHTML(prefix,r){
 return `<select class="input select" id="${prefix}Kind" data-change="${prefix}-kind">${Object.entries(RANGE_LABEL).map(([v,l])=>`<option value="${v}" ${r.kind===v?'selected':''}>${l}</option>`).join('')}</select>${r.kind==='custom'?`<input class="input" type="date" id="${prefix}From" value="${escapeHTML(r.from||'')}"/><span class="muted small">s/d</span><input class="input" type="date" id="${prefix}To" value="${escapeHTML(r.to||'')}"/>${btn('Terapkan','range-apply','primary',{prefix})}`:''}`;
}
const rangeOf=p=>p==='dash'?state.dash.range:p==='exp'?state.exp.range:state.sch.range;
const rangeRefresh=p=>p==='dash'?showDashboard():p==='exp'?showExport():showSchedule();
CHG['dash-kind']=CHG['exp-kind']=CHG['sch-kind']=async el=>{const p=el.id.replace('Kind','');const r=rangeOf(p);r.kind=el.value;if(r.kind!=='custom')await rangeRefresh(p);else await render_rangeHint(p)};
async function render_rangeHint(p){const r=rangeOf(p);if(r.kind==='custom'&&!r.from&&!r.to){const el=$('#'+p+'From');if(el)el.focus()}}
ACT['range-apply']=async el=>{const p=el.dataset.prefix;const r=rangeOf(p);r.from=$('#'+p+'From').value;r.to=$('#'+p+'To').value;if(r.from&&r.to&&r.from>r.to)throw Error('Tanggal awal harus sebelum tanggal akhir.');await rangeRefresh(p)};

// ===== Dashboard =====
function accuracyOf(k){
 const sku=k.appr_total>0?k.appr_tally/k.appr_total:null;
 const qty=k.appr_sys_qty>0?Math.max(0,1-k.appr_abs_qty/k.appr_sys_qty):(k.appr_total>0&&k.appr_abs_qty===0?1:null);
 const val=k.appr_sys_value>0?Math.max(0,1-k.appr_abs_value/k.appr_sys_value):(k.appr_total>0&&k.appr_abs_value===0?1:null);
 return{sku,qty,val}}
async function showDashboard(){
 const d=state.dash;await refreshDashboard();
 const [from,to]=rangeBounds(d.range);
 const k=await rpc('kpi',{p_store:d.store||null,p_type:d.type||null,p_from:from,p_to:to});
 const a=accuracyOf(k),tot=k.so_total,fin=k.so_finished;
 const kpi=(cls,label,value,sub)=>`<div class="kpi ${cls}"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;
 const vol=(cls,label,value,sub)=>`<div class="vol ${cls}"><div class="vol-l">${label}</div><div class="vol-v">${value}</div><div class="vol-s">${sub}</div></div>`;
 const tabs=[['kpi','KPI & Ringkasan'],['acc','Akurasi Toko'],['wf','Workflow'],['risk','Risiko & Progress'],['act','Aktivitas']];
 let body='';
 if(d.tab==='kpi'){
  body=`<div class="sec-title">Ringkasan Operasional Stock Opname</div>
  <div class="kpis">
   ${kpi('o','SKU Accuracy',P(a.sku),`${n(k.appr_tally)} dari ${n(k.appr_total)} SKU pada SO APPROVED`)}
   ${kpi('g','Qty Accuracy',P(a.qty),'Akurasi System Qty vs Actual Qty (SO APPROVED)')}
   ${kpi('o','Value Accuracy',P(a.val),'Akurasi nilai persediaan (SO APPROVED)')}
   ${kpi('a','SO Approved',`${n(k.so_approved)} / ${n(tot)}`,`${n(k.so_submitted)} SO menunggu validasi SPV`)}
  </div>
  <div class="sec-title">Volume & Progress <small>SO, penyelesaian, SKU yang dihitung, dan net variance quantity. SO yang sudah dibersihkan tetap dihitung.</small></div>
  <div class="vols">
   ${vol('o','Total SO',n(tot),'Seluruh SO sesuai filter')}
   ${vol('g','Completion',P(tot?fin/tot:null),`${n(fin)} SO sudah selesai (SUBMITTED/APPROVED)`)}
   ${vol('o','SKU Counted',n(k.sku_done),'Total SKU pada SO yang sudah selesai')}
   ${vol('a','Variance Qty',signed(k.net_qty_diff),'Net Actual Qty − System Qty')}
  </div>
  <div class="sec-title">Financial, Risiko & Adjustment <small>Nilai selisih dan SO yang terlambat.</small></div>
  <div class="vols">
   ${vol('r','Gross Missing',rp(-k.missing_value),'Nilai kekurangan stok (actual < sistem)')}
   ${vol('g','Surplus',rp(k.surplus_value,true),'Nilai kelebihan stok (actual > sistem)')}
   ${vol('r','Total Value Loss',rp(k.abs_value),'Total nilai selisih absolut')}
   ${vol('a','Overdue',n(k.so_overdue),'SO terjadwal yang sudah lewat tanggal')}
  </div>
  <div class="sec-title">Ringkasan Toko <small>Progress SO berjalan per toko.</small></div>
  <div class="store-grid">${state.dashboard.length?state.dashboard.map(storeCard).join(''):'<div class="empty">Belum ada toko yang diizinkan untuk akun ini.</div>'}</div>`;
 }
 if(d.tab==='acc'){
  body=`<div class="tablewrap"><table><thead><tr><th>Toko</th><th>Status SO</th><th class="num">SKU</th><th class="num">Selesai</th><th class="num">SKU Accuracy</th><th class="num">Qty Accuracy</th><th class="num">Value Accuracy</th></tr></thead><tbody>
  ${state.dashboard.map(s=>`<tr><td><b>${escapeHTML(s.name)}</b><br><small class="muted">${escapeHTML(s.code)}</small></td><td>${chip(s.status,s.status==='BELUM SO'?'BELUM SO':undefined)}</td><td class="num">${n(s.total)}</td><td class="num">${n(s.done)}</td><td class="num">${P(s.accuracy)}</td><td class="num">${P(s.qty_accuracy)}</td><td class="num">${P(s.value_accuracy)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Belum ada data.</td></tr>'}
  </tbody></table></div><p class="footerhint">Akurasi hanya dihitung dari SO berstatus APPROVED (per toko, SO terakhir).</p>`;
 }
 if(d.tab==='wf'){
  const step=(label,val,tone)=>`<div class="wf ${tone}"><small>${label}</small><b>${n(val)}</b></div>`;
  body=`<div class="wf-row">${step('Terjadwal',k.so_scheduled,'blue')}<i>→</i>${step('Sedang Counting',k.so_running,'orange')}<i>→</i>${step('Validasi SPV',k.so_submitted,'amber')}<i>→</i>${step('Approved',k.so_approved,'green')}</div>
  <p class="footerhint">Alur: Jadwal (SCHEDULED) → Counting Store (COUNTING/RECOUNT) → Validasi SPV (SUBMITTED) → Approved.</p>`;
 }
 if(d.tab==='risk'){
  const rows=state.dashboard.slice().sort((x,y)=>(x.total?x.done/x.total:0)-(y.total?y.done/y.total:0));
  body=`<div class="store-grid">${rows.map(storeCard).join('')||'<div class="empty">Belum ada data.</div>'}</div><p class="footerhint">Diurutkan dari progress terendah.</p>`;
 }
 if(d.tab==='act'){
  body=isAdmin()?'<div class="card" id="auditCard"></div>':'<div class="empty">Log aktivitas hanya tersedia untuk Admin.</div>';
 }
 $('#content').innerHTML=`<div class="card filter-card">
  <div class="filters">
   <select class="input select" id="dStore">${storeOptions(d.store,true)}</select>
   <select class="input select" id="dType"><option value="">Semua Jenis SO</option><option value="GRAND" ${d.type==='GRAND'?'selected':''}>Grand SO</option><option value="PARTIAL" ${d.type==='PARTIAL'?'selected':''}>Partial SO</option></select>
   ${rangeControlHTML('dash',d.range)}
   ${btn('Terapkan','dash-apply','primary')}${btn('Reset','dash-reset','outline')}
  </div>
  <div class="note info">Dasar perhitungan: SO yang sudah SUBMITTED atau APPROVED, termasuk SO yang sudah dibersihkan dari database. Akurasi hanya dari SO APPROVED.</div>
 </div>
 <div class="card tabs-card"><span class="tabs-lbl">ANALISA DASHBOARD</span>${tabs.map(([id,l])=>`<button class="tab ${d.tab===id?'on':''}" data-act="dash-tab" data-tab="${id}">${l}</button>`).join('')}</div>
 ${body}`;
 if(d.tab==='act'&&isAdmin())loadAudit().catch(()=>{});
}
ACT['dash-apply']=async()=>{const d=state.dash;d.store=$('#dStore').value;d.type=$('#dType').value;await showDashboard()};
ACT['dash-reset']=async()=>{state.dash={tab:state.dash.tab,store:'',type:'',range:{kind:'all',from:'',to:''}};await showDashboard()};
ACT['dash-tab']=async el=>{state.dash.tab=el.dataset.tab;await showDashboard()};

// ===== Import CSV inventory =====
function parseCSV(text){
 text=text.replace(/^﻿/,'');let inQuote=false,cur='',row=[],rows=[];
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(inQuote&&text[i+1]==='"'){cur+='"';i++}else inQuote=!inQuote}else if(!inQuote&&(ch===','||ch===';'||ch==='\t')){
   cur+=ch;
 }else if(!inQuote&&(ch==='\r'||ch==='\n')){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur=''}else cur+=ch;}
 if(inQuote)throw Error('Format CSV tidak valid: tanda kutip tidak tertutup.');if(cur||row.length){row.push(cur);rows.push(row)}
 if(!rows.length)throw Error('CSV kosong.');
 const header=rows[0].join('');const counts=[',',';','\t'].map(delim=>[delim,(header.match(new RegExp(delim==='\t'?'\\t':delim,'g'))||[]).length]);counts.sort((a,b)=>b[1]-a[1]);const delim=counts[0][0];
 if(!counts[0][1])throw Error('CSV harus memiliki beberapa kolom terpisah koma / titik koma / tab.');
 let final=[],part='',cells=[],quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){part+='"';i++}else quoted=!quoted}else if(ch===delim&&!quoted){cells.push(part);part=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;cells.push(part);if(cells.some(x=>x.trim()))final.push(cells);cells=[];part=''}else part+=ch}
 if(part!==''||cells.length){cells.push(part);if(cells.some(x=>x.trim()))final.push(cells)}
 return final;
}
function normHead(s){return String(s||'').trim().toLowerCase().replace(/[\s_-]+/g,'')}
function importRows(csv){const parsed=parseCSV(csv);const headers=parsed.shift().map(normHead);const index=names=>names.map(normHead).map(v=>headers.indexOf(v)).find(i=>i>=0)??-1;
 const cSku=index(['SKU','Item SKU','Kode SKU','Kode Item']);const cName=index(['NAME_VARIANT','Name - Variant','Name Variant','Item Name','Nama Item']);const cEnd=index(['ENDING','Ending Inventory','Qty','Stok Akhir']);const cCat=index(['CATEGORY','Category Name','Category']);const cRetail=index(['Harga Retail','Retail Price','Harga_Retail','RETAIL']);const cCost=index(['COST','HPP','Unit Cost','Unit_Cost']);
 if(cName<0||cEnd<0)throw Error('Header CSV harus memuat Name - Variant (atau NAME_VARIANT) dan Ending.');
 const body=parsed.filter(v=>!(v[cEnd]||'').trim().startsWith('-'));if(body.length>10000)throw Error('Maksimal 10.000 SKU per upload.');const seen=new Set();const out=body.map((v,i)=>{const rawSku=cSku>=0?(v[cSku]||''):(v[cName]||'');const sku=rawSku.trim().toUpperCase(),name=(v[cName]||'').trim(),ending=(v[cEnd]||'').trim(),cost=cCost>=0?(v[cCost]||'0').trim():'0',retail=cRetail>=0?((v[cRetail]||'').trim()||'0'):'0';
 if(!sku||!name||!/^\d+$/.test(ending)||!/^\d+(\.\d{1,2})?$/.test(cost)||!/^\d+(\.\d{1,2})?$/.test(retail))throw Error(`Baris ${i+2} tidak valid: SKU/nama/Ending/Cost.`);
 if(seen.has(sku))throw Error('SKU duplikat: '+sku);seen.add(sku);return{sku,name,category:cCat>=0?(v[cCat]||'').trim():'',ending:Number(ending),cost:Number(cost),retail:Number(retail)};});out.skipped=parsed.length-body.length;return out;
}

// ===== Warna: nama warna konsisten (teks sebelum ukuran, mis. "ABU MUDA 24S PDK 2XL" -> ABU MUDA) =====
const COLOR_EXACT={'HITAM':'#111827','PUTIH':'#ffffff','ABU MUDA':'#c4c9d1','ABU TUA':'#4b5563','TANPA WARNA':'#e5e7eb',
 'SKY BLUE':'#7dd3fc','STEEL BLUE':'#4b6584','ORANGE BATA':'#c2410c','COKLAT TUA':'#6b3f24','MERAH CABE':'#dc2626',
 'BENHUR':'#2563eb','TOSCA':'#14b8a6','TURKIS':'#06b6d4','CREAM':'#f3e3bf','NAVY':'#1e3a8a','MAROON':'#7f1d1d','BURGUNDY':'#800020',
 'OFF WHITE':'#f8f5ee','BABY PINK':'#f9c6d6','ALMOND BROWN':'#a0785a','BLUSH RED':'#d9546b','BABY BLUE':'#bae6fd'};
const COLOR_WORD={HITAM:'#111827',BLACK:'#111827',PUTIH:'#ffffff',WHITE:'#ffffff',IVORY:'#fffff0',SUSU:'#fbf7ee',
 ABU:'#9ca3af',GREY:'#9ca3af',GRAY:'#9ca3af',CHARCOAL:'#374151',ANTRASIT:'#3f3f46',ANTHRACITE:'#3f3f46',SILVER:'#c0c0c0',SMOKE:'#8e9196',
 NAVY:'#1e3a8a',ROYAL:'#2563eb',BIRU:'#2563eb',BLUE:'#2563eb',COBALT:'#1d4ed8',BENHUR:'#2563eb',DENIM:'#3b5b92',JEANS:'#3b5b92',
 SKY:'#7dd3fc',LAUT:'#1e40af',STEEL:'#4b6584',TOSCA:'#14b8a6',TEAL:'#14b8a6',TURKIS:'#06b6d4',TURQUOISE:'#06b6d4',AQUA:'#22d3ee',MINT:'#86efac',
 HIJAU:'#16a34a',GREEN:'#16a34a',OLIVE:'#6b7a2b',ARMY:'#4b5320',MILITER:'#4b5320',MILITARY:'#4b5320',LIME:'#84cc16',APEL:'#a3c93a',EMERALD:'#059669',SAGE:'#9caf88',
 MERAH:'#dc2626',RED:'#dc2626',CABE:'#dc2626',CHERRY:'#be123c',MAROON:'#7f1d1d',BURGUNDY:'#800020',WINE:'#722f37',
 ORANGE:'#f97316',JINGGA:'#f97316',BATA:'#c2410c',CORAL:'#ff7f50',SALMON:'#fa8072',PEACH:'#ffcba4',
 KUNING:'#facc15',YELLOW:'#facc15',MUSTARD:'#d4a017',GOLD:'#d4af37',EMAS:'#d4af37',LEMON:'#fde047',
 PINK:'#ec4899',FUCHSIA:'#d946ef',MAGENTA:'#c026d3',ROSE:'#e11d48',BLUSH:'#f4a7b9',
 UNGU:'#7c3aed',PURPLE:'#7c3aed',VIOLET:'#8b5cf6',LILAC:'#c8a2c8',LAVENDER:'#b4a7d6',PLUM:'#8e4585',MAUVE:'#b784a7',
 COKLAT:'#92400e',BROWN:'#92400e',COKELAT:'#92400e',CHOCO:'#5c3a21',MOCHA:'#7b5b4a',MOCCA:'#7b5b4a',TOBACCO:'#8b5a2b',TOBACO:'#8b5a2b',
 BEIGE:'#d8c3a5',KHAKI:'#c3b091',SAND:'#e0cda9',NUDE:'#e8c9b1',CAMEL:'#c19a6b',TAUPE:'#8b8589',ALMOND:'#efdecd',CREAM:'#f3e3bf',KRIM:'#f3e3bf'};
const MOD_LIGHT=/^(BABY|MUDA|LIGHT|PALE|SOFT|LIGHTS?)$/, MOD_DARK=/^(TUA|DARK|DEEP)$/;
const hexToRgb=h=>{const v=parseInt(h.slice(1),16);return[(v>>16)&255,(v>>8)&255,v&255]};
const rgbToHex=c=>'#'+c.map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('');
const mixHex=(hex,target,t)=>{const a=hexToRgb(hex),b=hexToRgb(target);return rgbToHex(a.map((x,i)=>x+(b[i]-x)*t))};
const luminance=hex=>{const c=hexToRgb(hex).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
function colorHex(name){
 const key=String(name||'').toUpperCase().replace(/\s+/g,' ').trim();
 if(COLOR_EXACT[key])return COLOR_EXACT[key];
 const words=key.split(' ');
 let base=null;
 for(let i=words.length-1;i>=0;i--){if(COLOR_WORD[words[i]]){base=COLOR_WORD[words[i]];break}}
 if(!base)return '#94a3b8';
 let hex=base;
 if(words.some(w=>MOD_LIGHT.test(w)))hex=mixHex(hex,'#ffffff',0.4);
 if(words.some(w=>MOD_DARK.test(w)))hex=mixHex(hex,'#000000',0.3);
 return hex;
}
function colorStyle(name){const hex=colorHex(name);const lum=luminance(hex);return{bg:hex,fg:lum>0.45?'#111827':'#ffffff',ring:lum>0.8}}
const swatchStyle=st=>`background:${st.bg};${st.ring?'box-shadow:inset 0 0 0 1.5px #94a3b8;':''}`;

// ===== SO Schedule =====
function assignNo(rows){
 const cnt={};
 rows.slice().sort((a,b)=>(a.planned_date||'').localeCompare(b.planned_date||'')||(a.started_at||'').localeCompare(b.started_at||'')).forEach(r=>{
  const k=r.store_code+r.so_type+(r.planned_date||r.started_at||'').slice(0,7);cnt[k]=(cnt[k]||0)+1;
  r.no=`SO-${r.so_type==='PARTIAL'?'P':'G'}-${r.store_code}-${(r.planned_date||r.started_at||'').slice(0,7).replace('-','')}-${String(cnt[k]).padStart(3,'0')}`;
 });
 return rows;
}
function schActions(r){
 const a=[],mgr=canManage();
 if(r.status==='SCHEDULED'){
  a.push(btn('▶ Proses','sch-start','primary',{store:r.store_code}));
  if(mgr)a.push(btn('✎ Edit','sch-edit','outline',{id:r.id}));
  if(mgr)a.push(btn('Hapus','sch-del','danger',{id:r.id}));
 }else if(r.status==='COUNTING'||r.status==='RECOUNT'){
  a.push(btn('Lanjut Draft','count-open','primary',{store:r.store_code}));
  if(mgr)a.push(btn('Hapus','sch-del','danger',{id:r.id}));
 }else{
  a.push(btn('View Detail','val-open','outline',{id:r.id,store:r.store_code}));
  if(isAdmin()&&r.status==='SUBMITTED')a.push(btn('Hapus','sch-del','danger',{id:r.id}));
 }
 return a.join('');
}
async function showSchedule(){
 const sc=state.sch;
 const rows=assignNo(await rpc('schedule_list',{p_store:sc.store||null}));
 sc.rows=rows;
 const [from,to]=rangeBounds(sc.range);
 const inR=r=>(!from||(r.planned_date||'')>=from)&&(!to||(r.planned_date||'')<=to);
 const show=rows.filter(r=>r.status!=='APPROVED'||inR(r));
 const open=rows.filter(r=>r.status!=='APPROVED').length,doneP=rows.filter(r=>r.status==='APPROVED'&&inR(r)).length;
 const groups=new Map();
 for(const r of show.slice().sort((a,b)=>(a.planned_date||'').localeCompare(b.planned_date||''))){
  if(!groups.has(r.store_code))groups.set(r.store_code,{name:r.store_name,rows:[]});
  groups.get(r.store_code).rows.push(r);
 }
 $('#content').innerHTML=`<div class="toolbar-top">
  <div class="pills"><span class="pill-stat">Belum Selesai · ${n(open)}</span><span class="pill-stat ok">Selesai pada periode · ${n(doneP)}</span></div>
  <div class="toolbar-right"><select class="input select" id="schStoreSel" data-change="sch-filter">${storeOptions(sc.store,true)}</select>${rangeControlHTML('sch',sc.range)}
   ${canManage()?btn('+ Partial SO','b-open','outline',{type:'PARTIAL'})+btn('+ Grand SO','b-open','primary',{type:'GRAND'}):''}</div></div>
 <div class="note info">${canManage()?'Folder per store berisi SO yang masih perlu diproses. SO APPROVED tampil sesuai rentang tanggal yang dipilih.':'Tampilan Store: jadwal SO toko Anda (hanya lihat). Klik Proses untuk memulai SO.'}</div>
 ${groups.size?[...groups.values()].map(g=>`<div class="card">
   <div class="card-head"><h3>▣ ${escapeHTML(g.name)}</h3><span class="muted small">${n(g.rows.length)} SO</span></div>
   <div class="tablewrap"><table><thead><tr><th>SO</th><th>Tanggal</th><th>PIC</th><th>Status</th><th class="num">SKU</th><th>Action</th></tr></thead><tbody>${g.rows.map(r=>`<tr><td><b class="mono">${escapeHTML(r.no)}</b><br><small class="muted">${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}${r.start_time?' • '+escapeHTML(r.start_time.slice(0,5)):''}${r.team_map?' • per tim/POS':(r.scope_rule?' • category/warna':'')}</small></td><td>${fmtDate(r.planned_date)}</td><td>${escapeHTML(r.pic||'-')}</td><td>${chip(r.status)}</td><td class="num">${n(r.scope_count)}</td><td class="actions">${schActions(r)}</td></tr>`).join('')}</tbody></table></div>
  </div>`).join(''):'<div class="card empty">Belum ada SO pada filter ini.'+(canManage()?' Klik + Partial SO atau + Grand SO untuk membuat jadwal.':'')+'</div>'}`;
}
CHG['sch-filter']=async()=>{state.sch.store=$('#schStoreSel').value;await showSchedule()};
ACT['sch-start']=async el=>{
 if(!confirm('Mulai SO dan kunci stok sistem awal sekarang?'))return;
 await rpc('start',{p_store:el.dataset.store});toast('SO dimulai. Lanjutkan menghitung di SO Counting.');
 state.store=el.dataset.store;state.count.open=true;state.count.offset=0;state.count.search='';state.count.filter='ALL';state.count.team='';state.page='count';await render();
};
ACT['sch-edit']=async el=>{const r=state.sch.rows.find(x=>x.id===el.dataset.id);if(!r)throw Error('Jadwal tidak ditemukan. Muat ulang halaman.');openBuilder(null,r)};
ACT['sch-del']=async el=>{
 if(!confirm('Hapus SO/jadwal ini? Draft counting yang belum disubmit ikut terhapus.'))return;
 await rpc('schedule_delete',{p_cycles:[el.dataset.id]});toast('Jadwal dihapus');
 state.count.sel.delete(el.dataset.id);await render();
};
ACT['b-open']=async el=>openBuilder(el.dataset.type,null);

// ----- Builder Partial / Grand SO -----
// cats = Map(kategori -> Set(warna)); Set kosong = seluruh warna pada kategori.
// scopeMode: ALL (Grand seluruh SKU) | SCOPE (kategori/warna + SKU manual) | TEAMS (pembagian tim/POS).
function newScope(){return{cats:new Map(),skus:new Set()}}
function scopeFromRule(rule){
 const s=newScope();
 if(rule){(rule.categories||[]).forEach(c=>s.cats.set(c,new Set((rule.colors||{})[c]||[])));(rule.skus||[]).forEach(x=>s.skus.add(x))}
 return s;
}
function ruleOf(scope){
 const categories=[...scope.cats.keys()];const colors={};
 for(const [cat,set] of scope.cats)if(set.size)colors[cat]=[...set];
 return{categories,colors,skus:[...scope.skus]};
}
const isEmptyRule=r=>!r.categories.length&&!r.skus.length;
function ownerScope(b,owner){return owner==='main'?b.scope:b.teams[Number(owner)]?.scope}
function teamsPayload(b){return b.teams.map(t=>({name:(t.name||'').trim()||'Tim',rule:ruleOf(t.scope)}))}
function openBuilder(type,cycle){
 const sc=state.sch;const edit=!!cycle;
 const b={mode:edit?'edit':'create',cycleId:cycle?.id||null,type:edit?cycle.so_type:(type||'GRAND'),store:edit?cycle.store_code:(sc.store||state.stores[0]?.code||''),
  scopeMode:'ALL',scope:newScope(),teams:[],stats:new Map(),catList:null,skuQ:'',timer:null};
 if(edit){
  b.scope=scopeFromRule(cycle.scope_rule);
  b.teams=(cycle.team_map||[]).map(t=>({name:t.name,scope:scopeFromRule(t.rule)}));
  b.scopeMode=b.teams.length?'TEAMS':(cycle.scope_rule?'SCOPE':'ALL');
 }else{
  b.scopeMode=b.type==='PARTIAL'?'SCOPE':'ALL';
 }
 if(b.type==='PARTIAL'&&b.scopeMode==='ALL')b.scopeMode='SCOPE';
 state.builder=b;
 const ov=document.createElement('div');ov.id='builder';ov.className='modal-bg';
 ov.innerHTML=`<div class="modal">
  <div class="modal-head"><div><h3>${edit?'Edit Jadwal SO':'Buat Jadwal SO Baru'}</h3><p>${edit?escapeHTML(cycle.no||''):'Pilih toko, jadwal, dan scope SO sebelum menyimpan.'}</p></div><button class="x" data-act="b-close" title="Tutup">×</button></div>
  <div class="builder">
   <div class="bcol">
    <div class="step"><span>1</span><h4>Jadwal & Scope</h4></div>
    <label class="field">Toko *<select id="bStore" class="input" data-change="b-store" ${edit?'disabled':''}>${state.stores.map(s=>`<option value="${escapeHTML(s.code)}" ${s.code===b.store?'selected':''}>${escapeHTML(s.name)}</option>`).join('')}</select></label>
    <div class="field"><span>Jenis SO *</span><div class="seg"><button class="${b.type==='GRAND'?'on':''}" data-act="b-type" data-v="GRAND">Grand SO</button><button class="${b.type==='PARTIAL'?'on':''}" data-act="b-type" data-v="PARTIAL">Partial SO</button></div></div>
    <div class="grid3">
     <label class="field">Tanggal *<input type="date" id="bDate" class="input" value="${edit?(cycle.planned_date||''):iso(new Date(Date.now()+864e5))}" data-change="b-field"/></label>
     <label class="field">Jam mulai<input type="time" id="bStart" class="input" value="${edit?(cycle.start_time||'').slice(0,5):''}" data-change="b-field"/></label>
     <label class="field">Jam selesai<input type="time" id="bEnd" class="input" value="${edit?(cycle.end_time||'').slice(0,5):''}" data-change="b-field"/></label>
    </div>
    <label class="field">Catatan<input id="bNotes" class="input" maxlength="500" value="${escapeHTML(edit?(cycle.notes||''):'')}"/></label>
    <div id="bScope"></div>
   </div>
   <div class="pcol"><div class="step"><span>2</span><h4>Preview Schedule</h4></div><div id="bPreview"></div></div>
  </div>
  <div class="modal-foot"><button class="btn outline" data-act="b-close">Batal</button><button class="btn primary" data-act="b-save">${edit?'Simpan Perubahan':'Create Schedule'}</button></div>
 </div>`;
 document.body.appendChild(ov);
 renderScope().catch(ex=>toast(ex.message,true));
}
function closeBuilder(){document.getElementById('builder')?.remove();state.builder=null}
ACT['b-close']=()=>closeBuilder();
ACT['b-type']=async el=>{const b=state.builder;if(!b)return;b.type=el.dataset.v;if(b.type==='PARTIAL'&&b.scopeMode==='ALL')b.scopeMode='SCOPE';await renderScope()};
ACT['b-mode']=async el=>{const b=state.builder;if(!b)return;b.scopeMode=el.dataset.v;if(b.scopeMode==='TEAMS'&&!b.teams.length)b.teams.push({name:'POS 1',scope:newScope()});await renderScope()};
CHG['b-store']=async el=>{const b=state.builder;if(!b)return;b.store=el.value;b.scope=newScope();b.teams=[];b.stats=new Map();b.catList=null;await renderScope()};
CHG['b-field']=()=>schedulePreview();
CHG['b-cat']=async el=>{const b=state.builder;const s=b&&ownerScope(b,el.dataset.owner);if(!s)return;el.checked?s.cats.set(el.value,new Set()):s.cats.delete(el.value);await renderScope()};
ACT['b-cat-all']=async()=>{const b=state.builder;if(!b||!b.catList)return;b.scope.cats=new Map(b.catList.map(c=>[c.category,new Set()]));await renderScope()};
ACT['b-cat-clear']=async()=>{const b=state.builder;if(!b)return;b.scope.cats=new Map();await renderScope()};
ACT['b-color-all']=async el=>{const b=state.builder;const s=b&&ownerScope(b,el.dataset.owner);if(!s)return;s.cats.set(el.dataset.cat,new Set());await renderScope()};
ACT['b-color-clear']=async el=>{const b=state.builder;const s=b&&ownerScope(b,el.dataset.owner);if(!s)return;s.cats.delete(el.dataset.cat);await renderScope()};
CHG['b-color']=async el=>{
 const b=state.builder;const s=b&&ownerScope(b,el.dataset.owner);if(!s)return;
 const cat=el.dataset.cat;const list=(b.stats.get(cat)||[]).map(x=>x.color);
 let set=s.cats.get(cat);if(!set||set.size===0)set=new Set(list);
 if(el.checked)set.add(el.value);else set.delete(el.value);
 if(set.size===0){toast('Kosongkan kategori dengan tombol "Kosongkan" atau hapus centang kategori.',true);await renderScope();return}
 s.cats.set(cat,set.size>=list.length?new Set():set);
 await renderScope();
};
CHG['b-sku']=el=>{const b=state.builder;if(!b)return;el.checked?b.scope.skus.add(el.value):b.scope.skus.delete(el.value);drawSkuChips();schedulePreview()};
ACT['b-sku-del']=async el=>{const b=state.builder;if(!b)return;b.scope.skus.delete(el.dataset.sku);drawSkuChips();const cb=$$('#bSkuList input').find(x=>x.value===el.dataset.sku);if(cb)cb.checked=false;schedulePreview()};
CHG['b-search']=async el=>{
 const b=state.builder;if(!b)return;b.skuQ=el.value.trim();
 const d=await rpc('inventory_list',{p_store:b.store,p_offset:0,p_limit:50,p_search:b.skuQ});
 $('#bSkuList').innerHTML=(d.items||[]).map(x=>`<label class="sku-row"><input type="checkbox" data-change="b-sku" value="${escapeHTML(x.sku)}" ${b.scope.skus.has(x.sku)?'checked':''}/><span class="mono">${escapeHTML(x.sku)}</span><small>${escapeHTML(x.name)}</small><em>${n(x.ending)}</em></label>`).join('')||'<div class="empty small">Tidak ada SKU yang cocok.</div>';
};
CHG['b-team-name']=el=>{const b=state.builder;const t=b&&b.teams[Number(el.dataset.idx)];if(!t)return;t.name=el.value;schedulePreview()};
ACT['b-team-add']=async()=>{const b=state.builder;if(!b)return;b.teams.push({name:'POS '+(b.teams.length+1),scope:newScope()});await renderScope()};
ACT['b-team-del']=async el=>{const b=state.builder;if(!b)return;b.teams.splice(Number(el.dataset.idx),1);await renderScope()};

async function ensureStats(b,cats){
 for(const c of cats){
  if(b.stats.has(c))continue;
  try{b.stats.set(c,await rpc('color_stats',{p_store:b.store,p_category:c}))}catch(ex){b.stats.set(c,[]);toast(ex.message,true)}
 }
}
function colorPanelHTML(owner,cat,set,list){
 if(!list)return '<div class="color-panel small muted">Memuat warna…</div>';
 const all=list.map(x=>x.color);const whole=!set||set.size===0;
 if(!all.length)return '<div class="color-panel small muted">Tidak ada SKU pada category ini.</div>';
 const head=`<div class="cp-head"><span class="small"><b>Warna ${escapeHTML(cat)}</b> — ${whole?'seluruh warna':n(set.size)+' dari '+n(all.length)+' warna'}</span>
  <span class="cp-actions"><button class="link-btn" data-act="b-color-all" data-owner="${escapeHTML(owner)}" data-cat="${escapeHTML(cat)}">Pilih semua</button><button class="link-btn muted-link" data-act="b-color-clear" data-owner="${escapeHTML(owner)}" data-cat="${escapeHTML(cat)}">Kosongkan</button></span></div>`;
 return `<div class="color-panel">${head}${list.map(x=>{const checked=whole||set.has(x.color);const st=colorStyle(x.color);return `<label class="crow ${checked?'on':''}"><input type="checkbox" data-change="b-color" data-owner="${escapeHTML(owner)}" data-cat="${escapeHTML(cat)}" value="${escapeHTML(x.color)}" ${checked?'checked':''}/><i class="swatch" style="${swatchStyle(st)}"></i><span class="cname">${escapeHTML(x.color)}</span><small>${n(x.sku_count)} SKU</small><em>${x.so_count?n(x.so_count)+'x SO':'Belum pernah SO'}${x.last_date?' · Terakhir '+fmtDate(x.last_date):''}</em></label>`}).join('')}</div>`;
}
function catBlocksHTML(b,owner,scope){
 if(!b.catList)return '<div class="empty small">Memuat category…</div>';
 if(!b.catList.length)return '<div class="empty small">Belum ada category pada inventory toko ini.</div>';
 return b.catList.map(c=>{
  const on=scope.cats.has(c.category);const set=scope.cats.get(c.category);
  const sub=on?(set&&set.size?n(set.size)+' warna dipilih':'seluruh warna'):n(c.count)+' SKU';
  return `<div class="cat-block ${on?'open':''}"><label class="cat ${on?'on':''}"><input type="checkbox" data-change="b-cat" data-owner="${escapeHTML(owner)}" value="${escapeHTML(c.category)}" ${on?'checked':''}/><span><b>${escapeHTML(c.category||'(Tanpa category)')}</b><small>${sub}</small></span></label>${on?colorPanelHTML(owner,c.category,set,b.stats.get(c.category)):''}</div>`;
 }).join('');
}
function teamCardsHTML(b){
 if(!b.teams.length)return '<div class="empty small">Belum ada tim/POS. Tambahkan tim, lalu pilih category dan warna untuk tiap tim.</div>';
 return b.teams.map((t,i)=>`<div class="team-card">
   <div class="team-head"><span class="team-no">${i+1}</span><input class="input" value="${escapeHTML(t.name)}" maxlength="60" data-change="b-team-name" data-idx="${i}" placeholder="Nama tim / POS"/><button class="btn danger" data-act="b-team-del" data-idx="${i}">Hapus</button></div>
   <div class="cat-grid">${catBlocksHTML(b,String(i),t.scope)}</div>
   <div class="small muted team-count" id="tc${i}">Belum dihitung</div>
 </div>`).join('');
}
function drawSkuChips(){
 const b=state.builder;if(!b)return;
 const box=$('#bSkuChips');if(box)box.innerHTML=[...b.scope.skus].map(s=>`<span class="sku-chip mono">${escapeHTML(s)} <button class="chip-x" data-act="b-sku-del" data-sku="${escapeHTML(s)}" title="Hapus">×</button></span>`).join('')||'<span class="small muted">Belum ada SKU manual.</span>';
 const c=$('#bSkuCount');if(c)c.textContent=b.scope.skus.size;
}
function keepScroll(){return $$('#builder .modal,#builder .bcol,#builder .pcol').map(e=>e.scrollTop)}
function restoreScroll(pos){$$('#builder .modal,#builder .bcol,#builder .pcol').forEach((e,i)=>{if(pos[i]!==undefined)e.scrollTop=pos[i]})}
async function renderScope(){
 const b=state.builder;if(!b)return;const box=$('#bScope');if(!box)return;
 const modes=b.type==='GRAND'?[['ALL','Seluruh SKU'],['SCOPE','Category & Warna'],['TEAMS','Bagi per Tim / POS']]:[['SCOPE','Category & Warna'],['TEAMS','Bagi per Tim / POS']];
 if(!modes.some(m=>m[0]===b.scopeMode))b.scopeMode=modes[0][0];
 if(!b.catList){b.catList=await rpc('categories',{p_store:b.store})}
 if(state.builder!==b)return;
 const cats=new Set([...b.scope.cats.keys(),...b.teams.flatMap(t=>[...t.scope.cats.keys()])]);
 await ensureStats(b,[...cats]);
 if(state.builder!==b)return;
 const modeSeg=`<div class="field"><span>Cara SO *</span><div class="seg">${modes.map(([v,l])=>`<button class="${b.scopeMode===v?'on':''}" data-act="b-mode" data-v="${v}">${l}</button>`).join('')}</div></div>`;
 let body='';
 if(b.scopeMode==='ALL'){
  body=`<div class="scope-box"><b>Scope: seluruh SKU inventory toko</b><p class="small muted">Stok sistem dikunci saat SO dimulai (Proses). Pilih Category & Warna atau Bagi per Tim / POS bila SO hanya sebagian.</p></div>`;
 }else if(b.scopeMode==='SCOPE'){
  body=`<div class="scope-box">
    <div class="scope-head"><b>Category & Warna</b>
     <span class="cp-actions"><button class="link-btn" data-act="b-cat-all">Pilih semua category</button><button class="link-btn muted-link" data-act="b-cat-clear">Kosongkan semua</button></span></div>
    <p class="small muted">Pilih category, lalu pilih warna yang di-SO. Tanpa pilih warna, seluruh warna category ikut.</p>
    <div class="cat-grid">${catBlocksHTML(b,'main',b.scope)}</div>
    <div class="scope-head"><b>SKU manual (opsional)</b></div>
    <div class="sku-cloud" id="bSkuChips"></div>
    <input id="bSearch" class="input" value="${escapeHTML(b.skuQ)}" placeholder="Cari SKU / nama produk, lalu Enter" data-change="b-search"/>
    <div id="bSkuList" class="sku-list"></div>
    <div class="small muted">SKU manual dipilih: <b id="bSkuCount">${b.scope.skus.size}</b></div>
   </div>`;
 }else{
  body=`<div class="scope-box">
    <div class="scope-head"><b>Pembagian Tim / POS</b><span class="small muted">Setiap SKU masuk ke tim pertama yang category/warnanya cocok. SKU di luar semua tim tidak di-SO.</span></div>
    <div class="teams">${teamCardsHTML(b)}</div>
    <button class="btn outline" data-act="b-team-add">+ Tambah Tim / POS</button>
   </div>`;
 }
 const keep=keepScroll();
 box.innerHTML=modeSeg+body;
 restoreScroll(keep);
 if(b.scopeMode==='SCOPE')drawSkuChips();
 updatePreview();
}
function schedulePreview(){const b=state.builder;if(!b)return;clearTimeout(b.timer);b.timer=setTimeout(updatePreview,250)}
async function updatePreview(){
 const b=state.builder;if(!b||!$('#bPreview'))return;
 const store=$('#bStore')?.value||b.store;
 const date=$('#bDate')?.value||'',start=$('#bStart')?.value||'',end=$('#bEnd')?.value||'';
 let info={count:0,sample:[]},teamRes=null,total=null,err='';
 try{
  if(b.scopeMode==='TEAMS'){
   teamRes=await rpc('teams_preview',{p_store:store,p_teams:teamsPayload(b)});
   total=(await rpc('scope_preview',{p_store:store,p_type:'GRAND',p_rule:{}})).count;
   info={count:teamRes.count,sample:[]};
  }else if(b.scopeMode==='SCOPE'){
   info=await rpc('scope_preview',{p_store:store,p_type:b.type,p_rule:ruleOf(b.scope)});
  }else{
   info=await rpc('scope_preview',{p_store:store,p_type:'GRAND',p_rule:{}});
  }
 }catch(ex){err=ex.message}
 if(state.builder!==b||!$('#bPreview'))return;
 if(teamRes&&b.teams.length){teamRes.teams.forEach((t,i)=>{const el=$('#tc'+i);if(el)el.textContent=`${n(t.count)} SKU`})}
 const cats=b.scope.cats.size,colorsSel=[...b.scope.cats.values()].filter(s=>s.size).length;
 const desc=b.scopeMode==='ALL'?'Seluruh inventory toko'
  :b.scopeMode==='SCOPE'?`${n(cats)} category${colorsSel?` • ${n(colorsSel)} dengan pilihan warna`:''} • ${n(b.scope.skus.size)} SKU manual`
  :`${n(b.teams.length)} tim/POS`;
 const uncovered=total!==null&&teamRes?Math.max(0,total-teamRes.count):null;
 $('#bPreview').innerHTML=`<div class="prev">
   <div class="prev-stats"><div><small>Toko</small><b>${escapeHTML(labelStore(store))}</b></div><div><small>Jenis</small><b>${b.type==='GRAND'?'Grand SO':'Partial SO'}</b></div><div><small>Tanggal</small><b>${fmtDate(date)}</b></div><div><small>Jam</small><b>${start||'—'}${end?' – '+end:''}</b></div></div>
   <div class="prev-big"><small>SKU yang di-SO</small><b>${n(info.count)}</b><span>${desc}</span></div>
   ${b.scopeMode==='TEAMS'&&teamRes?`<div class="team-summary">${teamRes.teams.map(t=>`<div><span>${escapeHTML(t.name)}</span><b>${n(t.count)} SKU</b></div>`).join('')}${uncovered?`<div class="warn-line"><span>Tidak masuk tim (tidak di-SO)</span><b>${n(uncovered)} SKU</b></div>`:''}</div>`:''}
   ${err?`<div class="note warning">${escapeHTML(err)}</div>`:''}
   ${info.sample?.length?`<div class="sku-cloud">${info.sample.map(s=>`<span class="sku-chip mono">${escapeHTML(s)}</span>`).join('')}${info.count>info.sample.length?`<span class="small muted">+${n(info.count-info.sample.length)} lainnya</span>`:''}</div>`:''}
   ${b.type==='PARTIAL'&&b.scopeMode==='SCOPE'&&!cats&&!b.scope.skus.size?'<div class="note">Pilih minimal satu category atau SKU.</div>':''}
   <div class="note info small">Stok sistem dikunci saat SO dimulai (Proses), bukan saat jadwal dibuat.</div>
 </div>`;
}
ACT['b-save']=async()=>{
 const b=state.builder;if(!b)return;
 const store=$('#bStore').value,date=$('#bDate').value,start=$('#bStart').value||null,end=$('#bEnd').value||null,notes=$('#bNotes').value.trim();
 if(!date)throw Error('Tanggal jadwal wajib diisi.');
 let p_rule={},p_teams=[];
 if(b.scopeMode==='SCOPE'){
  const r=ruleOf(b.scope);
  if(isEmptyRule(r))throw Error(b.type==='PARTIAL'?'Pilih minimal satu category, warna, atau SKU untuk Partial SO.':'Pilih category/warna, atau pilih Seluruh SKU.');
  p_rule=r;
 }else if(b.scopeMode==='TEAMS'){
  if(!b.teams.length)throw Error('Tambahkan minimal satu tim/POS.');
  p_teams=teamsPayload(b);
 }
 if(b.mode==='create'){
  if(!confirm(`Simpan jadwal ${b.type==='GRAND'?'Grand':'Partial'} SO untuk ${labelStore(store)} pada ${date}?`))return;
  const out=await rpc('schedule_create',{p_store:store,p_type:b.type,p_date:date,p_start:start,p_end:end,p_notes:notes,p_rule,p_teams});
  toast(`Jadwal dibuat: ${n(out.scope_count)} SKU`);
 }else{
  await rpc('schedule_update',{p_cycle:b.cycleId,p_type:b.type,p_date:date,p_start:start,p_end:end,p_notes:notes,p_rule,p_teams});
  toast('Jadwal diperbarui');
 }
 closeBuilder();await render();
};

// ===== SO Counting: 4 posisi, total, status (TALLY/SELISIH), alasan wajib saat selisih. Sistem tidak ditampilkan. =====
async function showCount(){
 const c=state.count;
 if(state.me.role==='store'){
  await refreshDashboard();const s=current();
  if(!s?.cycle_id||s.status==='SCHEDULED')return countStart(s);
  return loadCount();
 }
 if(c.open){
  await refreshDashboard();const s=current();
  if(!s?.cycle_id){c.open=false;return showCount()}
  return loadCount();
 }
 return showCountList();
}
function countStart(s){
 const back=state.me.role!=='store'?`<div class="crumb"><button class="btn ghost" data-act="count-back">← Daftar SO</button></div>`:'';
 $('#content').innerHTML=`${back}<div class="card stack"><div class="note info">${s?.status==='SCHEDULED'?`SO terjadwal${s.planned_date?' pada '+fmtDate(s.planned_date):''}. Klik Proses untuk memulai dan mengunci stok sistem.`:'Belum ada SO untuk toko ini. Pastikan inventory sudah di-upload.'}</div>${s?.status==='SCHEDULED'||!s?.cycle_id?btn('▶ Proses / Mulai SO','start-so','primary'):''}</div>`;
}
ACT['start-so']=async()=>{if(!confirm('Mulai SO dan kunci stok sistem awal sekarang?'))return;await rpc('start',{p_store:state.store});toast('SO berhasil dimulai');state.count.open=true;await render()};
ACT['count-back']=async()=>{state.count.open=false;state.count.search='';state.count.offset=0;await render()};
ACT['count-open']=async el=>{state.store=el.dataset.store;state.count.open=true;state.count.offset=0;state.count.search='';state.count.filter='ALL';state.count.team='';state.page='count';await render()};
async function showCountList(){
 const c=state.count;
 const all=assignNo(await rpc('schedule_list',{p_store:null}));
 c.rows=all.filter(r=>['SCHEDULED','COUNTING','RECOUNT'].includes(r.status));
 c.sel=new Set([...c.sel].filter(id=>c.rows.some(r=>r.id===id)));
 $('#content').innerHTML=`<div class="card">
  <div class="toolbar"><input id="cListSearch" class="input grow" placeholder="Cari SO Number / Store" value="${escapeHTML(c.listQ)}"/></div>
  <div class="bulkbar"><button class="btn outline" data-act="c-all">Pilih Semua</button><button class="btn outline" data-act="c-none">Kosongkan</button><button class="btn danger" data-act="c-bulk-del">Hapus Dipilih</button><span class="muted small" id="cSelCount"></span></div>
  <p class="muted small">Daftar ringan hanya memuat SO yang memang perlu dihitung.</p>
  <div class="tablewrap"><table><thead><tr><th><input type="checkbox" data-change="c-all-chk" id="cAll"/></th><th>SO Number</th><th>Store</th><th>Tanggal</th><th>Tipe</th><th>Status</th><th class="num">SKU</th><th>PIC</th><th>Action</th></tr></thead><tbody id="cBody"></tbody></table></div>
 </div>`;
 drawCountRows();
}
function countActions(r){
 const a=[];
 if(r.status==='SCHEDULED'){if(canManage())a.push(btn('▶ Proses','sch-start','primary',{store:r.store_code}))}
 else a.push(btn('Lanjut Counting','count-open','primary',{store:r.store_code}));
 if(canManage())a.push(btn('Hapus','sch-del','danger',{id:r.id}));
 return a.join('');
}
function drawCountRows(){
 const c=state.count;const q=(c.listQ||'').trim().toLowerCase();
 const rows=c.rows.filter(r=>!q||(r.no+' '+r.store_name).toLowerCase().includes(q));
 const body=$('#cBody');if(!body)return;
 body.innerHTML=rows.map(r=>`<tr><td><input type="checkbox" class="cChk" data-change="c-chk" value="${r.id}" ${c.sel.has(r.id)?'checked':''}/></td><td><b class="mono">${escapeHTML(r.no)}</b></td><td>${escapeHTML(r.store_name)}</td><td>${fmtDate(r.planned_date)}</td><td>${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}</td><td>${chip(r.status)}</td><td class="num">${n(r.scope_count)}</td><td>${escapeHTML(r.pic||'-')}</td><td class="actions">${countActions(r)}</td></tr>`).join('')||'<tr><td colspan="9" class="empty">Tidak ada SO yang perlu dihitung.</td></tr>';
 const lbl=$('#cSelCount');if(lbl)lbl.textContent=`${c.sel.size} dipilih`;
}
CHG['c-chk']=el=>{const c=state.count;el.checked?c.sel.add(el.value):c.sel.delete(el.value);const lbl=$('#cSelCount');if(lbl)lbl.textContent=`${c.sel.size} dipilih`};
CHG['c-all-chk']=el=>{el.checked?ACT['c-all']():ACT['c-none']()};
ACT['c-all']=async()=>{state.count.sel=new Set(state.count.rows.map(r=>r.id));drawCountRows();const a=$('#cAll');if(a)a.checked=true};
ACT['c-none']=async()=>{state.count.sel=new Set();drawCountRows();const a=$('#cAll');if(a)a.checked=false};
ACT['c-bulk-del']=async()=>{
 const ids=[...state.count.sel];if(!ids.length)throw Error('Pilih SO terlebih dahulu.');
 if(!confirm(`Hapus ${ids.length} SO/jadwal terpilih? Tindakan ini tidak bisa dibatalkan.`))return;
 const out=await rpc('schedule_delete',{p_cycles:ids});toast(`${out.deleted} SO dihapus`);
 state.count.sel=new Set();await render();
};
async function loadCount(){
 const s=current();
 if(!s?.cycle_id||s.status==='SCHEDULED')return countStart(s);
 const q=state.count;
 const data=await rpc('count_page',{p_cycle:s.cycle_id,p_offset:q.offset,p_limit:50,p_search:q.search,p_filter:q.filter,p_team:q.team||null});q.data=data;
 const edit=data.status==='COUNTING'||data.status==='RECOUNT';
 const back=state.me.role!=='store'?`<div class="crumb"><button class="btn ghost" data-act="count-back">← Daftar SO</button><span class="muted small">${escapeHTML(labelStore(state.store))}</span></div>`:'';
 const options=[['ALL','Semua SKU'],['PENDING','Belum Lengkap'],['DONE','Sudah Lengkap'],['SELISIH','Status Selisih'],['TALLY','Status Tally']].map(([v,l])=>`<option value="${v}" ${v===q.filter?'selected':''}>${l}</option>`).join('');
 const teams=data.teams||[];
 const teamSel=teams.length?`<select id="countTeam" class="input" data-change="count-team"><option value="">Semua Tim / POS</option>${teams.map(t=>`<option value="${escapeHTML(t)}" ${t===q.team?'selected':''}>${escapeHTML(t)}</option>`).join('')}</select>`:'';
 const rowHTML=x=>{
  const needsReason=x.status==='SELISIH'&&!(x.reason||'').trim();
  return `<tr data-sku="${escapeHTML(x.sku)}">
   <td class="mono"><strong>${escapeHTML(x.sku)}</strong></td>
   <td>${escapeHTML(x.name)}<br><small class="muted">${escapeHTML(x.category)}${x.team?' • '+escapeHTML(x.team):''}</small></td>
   ${POS.map(([k])=>`<td><input class="input count-num pos" data-pos="${k}" type="number" min="0" step="1" inputmode="numeric" ${edit?'':'disabled'} value="${x[k]??''}"/></td>`).join('')}
   <td class="num total">${x.total==null?'—':n(x.total)}</td>
   <td><input class="input noteval ${needsReason?'needs-reason':''}" maxlength="500" placeholder="${edit?'Alasan (wajib jika selisih)':''}" ${edit?'':'disabled'} value="${escapeHTML(x.reason||'')}"/></td>
   <td class="status-cell">${chip(x.status)}</td></tr>`;};
 $('#content').innerHTML=`${back}<div class="card">
  <div class="card-head"><div class="row"><h3>SO Berjalan</h3>${chip(data.status)}<span class="mono muted small">${escapeHTML(data.cycle_id.slice(0,8))}</span></div>${edit?btn('Submit Counting','count-submit','dark'):''}</div>
  <div class="toolbar"><input id="countSearch" class="input grow" placeholder="Cari SKU / nama produk" value="${escapeHTML(q.search)}"/>${teamSel}<select id="countFilter" class="input">${options}</select>${btn('Cari','count-find','outline')}${btn('📷 Scan Barcode','scan-count','outline')}</div>
  <div class="tablewrap"><table id="countTable" style="min-width:980px"><thead><tr><th>SKU</th><th>Nama / Kategori</th>${POS.map(([,l])=>`<th class="num">${l}</th>`).join('')}<th class="num">Total</th><th>Alasan (wajib jika selisih)</th><th>Status</th></tr></thead><tbody>${data.items.length?data.items.map(rowHTML).join(''):'<tr><td colspan="9" class="empty">Tidak ada SKU</td></tr>'}</tbody></table></div>
  <div class="pager"><span class="small muted">${n(q.offset+1)}–${n(Math.min(q.offset+50,data.total_filtered))} dari ${n(data.total_filtered)} SKU</span><div class="row">${btn('← Sebelumnya','count-prev','outline')}${btn('Berikutnya →','count-next','outline')}${edit?btn('Simpan Halaman','count-save','primary'):''}</div></div>
  <div class="footerhint">Isi keempat posisi (boleh 0). Status Selisih wajib diisi alasannya. Draft tersimpan otomatis di perangkat ini.</div>
 </div>`;
 if(edit)restoreCountDraft(data.cycle_id);
}
CHG['count-team']=async el=>{const q=state.count;q.team=el.value;q.offset=0;await loadCount()};
function readCountDraft(cid){try{return JSON.parse(localStorage.getItem('tsiSO_draft_'+cid)||'{}')}catch(e){return{}}}
function writeCountDraft(cid,d){try{localStorage.setItem('tsiSO_draft_'+cid,JSON.stringify(d))}catch(e){}}
function clearCountDraft(cid,skus){try{const d=readCountDraft(cid);(skus||[]).forEach(k=>delete d[k]);localStorage.setItem('tsiSO_draft_'+cid,JSON.stringify(d))}catch(e){}}
function sumRow(tr){const vals=POS.map(([k])=>tr.querySelector(`[data-pos="${k}"]`).value);return vals.every(v=>v!=='')?vals.reduce((a,v)=>a+Number(v),0):null}
function restoreCountDraft(cid){
 const dr=readCountDraft(cid);
 $$('#countTable tr[data-sku]').forEach(tr=>{const d=dr[tr.dataset.sku];if(!d)return;
  POS.forEach(([k])=>{tr.querySelector(`[data-pos="${k}"]`).value=d[k]??''});
  tr.querySelector('.noteval').value=d.reason||'';
  const t=sumRow(tr);tr.querySelector('.total').textContent=t===null?'—':n(t);
 });
}
function countDraftSync(tr){
 const d=state.count.data;if(!tr||!d||!(d.status==='COUNTING'||d.status==='RECOUNT'))return;
 const row={};POS.forEach(([k])=>{row[k]=tr.querySelector(`[data-pos="${k}"]`).value});row.reason=tr.querySelector('.noteval').value;
 const t=sumRow(tr);tr.querySelector('.total').textContent=t===null?'—':n(t);
 const dr=readCountDraft(d.cycle_id);dr[tr.dataset.sku]=row;writeCountDraft(d.cycle_id,dr);
}
function countVals(){return $$('#countTable tr[data-sku]').map(tr=>{
 const qty=k=>{const v=tr.querySelector(`[data-pos="${k}"]`).value;if(v==='')return null;if(!/^\d+$/.test(v))throw Error('Qty harus bilangan bulat >=0: '+tr.dataset.sku);return Number(v)};
 const row={sku:tr.dataset.sku,reason:tr.querySelector('.noteval').value};POS.forEach(([k])=>{row[k]=qty(k)});return row;})}
async function saveCountPage(){const d=state.count.data;const vals=countVals();if(!vals.length)return 0;await rpc('save_counts',{p_cycle:d.cycle_id,p_rows:vals.map(v=>({sku:v.sku,display:v.display,reject:v.reject,rak_utama:v.rak_utama,rak_cadangan:v.rak_cadangan,reason:v.reason}))});clearCountDraft(d.cycle_id,vals.map(v=>v.sku));return vals.length}
ACT['count-save']=async()=>{const k=await saveCountPage();toast(`Tersimpan ${n(k)} SKU.`);await refreshDashboard();await loadCount()};
ACT['count-submit']=async()=>{
 await saveCountPage();const cid=state.count.data.cycle_id;
 const [all,pend]=await Promise.all([rpc('count_page',{p_cycle:cid,p_offset:0,p_limit:1,p_search:'',p_filter:'ALL'}),rpc('count_page',{p_cycle:cid,p_offset:0,p_limit:1,p_search:'',p_filter:'PENDING'})]);
 const total=all.total_filtered,pending=pend.total_filtered;
 if(pending>0)throw Error(`${n(pending)} SKU belum lengkap. Isi keempat posisi semua SKU sebelum submit.`);
 if(!confirm(`Ringkasan counting:\n• Total SKU: ${n(total)}\n• Lengkap: ${n(total-pending)}\n\nSKU berstatus Selisih wajib sudah berisi alasan. Setelah submit, counting dikunci. Lanjutkan?`))return;
 await rpc('submit',{p_cycle:cid});clearCountDraft(cid,Object.keys(readCountDraft(cid)));
 toast('Counting SUBMITTED. Menunggu validasi SPV.');
 if(isAdmin())state.count.open=false;
 await refreshDashboard();await render();
};
CHG['count-filter']=async()=>{};
ACT['count-prev']=async()=>{const q=state.count;if(q.offset===0)return;q.offset=Math.max(0,q.offset-50);await loadCount()};
ACT['count-next']=async()=>{const q=state.count;if(!q.data||q.offset+50>=q.data.total_filtered)return;q.offset+=50;await loadCount()};
ACT['count-find']=async()=>{const q=state.count;q.search=$('#countSearch').value.trim();q.filter=$('#countFilter').value;q.offset=0;await loadCount()};
ACT['scan-count']=()=>openCountScanner();

// ===== Validasi SPV (tanpa PIN; system terbaru ditampilkan; akses dibatasi peran dan area) =====
function valAcc(r){const t=(r.tally||0)+(r.variance||0);return t?(r.tally||0)/t:null}
async function showValidation(){
 const v=state.validation;
 if(v.open)return loadValidation();
 const all=assignNo(await rpc('schedule_list',{p_store:null}));
 v.rows=all.filter(r=>r.status==='SUBMITTED'||r.status==='APPROVED');
 $('#content').innerHTML=`<div class="steps"><span>Counting</span><i>→</i><span>Submit Store</span><i>→</i><span class="on">Validasi SPV</span><i>→</i><span>Approved</span></div>
 <div class="card">
  <div class="card-head"><div><h3>Validasi SPV</h3><p class="muted small">Review hasil counting Store, validasi selisih, lalu approve SO.</p></div><span class="chip blue"><i></i>Live · ${n(v.rows.length)} SO</span></div>
  <div class="toolbar"><input id="vListSearch" class="input grow" placeholder="Cari SO / Store" value="${escapeHTML(v.listQ)}"/>
   <select id="vAcc" class="input" data-change="v-acc"><option value="ALL" ${v.acc==='ALL'?'selected':''}>Semua Akurasi</option><option value="LT" ${v.acc==='LT'?'selected':''}>Ada Variance</option><option value="EQ" ${v.acc==='EQ'?'selected':''}>Tanpa Variance (100%)</option></select>
   <select id="vStatus" class="input" data-change="v-status"><option value="ALL" ${v.status==='ALL'?'selected':''}>Semua Status</option><option value="SUBMITTED" ${v.status==='SUBMITTED'?'selected':''}>Validasi SPV</option><option value="APPROVED" ${v.status==='APPROVED'?'selected':''}>Approved</option></select>
   ${btn('↻ Refresh','val-refresh','outline')}</div>
  <div class="tablewrap"><table><thead><tr><th>SO</th><th>Store</th><th>Tanggal</th><th>PIC</th><th>Status</th><th class="num">SKU</th><th>SKU Accuracy Live</th><th>Action</th></tr></thead><tbody id="vBody"></tbody></table></div>
 </div>`;
 drawValRows();
}
function drawValRows(){
 const v=state.validation;const q=(v.listQ||'').trim().toLowerCase();
 const rows=v.rows.filter(r=>{
  if(q&&!(r.no+' '+r.store_name).toLowerCase().includes(q))return false;
  if(v.status!=='ALL'&&r.status!==v.status)return false;
  const a=valAcc(r);
  if(v.acc==='LT')return a!==null&&a<1;
  if(v.acc==='EQ')return a===1;
  return true;});
 const body=$('#vBody');if(!body)return;
 body.innerHTML=rows.map(r=>`<tr><td><b class="mono">${escapeHTML(r.no)}</b><br><small class="muted">${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}${r.archived?' • Diarsipkan':''}</small></td><td>${escapeHTML(r.store_name)}</td><td>${fmtDate(r.planned_date)}</td><td>${escapeHTML(r.pic||'-')}</td><td>${chip(r.status)}</td><td class="num">${n(r.scope_count)}</td><td><b class="acc">${P(valAcc(r))}</b><br><small class="muted">${n(r.variance||0)} variance · live</small></td><td>${btn('Validasi','val-open','primary',{id:r.id,store:r.store_code})}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Belum ada SO yang menunggu validasi.</td></tr>';
}
CHG['v-acc']=el=>{state.validation.acc=el.value;drawValRows()};
CHG['v-status']=el=>{state.validation.status=el.value;drawValRows()};
ACT['val-refresh']=async()=>{await render()};
ACT['val-open']=async el=>{const v=state.validation;v.cycle=el.dataset.id;v.open=true;v.offset=0;v.search='';v.filter='VARIANCE';state.store=el.dataset.store||state.store;await render()};
ACT['val-back']=async()=>{state.validation.open=false;state.validation.data=null;await render()};
async function loadValidation(){
 const v=state.validation;
 const data=await rpc('validation_page',{p_cycle:v.cycle,p_offset:v.offset,p_limit:50,p_search:v.search,p_filter:v.filter});v.data=data;
 const st=data.status,sum=data.summary||{};
 const tally=sum.tally_skus||0,variance=sum.variance_skus||0,complete=tally+variance;
 const acc=complete?tally/complete:null;
 const mini=(cls,l,val,sub)=>`<div class="mini ${cls}"><small>${l}</small><b>${val}</b><span>${sub||''}</span></div>`;
 const rowHTML=x=>`<tr data-sku="${escapeHTML(x.sku)}">
   <td><strong class="mono">${escapeHTML(x.sku)}</strong><br><small class="muted">${escapeHTML(x.name)}${x.team?' • '+escapeHTML(x.team):''}</small></td>
   <td class="num">${n(x.system)}</td>
   ${POS.map(([k])=>`<td class="num">${x[k]==null?'—':n(x[k])}</td>`).join('')}
   <td class="num"><b>${x.total==null?'—':n(x.total)}</b></td>
   <td>${chip(x.status==='TALLY'?'TALLY':x.status==='SELISIH'?'SELISIH':'BELUM SO',x.status==='BELUM'?'BELUM':undefined)} <span class="num">${x.delta==null?'—':signed(x.delta)}</span></td>
   <td class="small">${escapeHTML(x.store_note||'')}</td>
   <td><input class="input count-num spvqty" type="number" min="0" step="1" value="${x.validated_qty??''}" ${st!=='SUBMITTED'?'disabled':''}/></td>
   <td><input class="input spvnote" maxlength="500" value="${escapeHTML(x.spv_note||'')}" ${st!=='SUBMITTED'?'disabled':''}/></td>
   <td>${st==='SUBMITTED'?btn('Simpan','val-save-line','outline'):''}</td></tr>`;
 $('#content').innerHTML=`<div class="crumb"><button class="btn ghost" data-act="val-back">← Daftar SO</button><span class="muted small">${escapeHTML(labelStore(state.store)||'')}</span></div>
 <div class="mini-row">${mini('','Total SKU',n(sum.total_skus),'Seluruh SKU pada SO')}${mini('o','Variance',n(variance),'SKU selisih')}${mini('g','SKU Accuracy',P(acc),'tally / (tally + variance)')}${mini('a','Belum Lengkap',n(sum.missing_skus),'Posisi belum lengkap')}${mini('r','Blokir Approve',n(sum.blocking_skus),'Approve diblokir bila > 0')}</div>
 ${(sum.blocking_skus||0)>0?`<div class="note warning">${n(sum.blocking_skus)} SKU belum lengkap atau selisih belum beralasan. Approve diblokir sampai diperbaiki.</div>`:''}
 <div class="card">
  <div class="card-head"><div class="row"><h3>Detail Validasi</h3>${chip(st)}<span class="mono muted small">${escapeHTML(String(data.cycle_id).slice(0,8))}</span></div>
   <div class="row">${st==='SUBMITTED'?btn('Recount','val-recount','danger')+btn('Approve SO','val-approve','primary'):''}${st==='APPROVED'&&!data.archived?btn('Export CSV','val-export','dark'):''}</div></div>
  <div class="toolbar"><select id="valFilter" class="input" data-change="val-filter"><option value="VARIANCE" ${v.filter==='VARIANCE'?'selected':''}>Hanya Variance</option><option value="ALL" ${v.filter==='ALL'?'selected':''}>Semua SKU</option></select><input id="valSearch" class="input grow" placeholder="Cari SKU / nama" value="${escapeHTML(v.search)}"/>${btn('Cari','val-find','outline')}</div>
  <div class="tablewrap"><table id="valTable" style="min-width:1200px"><thead><tr><th>SKU / Produk</th><th class="num">System</th>${POS.map(([,l])=>`<th class="num">${l}</th>`).join('')}<th class="num">Total Store</th><th>Status</th><th>Alasan Store</th><th>SPV Qty</th><th>Alasan SPV</th><th>Aksi</th></tr></thead><tbody>${data.items.map(rowHTML).join('')||'<tr><td colspan="12" class="empty">Tidak ada SKU.</td></tr>'}</tbody></table></div>
  <div class="pager"><span class="small muted">${n(v.offset+1)}–${n(Math.min(v.offset+50,data.total_filtered))} / ${n(data.total_filtered)}</span><div class="row">${btn('←','val-prev','outline')}${btn('→','val-next','outline')}</div></div>
  <div class="note">Untuk SKU SELISIH, wajib ada alasan dari Store atau SPV sebelum Approve. Jika SPV Qty kosong, sistem memakai total fisik Store.</div>
 </div>`;
}
CHG['val-filter']=async el=>{const v=state.validation;v.filter=el.value;v.offset=0;await loadValidation()};
ACT['val-find']=async()=>{const v=state.validation;v.search=$('#valSearch').value.trim();v.offset=0;await loadValidation()};
ACT['val-prev']=async()=>{const v=state.validation;v.offset=Math.max(0,v.offset-50);await loadValidation()};
ACT['val-next']=async()=>{const v=state.validation;if(!v.data||v.offset+50>=v.data.total_filtered)return;v.offset+=50;await loadValidation()};
ACT['val-save-line']=async el=>{
 const v=state.validation;const tr=el.closest('tr');const val=tr.querySelector('.spvqty').value,note=tr.querySelector('.spvnote').value;
 if(val!==''&&!/^\d+$/.test(val))throw Error('Qty harus bilangan bulat >=0.');
 await rpc('validate_line',{p_cycle:v.data.cycle_id,p_sku:tr.dataset.sku,p_qty:val===''?null:Number(val),p_note:note});
 toast('Validasi SKU '+tr.dataset.sku+' tersimpan.');await loadValidation();
};
ACT['val-approve']=async()=>{const v=state.validation;if(!confirm('Approve SO? Setelah disetujui, hasil akan dikunci.'))return;await rpc('approve',{p_cycle:v.data.cycle_id});toast('SO berhasil APPROVED');await refreshDashboard();await loadValidation()};
ACT['val-recount']=async()=>{const v=state.validation;const reason=prompt('Alasan Recount (minimal 5 karakter):');if(reason===null)return;await rpc('recount',{p_cycle:v.data.cycle_id,p_reason:reason});toast('SO dikembalikan untuk recount');await refreshDashboard();await loadValidation()};
ACT['val-export']=async()=>{const v=state.validation;const k=await exportCombined([{id:v.data.cycle_id,no:'SO',store:labelStore(state.store),date:'',type:''}]);toast(`CSV diunduh: ${n(k)} SKU`)};

// ===== Export & Pembersihan Database =====
const KEYS_EXPORT=['SO_NO','STORE','TANGGAL','TIPE','SKU','NAME_VARIANT','CATEGORY','TEAM','SYSTEM_AT_START','DISPLAY','REJECT','RAK_UTAMA','RAK_CADANGAN','ACTUAL','ADJUSTMENT','UNIT_COST','REASON'];
async function exportCombined(items){
 const lines=[];
 for(const it of items){
  const vals=await rpc('export',{p_cycle:it.id});
  for(const x of vals)lines.push([it.no,it.store,it.date,it.type,x.SKU,x.NAME_VARIANT,x.CATEGORY,x.TEAM,x.SYSTEM_AT_START,x.DISPLAY,x.REJECT,x.RAK_UTAMA,x.RAK_CADANGAN,x.ACTUAL,x.ADJUSTMENT,x.UNIT_COST,x.REASON]);
 }
 if(!lines.length)throw Error('Tidak ada SKU untuk diexport.');
 const text='﻿'+[KEYS_EXPORT,...lines].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 const blob=new Blob([text],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(blob),a=document.createElement('a');
 const stamp=iso(new Date());
 a.href=u;a.download=items.length===1?`SO_${String(items[0].store||'SO').replace(/\s+/g,'_')}_${String(items[0].id).slice(0,8)}.csv`:`HASIL_SO_${stamp}_${items.length}SO.csv`;
 a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);
 return lines.length;
}
const exportItem=r=>({id:r.id,no:r.no,store:r.store_name,date:r.planned_date||'',type:r.so_type});
async function showExport(){
 const x=state.exp;
 const [raw,stats]=await Promise.all([rpc('schedule_list',{p_store:x.store||null}),rpc('db_stats')]);
 const [from,to]=rangeBounds(x.range);
 const inR=r=>(!from||(r.planned_date||'')>=from)&&(!to||(r.planned_date||'')<=to);
 const rows=assignNo(raw).filter(r=>r.status==='APPROVED'&&inR(r));
 x.rows=rows;
 x.sel=new Set([...x.sel].filter(id=>rows.some(r=>r.id===id&&!r.archived)));
 const openCnt=rows.filter(r=>!r.archived).length;
 $('#content').innerHTML=`<div class="db-grid">
   <div class="db-tile"><small>Baris detail SKU aktif</small><b>${n(stats.active_lines)}</b><span>Sumber beban database</span></div>
   <div class="db-tile"><small>SO terbuka (belum diarsipkan)</small><b>${n(stats.open_cycles)}</b><span>Termasuk yang masih berjalan</span></div>
   <div class="db-tile"><small>SO sudah dibersihkan</small><b>${n(stats.archived_cycles)}</b><span>Ringkasan tetap tampil di Dashboard</span></div>
   <div class="db-tile"><small>Ukuran tabel detail SO</small><b>${bytes(stats.lines_bytes)}</b><span>Total modul SO ${bytes(stats.total_bytes)}</span></div>
 </div>
 <div class="toolbar-top">
  <div class="pills"><span class="pill-stat">APPROVED belum dibersihkan · ${n(openCnt)}</span><span class="pill-stat ok">Sudah dibersihkan · ${n(rows.length-openCnt)}</span></div>
  <div class="toolbar-right"><select class="input select" id="expStore" data-change="exp-store">${storeOptions(x.store,true)}</select>${rangeControlHTML('exp',x.range)}</div></div>
 <div class="note info">Alur aman: <b>1)</b> pilih SO → <b>2)</b> Export CSV → <b>3)</b> simpan file ke Drive secara manual → <b>4)</b> Bersihkan. Pembersihan menghapus detail SKU dari database; ringkasan selisih dan nilai tetap dipakai Dashboard.</div>
 <div class="card">
  <div class="bulkbar"><button class="btn outline" data-act="exp-all">Pilih semua</button><button class="btn outline" data-act="exp-none">Kosongkan</button>
   <button class="btn dark" data-act="exp-bulk-csv">⤓ Export CSV terpilih</button><button class="btn danger" data-act="exp-bulk-clean">Export & bersihkan terpilih</button>
   <span class="muted small" id="expSelCount">${n(x.sel.size)} dipilih</span></div>
  <div class="tablewrap"><table><thead><tr><th></th><th>SO</th><th>Store</th><th>Tanggal</th><th>Tipe</th><th class="num">SKU</th><th class="num">Tally</th><th class="num">Selisih</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr>
    <td>${r.archived?'':`<input type="checkbox" data-change="exp-chk" value="${r.id}" ${x.sel.has(r.id)?'checked':''}/>`}</td>
    <td><b class="mono">${escapeHTML(r.no)}</b></td><td>${escapeHTML(r.store_name)}</td><td>${fmtDate(r.planned_date)}</td><td>${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}</td>
    <td class="num">${n(r.scope_count)}</td><td class="num">${n(r.tally)}</td><td class="num">${n(r.variance)}</td>
    <td>${r.archived?chip('APPROVED','Dibersihkan'):chip('APPROVED')}</td>
    <td class="actions">${r.archived?'<small class="muted">Detail sudah dihapus; ringkasan tersimpan</small>':`${btn('⤓ Export','exp-csv','dark',{id:r.id})}${canManage()?btn('Bersihkan','exp-archive','danger',{id:r.id}):''}`}</td></tr>`).join('')||'<tr><td colspan="10" class="empty">Belum ada SO APPROVED pada filter ini.</td></tr>'}</tbody></table></div>
 </div>`;
}
CHG['exp-store']=async()=>{state.exp.store=$('#expStore').value;state.exp.sel=new Set();await showExport()};
CHG['exp-chk']=el=>{const x=state.exp;el.checked?x.sel.add(el.value):x.sel.delete(el.value);const l=$('#expSelCount');if(l)l.textContent=`${n(x.sel.size)} dipilih`};
ACT['exp-all']=async()=>{const x=state.exp;x.sel=new Set(x.rows.filter(r=>!r.archived).map(r=>r.id));await showExport()};
ACT['exp-none']=async()=>{state.exp.sel=new Set();await showExport()};
const selectedItems=()=>{const x=state.exp;const items=x.rows.filter(r=>x.sel.has(r.id)&&!r.archived).map(exportItem);if(!items.length)throw Error('Pilih minimal satu SO APPROVED yang belum dibersihkan.');return items};
ACT['exp-csv']=async el=>{const r=state.exp.rows.find(x=>x.id===el.dataset.id);const k=await exportCombined([exportItem(r)]);toast(`CSV diunduh: ${n(k)} SKU. Simpan ke Drive sebelum dibersihkan.`)};
ACT['exp-bulk-csv']=async()=>{const k=await exportCombined(selectedItems());toast(`CSV gabungan diunduh: ${n(k)} baris.`)};
ACT['exp-bulk-clean']=async()=>{
 const items=selectedItems();
 if(!confirm(`Export ${items.length} SO lalu hapus detail SKU-nya dari database?\n\nPastikan file CSV sudah tersimpan di Drive. Ringkasan tetap tampil di Dashboard.`))return;
 const k=await exportCombined(items);
 const out=await rpc('archive_cycles',{p_cycles:items.map(i=>i.id)});
 toast(`CSV ${n(k)} baris diunduh. ${n(out.archived)} SO dibersihkan (${n(out.archived_skus)} SKU).`);
 state.exp.sel=new Set();await refreshDashboard();await render();
};
ACT['exp-archive']=async el=>{
 if(!confirm('Pastikan CSV sudah di-export dan tersimpan di Drive. Detail SKU SO ini akan dihapus dari database (ringkasan tetap disimpan). Lanjutkan?'))return;
 const out=await rpc('archive_cycles',{p_cycles:[el.dataset.id]});toast(`SO dibersihkan: ${n(out.archived_skus)} SKU`);
 await refreshDashboard();await render();
};

// ===== Upload Inventory (tanpa kunci: system SO aktif ikut diperbarui) =====
async function showUpload(){
 const s=current();
 $('#content').innerHTML=`<div class="card">
  <div class="card-head"><div><h3>Upload Inventory</h3><p class="muted small">File CSV mengganti inventory aktif toko. Inventory tidak dikunci: system qty SO yang sedang berjalan ikut diperbarui.</p></div>
   ${canManage()?`<select class="input select" id="upStore" data-change="up-store">${storeOptions(state.store,false)}</select>`:`<span class="chip blue"><i></i>${escapeHTML(labelStore(state.store))}</span>`}</div>
  <div class="note warning">Angka <b>Ending</b> dapat diketahui petugas yang mengunggah; untuk blind counting sepenuhnya, pisahkan petugas upload dari penghitung. <b>Cost/HPP harus berasal dari sumber resmi</b> agar Value Accuracy valid.</div>
  <label class="dropzone"><b>⬆ Pilih File CSV Inventory Summary</b><small>Name - Variant, Category, Ending (format Inventory Summary). Kolom SKU, Cost, dan Harga Retail opsional.</small><input type="file" id="fileInput" accept=".csv,text/csv" data-change="file-pick"/></label>
  <div id="fileInfo" class="small muted">Belum ada file dipilih.</div>
  <div id="retailPreview"></div>
  <div class="row">${btn('Upload & Ganti Inventory','do-upload','primary')}</div>
  <p class="footerhint">Inventory aktif sekarang: ${n(s?.inventory_count||0)} SKU. Maksimal 10.000 SKU per file. Baris Ending negatif dilewati otomatis.</p>
 </div>
 <div class="card" id="uploadHistory"></div>`;
 upRows=[];
 loadUploadHistory().catch(()=>{});
}
CHG['up-store']=async el=>{state.store=el.value;await refreshDashboard();await render()};
CHG['file-pick']=async el=>{
 try{const file=el.files[0];if(!file)return;if(file.size>3*1024*1024)throw Error('File >3MB. Pecah atau rapikan file sebelum upload.');
  upRows=importRows(await file.text());renderRetailPreview(upRows);
  $('#fileInfo').textContent=`Siap upload: ${n(upRows.length)} SKU; contoh SKU ${upRows[0]?.sku}${upRows.skipped?`; ${n(upRows.skipped)} baris Ending negatif dilewati`:''}`;
 }catch(ex){upRows=[];$('#retailPreview').innerHTML='';$('#fileInfo').textContent=ex.message;toast(ex.message,true)}
};
ACT['do-upload']=async()=>{
 if(!upRows.length)throw Error('Pilih CSV valid terlebih dahulu.');
 if(!confirm(`Ganti SEMUA inventory aktif ${labelStore(state.store)} dengan ${upRows.length} SKU?`))return;
 const out=await rpc('upload',{p_store:state.store,p_rows:upRows});
 toast(`Upload berhasil: ${n(out.sku_count)} SKU. ${n(out.synced_lines)} baris SO aktif diperbarui.`);upRows=[];await refreshDashboard();await render();
};

// ===== Manajemen Akses (tanpa PIN; SPV Mapping per toko) =====
async function showAdmin(){
 if(!isAdmin())throw Error('Akses Admin saja.');
 const [registered,pending,mapping]=await Promise.all([rpc('users_list'),rpc('pending_users'),rpc('spv_mapping')]);
 const users=registered||[],unknown=pending||[],map=mapping||[];
 const spvs=users.filter(x=>x.role==='spv');
 $('#content').innerHTML=`<div class="card">
   <div class="card-head"><h3>1. Aktivasi Akun Baru</h3><span class="muted small">${n(unknown.length)} akun menunggu</span></div>
   <p class="small muted">Akun dibuat di Supabase → Authentication → Users (email + password, centang auto confirm), atau didaftarkan sendiri oleh pengguna. Admin memilih role dan toko tanpa perlu pengguna login ulang.</p>
   <div class="toolbar"><select class="input select grow" id="newUser"><option value="">Pilih akun belum aktif</option>${unknown.map(x=>`<option value="${escapeHTML(x.id)}">${escapeHTML(x.email)}</option>`).join('')}</select><select class="input select" id="newRole"><option value="store">STORE</option><option value="spv">SPV</option><option value="admin">ADMIN</option></select><select class="input select" id="newStore"><option value="">Pilih toko (khusus Store)</option>${state.stores.map(s=>`<option value="${escapeHTML(s.code)}">${escapeHTML(s.name)}</option>`).join('')}</select>${btn('Aktifkan User','activate-user','primary')}</div>
  </div>
  <div class="card"><div class="card-head"><h3>2. Akun Aktif</h3><span class="muted small">${n(users.length)} akun</span></div>
   <div class="tablewrap"><table><thead><tr><th>Email</th><th>Role</th><th>Toko</th><th>Area SPV</th></tr></thead><tbody>${users.map(x=>`<tr data-uid="${escapeHTML(x.id)}"><td>${escapeHTML(x.email)}<br><small class="mono muted">${escapeHTML(x.id)}</small></td><td>${chip(x.role.toUpperCase(),x.role.toUpperCase())}</td><td>${escapeHTML(x.store_code||'—')}</td><td>${escapeHTML((x.spv_stores||[]).map(labelStore).join(', ')||'—')}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Belum ada akun.</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="card-head"><h3>3. SPV Mapping per Toko</h3><span class="muted small">${n(map.filter(x=>x.spv_user).length)} / ${n(map.length)} toko sudah punya SPV</span></div>
   <p class="small muted">Pilih area dan SPV untuk tiap toko. Perubahan tersimpan otomatis. SPV hanya melihat toko yang dipetakan kepadanya.</p>
   <div class="tablewrap"><table><thead><tr><th>Toko</th><th>Area</th><th>SPV</th></tr></thead><tbody>${map.map(x=>{const areaOpts=[...new Set([...SPV_AREAS,...(x.area?[x.area]:[])])];return `<tr><td><b>${escapeHTML(x.name)}</b><br><small class="mono muted">${escapeHTML(x.code)}</small></td>
    <td><select class="input select" data-change="map-area" data-store="${escapeHTML(x.code)}"><option value="">— Pilih area —</option>${areaOpts.map(a=>`<option value="${escapeHTML(a)}" ${a===x.area?'selected':''}>${escapeHTML(a)}</option>`).join('')}</select></td>
    <td><select class="input select" data-change="map-spv" data-store="${escapeHTML(x.code)}"><option value="">— Belum ada SPV —</option>${spvs.map(s=>`<option value="${escapeHTML(s.id)}" ${s.id===x.spv_user?'selected':''}>${escapeHTML(s.email)}</option>`).join('')}</select></td></tr>`}).join('')||'<tr><td colspan="3" class="empty">Belum ada toko.</td></tr>'}</tbody></table></div></div>
  <div class="card" id="auditCard"></div>`;
 loadAudit().catch(()=>{});
}
ACT['activate-user']=async()=>{
 const p_user=$('#newUser').value,p_role=$('#newRole').value,p_store=p_role==='store'?$('#newStore').value:null;
 if(!p_user)throw Error('Pilih akun yang akan diaktifkan.');
 await rpc('assign_user',{p_user,p_role,p_store});toast('Akun aktif');await render();
};
CHG['map-spv']=async el=>{await rpc('set_store_spv',{p_store:el.dataset.store,p_user:el.value||null});toast('SPV Mapping disimpan');await render()};
CHG['map-area']=async el=>{await rpc('set_store_area',{p_store:el.dataset.store,p_area:el.value||null});toast('Area toko disimpan');await render()};

// ===== Scanner barcode =====
let scanStream=null;
function stopCountScanner(){if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null}document.getElementById('scanOverlay')?.remove()}
async function openCountScanner(){
 if(!('BarcodeDetector' in window))return toast('Scanner barcode belum didukung browser ini. Gunakan Chrome Android terbaru.',true);
 stopCountScanner();
 const ov=document.createElement('div');ov.id='scanOverlay';
 ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:9999;padding:16px';
 ov.innerHTML='<video id="scanVideo" autoplay playsinline style="width:min(480px,100%);border-radius:14px;background:#0f172a"></video><p style="color:#fff;margin:0">Arahkan kamera ke barcode produk.</p><button class="btn" id="scanClose">Tutup</button>';
 document.body.appendChild(ov);
 document.getElementById('scanClose').onclick=stopCountScanner;
 try{
  scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
  const v=document.getElementById('scanVideo');v.srcObject=scanStream;
  const det=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','upc_a','upc_e']});
  const loop=async()=>{if(!scanStream||!document.getElementById('scanVideo'))return;try{const codes=await det.detect(v);if(codes.length){const code=codes[0].rawValue;stopCountScanner();state.count.search=code;state.count.filter='ALL';state.count.offset=0;await loadCount();toast('Barcode: '+code);return}}catch(e){}requestAnimationFrame(loop)};
  requestAnimationFrame(loop);
 }catch(e){stopCountScanner();toast('Kamera tidak dapat dibuka: '+e.message,true)}
}

function renderRetailPreview(rows){
 const box=$('#retailPreview');if(!box)return;
 const zero=rows.filter(x=>x.retail===0).length;
 const cell=(l,v)=>`<div class="kpi-card"><div class="metric-label">${l}</div><div class="value" style="font-size:20px">${v}</div></div>`;
 box.innerHTML=`<div class="grid" style="margin:12px 0">${cell('Item',n(rows.length))}${cell('Harga Retail 0',n(zero))}${cell('Dilewati (Ending negatif)',n(rows.skipped||0))}</div>
 <div class="tablewrap"><table><thead><tr><th>Item</th><th>Category</th><th>Ending</th><th>Harga Retail</th></tr></thead><tbody>${rows.slice(0,80).map(x=>`<tr><td>${escapeHTML(x.name)}</td><td>${escapeHTML(x.category)}</td><td class="num">${n(x.ending)}</td><td class="num">${n(x.retail)}</td></tr>`).join('')}</tbody></table></div>
 <p class="small muted">Menampilkan 80 baris pertama dari ${n(rows.length)} item.</p>`;
}
async function loadUploadHistory(){
 const box=$('#uploadHistory');if(!box||!state.store)return;
 const rows=await rpc('upload_history',{p_store:state.store});
 box.innerHTML=`<h3 class="heading">Riwayat Upload ${escapeHTML(labelStore(state.store))}</h3>${rows.length?`<div class="tablewrap"><table><thead><tr><th>Waktu</th><th>SKU</th><th>Diupload oleh</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHTML(new Date(r.uploaded_at).toLocaleString('id-ID'))}</td><td class="num">${n(r.sku_count)}</td><td>${escapeHTML(r.uploaded_by||'-')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Belum ada riwayat upload.</div>'}`;
}

// ===== Audit Trail =====
async function loadAudit(){
 const box=$('#auditCard');if(!box)return;
 const rows=await rpc('audit_list',{p_limit:100});
 box.innerHTML=`<h3 class="heading">Audit Trail (100 aktivitas terakhir)</h3>${rows.length?`<div class="tablewrap"><table><thead><tr><th>Waktu</th><th>User</th><th>Toko</th><th>Aktivitas</th><th>Detail</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHTML(new Date(r.at).toLocaleString('id-ID'))}</td><td>${escapeHTML(r.user||'-')}</td><td>${escapeHTML(r.store||'-')}</td><td>${escapeHTML(r.event)}</td><td class="small mono">${escapeHTML(JSON.stringify(r.meta||{}).slice(0,160))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Belum ada aktivitas.</div>'}`;
}

(async()=>{const {data:{session}}=await sb.auth.getSession();if(session)await start();else loginView()})();
