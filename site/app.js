import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const root=document.querySelector('#root');
const state={user:null,me:null,stores:[],dashboard:[],page:'dashboard',store:'',cycle:null,online:true,badges:{},
 dash:{tab:'kpi',store:'',type:'',period:''},
 sch:{store:'',month:'',rows:[]},
 count:{offset:0,search:'',filter:'ALL',data:null,open:false,sel:new Set(),listQ:'',rows:[]},
 validation:{offset:0,search:'',filter:'VARIANCE',acc:'ALL',status:'ALL',data:null,unlocked:false,open:false,cycle:'',listQ:'',rows:[]},
 builder:null};
let upRows=[];
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const n=v=>new Intl.NumberFormat('id-ID').format(Number(v)||0);
const signed=v=>(Number(v)>0?'+':'')+n(v);
const P=v=>v===null||v===undefined?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:1}).format(Number(v)*100)+'%';
const rp=(v,sign=false)=>{const x=Number(v)||0;return (x<0?'-':(sign&&x>0?'+':''))+'Rp '+n(Math.abs(x))};
const $=sel=>document.querySelector(sel);
const $$=sel=>Array.from(document.querySelectorAll(sel));
const toast=(s,isErr=false)=>{const el=$('#toast');el.textContent=s;el.className='toast'+(isErr?' error':'');setTimeout(()=>{if(el.textContent===s)el.classList.add('hidden')},5500)};
const rpc=async(name,args={})=>{const {data,error}=await sb.rpc('tsi_so_'+name,args);if(error){if(!error.code)state.online=false;throw new Error(error.message||'Terjadi kesalahan server')}state.online=true;return data};
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fmtDate=d=>d?new Date(d+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}):'—';
const ini=s=>((String(s||'?').split('@')[0]).match(/[a-zA-Z0-9]/g)||['?']).slice(0,2).join('').toUpperCase();
const ROLE_LABEL={admin:'Admin',spv:'SPV',store:'Store'};
const TONE={SCHEDULED:'blue',COUNTING:'blue',RECOUNT:'orange',SUBMITTED:'orange',APPROVED:'green','BELUM SO':'gray',SELISIH:'red',TALLY:'green'};
const STATUS_LABEL={SUBMITTED:'Validasi SPV'};
const chip=(s,label)=>`<span class="chip ${TONE[s]||'gray'}"><i></i>${escapeHTML(label||STATUS_LABEL[s]||s||'BELUM SO')}</span>`;
const labelStore=code=>state.stores.find(x=>x.code===code)?.name||code;
const wrap=html=>root.innerHTML=html;
const isAdmin=()=>state.me.role==='admin';
const canManage=()=>state.me.role==='admin'||state.me.role==='spv';
const btn=(label,act,kind='',attrs={})=>`<button class="btn ${kind}" data-act="${act}"${Object.entries(attrs).map(([k,v])=>` data-${k}="${escapeHTML(v)}"`).join('')}>${label}</button>`;
const ACT={};
const CHG={};
document.addEventListener('click',async e=>{const el=e.target.closest('[data-act]');if(!el)return;const fn=ACT[el.dataset.act];if(!fn)return;e.preventDefault();el.disabled=true;try{await fn(el)}catch(err){toast(err.message,true)}finally{if(el.isConnected)el.disabled=false}});
document.addEventListener('change',async e=>{const el=e.target.closest('[data-change]');if(!el)return;const fn=CHG[el.dataset.change];if(!fn)return;try{await fn(el)}catch(err){toast(err.message,true)}});
document.addEventListener('input',e=>{if(e.target.id==='cListSearch'){state.count.listQ=e.target.value;drawCountRows()}else if(e.target.id==='vListSearch'){state.validation.listQ=e.target.value;drawValRows()}else if(e.target.closest('#countTable tr[data-sku]')){countDraftSync(e.target.closest('tr'))}});

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

const PAGE={dashboard:['Dashboard','Ringkasan operasional Stock Opname'],schedule:['SO Schedule','Jadwal Partial dan Grand Stock Opname per toko'],count:['SO Counting','Hitung stok dengan cepat di desktop, tablet, atau smartphone'],validation:['Validasi SPV','Review hasil counting toko, validasi selisih, lalu approve SO'],upload:['Upload Inventory','Ganti inventory aktif toko dari file Inventory Summary'],admin:['Manajemen Akses','Aktivasi user, role, area SPV, PIN, dan audit aktivitas']};
function menu(){const p=state.me.role;return [
 ['dashboard','Dashboard','⌂','MAIN'],
 ...(p!=='store'?[['schedule','SO Schedule','▦','STOCK OPNAME']]:[]),
 ...(p!=='spv'?[['count','Counting','☑','STOCK OPNAME']]:[]),
 ...(p!=='store'?[['validation','Validasi SPV','✓','STOCK OPNAME']]:[]),
 ...(p!=='spv'?[['upload','Upload Inventory','⇧','INVENTORY & PLANNING']]:[]),
 ...(p==='admin'?[['admin','Manajemen Akses','⚙','REPORT & SETTINGS']]:[])]}
function shell(){
 wrap(`<section class="app" id="app">
 <aside class="sidebar">
  <div class="side-head"><div class="brand-card"><div class="logo">38</div><div class="brand-text"><strong>TIGALAPAN</strong><small>STOCK OPNAME SYSTEM</small></div></div><button class="collapse" id="collapseBtn" title="Perkecil / perbesar menu">‹</button></div>
  <nav class="nav" id="nav"></nav>
  <div class="side-foot"><div class="avatar">${escapeHTML(ini(state.me.email))}</div><div class="who"><strong>${escapeHTML(state.me.email)}</strong><small>${ROLE_LABEL[state.me.role]} · ${state.me.role==='store'?escapeHTML(labelStore(state.me.store_code)):'Semua area'}</small></div></div>
 </aside>
 <main class="main">
  <header class="topbar"><div class="titles"><h1 id="topTitle"></h1><p id="topSubtitle"></p></div>
   <div class="top-actions"><span class="sys" id="sysPill"><i></i>System Online</span><button class="btn pill" id="refreshBtn">↻ Refresh</button><button class="btn pill ghost" id="logout">Keluar</button></div>
  </header>
  <div class="content" id="content"></div>
 </main></section>`);
 $('#logout').onclick=async()=>{await sb.auth.signOut();loginView()};
 $('#refreshBtn').onclick=()=>render();
 $('#collapseBtn').onclick=()=>$('#app').classList.toggle('collapsed');
}
function updateNav(){const el=$('#nav');if(!el)return;let last='',html='';const b=state.badges;
 for(const [id,title,icon,section] of menu()){
  if(section!==last){html+=`<div class="nav-sec">${section}</div>`;last=section}
  const cnt=b[id]?`<b class="nbadge">${n(b[id])}</b>`:'';
  html+=`<button data-page="${id}" class="${state.page===id?'active':''}" title="${title}"><span class="ico">${icon}</span><span class="lbl">${title}</span>${cnt}</button>`;
 }
 el.innerHTML=html;
 el.querySelectorAll('[data-page]').forEach(btnEl=>btnEl.onclick=async()=>{state.page=btnEl.dataset.page;state.validation.unlocked=false;state.validation.open=false;state.count.open=false;state.count.sel=new Set();await render()});
}
async function render(){
 if(!state.me)return;
 const m=PAGE[state.page]||PAGE.dashboard;$('#topTitle').textContent=m[0];$('#topSubtitle').textContent=m[1];
 try{
  await loadBadges();updateNav();
  if(state.page==='dashboard')await showDashboard();
  if(state.page==='schedule')await showSchedule();
  if(state.page==='count')await showCount();
  if(state.page==='validation')await showValidation();
  if(state.page==='upload')await showUpload();
  if(state.page==='admin')await showAdmin();
 }catch(ex){$('#content').innerHTML=`<div class="card"><div class="note warning">${escapeHTML(ex.message)}</div></div>`;toast(ex.message,true)}
 const pill=$('#sysPill');if(pill){pill.classList.toggle('off',!state.online);pill.lastChild.textContent=state.online?'System Online':'Koneksi terputus'}
}
async function loadBadges(){try{const k=await rpc('kpi',{});state.badges={schedule:k.so_scheduled+k.so_running,count:k.so_running+k.so_scheduled,validation:k.so_submitted}}catch(e){state.badges={}}}
function selectStore(){return `<select id="storeSelect" class="input select">${state.stores.map(s=>`<option value="${escapeHTML(s.code)}" ${s.code===state.store?'selected':''}>${escapeHTML(s.name)} (${escapeHTML(s.code)})</option>`).join('')}</select>`}
function storeOptions(sel,all){return `${all?'<option value="">Semua Store</option>':''}${state.stores.map(s=>`<option value="${escapeHTML(s.code)}" ${s.code===sel?'selected':''}>${escapeHTML(s.name)}</option>`).join('')}`}
function current(){return state.dashboard.find(x=>x.code===state.store)||null}
function storeCard(s){const pv=s.total?Math.round(100*s.done/s.total):0;
 return `<div class="store-card"><div class="sc-head"><div><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(s.code)} • ${escapeHTML(s.area||'')}</small></div>${chip(s.status,s.status==='BELUM SO'?'BELUM SO':undefined)}</div>
 <div class="sc-line"><span>${n(s.done)} / ${n(s.total)} SKU selesai</span><b>${pv}%</b></div><div class="bar"><span style="width:${pv}%"></span></div>
 ${s.accuracy!==null&&s.accuracy!==undefined?`<div class="sc-acc"><span>SKU ${P(s.accuracy)}</span><span>Qty ${P(s.qty_accuracy)}</span><span>Nilai ${P(s.value_accuracy)}</span></div>`:''}</div>`}
async function refreshDashboard(){const res=await rpc('dashboard');state.dashboard=res.stores||[];state.cycle=state.dashboard.find(x=>x.code===state.store)?.cycle_id||null}

// ===== Dashboard (mengikuti tampilan v164) =====
const PERIOD_LABEL={'':'Semua Periode',month:'Bulan Ini',d30:'30 Hari Terakhir',d90:'90 Hari Terakhir'};
function periodRange(p){const t=new Date();const day=86400000;
 if(p==='month')return[iso(new Date(t.getFullYear(),t.getMonth(),1)),iso(t)];
 if(p==='d30')return[iso(new Date(Date.now()-29*day)),iso(t)];
 if(p==='d90')return[iso(new Date(Date.now()-89*day)),iso(t)];
 return[null,null]}
function accuracyOf(k){
 const sku=k.appr_total>0?k.appr_tally/k.appr_total:null;
 const qty=k.appr_sys_qty>0?Math.max(0,1-k.appr_abs_qty/k.appr_sys_qty):(k.appr_total>0&&k.appr_abs_qty===0?1:null);
 const val=k.appr_sys_value>0?Math.max(0,1-k.appr_abs_value/k.appr_sys_value):(k.appr_total>0&&k.appr_abs_value===0?1:null);
 return{sku,qty,val}}
async function showDashboard(){
 const d=state.dash;await refreshDashboard();
 const [from,to]=periodRange(d.period);
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
  <div class="sec-title">Volume & Progress <small>Jumlah SO, penyelesaian, SKU yang telah dihitung, dan net variance quantity.</small></div>
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
   <select class="input select" id="dPeriod">${Object.entries(PERIOD_LABEL).map(([v,l])=>`<option value="${v}" ${d.period===v?'selected':''}>${l}</option>`).join('')}</select>
   ${btn('Terapkan','dash-apply','primary')}${btn('Reset','dash-reset','outline')}
  </div>
  <div class="note info">Dasar perhitungan: SO yang sudah SUBMITTED atau APPROVED. Akurasi hanya dari SO APPROVED. SO yang masih berjalan hanya tampil di kartu operasional.</div>
 </div>
 <div class="card tabs-card"><span class="tabs-lbl">ANALISA DASHBOARD</span>${tabs.map(([id,l])=>`<button class="tab ${d.tab===id?'on':''}" data-act="dash-tab" data-tab="${id}">${l}</button>`).join('')}</div>
 ${body}`;
 if(d.tab==='act'&&isAdmin())loadAudit().catch(()=>{});
}
ACT['dash-apply']=async()=>{const d=state.dash;d.store=$('#dStore').value;d.type=$('#dType').value;d.period=$('#dPeriod').value;await showDashboard()};
ACT['dash-reset']=async()=>{state.dash={tab:state.dash.tab,store:'',type:'',period:''};await showDashboard()};
ACT['dash-tab']=async el=>{state.dash.tab=el.dataset.tab;await showDashboard()};

function parseCSV(text){
 text=text.replace(/^\uFEFF/,'');let inQuote=false,cur='',row=[],rows=[];
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(inQuote&&text[i+1]==='"'){cur+='"';i++}else inQuote=!inQuote}else if(!inQuote&&(ch===','||ch===';'||ch==='\t')){
   // delimiter is detected from header first line, handled below
   cur+=ch;
 }else if(!inQuote&&(ch==='\r'||ch==='\n')){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur=''}else cur+=ch;}
 if(inQuote)throw Error('Format CSV tidak valid: tanda kutip tidak tertutup.');if(cur||row.length){row.push(cur);rows.push(row)}
 if(!rows.length)throw Error('CSV kosong.');
 // Reparse using delimiter with the highest count in header, respecting quoted strings.
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

// ===== SO Schedule (folder per toko, aksi Proses / Edit / Hapus) =====
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
  if(isAdmin())a.push(btn('▶ Proses','sch-start','primary',{store:r.store_code}));
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
 const month=sc.month||iso(new Date()).slice(0,7);
 const inMonth=r=>(r.planned_date||'').slice(0,7)===month;
 const show=rows.filter(r=>r.status!=='APPROVED'||inMonth(r));
 const open=rows.filter(r=>r.status!=='APPROVED').length,doneM=rows.filter(r=>r.status==='APPROVED'&&inMonth(r)).length;
 const groups=new Map();
 for(const r of show.slice().sort((a,b)=>(a.planned_date||'').localeCompare(b.planned_date||''))){
  if(!groups.has(r.store_code))groups.set(r.store_code,{name:r.store_name,rows:[]});
  groups.get(r.store_code).rows.push(r);
 }
 $('#content').innerHTML=`<div class="toolbar-top">
  <div class="pills"><span class="pill-stat">Belum Selesai · ${n(open)}</span><span class="pill-stat ok">Selesai Periode · ${n(doneM)}</span></div>
  <div class="toolbar-right"><select class="input select" id="schStoreSel" data-change="sch-filter">${storeOptions(sc.store,true)}</select><input class="input" type="month" id="schMonth" value="${month}" data-change="sch-filter"/>
   ${canManage()?btn('+ Partial SO','b-open','outline',{type:'PARTIAL'})+btn('+ Grand SO','b-open','primary',{type:'GRAND'}):''}</div></div>
 <div class="note info">Folder per store berisi SO yang masih perlu diproses. SO yang sudah APPROVED tampil pada bulan yang dipilih.</div>
 ${groups.size?[...groups.values()].map(g=>`<div class="card">
   <div class="card-head"><h3>▣ ${escapeHTML(g.name)}</h3><span class="muted small">${n(g.rows.length)} SO</span></div>
   <div class="tablewrap"><table><thead><tr><th>SO</th><th>Tanggal</th><th>PIC</th><th>Status</th><th class="num">SKU</th><th>Action</th></tr></thead><tbody>${g.rows.map(r=>`<tr><td><b class="mono">${escapeHTML(r.no)}</b><br><small class="muted">${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}${r.start_time?' • '+escapeHTML(r.start_time.slice(0,5)):''}</small></td><td>${fmtDate(r.planned_date)}</td><td>${escapeHTML(r.pic||'-')}</td><td>${chip(r.status)}</td><td class="num">${n(r.scope_count)}</td><td class="actions">${schActions(r)}</td></tr>`).join('')}</tbody></table></div>
  </div>`).join(''):'<div class="card empty">Belum ada SO pada filter ini. Klik + Partial SO atau + Grand SO untuk membuat jadwal.</div>'}`;
}
CHG['sch-filter']=async()=>{state.sch.store=$('#schStoreSel').value;state.sch.month=$('#schMonth').value;await showSchedule()};
ACT['sch-start']=async el=>{
 if(!confirm('Mulai SO dan kunci stok sistem awal sekarang?'))return;
 await rpc('start',{p_store:el.dataset.store});toast('SO dimulai. Lanjutkan menghitung di SO Counting.');
 state.store=el.dataset.store;state.count.open=true;state.count.offset=0;state.count.search='';state.count.filter='ALL';state.page='count';await render();
};
ACT['sch-edit']=async el=>{const r=state.sch.rows.find(x=>x.id===el.dataset.id);if(!r)throw Error('Jadwal tidak ditemukan. Muat ulang halaman.');openBuilder(null,r)};
ACT['sch-del']=async el=>{
 if(!confirm('Hapus SO/jadwal ini? Draft counting yang belum disubmit ikut terhapus.'))return;
 await rpc('schedule_delete',{p_cycles:[el.dataset.id]});toast('Jadwal dihapus');
 state.count.sel.delete(el.dataset.id);await render();
};
ACT['b-open']=async el=>openBuilder(el.dataset.type,null);

// ----- Builder Partial / Grand SO (layout mengikuti v164: Jadwal & Scope | Preview) -----
function openBuilder(type,cycle){
 const sc=state.sch;const edit=!!cycle;
 const b={mode:edit?'edit':'create',cycleId:cycle?.id||null,type:edit?cycle.so_type:(type||'GRAND'),store:edit?cycle.store_code:(sc.store||state.stores[0]?.code||''),curCount:edit?(cycle.scope_count||0):0,cats:new Set(),skus:new Set(),catList:null,timer:null};
 state.builder=b;
 const ov=document.createElement('div');ov.id='builder';ov.className='modal-bg';
 ov.innerHTML=`<div class="modal">
  <div class="modal-head"><div><h3>${edit?'Edit Jadwal SO':'Buat Jadwal SO Baru'}</h3><p>${edit?escapeHTML(cycle.no||''):'Pilih toko, jadwal, dan scope SKU sebelum menyimpan.'}</p></div><button class="x" data-act="b-close" title="Tutup">×</button></div>
  <div class="builder">
   <div class="bcol">
    <div class="step"><span>1</span><h4>Jadwal & Scope</h4></div>
    <label class="field">Toko *<select id="bStore" class="input" data-change="b-store" ${edit?'disabled':''}>${state.stores.map(s=>`<option value="${escapeHTML(s.code)}" ${s.code===b.store?'selected':''}>${escapeHTML(s.name)}</option>`).join('')}</select></label>
    <div class="field"><span>Jenis SO *</span><div class="seg"><button class="${b.type==='GRAND'?'on':''}" data-act="b-type" data-v="GRAND">Grand SO (semua SKU)</button><button class="${b.type==='PARTIAL'?'on':''}" data-act="b-type" data-v="PARTIAL">Partial SO (pilih scope)</button></div></div>
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
 renderScope();
}
function closeBuilder(){document.getElementById('builder')?.remove();state.builder=null}
ACT['b-close']=()=>closeBuilder();
ACT['b-type']=async el=>{const b=state.builder;if(!b)return;b.type=el.dataset.v;$$('#builder [data-act="b-type"]').forEach(x=>x.classList.toggle('on',x.dataset.v===b.type));await renderScope()};
CHG['b-store']=async el=>{const b=state.builder;if(!b)return;b.store=el.value;b.cats=new Set();b.skus=new Set();b.catList=null;await renderScope()};
CHG['b-field']=()=>schedulePreview();
CHG['b-cat']=el=>{const b=state.builder;if(!b)return;el.checked?b.cats.add(el.value):b.cats.delete(el.value);el.closest('label').classList.toggle('on',el.checked);schedulePreview()};
CHG['b-sku']=el=>{const b=state.builder;if(!b)return;el.checked?b.skus.add(el.value):b.skus.delete(el.value);const c=$('#bSkuCount');if(c)c.textContent=b.skus.size;schedulePreview()};
CHG['b-search']=async el=>{
 const b=state.builder;if(!b)return;
 const d=await rpc('inventory_list',{p_store:b.store,p_offset:0,p_limit:50,p_search:el.value.trim()});
 $('#bSkuList').innerHTML=(d.items||[]).map(x=>`<label class="sku-row"><input type="checkbox" data-change="b-sku" value="${escapeHTML(x.sku)}" ${b.skus.has(x.sku)?'checked':''}/><span class="mono">${escapeHTML(x.sku)}</span><small>${escapeHTML(x.name)}</small><em>${n(x.ending)}</em></label>`).join('')||'<div class="empty small">Tidak ada SKU yang cocok.</div>';
};
async function renderScope(){
 const b=state.builder;if(!b)return;const box=$('#bScope');if(!box)return;
 if(b.type==='GRAND'){
  box.innerHTML=`<div class="scope-box"><b>Scope: seluruh SKU inventory toko</b><p class="small muted">Stok sistem dikunci saat SO dimulai (Proses). Pilih Partial SO untuk membatasi ke category atau SKU tertentu.</p></div>`;
 }else{
  if(!b.catList){b.catList=await rpc('categories',{p_store:b.store})}
  if(!state.builder||state.builder!==b)return;
  box.innerHTML=`<div class="scope-box">
    <div class="scope-head"><b>Scope Partial</b>${b.mode==='edit'?`<span class="small muted">Scope saat ini: ${n(b.curCount)} SKU (dipertahankan bila tidak diubah)</span>`:''}</div>
    <p class="small muted">Category yang dipilih ikut seluruhnya. Tambahkan SKU tertentu bila perlu.</p>
    <div class="cat-grid">${b.catList.map(c=>`<label class="cat ${b.cats.has(c.category)?'on':''}"><input type="checkbox" data-change="b-cat" value="${escapeHTML(c.category)}" ${b.cats.has(c.category)?'checked':''}/><span><b>${escapeHTML(c.category||'(Tanpa category)')}</b><small>${n(c.count)} SKU</small></span></label>`).join('')||'<div class="empty small">Belum ada category.</div>'}</div>
    <input id="bSearch" class="input" placeholder="Cari SKU / nama produk, lalu Enter" data-change="b-search"/>
    <div id="bSkuList" class="sku-list"></div>
    <div class="small muted">SKU dipilih manual: <b id="bSkuCount">${b.skus.size}</b></div>
   </div>`;
 }
 updatePreview();
}
function schedulePreview(){const b=state.builder;if(!b)return;clearTimeout(b.timer);b.timer=setTimeout(updatePreview,250)}
async function updatePreview(){
 const b=state.builder;if(!b||!$('#bPreview'))return;
 const type=b.type,cats=[...b.cats],skus=[...b.skus];
 const store=$('#bStore')?.value||b.store;
 const date=$('#bDate')?.value||'',start=$('#bStart')?.value||'',end=$('#bEnd')?.value||'';
 let info={count:0,sample:[]};
 try{
  if(type==='GRAND')info=await rpc('scope_preview',{p_store:store,p_type:'GRAND',p_skus:null,p_categories:null});
  else if(cats.length||skus.length)info=await rpc('scope_preview',{p_store:store,p_type:'PARTIAL',p_skus:skus,p_categories:cats});
  else info={count:b.mode==='edit'?b.curCount:0,sample:[]};
 }catch(ex){info={count:0,sample:[],error:ex.message}}
 if(!state.builder||state.builder!==b||!$('#bPreview'))return;
 $('#bPreview').innerHTML=`<div class="prev">
   <div class="prev-stats"><div><small>Toko</small><b>${escapeHTML(labelStore(store))}</b></div><div><small>Jenis</small><b>${type==='GRAND'?'Grand SO':'Partial SO'}</b></div><div><small>Tanggal</small><b>${fmtDate(date)}</b></div><div><small>Jam</small><b>${start||'—'}${end?' – '+end:''}</b></div></div>
   <div class="prev-big"><small>SKU dalam scope</small><b>${n(info.count)}</b><span>${type==='PARTIAL'?`${n(cats.length)} category • ${n(skus.length)} SKU manual`:'Seluruh inventory toko'}</span></div>
   ${info.error?`<div class="note warning">${escapeHTML(info.error)}</div>`:''}
   ${info.sample?.length?`<div class="sku-cloud">${info.sample.map(s=>`<span class="sku-chip mono">${escapeHTML(s)}</span>`).join('')}${info.count>info.sample.length?`<span class="small muted">+${n(info.count-info.sample.length)} lainnya</span>`:''}</div>`:''}
   ${type==='PARTIAL'&&!cats.length&&!skus.length&&b.mode==='create'?'<div class="note">Pilih minimal satu category atau SKU.</div>':''}
   <div class="note info small">Stok sistem dikunci saat SO dimulai (Proses), bukan saat jadwal dibuat.</div>
 </div>`;
}
ACT['b-save']=async()=>{
 const b=state.builder;if(!b)return;
 const store=$('#bStore').value,date=$('#bDate').value,start=$('#bStart').value||null,end=$('#bEnd').value||null,notes=$('#bNotes').value.trim();
 if(!date)throw Error('Tanggal jadwal wajib diisi.');
 const partialScope=b.type==='PARTIAL'&&(b.cats.size||b.skus.size);
 if(b.type==='PARTIAL'&&b.mode==='create'&&!partialScope)throw Error('Pilih minimal satu category atau SKU untuk Partial SO.');
 const p_skus=partialScope?[...b.skus]:null,p_categories=partialScope?[...b.cats]:null;
 if(b.mode==='create'){
  if(!confirm(`Simpan jadwal ${b.type} SO untuk ${labelStore(store)} pada ${date}?`))return;
  const out=await rpc('schedule_create',{p_store:store,p_type:b.type,p_date:date,p_start:start,p_end:end,p_notes:notes,p_skus,p_categories});
  toast(`Jadwal dibuat: ${n(out.scope_count)} SKU`);
 }else{
  await rpc('schedule_update',{p_cycle:b.cycleId,p_type:b.type,p_date:date,p_start:start,p_end:end,p_notes:notes,p_skus,p_categories});
  toast('Jadwal diperbarui');
 }
 closeBuilder();await render();
};

// ===== SO Counting =====
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
ACT['count-open']=async el=>{state.store=el.dataset.store;state.count.open=true;state.count.offset=0;state.count.search='';state.count.filter='ALL';state.page='count';await render()};
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
 if(r.status==='SCHEDULED'){if(isAdmin())a.push(btn('▶ Proses','sch-start','primary',{store:r.store_code}))}
 else a.push(btn('Lanjut Counting','count-open','primary',{store:r.store_code}));
 a.push(btn('Hapus','sch-del','danger',{id:r.id}));
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
 const data=await rpc('count_page',{p_cycle:s.cycle_id,p_offset:q.offset,p_limit:50,p_search:q.search,p_filter:q.filter});q.data=data;
 const edit=data.status==='COUNTING'||data.status==='RECOUNT';
 const back=state.me.role!=='store'?`<div class="crumb"><button class="btn ghost" data-act="count-back">← Daftar SO</button><span class="muted small">${escapeHTML(labelStore(state.store))}</span></div>`:'';
 const options=[['ALL','Semua SKU'],['PENDING','Belum Dihitung'],['DONE','Sudah Dihitung']].map(([v,l])=>`<option value="${v}" ${v===q.filter?'selected':''}>${l}</option>`).join('');
 $('#content').innerHTML=`${back}<div class="card">
  <div class="card-head"><div class="row"><h3>SO Berjalan</h3>${chip(data.status)}<span class="mono muted small">${escapeHTML(data.cycle_id.slice(0,8))}</span></div>${edit?btn('Submit Counting','count-submit','dark'):''}</div>
  <div class="toolbar"><input id="countSearch" class="input grow" placeholder="Cari SKU / nama produk" value="${escapeHTML(q.search)}"/><select id="countFilter" class="input">${options}</select>${btn('Cari','count-find','outline')}${btn('📷 Scan Barcode','scan-count','outline')}</div>
  <div class="tablewrap"><table id="countTable"><thead><tr><th>SKU</th><th>Nama / Kategori</th><th>Gudang</th><th>Display</th><th class="num">Total Fisik</th><th>Catatan</th><th>Status</th></tr></thead><tbody>${data.items.length?data.items.map(x=>`<tr data-sku="${escapeHTML(x.sku)}"><td class="mono"><strong>${escapeHTML(x.sku)}</strong></td><td>${escapeHTML(x.name)}<br><small class="muted">${escapeHTML(x.category)}</small></td><td><input class="input count-num wh" type="number" min="0" step="1" ${edit?'':'disabled'} value="${x.warehouse??''}"/></td><td><input class="input count-num ds" type="number" min="0" step="1" ${edit?'':'disabled'} value="${x.display??''}"/></td><td class="num total">${x.warehouse==null||x.display==null?'—':n(x.warehouse+x.display)}</td><td><input class="input noteval" maxlength="500" ${edit?'':'disabled'} value="${escapeHTML(x.note)}"/></td><td>${chip(x.status)}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">Tidak ada SKU</td></tr>'}</tbody></table></div>
  <div class="pager"><span class="small muted">${n(q.offset+1)}–${n(Math.min(q.offset+50,data.total_filtered))} dari ${n(data.total_filtered)} SKU</span><div class="row">${btn('← Sebelumnya','count-prev','outline')}${btn('Berikutnya →','count-next','outline')}${edit?btn('Simpan Halaman','count-save','primary'):''}</div></div>
  <div class="footerhint">Kedua kolom Qty harus diisi, termasuk angka 0. Draft tersimpan otomatis di perangkat ini.</div>
 </div>`;
 if(edit)restoreCountDraft(data.cycle_id);
}
function restoreCountDraft(cid){const dr=readCountDraft(cid);$$('#countTable tr[data-sku]').forEach(tr=>{const d=dr[tr.dataset.sku];if(!d)return;tr.querySelector('.wh').value=d.wh;tr.querySelector('.ds').value=d.ds;tr.querySelector('.noteval').value=d.note||'';tr.querySelector('.total').textContent=d.wh===''||d.ds===''?'—':n(Number(d.wh)+Number(d.ds))})}
function countDraftSync(tr){
 const d=state.count.data;if(!tr||!d||!(d.status==='COUNTING'||d.status==='RECOUNT'))return;
 const wh=tr.querySelector('.wh').value,ds=tr.querySelector('.ds').value;
 tr.querySelector('.total').textContent=wh===''||ds===''?'—':n(Number(wh)+Number(ds));
 const dr=readCountDraft(d.cycle_id);dr[tr.dataset.sku]={wh,ds,note:tr.querySelector('.noteval').value};writeCountDraft(d.cycle_id,dr);
}
function countVals(){return $$('#countTable tr[data-sku]').map(tr=>{const qty=sel=>{const v=tr.querySelector(sel).value;if(v==='')return null;if(!/^\d+$/.test(v))throw Error('Qty harus bilangan bulat >=0: '+tr.dataset.sku);return Number(v)};return{sku:tr.dataset.sku,warehouse:qty('.wh'),display:qty('.ds'),note:tr.querySelector('.noteval').value}})}
async function saveCountPage(){const d=state.count.data;const vals=countVals();if(!vals.length)return 0;await rpc('save_counts',{p_cycle:d.cycle_id,p_rows:vals});clearCountDraft(d.cycle_id,vals.map(v=>v.sku));return vals.length}
ACT['count-save']=async()=>{const k=await saveCountPage();toast(`Tersimpan ${n(k)} SKU.`);await refreshDashboard();await loadCount()};
ACT['count-submit']=async()=>{
 await saveCountPage();const cid=state.count.data.cycle_id;
 const [all,pend]=await Promise.all([rpc('count_page',{p_cycle:cid,p_offset:0,p_limit:1,p_search:'',p_filter:'ALL'}),rpc('count_page',{p_cycle:cid,p_offset:0,p_limit:1,p_search:'',p_filter:'PENDING'})]);
 const total=all.total_filtered,pending=pend.total_filtered;
 if(pending>0)throw Error(`${n(pending)} SKU belum lengkap. Isi Gudang dan Display semua SKU sebelum submit.`);
 if(!confirm(`Ringkasan counting:\n• Total SKU: ${n(total)}\n• Sudah dihitung: ${n(total-pending)}\n• Belum dihitung: 0\n\nSetelah submit, counting dikunci. Lanjutkan?`))return;
 await rpc('submit',{p_cycle:cid});clearCountDraft(cid,Object.keys(readCountDraft(cid)));
 toast('Counting SUBMITTED. Menunggu validasi SPV.');
 if(isAdmin())state.count.open=false;
 await refreshDashboard();await render();
};
ACT['count-prev']=async()=>{const q=state.count;if(q.offset===0)return;q.offset=Math.max(0,q.offset-50);await loadCount()};
ACT['count-next']=async()=>{const q=state.count;if(!q.data||q.offset+50>=q.data.total_filtered)return;q.offset+=50;await loadCount()};
ACT['count-find']=async()=>{const q=state.count;q.search=$('#countSearch').value.trim();q.filter=$('#countFilter').value;q.offset=0;await loadCount()};
ACT['scan-count']=()=>openCountScanner();

// ===== Validasi SPV (daftar SO + detail, PIN, approve/recount/export/arsip) =====
function valAcc(r){const t=(r.tally||0)+(r.variance||0);return t?(r.tally||0)/t:null}
async function showValidation(){
 const v=state.validation;
 if(!v.unlocked){
  $('#content').innerHTML=`<div class="card pin-card"><h3>🔒 Masukkan PIN Validasi SPV</h3><p class="small muted">PIN terdiri dari 8–12 angka dan diatur Admin. Setelah 5 kesalahan, akses ditahan sementara. Akses server berlaku 15 menit.</p><label class="field">PIN VALIDASI<input id="valPin" class="input" type="password" maxlength="12" inputmode="numeric" autocomplete="off"/></label><div>${btn('Buka Validasi','unlock-spv','primary')}</div></div>`;
  return;
 }
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
ACT['unlock-spv']=async()=>{const yes=await rpc('unlock',{p_pin:$('#valPin').value});if(!yes)throw Error('PIN salah atau sementara terkunci.');state.validation.unlocked=true;toast('Validasi berhasil dibuka');await render()};
ACT['val-open']=async el=>{const v=state.validation;v.cycle=el.dataset.id;v.open=true;v.offset=0;v.search='';v.filter='VARIANCE';await render()};
ACT['val-back']=async()=>{state.validation.open=false;state.validation.data=null;await render()};
async function loadValidation(){
 const v=state.validation;
 const data=await rpc('validation_page',{p_cycle:v.cycle,p_offset:v.offset,p_limit:50,p_search:v.search,p_filter:v.filter});v.data=data;
 const st=data.status,sum=data.summary||{};
 const tally=sum.tally_skus||0,variance=sum.variance_skus||0,complete=tally+variance;
 const acc=complete?tally/complete:null;
 const mini=(cls,l,val,sub)=>`<div class="mini ${cls}"><small>${l}</small><b>${val}</b><span>${sub||''}</span></div>`;
 $('#content').innerHTML=`<div class="crumb"><button class="btn ghost" data-act="val-back">← Daftar SO</button><span class="muted small">${escapeHTML(labelStore(state.store)||'')}</span></div>
 <div class="mini-row">${mini('','Total SKU',n(sum.total_skus),'Seluruh SKU pada SO')}${mini('o','Variance',n(variance),'SKU selisih')}${mini('g','SKU Accuracy',P(acc),'tally / (tally + variance)')}${mini('a','Belum Lengkap',n(sum.missing_skus),'Belum diisi lengkap')}${mini('r','Blokir Approve',n(sum.blocking_skus),'Approve diblokir bila > 0')}</div>
 ${(sum.blocking_skus||0)>0?`<div class="note warning">${n(sum.blocking_skus)} SKU belum lengkap atau selisih belum beralasan. Approve diblokir sampai diperbaiki.</div>`:''}
 <div class="card">
  <div class="card-head"><div class="row"><h3>Detail Validasi</h3>${chip(st)}<span class="mono muted small">${escapeHTML(String(data.cycle_id).slice(0,8))}</span></div>
   <div class="row">${st==='SUBMITTED'?btn('Recount','val-recount','danger')+btn('Approve SO','val-approve','primary'):''}${st==='APPROVED'?btn('Export Adjustment CSV','val-export','dark')+(isAdmin()&&!data.archived?btn('Arsipkan & Hapus Detail','val-archive','danger'):''):''}</div></div>
  <div class="toolbar"><select id="valFilter" class="input" data-change="val-filter"><option value="VARIANCE" ${v.filter==='VARIANCE'?'selected':''}>Hanya Variance</option><option value="ALL" ${v.filter==='ALL'?'selected':''}>Semua SKU</option></select><input id="valSearch" class="input grow" placeholder="Cari SKU / nama" value="${escapeHTML(v.search)}"/>${btn('Cari','val-find','outline')}</div>
  <div class="tablewrap"><table id="valTable" style="min-width:1200px"><thead><tr><th>SKU / Produk</th><th class="num">System Awal</th><th class="num">System Terbaru</th><th class="num">Gudang + Display</th><th class="num">Actual</th><th>SPV Qty</th><th>Delta</th><th>Catatan Store</th><th>Reason SPV</th><th>Aksi</th></tr></thead><tbody>${data.items.map(x=>`<tr data-sku="${escapeHTML(x.sku)}"><td><strong class="mono">${escapeHTML(x.sku)}</strong><br><small class="muted">${escapeHTML(x.name)}</small></td><td class="num">${n(x.system_at_start)}</td><td class="num">${x.latest_system==null?'—':n(x.latest_system)}</td><td class="num">${n(x.warehouse)} + ${n(x.display)}</td><td class="num">${n(x.actual)}</td><td><input class="input count-num spvqty" type="number" min="0" step="1" value="${x.validated_qty??''}" ${st!=='SUBMITTED'?'disabled':''}/></td><td>${chip(x.delta===0?'TALLY':'SELISIH')} <span class="num">${x.delta==null?'—':signed(x.delta)}</span></td><td>${escapeHTML(x.store_note)}</td><td><input class="input spvnote" maxlength="500" value="${escapeHTML(x.spv_note)}" ${st!=='SUBMITTED'?'disabled':''}/></td><td>${st==='SUBMITTED'?btn('Simpan','val-save-line','outline'):''}</td></tr>`).join('')||'<tr><td colspan="10" class="empty">Tidak ada SKU.</td></tr>'}</tbody></table></div>
  <div class="pager"><span class="small muted">${n(v.offset+1)}–${n(Math.min(v.offset+50,data.total_filtered))} / ${n(data.total_filtered)}</span><div class="row">${btn('←','val-prev','outline')}${btn('→','val-next','outline')}</div></div>
  <div class="note">Untuk SKU SELISIH, wajib isi alasan pada catatan Store atau SPV sebelum Approve. Jika SPV Qty kosong, sistem memakai total fisik Store.</div>
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
ACT['val-export']=async()=>{
 const v=state.validation;const vals=await rpc('export',{p_cycle:v.data.cycle_id});if(!vals.length)throw Error('Export kosong.');
 const keys=['SKU','NAME_VARIANT','SYSTEM_AT_START','ACTUAL','ADJUSTMENT','UNIT_COST','REASON'];
 const text='﻿'+[keys,...vals.map(x=>keys.map(k=>x[k]))].map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 const blob=new Blob([text],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=u;a.download=`SO_${(labelStore(state.store)||'SO').replace(/\s+/g,'_')}_${String(v.data.cycle_id).slice(0,8)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
};
ACT['val-archive']=async()=>{
 const v=state.validation;
 if(!confirm('Pastikan CSV sudah di-export dan disimpan. Detail SKU SO ini akan dihapus dari database (ringkasan tetap disimpan). Lanjutkan?'))return;
 const out=await rpc('archive_cycle',{p_cycle:v.data.cycle_id});toast(`Arsip berhasil: ${out.archived_skus} SKU`);await refreshDashboard();await loadValidation();
};

// ===== Upload Inventory =====
async function showUpload(){
 const s=current();
 $('#content').innerHTML=`<div class="card">
  <div class="card-head"><div><h3>Upload Inventory</h3><p class="muted small">File CSV mengganti daftar inventory aktif toko (bukan stok awal SO yang sedang berjalan).</p></div>
   ${isAdmin()?`<select class="input select" id="upStore" data-change="up-store">${storeOptions(state.store,false)}</select>`:`<span class="chip blue"><i></i>${escapeHTML(labelStore(state.store))}</span>`}</div>
  <div class="note warning">Angka <b>Ending</b> dapat diketahui petugas yang mengunggah; untuk blind counting sepenuhnya, pisahkan petugas upload dari penghitung. <b>Cost/HPP harus berasal dari sumber resmi</b> agar Value Accuracy valid.</div>
  <label class="dropzone"><b>⬆ Pilih File CSV Inventory Summary</b><small>Name - Variant, Category, Ending (format Inventory Summary). Kolom SKU dan Cost opsional.</small><input type="file" id="fileInput" accept=".csv,text/csv" data-change="file-pick"/></label>
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
 toast(`Upload berhasil: ${out.sku_count} SKU.`);upRows=[];await refreshDashboard();await render();
};

// ===== Manajemen Akses =====
async function showAdmin(){
 if(!isAdmin())throw Error('Akses Admin saja.');
 const [registered,pending]=await Promise.all([rpc('users_list'),rpc('pending_users')]);
 const users=registered||[],unknown=pending||[];
 $('#content').innerHTML=`<div class="card">
   <div class="card-head"><h3>1. Aktivasi Akun Baru</h3><span class="muted small">${n(unknown.length)} akun menunggu</span></div>
   <p class="small muted">Akun dibuat di Supabase → Authentication → Users (email + password, centang auto confirm), atau didaftarkan sendiri oleh pengguna. Akun yang sudah pernah login tapi belum aktif muncul di sini; Admin memilih role dan toko tanpa perlu pengguna login ulang.</p>
   <div class="toolbar"><select class="input select grow" id="newUser"><option value="">Pilih akun belum aktif</option>${unknown.map(x=>`<option value="${escapeHTML(x.id)}">${escapeHTML(x.email)}</option>`).join('')}</select><select class="input select" id="newRole"><option value="store">STORE</option><option value="spv">SPV</option><option value="admin">ADMIN</option></select><select class="input select" id="newStore"><option value="">Pilih toko (khusus Store)</option>${state.stores.map(s=>`<option value="${escapeHTML(s.code)}">${escapeHTML(s.name)}</option>`).join('')}</select>${btn('Aktifkan User','activate-user','primary')}</div>
  </div>
  <div class="card"><div class="card-head"><h3>2. Akun Aktif</h3><span class="muted small">${n(users.length)} akun</span></div>
   <div class="tablewrap"><table><thead><tr><th>Email</th><th>Role</th><th>Toko</th><th>Area SPV</th><th>PIN SPV/Admin</th></tr></thead><tbody>${users.map(x=>`<tr data-uid="${escapeHTML(x.id)}"><td>${escapeHTML(x.email)}<br><small class="mono muted">${escapeHTML(x.id)}</small></td><td>${chip(x.role.toUpperCase(),x.role.toUpperCase())}</td><td>${escapeHTML(x.store_code||'—')}</td><td>${escapeHTML((x.spv_stores||[]).join(', ')||'—')}</td><td>${x.role==='store'?'—':`<div class="row"><input class="input pinvalue" style="width:150px" type="password" inputmode="numeric" maxlength="12" placeholder="PIN 8–12 angka"/>${btn('Atur PIN','pin-set','outline')}</div>`}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Belum ada akun.</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="card-head"><h3>3. Tambahkan Area SPV</h3></div><div class="toolbar"><select class="input select grow" id="spvUser"><option value="">Pilih SPV</option>${users.filter(x=>x.role==='spv').map(x=>`<option value="${escapeHTML(x.id)}">${escapeHTML(x.email)}</option>`).join('')}</select><select class="input select grow" id="spvStore">${state.stores.map(s=>`<option value="${escapeHTML(s.code)}">${escapeHTML(s.name)}</option>`).join('')}</select>${btn('Tambahkan Area','add-area','primary')}</div><p class="footerhint">Jangan membagikan akun atau PIN antarpetugas.</p></div>
  <div class="card" id="auditCard"></div>`;
 loadAudit().catch(()=>{});
}
ACT['activate-user']=async()=>{
 const p_user=$('#newUser').value,p_role=$('#newRole').value,p_store=p_role==='store'?$('#newStore').value:null;
 if(!p_user)throw Error('Pilih akun yang akan diaktifkan.');
 await rpc('assign_user',{p_user,p_role,p_store});toast('Akun aktif');await render();
};
ACT['pin-set']=async el=>{const tr=el.closest('tr');await rpc('set_pin',{p_user:tr.dataset.uid,p_pin:tr.querySelector('.pinvalue').value});toast('PIN SPV/Admin diperbarui');tr.querySelector('.pinvalue').value=''};
ACT['add-area']=async()=>{const p_user=$('#spvUser').value,p_store=$('#spvStore').value;if(!p_user)throw Error('Pilih SPV.');await rpc('assign_spv_store',{p_user,p_store});toast('Area SPV ditambahkan');await render()};

// ===== Counting: draft lokal & scanner barcode =====
function readCountDraft(cid){try{return JSON.parse(localStorage.getItem('tsiSO_draft_'+cid)||'{}')}catch(e){return{}}}
function writeCountDraft(cid,d){try{localStorage.setItem('tsiSO_draft_'+cid,JSON.stringify(d))}catch(e){}}
function clearCountDraft(cid,skus){try{const d=readCountDraft(cid);(skus||[]).forEach(k=>delete d[k]);localStorage.setItem('tsiSO_draft_'+cid,JSON.stringify(d))}catch(e){}}
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

// ===== Manajemen Akses: Audit Trail =====
async function loadAudit(){
 const box=$('#auditCard');if(!box)return;
 const rows=await rpc('audit_list',{p_limit:100});
 box.innerHTML=`<h3 class="heading">Audit Trail (100 aktivitas terakhir)</h3>${rows.length?`<div class="tablewrap"><table><thead><tr><th>Waktu</th><th>User</th><th>Toko</th><th>Aktivitas</th><th>Detail</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHTML(new Date(r.at).toLocaleString('id-ID'))}</td><td>${escapeHTML(r.user||'-')}</td><td>${escapeHTML(r.store||'-')}</td><td>${escapeHTML(r.event)}</td><td class="small mono">${escapeHTML(JSON.stringify(r.meta||{}).slice(0,160))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Belum ada aktivitas.</div>'}`;
}

(async()=>{const {data:{session}}=await sb.auth.getSession();if(session)await start();else loginView()})();
