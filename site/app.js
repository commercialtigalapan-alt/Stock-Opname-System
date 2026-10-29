import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const root=document.querySelector('#root');
const SPV_AREAS=['AREA-SULSEL','AREA-SULTENG','AREA-SULBAR','AREA-KALTIM','AREA-SULUT','AREA-SULTRA'];
const POS=[['display','Display'],['reject','Reject'],['rak_utama','Rak Utama'],['rak_cadangan','Rak Cadangan']];
const state={me:null,stores:[],dashboard:[],page:'dashboard',store:'',online:true,badges:{},
 dash:{tab:'kpi',store:'',type:'',range:null},
 sch:{store:'',range:null,rows:[]},
 exp:{store:'',range:null,rows:[],sel:new Set()},
 count:{offset:0,search:'',filter:'ALL',team:'',data:null,open:false,sel:new Set(),listQ:'',rows:[]},
 validation:{offset:0,search:'',filter:'VARIANCE',status:'ALL',data:null,open:false,cycle:'',listQ:'',rows:[]},
 builder:null,cov:{store:'',filter:'ALL',search:'',offset:0,data:null}};
let upRows=[];
let inflight=0;
let calc=null;

/* ---------- helper umum ---------- */
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
const SYNC_RPCS=new Set(['upload','start','start_cycle','submit','approve','recount','validate_edit','validate_line','schedule_create','schedule_update','schedule_delete','archive_cycles','hard_delete','unlock','ba_sign','ba_sign_bulk','ba_adjust','ba_adjust_bulk','ba_clean','assign_user','set_store_spv','set_store_area','rounds_resync','activate_user']);
const rpc=async(name,args={})=>{busy(1);try{const {data,error}=await sb.rpc('tsi_so_'+name,args);if(error){if(!error.code)state.online=false;throw new Error(error.message||'Terjadi kesalahan server')}state.online=true;if(SYNC_RPCS.has(name))notifySync(name,args.p_store||null);return data}finally{busy(-1)}};
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const isoUTC=d=>d.toISOString().slice(0,10);
state.dash.range=newRange();state.sch.range=newRange();state.exp.range=newRange();
const fmtDate=d=>d?new Date(d+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}):'—';
const fmtShort=d=>new Date(d+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short'});
const ini=s=>{const t=String(s||'?').split('@')[0].trim();const w=t.split(/\s+/).filter(Boolean);
 return (w.length>1?w[0][0]+w[1][0]:((t.match(/[a-zA-Z0-9]/g)||['?']).slice(0,2).join(''))).toUpperCase()};
const ROLE_LABEL={admin:'Admin',spv:'SPV',store:'Store'};
const TONE={SCHEDULED:'blue',COUNTING:'blue',RECOUNT:'orange',SUBMITTED:'orange',APPROVED:'green','BELUM SO':'gray',BELUM:'gray',SELISIH:'red',TALLY:'green'};
const chip=(s,label)=>`<span class="chip ${TONE[s]||'gray'}"><i></i>${escapeHTML(label||(s==='SUBMITTED'?'Validasi SPV':s)||'BELUM SO')}</span>`;
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
});

/* ---------- warna: nama warna dibaca persis seperti fungsi SQL tsi_so_color_name ---------- */
function colorName(name,cat){
 const up=String(name||'').toUpperCase().trim();
 const c=String(cat||'').toUpperCase().trim();
 const m=up.match(/^(.*?)\s+\d+S(\s|$)/);
 let v=m?m[1]:((c&&up.startsWith(c+' '))?up.slice(c.length+1):up);
 v=(' '+v).replace(/(\s+(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|ALL\s?SIZE|FREE\s?SIZE|\d{1,3}))+$/,'').trim();
 return v||'TANPA WARNA';
}
const COLOR_EXACT={'HITAM':'#111827','PUTIH':'#ffffff','ABU MUDA':'#c4c9d1','ABU TUA':'#4b5563','TANPA WARNA':'#e5e7eb',
 'SKY BLUE':'#7dd3fc','STEEL BLUE':'#4b6584','ORANGE BATA':'#c2410c','COKLAT TUA':'#6b3f24','MERAH CABE':'#dc2626',
 'BENHUR':'#2563eb','TOSCA':'#14b8a6','TURKIS':'#06b6d4','CREAM':'#f3e3bf','NAVY':'#1e3a8a','MAROON':'#7f1d1d','BURGUNDY':'#800020',
 'OFF WHITE':'#f8f5ee','BABY PINK':'#f9c6d6','ALMOND BROWN':'#a0785a','BLUSH RED':'#d9546b','BABY BLUE':'#bae6fd','PUTIH ARMY':'#c8cfb0','PUTIH-ARMY':'#c8cfb0'};
const COLOR_WORD={HITAM:'#111827',BLACK:'#111827',BLACKS:'#111827',BLK:'#111827',JET:'#111827',ONYX:'#111827',
 PUTIH:'#ffffff',WHITE:'#ffffff',WHT:'#ffffff',IVORY:'#fffff0',GADING:'#f5ecd7',SUSU:'#fbf7ee',SNOW:'#fffafa',PEARL:'#f3efe6',
 ABU:'#9ca3af',GREY:'#9ca3af',GRAY:'#9ca3af',GRY:'#9ca3af',CHARCOAL:'#374151',ARANG:'#374151',ANTRASIT:'#3f3f46',ANTHRACITE:'#3f3f46',
 SILVER:'#c0c0c0',PERAK:'#c0c0c0',SMOKE:'#8e9196',MELANGE:'#a8a29e',MARLE:'#a8a29e',HEATHER:'#a8a29e',
 BIRU:'#2563eb',BLUE:'#2563eb',BLU:'#2563eb',NAVY:'#1e3a8a',NVY:'#1e3a8a',ROYAL:'#2563eb',COBALT:'#1d4ed8',LAUT:'#1e40af',MARINE:'#1e3a8a',
 DENIM:'#3b5b92',JEANS:'#3b5b92',SKY:'#7dd3fc',LANGIT:'#7dd3fc',INDIGO:'#3f51b5',SAPPHIRE:'#1d4ed8',CYAN:'#06b6d4',AQUA:'#22d3ee',
 STEEL:'#4b6584',TOSCA:'#14b8a6',TEAL:'#14b8a6',TURKIS:'#06b6d4',TURQUOISE:'#06b6d4',PETROL:'#0f5e6e',BENHUR:'#2563eb',
 HIJAU:'#16a34a',GREEN:'#16a34a',GRN:'#16a34a',ARMY:'#4b5320',MILITER:'#4b5320',MILITARY:'#4b5320',OLIVE:'#6b7a2b',OLV:'#6b7a2b',ZAITUN:'#6b7a2b',
 LUMUT:'#4d7c0f',MINT:'#86efac',LIME:'#84cc16',APEL:'#a3c93a',EMERALD:'#059669',SAGE:'#9caf88',FOREST:'#166534',BOTOL:'#14532d',BOTTLE:'#14532d',
 MERAH:'#dc2626',RED:'#dc2626',CABE:'#dc2626',CHERRY:'#be123c',RUBY:'#9f1239',SCARLET:'#ef4444',CRIMSON:'#b91c1c',TOMAT:'#e11d48',
 MAROON:'#7f1d1d',MRN:'#7f1d1d',BURGUNDY:'#800020',WINE:'#722f37',ANGGUR:'#722f37',
 ORANGE:'#f97316',JINGGA:'#f97316',BATA:'#c2410c',CORAL:'#ff7f50',SALMON:'#fa8072',PEACH:'#ffcba4',TERRACOTTA:'#c2410c',
 KUNING:'#facc15',YELLOW:'#facc15',MUSTARD:'#d4a017',GOLD:'#d4af37',GOLDEN:'#d4af37',EMAS:'#d4af37',LEMON:'#fde047',
 PINK:'#ec4899',FUCHSIA:'#d946ef',MAGENTA:'#c026d3',ROSE:'#e11d48',BLUSH:'#f4a7b9',
 UNGU:'#7c3aed',PURPLE:'#7c3aed',VIOLET:'#8b5cf6',LILAC:'#c8a2c8',LILA:'#c8a2c8',LAVENDER:'#b4a7d6',PLUM:'#8e4585',MAUVE:'#b784a7',TERONG:'#5b2c6f',GRAPE:'#6b2d8b',
 COKLAT:'#92400e',COKELAT:'#92400e',BROWN:'#92400e',BRN:'#92400e',CHOCO:'#5c3a21',CHOCOLATE:'#5c3a21',MOCHA:'#7b5b4a',MOCCA:'#7b5b4a',TOBACCO:'#8b5a2b',TOBACO:'#8b5a2b',
 KOPI:'#6f4e37',COFFEE:'#6f4e37',SADDLE:'#8b5a2b',TAN:'#b08d57',CAMEL:'#c19a6b',TAUPE:'#8b8589',MARRON:'#7b3f00',HAZEL:'#8e7055',KAYU:'#8b5a2b',
 BEIGE:'#d8c3a5',KHAKI:'#c3b091',KHK:'#c3b091',SAND:'#e0cda9',PASIR:'#e0cda9',NUDE:'#e8c9b1',SKIN:'#e8c9b1',KULIT:'#e8c9b1',ALMOND:'#efdecd',
 CREAM:'#f3e3bf',KRIM:'#f3e3bf',CRM:'#f3e3bf',OATMEAL:'#e6dccb',LINEN:'#ede6d6',LINNEN:'#ede6d6',ECRU:'#e5dccb'};
const MOD_LIGHT=/^(BABY|MUDA|LIGHT|LT|PALE|SOFT)$/, MOD_DARK=/^(TUA|DARK|DK|DEEP)$/;
const hexToRgb=h=>{const v=parseInt(h.slice(1),16);return[(v>>16)&255,(v>>8)&255,v&255]};
const rgbToHex=c=>'#'+c.map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('');
const mixHex=(hex,target,t)=>{const a=hexToRgb(hex),b=hexToRgb(target);return rgbToHex(a.map((x,i)=>x+(b[i]-x)*t))};
const luminance=hex=>{const c=hexToRgb(hex).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
function colorHex(name){
 const key=String(name||'').toUpperCase().replace(/[-\/_]+/g,' ').replace(/\s+/g,' ').trim();
 if(COLOR_EXACT[key])return COLOR_EXACT[key];
 const words=key.split(' ').filter(Boolean);
 const base=words.find(w=>COLOR_WORD[w]);
 if(!base)return '#94a3b8';
 let hex=COLOR_WORD[base];
 if(words.some(w=>MOD_LIGHT.test(w)))hex=mixHex(hex,'#ffffff',0.4);
 if(words.some(w=>MOD_DARK.test(w)))hex=mixHex(hex,'#000000',0.3);
 return hex;
}
function colorStyle(name){const hex=colorHex(name);const lum=luminance(hex);return{bg:hex,fg:lum>0.45?'#111827':'#ffffff',ring:lum>0.8}}
const swatchStyle=st=>`background:${st.bg};${st.ring?'box-shadow:inset 0 0 0 1.5px #94a3b8;':''}`;
const isDarkHex=hex=>luminance(hex)<0.3;
const nameBadge=(name,cat)=>{const cn=colorName(name,cat);const hex=colorHex(cn);const dk=isDarkHex(hex);
 return `<span class="nbadge-c ${dk?'dk':''}" style="${dk?`background:${hex};border-color:${hex}`:`background:linear-gradient(90deg,${hex}55,${hex}22);border-color:${hex}88`}" title="Warna: ${escapeHTML(cn)}">${escapeHTML(name)}</span>`};
const colorChip=(name)=>{const st=colorStyle(name);return `<span class="cchip"><i style="${swatchStyle(st)}"></i>${escapeHTML(name)}</span>`};

/* ---------- rentang: minggu ISO, bulan, tahun, 30/90 hari, atau tanggal sendiri ---------- */
const RANGE_LABEL={all:'Semua Periode',week:'Per Minggu',month:'Per Bulan',year:'Per Tahun',d30:'30 Hari Terakhir',d90:'90 Hari Terakhir',custom:'Rentang Tanggal'};
function isoWeekOf(t){
 const d=new Date(Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()));
 const dayNum=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-dayNum);
 const ys=new Date(Date.UTC(d.getUTCFullYear(),0,1));
 return{y:d.getUTCFullYear(),w:Math.ceil((((d-ys)/864e5)+1)/7)};
}
function isoWeekStart(y,w){const j=new Date(Date.UTC(y,0,4));const dow=(j.getUTCDay()+6)%7;const m1=new Date(j);m1.setUTCDate(j.getUTCDate()-dow+(w-1)*7);return m1}
function isoWeeksIn(y){return isoWeekOf(new Date(y,11,28)).w}
function newRange(){const t=new Date();const w=isoWeekOf(t);return{kind:'all',week:`${w.y}-${w.w}`,month:iso(t).slice(0,7),year:String(t.getFullYear()),from:'',to:''}}
function rangeBounds(r){
 const t=new Date();const today=iso(t);
 switch(r.kind){
  case 'week':{const [y,w]=r.week.split('-').map(Number);const s=isoWeekStart(y,w);const e=new Date(s);e.setUTCDate(s.getUTCDate()+6);return[isoUTC(s),isoUTC(e)]}
  case 'month':{const [y,m]=r.month.split('-').map(Number);return[iso(new Date(y,m-1,1)),iso(new Date(y,m,0))]}
  case 'year':return[r.year+'-01-01',r.year+'-12-31'];
  case 'd30':return[iso(new Date(Date.now()-29*864e5)),today];
  case 'd90':return[iso(new Date(Date.now()-89*864e5)),today];
  case 'custom':return[r.from||null,r.to||null];
  default:return[null,null];
 }
}
function rangeSummary(r){
 const [a,b]=rangeBounds(r);
 if(!a&&!b)return 'Semua periode';
 return `${a?fmtShort(a):'awal'} – ${b?fmtShort(b):'sekarang'}`;
}
function rangeControlHTML(p,r){
 const Y=new Date().getFullYear();
 let extra='';
 if(r.kind==='week'){
  const opts=[];
  for(const y of [Y-1,Y])for(let w=1;w<=isoWeeksIn(y);w++){const s=isoWeekStart(y,w);const e=new Date(s);e.setUTCDate(s.getUTCDate()+6);const v=`${y}-${w}`;opts.push(`<option value="${v}" ${r.week===v?'selected':''}>Minggu ${w} · ${fmtShort(isoUTC(s))} – ${fmtShort(isoUTC(e))} ${y}</option>`)}
  extra=`<select class="input select wide" data-change="rng" data-p="${p}" data-f="week">${opts.join('')}</select>`;
 }else if(r.kind==='month'){
  extra=`<input class="input" type="month" value="${escapeHTML(r.month)}" data-change="rng" data-p="${p}" data-f="month"/>`;
 }else if(r.kind==='year'){
  extra=`<select class="input select" data-change="rng" data-p="${p}" data-f="year">${[Y-2,Y-1,Y,Y+1].map(y=>`<option value="${y}" ${String(y)===r.year?'selected':''}>Tahun ${y}</option>`).join('')}</select>`;
 }else if(r.kind==='custom'){
  extra=`<input class="input" type="date" value="${escapeHTML(r.from)}" data-change="rng" data-p="${p}" data-f="from" aria-label="Tanggal awal"/><span class="muted small">s/d</span><input class="input" type="date" value="${escapeHTML(r.to)}" data-change="rng" data-p="${p}" data-f="to" aria-label="Tanggal akhir"/>`;
 }
 return `<div class="range-ctl"><select class="input select" data-change="rng" data-p="${p}" data-f="kind">${Object.entries(RANGE_LABEL).map(([v,l])=>`<option value="${v}" ${r.kind===v?'selected':''}>${l}</option>`).join('')}</select>${extra}<span class="range-sum small muted">${escapeHTML(rangeSummary(r))}</span>${rstHTML(p)}</div>`;
}
const rangeOf=p=>p==='dash'?state.dash.range:p==='exp'?state.exp.range:state.sch.range;
const rangeRefresh=p=>p==='dash'?showDashboard():p==='exp'?showExport():showSchedule();
ACT['rng-clear']=async el=>{const r=rangeOf(el.dataset.p);r.kind='all';r.from='';r.to='';await rangeRefresh(el.dataset.p)};
CHG['rng']=async el=>{
 const p=el.dataset.p,f=el.dataset.f,r=rangeOf(p);
 r[f]=el.value;
 if(f==='kind'&&el.value==='custom'&&!r.from&&!r.to){await rangeRefresh(p);return}
 if(f==='from'||f==='to'){if(r.from&&r.to&&r.from>r.to){toast('Tanggal awal harus sebelum tanggal akhir.',true);return}}
 await rangeRefresh(p);
};

/* ---------- auth & shell ---------- */
function loginView(message=''){
 state.me=null;
 const eye='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
 const mail='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
 const lock='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
 wrap(`<section class="lg-bg"><div class="lg-card">
  <div class="lg-brand"><img class="lg-logo" src="logo.png" alt="Tigalapan"/><div><strong>Tigalapan Indonesia</strong><span>Stock Opname System</span></div></div>
  <h1 class="lg-title">Selamat datang</h1>
  <p class="lg-sub">Masuk untuk melanjutkan stock opname.</p>
  ${message?`<div class="lg-alert">${escapeHTML(message)}</div>`:''}
  <form id="loginForm" class="lg-form" novalidate>
   <label class="lg-field"><span>Email</span><div class="lg-input"><i>${mail}</i><input id="email" type="email" autocomplete="email" required placeholder="nama@email.com"/></div></label>
   <label class="lg-field"><span>Password</span><div class="lg-input"><i>${lock}</i><input id="password" type="password" minlength="6" autocomplete="current-password" required placeholder="Masukkan password"/><button type="button" class="lg-eye" id="pwToggle" aria-label="Tampilkan password">${eye}</button></div></label>
   <button class="lg-submit" type="submit" id="loginBtn">Masuk</button>
  </form>
  <div class="lg-divider"><span>atau</span></div>
  <button class="lg-link" id="forgotBtn" type="button">Lupa password?</button>
  <button class="lg-ghost" id="signUpBtn" type="button">Daftar akun baru</button>
  <p class="lg-foot">Akun baru perlu diaktifkan Admin sebelum dapat digunakan.</p>
 </div></section>`);
 $('#pwToggle').addEventListener('click',()=>{const i=$('#password');const show=i.type==='password';i.type=show?'text':'password';$('#pwToggle').setAttribute('aria-label',show?'Sembunyikan password':'Tampilkan password')});
 $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const email=$('#email').value.trim(),password=$('#password').value;if(!email||!password){toast('Isi email dan password.',true);return}const btn=$('#loginBtn');btn.disabled=true;btn.textContent='Memproses…';try{const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;await start()}catch(ex){toast(ex.message,true);btn.disabled=false;btn.textContent='Masuk'}});
 $('#forgotBtn').addEventListener('click',async()=>{const email=$('#email').value.trim();if(!email){toast('Isi email dulu, lalu tekan Lupa password.',true);return}const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.href.split('?')[0].split('#')[0]});toast(error?error.message:'Link reset password sudah dikirim ke email Anda.',!!error)});
 $('#signUpBtn').addEventListener('click',async()=>{const email=$('#email').value.trim(),password=$('#password').value;if(!email||password.length<6){toast('Isi email dan password minimal 6 karakter.',true);return}const {error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.href.split('?')[0]}});toast(error?error.message:'Pendaftaran diproses. Minta Admin mengaktifkan akun.',!!error)});
}
async function start(){
 const {data:{user}}=await sb.auth.getUser();if(!user){loginView();return}
 try{state.me=await rpc('me');state.stores=state.me.stores||[];state.store=state.me.store_code||state.stores[0]?.code||'';state.page='dashboard';await refreshDashboard();shell();await render();startPresence();startSync()}
 catch(ex){loginView('Login berhasil, tetapi '+ex.message);toast(ex.message,true)}
}
const PAGE={
 dashboard:['Dashboard','Ringkasan operasional Stock Opname'],
 schedule:['SO Schedule','Jadwal Partial dan Grand Stock Opname per toko'],
 count:['SO Counting','Hitung stok per posisi di desktop, tablet, atau smartphone'],
 coverage:['Cakupan SKU','Setiap SKU wajib ter-SO sebelum boleh di-SO lagi dalam periode ini'],
 validation:['Validasi SPV','Review hasil counting toko, validasi selisih, lalu approve SO'],
 export:['Export & Pembersihan','Export hasil SO APPROVED ke CSV, lalu bersihkan detail dari database'],
 upload:['Upload Inventory','Ganti inventory aktif toko. System qty SO yang berjalan ikut diperbarui sampai SUBMITTED'],
 ba:['Berita Acara','Approval berjenjang SPV lalu Manager, dan checklist adjustment per BA'],
 admin:['Manajemen Akses','Aktivasi user, SPV Mapping per toko, dan audit aktivitas']};
// Store: Dashboard, Schedule (lihat), Counting, Upload. SPV: semua kecuali Manajemen Akses. Admin: semua.
function menu(){const p=state.me.role;return [
 ['dashboard','Dashboard','⌂','MAIN'],
 ['schedule','SO Schedule','▦','STOCK OPNAME'],
 ['count','Counting','☑','STOCK OPNAME'],
 ['coverage','Cakupan SKU','◎','STOCK OPNAME'],
 ...(p!=='store'?[['validation','Validasi SPV','✓','STOCK OPNAME']]:[]),
 ...(p!=='store'?[['ba','Berita Acara','§','STOCK OPNAME']]:[]),
 ...(p!=='store'?[['export','Export & Pembersihan','⤓','REPORT & SETTINGS']]:[]),
 ['upload','Upload Inventory','⇧','INVENTORY & PLANNING'],
 ...(p==='admin'?[['admin','Manajemen Akses','⚙','REPORT & SETTINGS']]:[])]}
function shell(){
 wrap(`<div class="progress" id="progress"><i></i></div><section class="app${innerWidth>900&&innerWidth<=1100?' collapsed':''}" id="app">
 <aside class="sidebar">
  <div class="side-head"><div class="brand-card"><img class="logo-img" src="logo.png" alt="Tigalapan OPR Division"/><div class="brand-text"><strong>TIGALAPAN</strong><small>STOCK OPNAME SYSTEM</small></div></div><button class="collapse" id="collapseBtn" title="Perkecil / perbesar menu">‹</button></div>
  <nav class="nav" id="nav"></nav>
  <div class="side-foot"><div class="avatar">${escapeHTML(ini(state.me.name||state.me.email))}</div><div class="who"><strong title="${escapeHTML(state.me.email)}">${escapeHTML(state.me.name||state.me.email)}</strong><small>${ROLE_LABEL[state.me.role]} · ${state.me.role==='store'?escapeHTML(labelStore(state.me.store_code)):'Semua area'}</small></div></div>
 </aside>
 <main class="main">
  <header class="topbar"><div class="titles"><h1 id="topTitle"></h1><p id="topSubtitle"></p></div>
   <div class="top-actions"><div class="presence-wrap"><button class="btn pill" data-act="presence-toggle" title="Siapa yang sedang aktif">👥 <b id="presN">0</b> aktif</button><div class="presence-panel hidden" id="presPanel"></div></div><span class="sys" id="sysPill"><i></i>System Online</span><button class="btn pill" data-act="refresh" title="Muat ulang data dari server">↻ Refresh</button>${isAdmin()?'<button class="btn pill ghost" data-act="app-reset" title="Muat ulang seluruh aplikasi">⟲ Reset</button>':''}<button class="btn pill ghost" data-act="logout">Keluar</button></div>
  </header>
  <div class="content" id="content"></div>
 </main></section>`);
 $('#collapseBtn').onclick=()=>$('#app').classList.toggle('collapsed');
}
// Refresh: bersihkan cache di memori, muat ulang profil, toko, dan dashboard dari server
async function softRefresh(){
 state.builder=null;
 if(state.validation)state.validation.data=null;
 if(state.cov)state.cov.data=null;
 if(state.count)state.count.data=null;
 const me=await rpc('me');state.me=me;state.stores=me.stores||[];
 if(!state.stores.some(x=>x.code===state.store))state.store=me.store_code||state.stores[0]?.code||'';
 await refreshDashboard();
}
ACT['refresh']=async()=>{try{await softRefresh();await render();toast('Data diperbarui dari server')}catch(ex){toast(ex.message,true)}};
ACT['app-reset']=()=>{location.reload()};
ACT['logout']=async()=>{stopPresence();stopSync();await sb.auth.signOut();loginView()};
function updateNav(){const el=$('#nav');if(!el)return;let last='',html='';const b=state.badges;
 for(const [id,title,icon,section] of menu()){
  if(section!==last){html+=`<div class="nav-sec">${section}</div>`;last=section}
  const cnt=b[id]?`<b class="nbadge">${n(b[id])}</b>`:'';
  html+=`<button data-page="${id}" class="${state.page===id?'active':''}" title="${title}"><span class="ico">${icon}</span><span class="lbl">${title}</span>${cnt}</button>`;
 }
 el.innerHTML=html;
 paintNavPresence();
 el.querySelectorAll('[data-page]').forEach(b2=>b2.onclick=async()=>{state.page=b2.dataset.page;state.validation.open=false;if(state.ba)state.ba.open=null;state.count.open=false;state.count.sel=new Set();await render()});
}
const loadingHTML=(t='Memuat data…')=>`<div class="card loading-card"><span class="spinner"></span>${t}</div>`;
async function render(){
 if(!state.me)return;
 if(state.page!=='count')leaveCountChannel();
 const m=PAGE[state.page]||PAGE.dashboard;$('#topTitle').textContent=m[0];$('#topSubtitle').textContent=m[1];
 $('#content').innerHTML=loadingHTML();
 try{
  await loadBadges();updateNav();
  if(state.page==='dashboard')await showDashboard();
  if(state.page==='schedule')await showSchedule();
  if(state.page==='count')await showCount();
  if(state.page==='coverage')await showCoverage();
  if(state.page==='validation')await showValidation();
  if(state.page==='ba')await showBA();
  if(state.page==='export')await showExport();
  if(state.page==='upload')await showUpload();
  if(state.page==='admin')await showAdmin();
 }catch(ex){$('#content').innerHTML=`<div class="card"><div class="note warning">${escapeHTML(ex.message)}</div></div>`;toast(ex.message,true)}
 const pill=$('#sysPill');if(pill){pill.classList.toggle('off',!state.online);pill.lastChild.textContent=state.online?'System Online':'Koneksi terputus'}
 updatePresence();
}
async function loadBadges(){try{const k=await rpc('kpi',{});state.badges={schedule:k.so_scheduled+k.so_running,count:k.so_running+k.so_scheduled,validation:k.so_submitted}}catch(e){state.badges={}}}
function storeOptions(sel,all){return `${all?'<option value="">Semua Store</option>':''}${state.stores.map(s=>`<option value="${escapeHTML(s.code)}" ${s.code===sel?'selected':''}>${escapeHTML(s.name)}</option>`).join('')}`}
async function refreshDashboard(){const res=await rpc('dashboard');state.dashboard=res.stores||[]}

/* ---------- Dashboard ---------- */
function accuracyOf(k){
 const sku=k.appr_total>0?k.appr_tally/k.appr_total:null;
 const qty=k.appr_sys_qty>0?Math.max(0,1-k.appr_abs_qty/k.appr_sys_qty):(k.appr_total>0&&k.appr_abs_qty===0?1:null);
 const val=k.appr_sys_value>0?Math.max(0,1-k.appr_abs_value/k.appr_sys_value):(k.appr_total>0&&k.appr_abs_value===0?1:null);
 return{sku,qty,val};
}
const accOf=r=>accuracyOf(r);
function gridStyle(n){return `style="--n:${Math.min(Math.max(n,1),4)}"`}
function storeCard(s){const pv=s.total?Math.round(100*s.done/s.total):0;
 return `<div class="store-card st-${escapeHTML(s.status||'NONE').replace(/\s+/g,'_')}"><div class="sc-head"><div><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(s.code)} • ${escapeHTML(s.area||'')}</small></div>${chip(s.status,s.status==='BELUM SO'?'BELUM SO':undefined)}</div>
 <div class="sc-line"><span>${n(s.done)} / ${n(s.total)} SKU selesai (SO berjalan)</span><b>${pv}%</b></div><div class="bar"><span style="width:${pv}%"></span></div></div>`;
}
function analyticsRows(rows){
 return rows.map(r=>{const a=accOf(r);return `<tr><td><b>${escapeHTML(r.name)}</b><br><small class="muted">${escapeHTML(r.code)}</small></td><td>${escapeHTML(r.area||'—')}</td><td>${escapeHTML(r.spv||'—')}</td><td class="num">${n(r.so_total)}</td><td class="num">${n(r.so_approved)}</td><td class="num">${P(a.sku)}${barHTML(a.sku)}</td><td class="num">${P(a.qty)}</td><td class="num">${P(a.val)}</td><td class="num">${signed(r.net_qty_diff)}</td><td class="num">${rp(r.abs_value)}</td></tr>`}).join('');
}
function barHTML(v){const x=v===null||v===undefined?0:Math.round(v*100);return `<div class="bar mini-bar"><span style="width:${x}%"></span></div>`}
function areaRows(rows){
 const map=new Map();
 for(const r of rows){const k=r.area||'(Tanpa area)';if(!map.has(k))map.set(k,{area:k,stores:0,spv:new Set(),so_total:0,so_approved:0,appr_total:0,appr_tally:0,appr_sys_qty:0,appr_abs_qty:0,appr_sys_value:0,appr_abs_value:0,net_qty_diff:0,abs_value:0});
  const m=map.get(k);m.stores++;if(r.spv)m.spv.add(r.spv);['so_total','so_approved','appr_total','appr_tally','appr_sys_qty','appr_abs_qty','appr_sys_value','appr_abs_value','net_qty_diff','abs_value'].forEach(f=>m[f]+=Number(r[f])||0)}
 return [...map.values()].sort((a,b)=>a.area.localeCompare(b.area));
}
// Agregasi KPI dari baris toko (dipakai saat filter area/toko aktif).
const KPI_KEYS=['so_total','so_finished','so_approved','so_submitted','so_running','so_scheduled','so_overdue','sku_done','appr_total','appr_tally','appr_sys_qty','appr_abs_qty','appr_sys_value','appr_abs_value','net_qty_diff','missing_value','surplus_value','abs_value'];
function sumKpi(rows){const o={};KPI_KEYS.forEach(f=>{o[f]=rows.reduce((s,r)=>s+(Number(r[f])||0),0)});return o}
const CHART_COLORS=['#2563eb','#16a34a','#f59e0b','#dc2626','#7c3aed','#0891b2','#db2777','#65a30d','#ea580c','#475569'];
const BUCKETS=[['day','Harian'],['week','Mingguan'],['month','Bulanan'],['year','Tahunan']];
function bucketLabel(key,b){
 const d=new Date(key+'T00:00:00');
 if(b==='month')return d.toLocaleDateString('id-ID',{month:'short',year:'numeric'});
 if(b==='year')return String(d.getFullYear());
 return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'});
}
// Grafik garis SVG sederhana. series: [{name,color,values:[0..1|null],bold}]
function lineChartSVG(series,labels){
 const W=960,H=320,L=52,R=16,T=16,B=44;const iw=W-L-R,ih=H-T-B;const cnt=labels.length;
 const x=i=>L+(cnt<=1?iw/2:i*iw/(cnt-1));
 // Skala sumbu mengikuti data (kelipatan 5% di bawah nilai terendah) agar perbedaan antar toko terlihat.
 const vals=series.flatMap(s=>s.values).filter(v=>v!=null);
 const lo=vals.length?Math.min(...vals):0;
 let ystep=0.25;for(const c of [0.02,0.05,0.1,0.25]){if((1-Math.max(0,Math.floor((lo-0.02)/c)*c))/c<=5){ystep=c;break}}
 const yMin=Math.max(0,Math.floor((lo-0.02)/ystep)*ystep);
 const y=v=>T+ih*(1-Math.max(0,Math.min(1,(v-yMin)/(1-yMin))));
 let g='';
 for(let t=yMin;t<=1.000001;t+=ystep){const tt=Math.min(1,+t.toFixed(4));const yy=y(tt).toFixed(1);g+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" class="gl"/><text x="${L-8}" y="${(+yy+4).toFixed(1)}" class="gt" text-anchor="end">${Math.round(tt*100)}%</text>`}
 const step=Math.max(1,Math.ceil(cnt/12));
 labels.forEach((lb,i)=>{if(i%step!==0&&i!==cnt-1)return;g+=`<text x="${x(i).toFixed(1)}" y="${H-14}" class="gt" text-anchor="middle">${escapeHTML(lb)}</text>`});
 series.forEach(s=>{
  let path='',pen=false;
  s.values.forEach((v,i)=>{if(v==null){pen=false;return}path+=(pen?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1);pen=true});
  if(path)g+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.bold?3.5:2}" stroke-linejoin="round" stroke-linecap="round"${s.dash?' stroke-dasharray="6 5"':''}/>`;
  s.values.forEach((v,i)=>{if(v==null)return;g+=`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${s.bold?4:3}" fill="${s.color}"><title>${escapeHTML(s.name)} · ${escapeHTML(labels[i])}: ${P(v)}</title></circle>`});
 });
 return `<svg class="line-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik tren akurasi SKU">${g}</svg>`;
}
// Isi tab "Grafik & Tren": seluruh data mengikuti filter area, toko, jenis SO, dan rentang tanggal.
function chartTabHTML(d,rows,k,trend){
 const codes=new Set(rows.map(r=>r.code));
 const names=new Map(rows.map(r=>[r.code,r.name]));
 const tr=trend.filter(r=>codes.has(r.store_code));
 const buckets=[...new Set(tr.map(r=>r.bucket))].sort();
 const bl=buckets.map(b=>bucketLabel(b,d.bucket||'week'));
 // 1) Tren akurasi SKU per toko + garis gabungan
 const stores=rows.filter(r=>tr.some(x=>x.store_code===r.code)).map(r=>r.code);
 const series=stores.map((code,i)=>({name:names.get(code),color:CHART_COLORS[i%CHART_COLORS.length],
  values:buckets.map(b=>{const x=tr.find(t=>t.store_code===code&&t.bucket===b);return x&&x.appr_total>0?x.appr_tally/x.appr_total:null})}));
 if(stores.length>1)series.push({name:'Gabungan',color:'#0f172a',bold:true,values:buckets.map(b=>{const l=tr.filter(t=>t.bucket===b);const tt=l.reduce((s,x)=>s+x.appr_total,0);return tt?l.reduce((s,x)=>s+x.appr_tally,0)/tt:null})});
 const trendHTML=buckets.length
  ?`<div class="line-wrap">${lineChartSVG(series,bl)}</div><div class="legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${escapeHTML(s.name)}</span>`).join('')}</div>`
  :'<div class="empty">Belum ada SO APPROVED pada periode ini.</div>';
 // 2) SKU accuracy per toko (urut tertinggi)
 const acc=rows.filter(r=>r.appr_total>0).map(r=>({name:r.name,v:accOf(r).sku})).sort((x,y)=>y.v-x.v);
 const accHTML=acc.length?acc.map(x=>{const p=Math.round(x.v*100);const tone=x.v>=.95?'ok':x.v>=.85?'warn':'bad';
  return `<div class="hbar-row"><span class="hbar-l" title="${escapeHTML(x.name)}">${escapeHTML(x.name)}</span><div class="hbar-t"><span class="hbar-f ${tone}" style="width:${p}%"></span></div><b class="num">${P(x.v)}</b></div>`}).join(''):'<div class="empty">Belum ada SO APPROVED.</div>';
 // 3) Volume SO approved per periode
 const vol=buckets.map(b=>tr.filter(t=>t.bucket===b).reduce((s,x)=>s+x.so_approved,0));
 const vmax=Math.max(1,...vol);
 const volHTML=buckets.length?`<div class="colchart">${vol.map((v,i)=>`<div class="col"><div class="col-bar" style="height:${Math.max(2,Math.round(v/vmax*100))}%"><span>${n(v)}</span></div><small>${escapeHTML(bl[i])}</small></div>`).join('')}</div>`:'<div class="empty">Belum ada SO APPROVED pada periode ini.</div>';
 // 4) Status SO (posisi seluruh SO)
 const parts=[['Terjadwal',k.so_scheduled,'stk-sch'],['Sedang Counting',k.so_running,'stk-run'],['Validasi SPV',k.so_submitted,'stk-sub'],['Approved',k.so_approved,'stk-app']];
 const tot2=parts.reduce((s,p)=>s+(Number(p[1])||0),0);
 const statusHTML=tot2?`<div class="stk-bar">${parts.map(p=>`<span class="${p[2]}" style="width:${((Number(p[1])||0)/tot2*100).toFixed(2)}%" title="${p[0]}: ${n(p[1])}"></span>`).join('')}</div><div class="st-legend">${parts.map(p=>`<span><i class="sw ${p[2]}"></i>${p[0]} · <b>${n(p[1])}</b></span>`).join('')}</div>`:'<div class="empty">Belum ada SO pada periode ini.</div>';
 // 5) Nilai selisih per toko (kekurangan vs kelebihan)
 const vals=rows.map(r=>({name:r.name,m:Number(r.missing_value)||0,s:Number(r.surplus_value)||0})).filter(x=>x.m>0||x.s>0).sort((x,y)=>(y.m+y.s)-(x.m+x.s));
 const vmax2=Math.max(1,...vals.map(x=>Math.max(x.m,x.s)));
 const valHTML=vals.length?vals.map(x=>`<div class="hbar-pair"><span class="hbar-l" title="${escapeHTML(x.name)}">${escapeHTML(x.name)}</span><div><div class="hbar-t"><span class="hbar-f miss" style="width:${(x.m/vmax2*100).toFixed(1)}%"></span></div><div class="hbar-t"><span class="hbar-f sur" style="width:${(x.s/vmax2*100).toFixed(1)}%"></span></div></div><small class="num">${rp(-x.m)}<br>${rp(x.s,true)}</small></div>`).join('')+'<div class="legend"><span><i style="background:#dc2626"></i>Kekurangan</span><span><i style="background:#16a34a"></i>Kelebihan</span></div>':'<div class="empty">Tidak ada nilai selisih pada periode ini.</div>';
 return `<div class="chart-grid">
  <div class="card chart-card chart-wide"><div class="card-head"><div><h3>Tren Akurasi SKU per Toko</h3><p class="muted small">Persentase SKU sesuai pada SO APPROVED, per periode.</p></div><div class="seg">${BUCKETS.map(([kk,l])=>`<button class="${(d.bucket||'week')===kk?'on':''}" data-act="dash-bucket" data-b="${kk}">${l}</button>`).join('')}</div></div>${trendHTML}</div>
  <div class="card chart-card"><div class="card-head"><div><h3>SKU Accuracy per Toko</h3><p class="muted small">Urut tertinggi. Hijau ≥ 95%, kuning ≥ 85%, merah di bawahnya.</p></div></div>${accHTML}</div>
  <div class="card chart-card"><div class="card-head"><div><h3>Volume SO Approved</h3><p class="muted small">Jumlah SO APPROVED per periode.</p></div></div>${volHTML}</div>
  <div class="card chart-card"><div class="card-head"><div><h3>Status SO</h3><p class="muted small">Posisi seluruh SO pada periode & filter.</p></div></div>${statusHTML}</div>
  <div class="card chart-card"><div class="card-head"><div><h3>Nilai Selisih per Toko</h3><p class="muted small">Kekurangan dan kelebihan stok pada SO APPROVED.</p></div></div>${valHTML}</div>
 </div>`;
}
async function showDashboard(){
 const d=state.dash;await refreshDashboard();
 d.bucket=d.bucket||'week';
 const [from,to]=rangeBounds(d.range);
 const wantChart=d.tab==='chart';
 const [kpiRpc,analytics,trend]=await Promise.all([
  rpc('kpi',{p_store:d.store||null,p_type:d.type||null,p_from:from,p_to:to}),
  rpc('store_analytics',{p_type:d.type||null,p_from:from,p_to:to}),
  wantChart?rpc('accuracy_trend',{p_type:d.type||null,p_from:from,p_to:to,p_bucket:d.bucket}):Promise.resolve([])]);
 const areas=[...new Set(analytics.map(r=>r.area).filter(Boolean))].sort((x,y)=>x.localeCompare(y));
 if(d.area&&!areas.includes(d.area))d.area='';
 if(d.store&&!analytics.some(r=>r.code===d.store&&(!d.area||r.area===d.area)))d.store='';
 const rows=analytics.filter(r=>(!d.area||r.area===d.area)&&(!d.store||r.code===d.store));
 const cards=state.dashboard.filter(s=>(!d.area||s.area===d.area)&&(!d.store||s.code===d.store));
 // KPI: tanpa filter memakai RPC kpi; dengan filter area/toko dijumlahkan dari baris toko yang terpilih.
 const k=(d.area||d.store)?sumKpi(rows):kpiRpc;
 const a=accuracyOf(k),tot=k.so_total,fin=k.so_finished;
 const kpi=(cls,label,value,sub)=>`<div class="kpi ${cls}"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;
 const vol=(cls,label,value,sub)=>`<div class="vol ${cls}"><div class="vol-l">${label}</div><div class="vol-v">${value}</div><div class="vol-s">${sub}</div></div>`;
 const tabs=[['kpi','KPI & Ringkasan'],['chart','Grafik & Tren'],['acc','Akurasi Area & Toko'],['wf','Workflow'],['risk','Risiko & Progress'],['act','Aktivitas']];
 let body='';
 if(d.tab==='kpi'){
  body=`<div class="sec-title">Ringkasan Operasional <small>Periode: ${escapeHTML(rangeSummary(d.range))}</small></div>
  <div class="kpis">
   ${kpi('o','SKU Accuracy',P(a.sku),`${n(k.appr_tally)} dari ${n(k.appr_total)} SKU pada SO APPROVED`)}
   ${kpi('g','Qty Accuracy',P(a.qty),'System Qty vs Actual Qty (SO APPROVED)')}
   ${kpi('o','Value Accuracy',P(a.val),'Akurasi nilai persediaan (SO APPROVED)')}
   ${kpi('a','SO Approved',`${n(k.so_approved)} / ${n(tot)}`,`${n(k.so_submitted)} SO menunggu validasi SPV`)}
  </div>
  <div class="sec-title">Volume & Progress</div>
  <div class="vols">
   ${vol('o','Total SO',n(tot),'SO pada periode & filter')}
   ${vol('g','Completion',P(tot?fin/tot:null),`${n(fin)} SO selesai (SUBMITTED/APPROVED)`)}
   ${vol('o','SKU Counted',n(k.sku_done),'Total SKU pada SO yang selesai')}
   ${vol('a','Net Variance Qty',signed(k.net_qty_diff),'Actual Qty − System Qty')}
  </div>
  <div class="sec-title">Financial & Risiko</div>
  <div class="vols">
   ${vol('r','Gross Missing',rp(-k.missing_value),'Nilai kekurangan stok')}
   ${vol('g','Surplus',rp(k.surplus_value,true),'Nilai kelebihan stok')}
   ${vol('r','Total Value Loss',rp(k.abs_value),'Total nilai selisih absolut')}
   ${vol('a','Overdue',n(k.so_overdue),'SO terjadwal yang sudah lewat tanggal')}
  </div>
  <div class="sec-title">Ringkasan Toko <small>Progress SO berjalan per toko (status terkini)</small></div>
  <div class="store-grid" ${gridStyle(cards.length)}>${cards.length?cards.map(storeCard).join(''):'<div class="empty">Belum ada toko untuk filter ini.</div>'}</div>`;
 }
 if(d.tab==='chart'){
  body=chartTabHTML(d,rows,k,trend);
 }
 if(d.tab==='acc'){
  const areaList=areaRows(rows);
  body=`<div class="sec-title">Akurasi per Area <small>${escapeHTML(rangeSummary(d.range))}</small></div>
  <div class="tablewrap"><table class="fit"><thead><tr><th>Area</th><th class="num">Toko</th><th>SPV</th><th class="num">SO</th><th class="num">Approved</th><th class="num">SKU Accuracy</th><th class="num">Qty Accuracy</th><th class="num">Value Accuracy</th></tr></thead><tbody>
  ${areaList.map(m=>{const x=accuracyOf({appr_total:m.appr_total,appr_tally:m.appr_tally,appr_sys_qty:m.appr_sys_qty,appr_abs_qty:m.appr_abs_qty,appr_sys_value:m.appr_sys_value,appr_abs_value:m.appr_abs_value});return `<tr><td><b>${escapeHTML(m.area)}</b></td><td class="num">${n(m.stores)}</td><td>${escapeHTML([...m.spv].join(', ')||'—')}</td><td class="num">${n(m.so_total)}</td><td class="num">${n(m.so_approved)}</td><td class="num">${P(x.sku)}${barHTML(x.sku)}</td><td class="num">${P(x.qty)}</td><td class="num">${P(x.val)}</td></tr>`}).join('')||'<tr><td colspan="8" class="empty">Belum ada data pada periode ini.</td></tr>'}
  </tbody></table></div>
  <div class="sec-title">Akurasi per Toko</div>
  <div class="tablewrap"><table class="fit"><thead><tr><th>Toko</th><th>Area</th><th>SPV</th><th class="num">SO</th><th class="num">Approved</th><th class="num">SKU Accuracy</th><th class="num">Qty Accuracy</th><th class="num">Value Accuracy</th><th class="num">Net Qty</th><th class="num">Value Loss</th></tr></thead><tbody>${analyticsRows(rows)||'<tr><td colspan="10" class="empty">Belum ada data pada periode ini.</td></tr>'}</tbody></table></div>
  <p class="footerhint">Akurasi hanya dihitung dari SO berstatus APPROVED pada periode yang dipilih. SO yang sudah dibersihkan tetap dihitung dari ringkasannya.</p>`;
 }
 if(d.tab==='wf'){
  const step=(label,val,tone)=>`<div class="wf ${tone}"><small>${label}</small><b>${n(val)}</b></div>`;
  body=`<div class="wf-row">${step('Terjadwal',k.so_scheduled,'blue')}<i>→</i>${step('Sedang Counting',k.so_running,'orange')}<i>→</i>${step('Validasi SPV',k.so_submitted,'amber')}<i>→</i>${step('Approved',k.so_approved,'green')}</div>
  <p class="footerhint">Alur: Jadwal (SCHEDULED) → Counting Store (COUNTING/RECOUNT) → Validasi SPV (SUBMITTED) → Approved.</p>`;
 }
 if(d.tab==='risk'){
  const list=cards.slice().sort((x,y)=>(x.total?x.done/x.total:0)-(y.total?y.done/y.total:0));
  body=`<div class="store-grid" ${gridStyle(list.length)}>${list.map(storeCard).join('')||'<div class="empty">Belum ada data.</div>'}</div><p class="footerhint">Diurutkan dari progress terendah.</p>`;
 }
 if(d.tab==='act'){
  body=isAdmin()?'<div class="card" id="auditCard"></div>':'<div class="empty">Log aktivitas hanya tersedia untuk Admin.</div>';
 }
 $('#content').innerHTML=`<div class="card filter-card">
  <div class="filters">
   <select class="input select" data-change="dash-area" id="dArea"><option value="">Semua Area</option>${areas.map(ar=>`<option value="${escapeHTML(ar)}" ${d.area===ar?'selected':''}>${escapeHTML(ar)}</option>`).join('')}</select>
   <select class="input select" data-change="dash-filter" id="dStore"><option value="">Semua Store</option>${analytics.filter(r=>!d.area||r.area===d.area).map(r=>`<option value="${escapeHTML(r.code)}" ${d.store===r.code?'selected':''}>${escapeHTML(r.name)}</option>`).join('')}</select>
   <select class="input select" data-change="dash-filter" id="dType"><option value="">Semua Jenis SO</option><option value="GRAND" ${d.type==='GRAND'?'selected':''}>Grand SO</option><option value="PARTIAL" ${d.type==='PARTIAL'?'selected':''}>Partial SO</option></select>
   ${rangeControlHTML('dash',d.range)}
  </div>
 </div>
 <div class="card tabs-card"><span class="tabs-lbl">ANALISA</span>${tabs.map(([id,l])=>`<button class="tab ${d.tab===id?'on':''}" data-act="dash-tab" data-tab="${id}">${l}</button>`).join('')}</div>
 ${body}`;
 if(d.tab==='act'&&isAdmin())loadAudit().catch(()=>{});
}
CHG['dash-area']=async()=>{state.dash.area=$('#dArea').value;state.dash.store='';await showDashboard()};
ACT['dash-bucket']=async el=>{state.dash.bucket=el.dataset.b;await showDashboard()};
CHG['dash-filter']=async()=>{state.dash.store=$('#dStore').value;state.dash.type=$('#dType').value;await showDashboard()};
ACT['dash-tab']=async el=>{state.dash.tab=el.dataset.tab;await showDashboard()};
function resetPage(p){
 if(p==='dash'){state.dash.area='';state.dash.store='';state.dash.type='';state.dash.range=newRange()}
 else if(p==='sch'){state.sch.store='';state.sch.range=newRange()}
 else if(p==='exp'){state.exp.store='';state.exp.range=newRange();state.exp.sel=new Set()}
 else if(p==='count'){Object.assign(state.count,{offset:0,search:'',filter:'ALL',team:'',listQ:''})}
 else if(p==='validation'){Object.assign(state.validation,{offset:0,search:'',filter:'VARIANCE',status:'ALL',listQ:''})}
 else if(p==='cov'){Object.assign(state.cov,{filter:'ALL',search:'',offset:0})}
 else if(p==='ba'&&state.ba){state.ba.status='ALL';state.ba.store='ALL'}
}
const rstHTML=p=>`<button class="btn ghost sm filter-reset" data-act="filters-reset" data-p="${p}" title="Kembalikan filter di blok ini ke awal">↺ Reset</button>`;
ACT['filters-reset']=async el=>{resetPage(el.dataset.p);await render()};
ACT['dash-reset']=async()=>{state.dash.area='';state.dash.store='';state.dash.type='';state.dash.range=newRange();await showDashboard()};

/* ---------- Import CSV inventory ---------- */
function parseCSV(text){
 text=text.replace(/^﻿/,'');
 const head=text.split(/\r?\n/)[0]||'';
 const delim=[',',';','\t'].map(d=>[d,head.split(d).length-1]).sort((a,b)=>b[1]-a[1])[0][0];
 if(!head.includes(delim))throw Error('CSV harus memiliki beberapa kolom terpisah koma / titik koma / tab.');
 let rows=[],cells=[],part='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(ch==='"'){if(quoted&&text[i+1]==='"'){part+='"';i++}else quoted=!quoted}
  else if(ch===delim&&!quoted){cells.push(part);part=''}
  else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;cells.push(part);if(cells.some(x=>x.trim()))rows.push(cells);cells=[];part=''}
  else part+=ch;}
 if(quoted)throw Error('Format CSV tidak valid: tanda kutip tidak tertutup.');
 if(part!==''||cells.length){cells.push(part);if(cells.some(x=>x.trim()))rows.push(cells)}
 if(!rows.length)throw Error('CSV kosong.');
 return rows;
}
function normHead(s){return String(s||'').trim().toLowerCase().replace(/[\s_-]+/g,'')}
function importRows(csv){
 const parsed=parseCSV(csv);const headers=parsed.shift().map(normHead);
 const index=names=>names.map(normHead).map(v=>headers.indexOf(v)).find(i=>i>=0)??-1;
 const cSku=index(['SKU','Item SKU','Kode SKU','Kode Item']);const cName=index(['NAME_VARIANT','Name - Variant','Name Variant','Item Name','Nama Item']);const cEnd=index(['ENDING','Ending Inventory','Qty','Stok Akhir']);const cCat=index(['CATEGORY','Category Name','Category']);const cRetail=index(['Harga Retail','Retail Price','Harga_Retail','RETAIL']);const cCost=index(['COST','HPP','Unit Cost','Unit_Cost']);
 if(cName<0||cEnd<0)throw Error('Header CSV harus memuat Name - Variant (atau NAME_VARIANT) dan Ending.');
 const body=parsed.filter(v=>!(v[cEnd]||'').trim().startsWith('-'));
 if(body.length>10000)throw Error('Maksimal 10.000 SKU per upload.');
 const seen=new Set();
 const out=body.map((v,i)=>{const rawSku=cSku>=0?(v[cSku]||''):(v[cName]||'');const sku=rawSku.trim().toUpperCase(),name=(v[cName]||'').trim(),ending=(v[cEnd]||'').trim(),cost=cCost>=0?(v[cCost]||'0').trim():'0',retail=cRetail>=0?((v[cRetail]||'').trim()||'0'):'0';
  if(!sku||!name||!/^\d+$/.test(ending)||!/^\d+(\.\d{1,2})?$/.test(cost)||!/^\d+(\.\d{1,2})?$/.test(retail))throw Error(`Baris ${i+2} tidak valid: SKU/nama/Ending/Cost.`);
  if(seen.has(sku))throw Error('SKU duplikat: '+sku);seen.add(sku);
  return{sku,name,category:cCat>=0?(v[cCat]||'').trim():'',ending:Number(ending),cost:Number(cost),retail:Number(retail)};});
 out.skipped=parsed.length-body.length;return out;
}

/* ---------- SO Schedule ---------- */
function assignNo(rows){
 const cnt={};
 rows.slice().sort((a,b)=>(a.planned_date||'').localeCompare(b.planned_date||'')||(a.started_at||'').localeCompare(b.started_at||'')).forEach(r=>{
  const d=r.planned_date||(r.started_at||'').slice(0,10)||iso(new Date());
  const k=r.store_code+r.so_type+d;cnt[k]=(cnt[k]||0)+1;
  const [y,m,dd]=d.split('-');
  r.no=`SO-${r.so_type==='PARTIAL'?'P':'G'}-${r.store_code}-${dd}${m}${y.slice(2)}-${String(cnt[k]).padStart(3,'0')}`;
 });
 return rows;
}
function schActions(r){
 const a=[],mgr=canManage();
 if(r.status==='SCHEDULED'){
  a.push(btn('▶ Proses','sch-start','primary',{store:r.store_code,id:r.id}));
  a.push(btn('✎ Edit','sch-edit','outline',{id:r.id}));
  a.push(btn('Hapus','sch-del','danger',{id:r.id}));
 }else if(r.status==='COUNTING'||r.status==='RECOUNT'){
  a.push(btn('Lanjut Counting','count-open','primary',{store:r.store_code,cycle:r.id}));
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
  <div class="toolbar-right"><select class="input select" data-change="sch-filter">${storeOptions(sc.store,true)}</select>
   ${btn('+ Partial SO','b-open','outline',{type:'PARTIAL'})}${btn('+ Grand SO','b-open','primary',{type:'GRAND'})}</div></div>
 <div class="card filter-card">${rangeControlHTML('sch',sc.range)}</div>
 <div class="note info">${isAdmin()||state.me.role==='spv'?'Jadwal per toko. SO yang sudah APPROVED tampil sesuai rentang tanggal yang dipilih.':'Jadwal SO toko Anda. Buat, ubah, atau hapus jadwal yang belum diproses, lalu klik Proses untuk memulai SO.'}</div>
 ${groups.size?[...groups.values()].map(g=>{const run=g.rows.filter(r=>['COUNTING','RECOUNT'].includes(r.status)).length;const busy=g.rows.some(r=>['COUNTING','RECOUNT','SUBMITTED'].includes(r.status));const code=g.rows[0].store_code;const isOpen=(state.sch.folders||{})[code]??busy;return `<details class="card store-folder" data-code="${escapeHTML(code)}" ${isOpen?'open':''}>
   <summary><span class="sf-name">📁 ${escapeHTML(g.name)}</span><span class="sf-meta">${n(g.rows.length)} SO${run?` · ${n(run)} sedang berjalan`:''}</span></summary>
   <div class="tablewrap"><table><thead><tr><th>SO</th><th>Tanggal</th><th>PIC</th><th>Status</th><th class="num">SKU</th><th>Action</th></tr></thead><tbody>${g.rows.map(r=>`<tr><td><b class="mono">${escapeHTML(r.no)}</b><br><small class="muted">${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}${r.start_time?' • '+escapeHTML(r.start_time.slice(0,5)):''}${r.team_map?' • per tim/POS':(r.scope_rule?' • category/warna':'')}</small></td><td>${fmtDate(r.planned_date)}</td><td>${escapeHTML(r.pic||'-')}</td><td>${chip(r.status)}</td><td class="num">${n(r.scope_count)}</td><td class="actions">${schActions(r)}</td></tr>`).join('')}</tbody></table></div>
  </details>`}).join(''):'<div class="card empty">Belum ada SO pada filter ini.'+' Klik + Partial SO atau + Grand SO untuk membuat jadwal.</div>'}`;
}
document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.classList&&d.classList.contains('store-folder')&&d.dataset.code){state.sch.folders=state.sch.folders||{};state.sch.folders[d.dataset.code]=d.open}},true);
document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.classList&&d.classList.contains('month-folder')&&d.dataset.mkey){state.exp.months=state.exp.months||{};state.exp.months[d.dataset.mkey]=d.open}},true);
document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.classList&&d.classList.contains('month-folder')&&d.dataset.mfkey){state.mf=state.mf||{};state.mf[d.dataset.mfkey]=d.open}},true);
CHG['sch-filter']=async el=>{state.sch.store=el.value;await showSchedule()};
ACT['sch-start']=async el=>{
 if(!confirm('Mulai SO sekarang? Stok sistem diambil dari inventory saat ini.'))return;
 await rpc('start_cycle',{p_cycle:el.dataset.id});toast('SO dimulai. Lanjutkan menghitung di SO Counting.');
 state.store=el.dataset.store;state.count.cycle=el.dataset.id;state.count.open=true;state.count.offset=0;state.count.search='';state.count.filter='ALL';state.count.team='';state.page='count';await refreshDashboard();await render();
};
ACT['sch-edit']=async el=>{const r=state.sch.rows.find(x=>x.id===el.dataset.id);if(!r)throw Error('Jadwal tidak ditemukan. Muat ulang halaman.');openBuilder(null,r)};
ACT['sch-del']=async el=>{
 if(!confirm('Hapus SO/jadwal ini? Draft counting yang belum disubmit ikut terhapus.'))return;
 await rpc('schedule_delete',{p_cycles:[el.dataset.id]});toast('Jadwal dihapus');
 state.count.sel.delete(el.dataset.id);await render();
};
ACT['b-open']=async el=>openBuilder(el.dataset.type,null);

/* ---------- Builder Partial / Grand SO ----------
   cats: Map(kategori -> Set(warna terpilih)). Set berisi pilihan eksplisit; null = belum dimuat (dianggap semua).
   Sebuah category yang dicentang wajib punya minimal satu warna. Jika semua warna dipilih, rule menyimpan kategori tanpa daftar warna. */
function newScope(){return{cats:new Map(),skus:new Set()}}
function scopeFromRule(rule){
 const s=newScope();
 if(rule){
  (rule.categories||[]).forEach(c=>{const cols=(rule.colors||{})[c];s.cats.set(c,cols&&cols.length?new Set(cols):null)});
  (rule.skus||[]).forEach(x=>s.skus.add(x));
 }
 return s;
}
function ruleOf(scope,stats){
 const categories=[...scope.cats.keys()];const colors={};
 for(const [cat,set] of scope.cats){
  if(!set)continue;
  const all=(stats.get(cat)||[]).map(x=>x.color);
  if(all.length&&set.size<all.length)colors[cat]=[...set];
 }
 return{categories,colors,skus:[...scope.skus]};
}
const isEmptyRule=r=>!r.categories.length&&!r.skus.length;
function ownerScope(b,owner){return owner==='main'?b.scope:b.teams[Number(owner)]?.scope}
function teamsPayload(b){return b.teams.map(t=>({name:(t.name||'').trim()||'Tim',rule:ruleOf(t.scope,b.stats)}))}
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
   <div class="bcol" id="bCol">
    <div class="step"><span>1</span><h4>Jadwal & Scope</h4></div>
    <label class="field">Toko *<select id="bStore" class="input" data-change="b-store" ${edit?'disabled':''}>${state.stores.map(s=>`<option value="${escapeHTML(s.code)}" ${s.code===b.store?'selected':''}>${escapeHTML(s.name)}</option>`).join('')}</select></label>
    <div class="field"><span>Jenis SO *</span><div class="seg"><button class="${b.type==='GRAND'?'on':''}" data-act="b-type" data-v="GRAND">Grand SO</button><button class="${b.type==='PARTIAL'?'on':''}" data-act="b-type" data-v="PARTIAL">Partial SO</button></div></div>
    <div class="grid3">
     <label class="field">Tanggal *<input type="date" id="bDate" class="input" value="${edit?(cycle.planned_date||''):iso(new Date())}" data-change="b-field"/></label>
     <label class="field">Jam mulai<input type="time" id="bStart" class="input" value="${edit?(cycle.start_time||'').slice(0,5):''}" data-change="b-field"/></label>
     <label class="field">Jam selesai<input type="time" id="bEnd" class="input" value="${edit?(cycle.end_time||'').slice(0,5):''}" data-change="b-field"/></label>
    </div>
    <label class="field">Catatan<input id="bNotes" class="input" maxlength="500" value="${escapeHTML(edit?(cycle.notes||''):'')}"/></label>
    <div id="bScope"></div>
   </div>
   <div class="pcol" id="pCol"><div class="step"><span>2</span><h4>Preview Schedule</h4></div><div id="bPreview"></div></div>
  </div>
  <div class="modal-foot"><button class="btn outline" data-act="b-close">Batal</button><button class="btn primary" data-act="b-save">${edit?'Simpan Perubahan':'Create Schedule'}</button></div>
 </div>`;
 document.body.appendChild(ov);
 renderScope().catch(ex=>toast(ex.message,true));
}
function closeBuilder(){document.getElementById('builder')?.remove();state.builder=null}
ACT['b-close']=()=>closeBuilder();
ACT['b-type']=async el=>{const b=state.builder;if(!b)return;b.type=el.dataset.v;if(b.type==='PARTIAL'&&b.scopeMode==='ALL')b.scopeMode='SCOPE';
 $$('#bCol [data-act="b-type"]').forEach(x=>x.classList.toggle('on',x.dataset.v===b.type));await renderScope()};
ACT['b-mode']=async el=>{const b=state.builder;if(!b)return;b.scopeMode=el.dataset.v;if(b.scopeMode==='TEAMS'&&!b.teams.length)b.teams.push({name:'POS 1',scope:newScope()});await renderScope()};
CHG['b-store']=async el=>{const b=state.builder;if(!b)return;b.store=el.value;b.scope=newScope();b.teams=[];b.stats=new Map();b.catList=null;await renderScope()};
CHG['b-field']=()=>schedulePreview();

async function ensureStats(b,cats){
 const need=cats.filter(c=>!b.stats.has(c));
 await Promise.all(need.map(async c=>{try{const list=(await rpc('color_stats',{p_store:b.store,p_category:c})).slice().sort((x,y)=>y.sku_count-x.sku_count||x.color.localeCompare(y.color));b.stats.set(c,list)}catch(ex){b.stats.set(c,[]);toast(ex.message,true)}}));
}
// Set kosong dari null (belum dimuat) -> semua warna, dipanggil setelah stats tersedia
function materialize(b,scope,cat){
 const set=scope.cats.get(cat);
 if(set===null||set===undefined){const all=(b.stats.get(cat)||[]).map(x=>x.color);scope.cats.set(cat,new Set(all));return scope.cats.get(cat)}
 return set;
}
function ownerKey(owner,cat){return owner+'|'+cat}
function colorPanelHTML(owner,cat,set,list){
 if(!list)return '<div class="color-panel small muted">Memuat warna…</div>';
 if(!list.length)return '<div class="color-panel small muted">Tidak ada SKU pada category ini.</div>';
 const count=set?set.size:0;
 const head=`<div class="cp-head"><span class="small"><b>Warna ${escapeHTML(cat)}</b> — ${n(count)} dari ${n(list.length)} dipilih</span>
  <span class="cp-actions"><button class="link-btn" data-act="b-color-all" data-owner="${escapeHTML(owner)}" data-cat="${escapeHTML(cat)}">Pilih semua</button><button class="link-btn muted-link" data-act="b-color-clear" data-owner="${escapeHTML(owner)}" data-cat="${escapeHTML(cat)}">Kosongkan</button></span></div>`;
 return `<div class="color-panel">${head}<div class="crow-grid">${list.map(x=>{
   const checked=!!set&&set.has(x.color);const hex=colorHex(x.color);const dk=isDarkHex(hex);
   const elig=x.eligible_count??x.sku_count;const locked=x.sku_count-elig;
   const style=dk?`background:${hex};border-color:${hex}`:`background:linear-gradient(90deg,${hex}40,${hex}14);border-color:${hex}88`;
   return `<label class="crow ${checked?'on':''} ${dk?'dk':''}" style="${style}"><span class="crow-top"><input type="checkbox" data-change="b-color" data-owner="${escapeHTML(owner)}" data-cat="${escapeHTML(cat)}" value="${escapeHTML(x.color)}" ${checked?'checked':''}/><span class="cname">${escapeHTML(x.color)}</span></span><span class="crow-bot"><small>${n(elig)} bisa di-SO${locked>0?` · ${n(locked)} terkunci`:''}</small><em>${x.so_count?n(x.so_count)+'x SO':'Belum SO'}</em></span></label>`}).join('')}</div></div>`;
}
function catBlockHTML(b,owner,cat,scope){
 const on=scope.cats.has(cat);const set=scope.cats.get(cat);const list=b.stats.get(cat);
 let sub;
 if(!on)sub=n(b.catList?.find(c=>c.category===cat)?.count||0)+' SKU';
 else if(!list)sub='memuat…';
 else sub=n(set?set.size:0)+' dari '+n(list.length)+' warna';
 return `<div class="cat-block ${on?'open':''}" data-blk="${escapeHTML(ownerKey(owner,cat))}"><label class="cat ${on?'on':''}"><input type="checkbox" data-change="b-cat" data-owner="${escapeHTML(owner)}" value="${escapeHTML(cat)}" ${on?'checked':''}/><span><b>${escapeHTML(cat||'(Tanpa category)')}</b><small>${sub}</small></span></label>${on?colorPanelHTML(owner,cat,set,list):''}</div>`;
}
function catBlocksHTML(b,owner,scope){
 if(!b.catList)return '<div class="empty small">Memuat category…</div>';
 if(!b.catList.length)return '<div class="empty small">Belum ada category pada inventory toko ini.</div>';
 return b.catList.map(c=>catBlockHTML(b,owner,c.category,scope)).join('');
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
// Scroll: simpan posisi semua induk scrollable, pulihkan setelah render ulang
function scrollSnap(el){const arr=[];let p=el;while(p&&p!==document.body){if(p.scrollTop)arr.push([p,p.scrollTop]);p=p.parentElement}return arr}
function scrollRestore(arr){arr.forEach(([p,t])=>{p.scrollTop=t})}
// Render ulang satu blok category saja (tidak menyentuh area scroll lain)
function redrawBlock(owner,cat){
 const b=state.builder;const scope=ownerScope(b,owner);if(!scope)return;
 const el=$$('#builder [data-blk]').find(x=>x.dataset.blk===ownerKey(owner,cat));
 if(!el){renderScope();return}
 const tmp=document.createElement('div');tmp.innerHTML=catBlockHTML(b,owner,cat,scope);
 el.replaceWith(tmp.firstElementChild);
 updateCatSummary();schedulePreview();
}
function updateCatSummary(){
 const b=state.builder;if(!b)return;
 const el=$('#catSum');if(!el)return;
 const cats=b.scope.cats.size;const sel=[...b.scope.cats.values()].reduce((a,s)=>a+(s?s.size:0),0);
 el.textContent=`${n(cats)} category dipilih · ${n(sel)} warna · ${n(b.scope.skus.size)} SKU manual`;
}
async function renderScope(){
 const b=state.builder;if(!b)return;const box=$('#bScope');if(!box)return;
 const modes=b.type==='GRAND'?[['ALL','Seluruh SKU'],['SCOPE','Category & Warna'],['TEAMS','Bagi per Tim / POS']]:[['SCOPE','Category & Warna'],['TEAMS','Bagi per Tim / POS']];
 if(!modes.some(m=>m[0]===b.scopeMode))b.scopeMode=modes[0][0];
 if(!b.catList){b.catList=await rpc('categories',{p_store:b.store})}
 if(state.builder!==b)return;
 const allScopes=[b.scope,...b.teams.map(t=>t.scope)];
 const cats=new Set(allScopes.flatMap(s=>[...s.cats.keys()]));
 await ensureStats(b,[...cats]);
 if(state.builder!==b)return;
 allScopes.forEach(s=>{for(const c of s.cats.keys())if(s.cats.get(c)===null)materialize(b,s,c)});
 const modeSeg=`<div class="field"><span>Cara SO *</span><div class="seg">${modes.map(([v,l])=>`<button class="${b.scopeMode===v?'on':''}" data-act="b-mode" data-v="${v}">${l}</button>`).join('')}</div></div>`;
 let body='';
 if(b.scopeMode==='ALL'){
  body=`<div class="scope-box"><b>Scope: seluruh SKU inventory toko</b><p class="small muted">Stok sistem diambil saat SO dimulai (Proses) dan ikut diperbarui jika inventory di-upload ulang, sampai SO di-SUBMIT store. Setelah SUBMIT, system dikunci. Pilih Category & Warna atau Bagi per Tim / POS bila SO hanya sebagian.</p></div>`;
 }else if(b.scopeMode==='SCOPE'){
  body=`<div class="scope-box">
    <div class="scope-head"><b>Category & Warna</b>
     <span class="cp-actions"><button class="link-btn" data-act="b-cat-all">Pilih semua category</button><button class="link-btn muted-link" data-act="b-cat-clear">Kosongkan semua</button></span></div>
    <p class="small muted">Centang category, lalu pilih warna satu per satu. Gunakan "Kosongkan" untuk mulai dari nol. Warna dengan SKU terbanyak tampil paling atas.</p>
    <div class="small" id="catSum"></div>
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
 const snap=scrollSnap(box);
 box.innerHTML=modeSeg+body;
 scrollRestore(snap);
 if(b.scopeMode==='SCOPE'){drawSkuChips();updateCatSummary()}
 updatePreview();
}
CHG['b-cat']=async el=>{
 const b=state.builder;const owner=el.dataset.owner,cat=el.value;const scope=b&&ownerScope(b,owner);if(!scope)return;
 if(el.checked){await ensureStats(b,[cat]);scope.cats.set(cat,new Set((b.stats.get(cat)||[]).map(x=>x.color)))}
 else scope.cats.delete(cat);
 redrawBlock(owner,cat);
};
ACT['b-cat-all']=async()=>{
 const b=state.builder;if(!b||!b.catList)return;
 const snap=scrollSnap($('#bScope'));
 await ensureStats(b,b.catList.map(c=>c.category));
 b.scope.cats=new Map(b.catList.map(c=>[c.category,new Set((b.stats.get(c.category)||[]).map(x=>x.color))]));
 await renderScope();scrollRestore(snap);
};
ACT['b-cat-clear']=async()=>{const b=state.builder;if(!b)return;b.scope.cats=new Map();await renderScope()};
ACT['b-color-all']=async el=>{const b=state.builder;const owner=el.dataset.owner,cat=el.dataset.cat;const s=b&&ownerScope(b,owner);if(!s)return;s.cats.set(cat,new Set((b.stats.get(cat)||[]).map(x=>x.color)));redrawBlock(owner,cat)};
ACT['b-color-clear']=async el=>{const b=state.builder;const owner=el.dataset.owner,cat=el.dataset.cat;const s=b&&ownerScope(b,owner);if(!s)return;s.cats.set(cat,new Set());redrawBlock(owner,cat)};
CHG['b-color']=async el=>{
 const b=state.builder;const owner=el.dataset.owner,cat=el.dataset.cat;const s=b&&ownerScope(b,owner);if(!s)return;
 const set=materialize(b,s,cat);
 if(el.checked)set.add(el.value);else set.delete(el.value);
 redrawBlock(owner,cat);
};
CHG['b-sku']=el=>{const b=state.builder;if(!b)return;el.checked?b.scope.skus.add(el.value):b.scope.skus.delete(el.value);drawSkuChips();updateCatSummary();schedulePreview()};
ACT['b-sku-del']=async el=>{const b=state.builder;if(!b)return;b.scope.skus.delete(el.dataset.sku);drawSkuChips();updateCatSummary();const cb=$$('#bSkuList input').find(x=>x.value===el.dataset.sku);if(cb)cb.checked=false;schedulePreview()};
CHG['b-search']=async el=>{
 const b=state.builder;if(!b)return;b.skuQ=el.value.trim();
 const d=await rpc('sku_coverage',{p_store:b.store,p_filter:'ALL',p_search:b.skuQ,p_offset:0,p_limit:50});
 const box=$('#bSkuList');if(!box||state.builder!==b)return;
 box.innerHTML=(d.items||[]).map(x=>{const sel=b.scope.skus.has(x.sku);const dis=!x.eligible&&!sel;
   return `<label class="sku-row ${dis?'locked':''}"><input type="checkbox" data-change="b-sku" value="${escapeHTML(x.sku)}" ${sel?'checked':''} ${dis?'disabled':''}/><span class="mono">${escapeHTML(x.sku)}</span><small>${escapeHTML(x.name)}</small><span class="ratio ${x.ratio?'r1':'r0'}">${n(x.ratio)}x</span><em>${dis?'Terkunci':'Bisa'}</em></label>`}).join('')||'<div class="empty small">Tidak ada SKU yang cocok.</div>';
};
CHG['b-team-name']=el=>{const b=state.builder;const t=b&&b.teams[Number(el.dataset.idx)];if(!t)return;t.name=el.value;schedulePreview()};
ACT['b-team-add']=async()=>{const b=state.builder;if(!b)return;b.teams.push({name:'POS '+(b.teams.length+1),scope:newScope()});await renderScope()};
ACT['b-team-del']=async el=>{const b=state.builder;if(!b)return;b.teams.splice(Number(el.dataset.idx),1);await renderScope()};
ACT['b-mode-set']=async()=>{};

function schedulePreview(){const b=state.builder;if(!b)return;clearTimeout(b.timer);b.timer=setTimeout(updatePreview,250)}
async function updatePreview(){
 const b=state.builder;if(!b||!$('#bPreview'))return;
 const store=$('#bStore')?.value||b.store;
 const date=$('#bDate')?.value||'',start=$('#bStart')?.value||'',end=$('#bEnd')?.value||'';
 let info={count:0,sample:[]},teamRes=null,err='';
 try{
  if(b.scopeMode==='TEAMS'){
   teamRes=await rpc('teams_preview',{p_store:store,p_teams:teamsPayload(b)});
   info={count:teamRes.count,sample:[]};
  }else if(b.scopeMode==='SCOPE'){
   info=await rpc('scope_preview',{p_store:store,p_type:b.type,p_rule:ruleOf(b.scope,b.stats)});
  }else{
   info=await rpc('scope_preview',{p_store:store,p_type:'GRAND',p_rule:{}});
  }
 }catch(ex){err=ex.message}
 if(state.builder!==b||!$('#bPreview'))return;
 if(teamRes){teamRes.teams.forEach((t,i)=>{const el=$('#tc'+i);if(el)el.textContent=`${n(t.count)} SKU`})}
 const desc=b.scopeMode==='ALL'?'Seluruh inventory toko':b.scopeMode==='SCOPE'?`${n(b.scope.cats.size)} category • ${n(b.scope.skus.size)} SKU manual`:`${n(b.teams.length)} tim/POS`;
 $('#bPreview').innerHTML=`<div class="prev">
   <div class="prev-stats"><div><small>Toko</small><b>${escapeHTML(labelStore(store))}</b></div><div><small>Jenis</small><b>${b.type==='GRAND'?'Grand SO':'Partial SO'}</b></div><div><small>Tanggal</small><b>${fmtDate(date)}</b></div><div><small>Jam</small><b>${start||'—'}${end?' – '+end:''}</b></div></div>
   <div class="prev-big"><small>SKU yang di-SO</small><b>${n(info.count)}</b><span>${desc}</span></div>
   ${b.scopeMode==='TEAMS'&&teamRes?`<div class="team-summary">${teamRes.teams.map(t=>`<div><span>${escapeHTML(t.name)}</span><b>${n(t.count)} SKU</b></div>`).join('')}</div>`:''}
   ${err?`<div class="note warning">${escapeHTML(err)}</div>`:''}
   ${info.sample?.length?`<div class="sku-cloud">${info.sample.map(s=>`<span class="sku-chip mono">${escapeHTML(s)}</span>`).join('')}${info.count>info.sample.length?`<span class="small muted">+${n(info.count-info.sample.length)} lainnya</span>`:''}</div>`:''}
   <div class="note info small">Stok sistem diambil saat SO dimulai (Proses). Jika inventory di-upload ulang, system ikut diperbarui sampai SO di-SUBMIT. Setelah SUBMIT, system dikunci dan hanya bisa diubah SPV/Admin di menu Validasi.</div>
 </div>`;
}
ACT['b-save']=async()=>{
 const b=state.builder;if(!b)return;
 const store=$('#bStore').value,date=$('#bDate').value,start=$('#bStart').value||null,end=$('#bEnd').value||null,notes=$('#bNotes').value.trim();
 if(!date)throw Error('Tanggal jadwal wajib diisi.');
 let p_rule={},p_teams=[];
 const owners=b.scopeMode==='SCOPE'?[['main',b.scope]]:b.scopeMode==='TEAMS'?b.teams.map((t,i)=>[String(i),t.scope]):[];
 for(const [owner,sc] of owners){
  for(const [cat,set] of sc.cats){
   const list=b.stats.get(cat)||[];
   if(list.length&&(!set||set.size===0))throw Error(`Category ${cat} belum punya warna dipilih. Pilih minimal satu warna atau hapus centang category.`);
  }
 }
 if(b.scopeMode==='SCOPE'){
  const r=ruleOf(b.scope,b.stats);
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

/* ---------- SO Counting: 4 posisi, total, status TALLY/SELISIH (system tidak ditampilkan), alasan wajib saat selisih ---------- */
async function showCount(){
 const c=state.count;
 if(state.me.role==='store'){
  await refreshDashboard();
  const t=await countTarget();
  if(!t)return countStart(current());
  if(t.status==='SCHEDULED')return countStart(schedArg(t));
  return loadCount(t.id);
 }
 if(c.open){
  await refreshDashboard();
  const t=await countTarget();
  if(!t){c.open=false;return showCount()}
  if(t.status==='SCHEDULED')return countStart(schedArg(t));
  return loadCount(t.id);
 }
 return showCountList();
}
function current(){return state.dashboard.find(x=>x.code===state.store)||null}
const OPEN_ST=['SCHEDULED','COUNTING','RECOUNT','SUBMITTED'];
const CYC_LAB={SCHEDULED:'Terjadwal',COUNTING:'Counting',RECOUNT:'Recount',SUBMITTED:'Validasi SPV'};
async function countTarget(){
 const all=await rpc('schedule_list',{p_store:state.store||null});
 const list=(all||[]).filter(r=>OPEN_ST.includes(r.status));
 state.count.cycles=list;
 let t=list.find(r=>r.id===state.count.cycle);
 if(!t)t=list.find(r=>['COUNTING','RECOUNT','SUBMITTED'].includes(r.status))||list[0]||null;
 state.count.cycle=t?t.id:null;
 return t;
}
function schedArg(t){return {...t,cycle_id:t.id,inventory_count:current()?.inventory_count}}
function cycleSwitchHTML(){
 const list=state.count.cycles||[];
 if(list.length<2)return '';
 return `<div class="cyc-switch">${list.map(r=>`<button class="cyc-pill ${r.id===state.count.cycle?'on':''}" data-act="cyc-pick" data-id="${escapeHTML(r.id)}"><b class="mono">${escapeHTML(r.no||'SO')}</b><span>${CYC_LAB[r.status]||escapeHTML(r.status)}</span></button>`).join('')}</div>`;
}
ACT['cyc-pick']=async el=>{state.count.cycle=el.dataset.id;state.count.offset=0;state.count.search='';state.count.filter='ALL';state.count.team='';state.count.open=true;await render()};
function mountUpPanel(keep,s){
 const slot=$('#upSlot');if(!slot)return;
 if(keep)slot.replaceWith(keep);else slot.outerHTML=uploadPanelHTML(s);
}
function countStart(s){
 const back=state.me.role!=='store'?`<div class="crumb"><button class="btn ghost" data-act="count-back">← Daftar SO</button></div>`:'';
 const keepUp=$('#upPanel');
 $('#content').innerHTML=`${back}${cycleSwitchHTML()}<div id="upSlot"></div><div class="card stack"><div class="note info">${s?.status==='SCHEDULED'?`SO terjadwal${s.planned_date?' pada '+fmtDate(s.planned_date):''}. Klik Proses untuk memulai SO.`:'Belum ada SO untuk toko ini. Pastikan inventory sudah di-upload.'}</div>${s?.status==='SCHEDULED'||!s?.cycle_id?btn('▶ Proses / Mulai SO','start-so','primary'):''}</div>`;
 mountUpPanel(keepUp,s);
}
ACT['start-so']=async()=>{if(!confirm('Mulai SO sekarang? Stok sistem diambil dari inventory saat ini.'))return;if(state.count.cycle)await rpc('start_cycle',{p_cycle:state.count.cycle});else await rpc('start',{p_store:state.store});toast('SO berhasil dimulai');state.count.open=true;await refreshDashboard();await render()};
ACT['count-back']=async()=>{state.count.open=false;state.count.search='';state.count.offset=0;await render()};
ACT['count-open']=async el=>{state.store=el.dataset.store;state.count.cycle=el.dataset.cycle||null;state.count.open=true;state.count.offset=0;state.count.search='';state.count.filter='ALL';state.count.team='';state.page='count';await render()};
async function showCountList(){
 leaveCountChannel();
 const c=state.count;
 const all=assignNo(await rpc('schedule_list',{p_store:null}));
 c.rows=all.filter(r=>['SCHEDULED','COUNTING','RECOUNT'].includes(r.status));
 c.sel=new Set([...c.sel].filter(id=>c.rows.some(r=>r.id===id)));
 $('#content').innerHTML=`<div class="card">
  <div class="toolbar"><input id="cListSearch" class="input grow" placeholder="Cari SO Number / Store" value="${escapeHTML(c.listQ)}"/>${rstHTML('count')}</div>
  <div class="bulkbar"><button class="btn outline" data-act="c-all">Pilih Semua</button><button class="btn outline" data-act="c-none">Kosongkan</button>${canManage()?'<button class="btn danger" data-act="c-bulk-del">Hapus Dipilih</button>':''}<span class="muted small" id="cSelCount"></span></div>
  <div id="cBody"></div>
 </div>`;
 drawCountRows();
}
function countActions(r){
 const a=[];
 if(r.status==='SCHEDULED'){a.push(btn('▶ Proses','sch-start','primary',{store:r.store_code,id:r.id}));a.push(btn('Hapus','sch-del','danger',{id:r.id}))}
 else{a.push(btn('Lanjut Counting','count-open','primary',{store:r.store_code,cycle:r.id}));if(canManage())a.push(btn('Hapus','sch-del','danger',{id:r.id}))}
 return a.join('');
}
function cntListRowHTML(r){const c=state.count;return `<tr><td><input type="checkbox" data-change="c-chk" value="${r.id}" ${c.sel.has(r.id)?'checked':''} ${canManage()?'':'disabled'}/></td><td><b class="mono">${escapeHTML(r.no)}</b></td><td>${escapeHTML(r.store_name)}</td><td>${fmtDate(r.planned_date)}</td><td>${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}</td><td>${chip(r.status)}</td><td class="num">${n(r.scope_count)}</td><td class="actions">${countActions(r)}</td></tr>`}
function drawCountRows(){
 const c=state.count;const q=(c.listQ||'').trim().toLowerCase();
 const rows=c.rows.filter(r=>!q||(r.no+' '+r.store_name).toLowerCase().includes(q));
 const body=$('#cBody');if(!body)return;
 body.innerHTML=monthFolders('count',rows,r=>mfKeyDate(r.planned_date),g=>`<div class="tablewrap"><table><thead><tr><th></th><th>SO Number</th><th>Store</th><th>Tanggal</th><th>Tipe</th><th>Status</th><th class="num">SKU</th><th>Action</th></tr></thead><tbody>${g.map(cntListRowHTML).join('')}</tbody></table></div>`,g=>`${n(g.length)} SO`)||'<div class="empty">Tidak ada SO yang perlu dihitung.</div>';
 const lbl=$('#cSelCount');if(lbl)lbl.textContent=`${c.sel.size} dipilih`;
}
CHG['c-chk']=el=>{const c=state.count;el.checked?c.sel.add(el.value):c.sel.delete(el.value);const lbl=$('#cSelCount');if(lbl)lbl.textContent=`${c.sel.size} dipilih`};
ACT['c-all']=async()=>{state.count.sel=new Set(state.count.rows.map(r=>r.id));drawCountRows()};
ACT['c-none']=async()=>{state.count.sel=new Set();drawCountRows()};
ACT['c-bulk-del']=async()=>{
 const ids=[...state.count.sel];if(!ids.length)throw Error('Pilih SO terlebih dahulu.');
 if(!confirm(`Hapus ${ids.length} SO/jadwal terpilih? Tindakan ini tidak bisa dibatalkan.`))return;
 const out=await rpc('schedule_delete',{p_cycles:ids});toast(`${n(out.deleted)} SO dihapus`);
 state.count.sel=new Set();await render();
};
function uploadPanelHTML(s){
 return `<details class="card up-panel" id="upPanel" open><summary><b>⬆ Upload Inventory</b><span class="muted small">Ganti inventory aktif toko. SO yang sudah SUBMITTED tidak ikut berubah.</span></summary>
  <div class="up-body">
   ${canManage()?`<select class="input select" data-change="up-store">${storeOptions(state.store,false)}</select>`:`<span class="chip blue"><i></i>${escapeHTML(labelStore(state.store))}</span>`}
   <label class="dropzone"><b>⬆ Pilih File CSV Inventory Summary</b><small>Name - Variant, Category, Ending. Kolom SKU, Cost, dan Harga Retail opsional.</small><input type="file" id="fileInput" accept=".csv,text/csv" data-change="file-pick"/></label>
   <div id="fileInfo" class="small muted">Belum ada file dipilih.</div>
   <div id="retailPreview"></div>
   <div class="row">${btn('Upload & Ganti Inventory','do-upload','primary')}</div>
   <p class="footerhint">Inventory aktif sekarang: ${n(s?.inventory_count||0)} SKU. Maksimal 10.000 SKU per file.</p>
  </div></details>`;
}
async function loadCount(cid){
 const s=current();
 const id=cid||state.count.cycle||s?.cycle_id;
 if(!id)return countStart(s);
 const sch=(state.count.cycles||[]).find(r=>r.id===id);
 if(sch?.status==='SCHEDULED')return countStart(schedArg(sch));
 const q=state.count;
 const data=await rpc('count_page',{p_cycle:id,p_offset:q.offset,p_limit:50,p_search:q.search,p_filter:q.filter,p_team:q.team||null});q.data=data;joinCountChannel(id);
 const edit=data.status==='COUNTING'||data.status==='RECOUNT';
 const keepUp=$('#upPanel');
 const back=state.me.role!=='store'?`<div class="crumb"><button class="btn ghost" data-act="count-back">← Daftar SO</button><span class="muted small">${escapeHTML(labelStore(state.store))}</span></div>`:'';
 const options=[['ALL','Semua SKU'],['PENDING','Belum Lengkap'],['DONE','Sudah Lengkap'],['SELISIH','Status Selisih'],['TALLY','Status Tally']].map(([v,l])=>`<option value="${v}" ${v===q.filter?'selected':''}>${l}</option>`).join('');
 const teams=data.teams||[];
 const teamSel=teams.length?`<select id="countTeam" class="input" data-change="count-team"><option value="">Semua Tim / POS</option>${teams.map(t=>`<option value="${escapeHTML(t)}" ${t===q.team?'selected':''}>${escapeHTML(t)}</option>`).join('')}</select>`:'';
 $('#content').innerHTML=`${back}${cycleSwitchHTML()}<div id="upSlot"></div><div class="card">
  <div class="card-head"><div class="row"><h3>SO Berjalan</h3>${chip(data.status)}</div>${edit?btn('Submit Counting','count-submit','dark'):''}</div>
  <div class="toolbar"><input id="countSearch" class="input grow" placeholder="Cari SKU / nama produk" value="${escapeHTML(q.search)}"/>${teamSel}<select id="countFilter" class="input" data-change="count-filter-chg">${options}</select>${btn('Cari','count-find','outline')}${btn('📷 Scan','scan-count','outline')}${rstHTML('count')}</div>
  <div class="tablewrap"><table id="countTable" class="count-table"><thead><tr><th>Nama Item & Warna</th>${POS.map(([,l])=>`<th class="num">${l}</th>`).join('')}<th class="num">Total</th><th>Alasan (wajib jika selisih)</th><th>Status</th></tr></thead><tbody>${data.items.length?data.items.map(x=>countRowHTML(x,edit)).join(''):'<tr><td colspan="9" class="empty">Tidak ada SKU</td></tr>'}</tbody></table></div>
  <div class="pager"><span class="small muted">${n(data.total_filtered?q.offset+1:0)}–${n(Math.min(q.offset+50,data.total_filtered))} dari ${n(data.total_filtered)} SKU</span><div class="row">${btn('← Sebelumnya','count-prev','outline')}${btn('Berikutnya →','count-next','outline')}</div></div>
  <div class="footerhint">Input tersimpan otomatis per baris. Tekan Submit Counting untuk mengirim semua hasil ke validasi SPV.</div>
 </div>`;
 const slot=$('#upSlot');
 if(slot){if(keepUp)slot.replaceWith(keepUp);else slot.outerHTML=uploadPanelHTML(s)}
 if(edit)restoreCountDraft(data.cycle_id);
 renderPresence();
}
function statusCell(status,reason){
 const warn=status==='SELISIH'&&!String(reason||'').trim();
 if(status==='TALLY')return chip('TALLY');
 if(status==='SELISIH')return chip('SELISIH')+(warn?'<small class="need-txt">wajib alasan</small>':'');
 return chip('BELUM','BELUM');
}
function countRowHTML(x,edit){
 const needsReason=x.status==='SELISIH'&&!(x.reason||'').trim();
 return `<tr data-sku="${escapeHTML(x.sku)}">
  <td class="nm"><div class="nm-sub">${nameBadge(x.name,x.category)}${x.team?`<span class="team-tag">${escapeHTML(x.team)}</span>`:''}</div></td>
  ${POS.map(([k,l])=>`<td><div class="pos-wrap"><input class="input count-num pos" data-change="count-row" data-pos="${k}" type="number" min="0" step="1" inputmode="numeric" aria-label="${l}" ${edit?'':'disabled'} value="${x[k]??''}"/>${edit?`<button class="calc-btn" data-act="calc-open" data-label="${escapeHTML(l)}" title="Kalkulator ${l}">🧮</button>`:''}</div></td>`).join('')}
  <td class="num total">${x.total==null?'—':n(x.total)}</td>
  <td><input class="input noteval ${needsReason?'needs-reason':''}" data-change="count-row" maxlength="500" placeholder="Alasan (wajib jika selisih)" ${edit?'':'disabled'} value="${escapeHTML(x.reason||'')}"/></td>
  <td class="st-cell">${statusCell(x.status,x.reason)}</td></tr>`;
}
CHG['count-team']=async el=>{const q=state.count;q.team=el.value;q.offset=0;await loadCount()};
CHG['count-filter-chg']=async el=>{const q=state.count;q.filter=el.value;q.offset=0;await loadCount()};
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
document.addEventListener('input',e=>{const tr=e.target.closest?.('#countTable tr[data-sku]');if(tr)countDraftSync(tr)});
// blankZero: kolom yang dikosongkan dianggap 0 (tidak perlu diketik manual).
function rowVals(tr,opts={}){
 const qty=k=>{const v=tr.querySelector(`[data-pos="${k}"]`).value;if(v==='')return opts.blankZero?0:null;if(!/^\d+$/.test(v))throw Error('Qty harus bilangan bulat >=0: '+tr.dataset.sku);return Number(v)};
 const row={sku:tr.dataset.sku,reason:tr.querySelector('.noteval').value.trim()};POS.forEach(([k])=>{row[k]=qty(k)});return row;
}
function paintRow(tr,status,total,reason){
 tr.querySelector('.total').textContent=total==null?'—':n(total);
 const sc=tr.querySelector('.st-cell');if(sc)sc.innerHTML=statusCell(status,reason);
 tr.querySelector('.noteval').classList.toggle('needs-reason',status==='SELISIH'&&!String(reason||'').trim());
}
// Simpan satu baris lalu minta status-nya dari server (system tetap tidak dikirim ke Store)
async function saveRow(tr){
 const d=state.count.data;if(!d||!(d.status==='COUNTING'||d.status==='RECOUNT'))return;
 const row=rowVals(tr,{blankZero:true});
 tr.classList.add('row-saving');
 try{
  await rpc('save_counts',{p_cycle:d.cycle_id,p_rows:[{sku:row.sku,display:row.display,reject:row.reject,rak_utama:row.rak_utama,rak_cadangan:row.rak_cadangan,reason:row.reason}]});
  clearCountDraft(d.cycle_id,[row.sku]);
  const st=await rpc('row_status',{p_cycle:d.cycle_id,p_sku:row.sku});
  // Kolom kosong sudah tersimpan sebagai 0: tampilkan 0 agar jelas.
  POS.forEach(([k])=>{const inp=tr.querySelector(`[data-pos="${k}"]`);if(inp&&inp.value===''&&document.activeElement!==inp)inp.value='0'});
  paintRow(tr,st.status,st.total,row.reason);
  broadcastRow(row,st);
 }finally{tr.classList.remove('row-saving')}
}
/* ---------- Realtime SO Counting: perubahan qty dari akun/perangkat lain langsung tampil ---------- */
let countCh=null,countChCid=null,countPoll=null;
const isTypingCount=()=>{const a=document.activeElement;return !!(a&&a.closest&&a.closest('#countTable'))};
function joinCountChannel(cid){
 if(!cid||(countChCid===cid&&countCh))return;
 leaveCountChannel();
 countChCid=cid;
 try{
  countCh=sb.channel('so-count-'+cid,{config:{broadcast:{self:false}}})
   .on('broadcast',{event:'row'},({payload})=>applyRemoteRow(payload))
   .subscribe();
 }catch(e){countCh=null}
 // cadangan: muat ulang halaman tiap 15 detik bila tidak sedang diketik
 countPoll=setInterval(()=>{if(state.page==='count'&&!isTypingCount())loadCount().catch(()=>{})},15000);
}
function leaveCountChannel(){
 if(countPoll){clearInterval(countPoll);countPoll=null}
 if(countCh){try{sb.removeChannel(countCh)}catch(e){}countCh=null}
 countChCid=null;
}
function applyRemoteRow(p){
 const tbl=$('#countTable');if(!tbl||!p?.sku)return;
 const tr=[...tbl.querySelectorAll('tr[data-sku]')].find(x=>x.dataset.sku===p.sku);if(!tr)return;
 if(tr.contains(document.activeElement))return; // sedang diketik di baris ini: jangan timpa
 POS.forEach(([k])=>{const inp=tr.querySelector(`[data-pos="${k}"]`);if(inp&&document.activeElement!==inp)inp.value=p[k]??''});
 const note=tr.querySelector('.noteval');if(note&&document.activeElement!==note)note.value=p.reason||'';
 paintRow(tr,p.status,p.total,p.reason);
}
function broadcastRow(row,st){
 if(!countCh)return;
 countCh.send({type:'broadcast',event:'row',payload:{sku:row.sku,display:row.display,reject:row.reject,rak_utama:row.rak_utama,rak_cadangan:row.rak_cadangan,reason:row.reason,status:st.status,total:st.total}}).catch(()=>{});
}
// Simpan per baris berurutan: respons server tidak saling mendahului, total tidak tertinggal.
let saveQ=Promise.resolve();
const saveRowQ=tr=>{const job=saveQ.then(()=>saveRow(tr));saveQ=job.catch(()=>{});return job};
CHG['count-row']=async el=>{const tr=el.closest('tr[data-sku]');if(tr)await saveRowQ(tr)};
async function saveCountPage(){
 const d=state.count.data;
 // Baris yang belum diisi sama sekali dilewati; kolom kosong di baris yang diisi dianggap 0.
 const rows=$$('#countTable tr[data-sku]').filter(tr=>POS.some(([k])=>tr.querySelector(`[data-pos="${k}"]`).value!=='')||tr.querySelector('.noteval').value.trim()!=='').map(tr=>rowVals(tr,{blankZero:true}));
 if(!rows.length)return 0;
 await rpc('save_counts',{p_cycle:d.cycle_id,p_rows:rows.map(v=>({sku:v.sku,display:v.display,reject:v.reject,rak_utama:v.rak_utama,rak_cadangan:v.rak_cadangan,reason:v.reason}))});
 clearCountDraft(d.cycle_id,rows.map(v=>v.sku));return rows.length;
}
ACT['count-submit']=async()=>{
 await saveCountPage();const cid=state.count.data.cycle_id;
 const [all,pend]=await Promise.all([rpc('count_page',{p_cycle:cid,p_offset:0,p_limit:1,p_search:'',p_filter:'ALL'}),rpc('count_page',{p_cycle:cid,p_offset:0,p_limit:1,p_search:'',p_filter:'PENDING'})]);
 const total=all.total_filtered,pending=pend.total_filtered;
 if(pending>0)throw Error(`${n(pending)} SKU belum lengkap. Isi keempat posisi semua SKU sebelum submit.`);
 if(!confirm(`Ringkasan counting:\n• Total SKU: ${n(total)}\n• Lengkap: ${n(total)}\n\nSKU berstatus Selisih wajib sudah berisi alasan. Setelah submit, counting dikunci. Lanjutkan?`))return;
 await rpc('submit',{p_cycle:cid});clearCountDraft(cid,Object.keys(readCountDraft(cid)));
 toast('Counting SUBMITTED. Menunggu validasi SPV.');
 state.count.open=false;
 await refreshDashboard();await render();
};
ACT['count-prev']=async()=>{const q=state.count;if(q.offset===0)return;q.offset=Math.max(0,q.offset-50);await loadCount()};
ACT['count-next']=async()=>{const q=state.count;if(!q.data||q.offset+50>=q.data.total_filtered)return;q.offset+=50;await loadCount()};
ACT['count-find']=async()=>{const q=state.count;q.search=$('#countSearch').value.trim();q.filter=$('#countFilter').value;q.offset=0;await loadCount()};
ACT['scan-count']=()=>openCountScanner();

/* ---------- Kalkulator: tambah / kurangi / ganti ke posisi, berulang ---------- */
let calcLog=[];
try{calcLog=JSON.parse(sessionStorage.getItem('calcLog')||'[]')}catch{calcLog=[]}
function calcSplit(label){return String(label||'').includes(' · ')?String(label).split(' · '):['',String(label||'')]}
function pushCalcLog(e){
 const [sku,pos]=calcSplit(e.label);
 calcLog.push({t:Date.now(),sku,pos,op:e.op,amt:e.amt,before:e.before,after:e.after});
 if(calcLog.length>200)calcLog=calcLog.slice(-200);
 try{sessionStorage.setItem('calcLog',JSON.stringify(calcLog))}catch{}
}
function calcHistHTML(){
 const [sku]=calcSplit(calc?.label);
 const mine=calcLog.filter(x=>x.sku===sku).slice(-8).reverse();
 const sym={add:'+',sub:'−',set:'=',mul:'×'};
 const rows=mine.map(x=>`<li><span class="mono small">${new Date(x.t).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})}</span> <b>${escapeHTML(x.pos)}</b> ${sym[x.op]||''}${n(x.amt)} <span class="muted small">${n(x.before)} → ${n(x.after)}</span></li>`).join('');
 return `<div class="calc-hist"><div class="calc-hist-head"><b>Riwayat ${sku?escapeHTML(sku):'kalkulator'}</b><span class="muted small">${n(mine.length)} tercatat</span>${calcLog.length?'<button class="btn ghost sm" data-act="calc-hist-clear">Hapus semua</button>':''}</div>${rows?`<ul>${rows}</ul>`:'<p class="small muted">Belum ada riwayat untuk item ini.</p>'}</div>`;
}
ACT['calc-hist-clear']=async()=>{calcLog=[];try{sessionStorage.removeItem('calcLog')}catch{};drawCalc()};
// Simpan SKU dan posisi agar kalkulator tetap bisa mengisi baris yang benar walau tabel sudah dirender ulang.
function openCalc(input,label){calc={input,typed:'',label:label||'Qty',sku:input.closest('tr')?.dataset.sku||'',pos:input.dataset.pos||''};drawCalc()}
function calcLiveInput(){
 if(!calc)return null;
 if(calc.input&&calc.input.isConnected)return calc.input;
 const tr=[...document.querySelectorAll('#countTable tr[data-sku]')].find(x=>x.dataset.sku===calc.sku);
 return tr?tr.querySelector(`[data-pos="${calc.pos}"]`):null;
}
function drawCalc(){
 let ov=document.getElementById('calcOv');
 if(!calc){ov?.remove();return}
 const cur=calc.input.value===''?0:Number(calc.input.value);
 const keys=['7','8','9','4','5','6','1','2','3','00','0','⌫'];
 const html=`<div class="calc-box" role="dialog" aria-label="Kalkulator">
  <div class="calc-head"><b>Kalkulator · ${escapeHTML(calc.label)}</b><button class="x" data-act="calc-close" title="Tutup">×</button></div>
  <div class="calc-disp"><small>Posisi saat ini</small><b>${n(cur)}</b></div>
  <div class="calc-disp input-disp"><small>Angka input</small><b>${calc.typed===''?'0':escapeHTML(calc.typed)}</b></div>
  <div class="keypad">${keys.map(k=>`<button class="key" data-act="calc-key" data-k="${k}">${k}</button>`).join('')}<button class="key warn" data-act="calc-key" data-k="C">C</button></div>
  <div class="calc-actions"><button class="btn primary" data-act="calc-apply" data-op="add">+ Tambah</button><button class="btn danger" data-act="calc-apply" data-op="sub">− Kurangi</button><button class="btn outline" data-act="calc-apply" data-op="mul">× Kali</button><button class="btn outline" data-act="calc-apply" data-op="set">= Ganti</button></div>
  ${calcHistHTML()}
  <p class="small muted">Setiap Tambah/Kurangi langsung masuk ke posisi. Kalkulator tetap terbuka untuk input berikutnya.</p>
 </div>`;
 if(!ov){ov=document.createElement('div');ov.id='calcOv';ov.className='calc-bg';document.body.appendChild(ov)}
 ov.innerHTML=html;
}
ACT['calc-open']=async el=>{
 const wrap=el.closest('.pos-wrap,.qty-wrap');const input=wrap?.querySelector('input');if(!input||input.disabled)return;
 const tr=el.closest('tr');openCalc(input,(tr?.dataset.sku?tr.dataset.sku+' · ':'')+(el.dataset.label||'Qty'));
};
ACT['calc-key']=async el=>{
 if(!calc)return;const k=el.dataset.k;
 if(k==='C')calc.typed='';
 else if(k==='⌫')calc.typed=calc.typed.slice(0,-1);
 else{const next=(calc.typed+k).replace(/^0+(?=\d)/,'');if(next.length<=9)calc.typed=next}
 drawCalc();
};
ACT['calc-apply']=async el=>{
 if(!calc)return;const op=el.dataset.op;
 if(calc.typed===''&&op!=='set')throw Error('Isi angka terlebih dahulu.');
 const live=calcLiveInput();
 if(!live)throw Error('Baris tidak ditemukan. Tutup kalkulator lalu coba lagi.');
 const amt=Number(calc.typed||0);
 const cur=live.value===''?0:Number(live.value);
 const next=op==='add'?cur+amt:op==='sub'?Math.max(0,cur-amt):op==='mul'?cur*amt:amt;
 if(next>999999999)throw Error('Hasil terlalu besar.');
 pushCalcLog({label:calc.label,op,amt,before:cur,after:next});
 live.value=String(next);
 live.dispatchEvent(new Event('input',{bubbles:true}));
 // Total baris langsung diperbarui, lalu disimpan lewat antrean.
 const tr=live.closest('tr[data-sku]');
 if(tr){const t=POS.reduce((a,[k])=>a+Number(tr.querySelector(`[data-pos="${k}"]`).value||0),0);tr.querySelector('.total').textContent=n(t)}
 calc.typed='';drawCalc();
 if(tr)await saveRowQ(tr);
};
ACT['calc-close']=async()=>{calc=null;drawCalc()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&calc){calc=null;drawCalc()}});

/* ---------- Scanner barcode ---------- */
let scanStream=null;
function stopCountScanner(){if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null}document.getElementById('scanOverlay')?.remove()}
async function openCountScanner(){
 if(!('BarcodeDetector' in window))return toast('Scanner barcode belum didukung browser ini. Gunakan Chrome Android terbaru.',true);
 stopCountScanner();
 const ov=document.createElement('div');ov.id='scanOverlay';ov.className='calc-bg';
 ov.innerHTML='<div class="calc-box"><video id="scanVideo" autoplay playsinline class="scan-video"></video><p class="small muted">Arahkan kamera ke barcode produk.</p><button class="btn" id="scanClose">Tutup</button></div>';
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

/* ---------- Folder per bulan (Counting, Validasi SPV, BA) ----------
   Dipakai bersama: tiap bulan jadi <details> yang bisa dibuka/tutup. Status buka/tutup disimpan di state.mf. */
const mfKeyDate=d=>(d||'').slice(0,7)||'0000-00';
const mfKeyTs=t=>{if(!t)return '0000-00';const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit'}).formatToParts(new Date(t));return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}`};
const mfLabel=k=>k==='0000-00'?'Tanpa tanggal':new Date(+k.slice(0,4),+k.slice(5,7)-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'});
function monthFolders(pg,rows,keyOf,inner,meta){
 const m=new Map();for(const r of rows){const k=keyOf(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r)}
 const st=state.mf||{};
 return [...m.keys()].sort().reverse().map(k=>{const g=m.get(k);const open=st[pg+'|'+k]!==false;
  return `<details class="card store-folder month-folder" data-mfkey="${pg}|${k}"${open?' open':''}><summary><span class="sf-name">${mfLabel(k)}</span><span class="sf-meta">${meta(g)}</span></summary>${inner(g)}</details>`}).join('');
}

/* ---------- Validasi SPV: sistem live, 4 posisi, status, alasan Store, qty & alasan SPV ---------- */
async function showValidation(){
 const v=state.validation;
 if(v.open)return loadValidation();
 const all=assignNo(await rpc('schedule_list',{p_store:null}));
 // Hanya SO yang menunggu validasi. SO APPROVED dipindah ke menu Export & Pembersihan.
 v.rows=all.filter(r=>r.status==='SUBMITTED');
 $('#content').innerHTML=`<div class="steps"><span>Counting</span><i>→</i><span>Submit Store</span><i>→</i><span class="on">Validasi SPV</span><i>→</i><span>Approved</span></div>
 <div class="card">
  <div class="card-head"><div><h3>Validasi SPV</h3><p class="muted small">Review hasil counting Store, validasi selisih, lalu approve SO.</p></div><div class="row"><span class="chip blue"><i></i>${n(v.rows.length)} SO</span></div></div>
  <div class="toolbar"><input id="vListSearch" class="input grow" placeholder="Cari SO / Store" value="${escapeHTML(v.listQ)}"/>
   <select id="vStatus" class="input" data-change="v-status"><option value="ALL" ${v.status==='ALL'?'selected':''}>Semua Status</option><option value="SUBMITTED" ${v.status==='SUBMITTED'?'selected':''}>Validasi SPV</option></select></div>
  <div class="bulkbar"><button class="btn outline" data-act="val-sel-all">Pilih semua</button><button class="btn outline" data-act="val-sel-none">Kosongkan</button>
   <button class="btn dark" data-act="val-csv-sel">⤓ Export CSV terpilih (draft)</button><span class="muted small" id="valSelCount">${n((state.validation.sel||new Set()).size)} dipilih</span></div>
  <div id="vBody"></div>
 </div>`;
 drawValRows();
}
function valAcc(r){const t=(r.tally||0)+(r.variance||0);return t?(r.tally||0)/t:null}
function valFiltered(){const v=state.validation;const q=(v.listQ||'').trim().toLowerCase();return v.rows.filter(r=>{if(q&&!(r.no+' '+r.store_name).toLowerCase().includes(q))return false;if(v.status!=='ALL'&&r.status!==v.status)return false;return true})}
function drawValRows(){
 const v=state.validation;v.sel=v.sel||new Set();
 const rows=valFiltered();
 const body=$('#vBody');if(!body)return;
 const valRowHTML=r=>`<tr><td><input type="checkbox" data-change="val-chk" value="${r.id}" ${v.sel.has(r.id)?'checked':''}/></td><td><b class="mono">${escapeHTML(r.no)}</b><br><small class="muted">${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}</small></td><td>${escapeHTML(r.store_name)}</td><td>${fmtDate(r.planned_date)}</td><td>${escapeHTML(r.pic||'-')}</td><td>${chip(r.status)}</td><td class="num">${n(r.scope_count)}</td><td class="num"><b>${P(valAcc(r))}</b><br><small class="muted">${n(r.variance||0)} variance</small></td><td>${btn('Validasi','val-open','primary',{id:r.id,store:r.store_code})}</td></tr>`;
 body.innerHTML=monthFolders('val',rows,r=>mfKeyDate(r.planned_date),g=>`<div class="tablewrap"><table><thead><tr><th></th><th>SO</th><th>Store</th><th>Tanggal</th><th>PIC</th><th>Status</th><th class="num">SKU</th><th class="num">SKU Accuracy</th><th>Action</th></tr></thead><tbody>${g.map(valRowHTML).join('')}</tbody></table></div>`,g=>`${n(g.length)} SO`)||'<div class="empty">Belum ada SO yang menunggu validasi.</div>';
}
CHG['v-status']=el=>{state.validation.status=el.value;drawValRows()};
ACT['val-open']=async el=>{state.page='validation';const v=state.validation;v.cycle=el.dataset.id;v.open=true;v.offset=0;v.search='';v.filter='VARIANCE';state.store=el.dataset.store||state.store;await render()};
ACT['val-back']=async()=>{state.validation.open=false;state.validation.data=null;await render()};
// Export CSV draft dari Validasi: SO yang masih SUBMITTED (belum approved). Tidak menandai SO sebagai sudah diexport.
const valSelItems=()=>{const v=state.validation;const items=v.rows.filter(r=>v.sel.has(r.id)&&r.status==='SUBMITTED').map(exportItem);if(!items.length)throw Error('Pilih minimal satu SO yang sedang validasi.');return items};
function updateValSelCount(){const l=$('#valSelCount');if(l)l.textContent=`${n((state.validation.sel||new Set()).size)} dipilih`}
ACT['val-sel-all']=()=>{const v=state.validation;v.sel=new Set(valFiltered().map(r=>r.id));drawValRows()};
ACT['val-sel-none']=()=>{state.validation.sel=new Set();drawValRows()};
CHG['val-chk']=el=>{const v=state.validation;v.sel=v.sel||new Set();el.checked?v.sel.add(el.value):v.sel.delete(el.value);updateValSelCount()};
ACT['val-csv-sel']=async()=>{const items=valSelItems();const k=await exportCombined(items,{draft:true});toast(`CSV draft diunduh: ${n(items.length)} SO, ${n(k)} baris.`)};
async function loadValidation(){
 const v=state.validation;
 const data=await rpc('validation_page',{p_cycle:v.cycle,p_offset:v.offset,p_limit:50,p_search:v.search,p_filter:v.filter});v.data=data;
 const st=data.status,sum=data.summary||{};
 const tally=sum.tally_skus||0,variance=sum.variance_skus||0,complete=tally+variance;
 const acc=complete?tally/complete:null;
 const mini=(cls,l,val,sub)=>`<div class="mini ${cls}"><small>${l}</small><b>${val}</b><span>${sub||''}</span></div>`;
 const editable=st==='SUBMITTED';
 const noBA=st==='APPROVED'&&(sum.total_skus||0)>0&&sum.variance_skus===0&&sum.missing_skus===0;
 const rowHTML=x=>{const reason=x.spv_note||x.store_note||'';const delta=x.delta==null?'—':signed(x.delta);return `<tr data-sku="${escapeHTML(x.sku)}">
   <td class="nm"><div class="nm-sub">${nameBadge(x.name,x.category)}${x.team?`<span class="team-tag">${escapeHTML(x.team)}</span>`:''}</div></td>
   ${editable
     ?`<td class="num sys-cell"><input class="input count-num" data-change="val-field" data-f="system" type="number" min="0" step="1" inputmode="numeric" value="${x.system??''}"/></td>`
     :`<td class="num sys-cell">${n(x.system)}</td>`}
   ${POS.map(([k])=>editable
     ?`<td class="num"><input class="input count-num" data-change="val-field" data-f="${k}" type="number" min="0" step="1" inputmode="numeric" value="${x[k]??''}"/></td>`
     :`<td class="num">${x[k]==null?'—':n(x[k])}</td>`).join('')}
   <td class="num"><b>${x.total==null?'—':n(x.total)}</b></td>
   <td class="st-cell">${statusCell(x.status,reason)}<span class="delta num">${delta}</span></td>
   <td><input class="input reason-in" data-change="val-field" data-f="reason" maxlength="500" placeholder="Alasan" value="${escapeHTML(reason)}" ${editable?'':'disabled'}/></td></tr>`};
 $('#content').innerHTML=`<div class="crumb"><button class="btn ghost" data-act="val-back">← Daftar SO</button><span class="muted small">${escapeHTML(labelStore(state.store)||'')}</span></div>
 <div class="mini-row">${mini('','Total SKU',n(sum.total_skus),'Seluruh SKU pada SO')}${mini('o','Variance',n(variance),'SKU selisih')}${mini('g','SKU Accuracy',P(acc),'tally / (tally + variance)')}${mini('a','Belum Lengkap',n(sum.missing_skus),'Posisi belum lengkap')}${mini('r','Blokir Approve',n(sum.blocking_skus),'Approve diblokir bila > 0')}</div>
 ${(sum.blocking_skus||0)>0?`<div class="note warning">${n(sum.blocking_skus)} SKU belum lengkap atau selisih belum beralasan. Approve diblokir sampai diperbaiki.</div>`:''}
 ${noBA?`<div class="note info">SO ini 100% akurasi tanpa selisih, jadi tidak perlu Berita Acara maupun adjustment. SO dianggap selesai.</div>`:''}
 <div class="card">
  <div class="card-head"><div class="row"><h3>Detail Validasi</h3>${noBA?chip('APPROVED','Selesai · tanpa BA'):chip(st)}</div>
   <div class="row">${editable?btn('Recount','val-recount','danger')+btn('Approve SO','val-approve','primary'):''}${st==='APPROVED'&&!noBA?btn('Buat BA','ba-create','primary',{id:data.cycle_id}):''}${st==='APPROVED'&&!data.archived?btn('Export CSV','val-export','dark'):''}${st==='APPROVED'&&isAdmin()?btn('Hapus Permanen','so-hard-del','danger',{id:data.cycle_id}):''}</div></div>
  <div class="toolbar">
   <div class="seg" role="tablist" aria-label="Tampilan SKU">
    <button class="${v.filter==='VARIANCE'?'on':''}" data-act="val-filter" data-v="VARIANCE">Variance (${n(sum.variance_skus)})</button>
    <button class="${v.filter==='ALL'?'on':''}" data-act="val-filter" data-v="ALL">Semua (${n(sum.total_skus)})</button>
   </div>
   <input id="valSearch" class="input grow" placeholder="Cari item / nama" value="${escapeHTML(v.search)}"/>${btn('Cari','val-find','outline')}${rstHTML('validation')}</div>
  <div class="tablewrap"><table id="valTable" class="val-table"><thead><tr><th>Item & Warna</th><th class="num">System</th>${POS.map(([,l])=>`<th class="num">${l}</th>`).join('')}<th class="num">Total Store</th><th>Status</th><th>Alasan</th></tr></thead><tbody>${data.items.map(rowHTML).join('')||'<tr><td colspan="9" class="empty">Tidak ada SKU.</td></tr>'}</tbody></table></div>
  <div class="pager"><span class="small muted">${n(data.total_filtered?v.offset+1:0)}–${n(Math.min(v.offset+50,data.total_filtered))} / ${n(data.total_filtered)} SKU</span><div class="row">${btn('← Sebelumnya','val-prev','outline')}${btn('Berikutnya →','val-next','outline')}</div></div>
  <div class="footerhint">Alasan dan SPV Qty tersimpan otomatis saat diubah. Untuk SKU selisih, alasan wajib diisi sebelum Approve. Jika SPV Qty kosong, sistem memakai total fisik Store.</div>
 </div>`;
renderPresence();
}
ACT['val-clear']=async()=>{const v=state.validation;v.search='';v.filter='VARIANCE';v.offset=0;await loadValidation()};
CHG['val-field']=async el=>{
 const tr=el.closest('tr[data-sku]');const v=state.validation;if(!tr||!v.data)return;
 // Kolom yang dikosongkan dianggap 0.
 const val=f=>{const q=tr.querySelector(`[data-f="${f}"]`)?.value??'';if(q!==''&&!/^\d+$/.test(q))throw Error('Qty harus bilangan bulat >=0.');return q===''?0:Number(q)};
 const sys=val('system');
 const note=tr.querySelector('.reason-in').value.trim();
 tr.classList.add('row-saving');
 try{await rpc('validate_edit',{p_cycle:v.data.cycle_id,p_sku:tr.dataset.sku,p_system:sys,p_display:val('display'),p_reject:val('reject'),p_rak_utama:val('rak_utama'),p_rak_cadangan:val('rak_cadangan'),p_note:note});toast('Tersimpan: '+tr.dataset.sku);await loadValidation()}
 finally{tr.classList.remove('row-saving')}
};
ACT['val-filter']=async el=>{const v=state.validation;v.filter=el.dataset.v;v.offset=0;await loadValidation()};
ACT['val-find']=async()=>{const v=state.validation;v.search=$('#valSearch').value.trim();v.offset=0;await loadValidation()};
ACT['val-prev']=async()=>{const v=state.validation;v.offset=Math.max(0,v.offset-50);await loadValidation()};
ACT['val-next']=async()=>{const v=state.validation;if(!v.data||v.offset+50>=v.data.total_filtered)return;v.offset+=50;await loadValidation()};
ACT['val-approve']=async()=>{const v=state.validation;if(!confirm('Approve SO? Setelah disetujui, hasil akan dikunci.'))return;await rpc('approve',{p_cycle:v.data.cycle_id});toast('SO berhasil APPROVED');await refreshDashboard();await loadValidation()};
ACT['val-recount']=async()=>{const v=state.validation;const reason=prompt('Alasan Recount (minimal 5 karakter):');if(reason===null)return;await rpc('recount',{p_cycle:v.data.cycle_id,p_reason:reason});toast('SO dikembalikan untuk recount');await refreshDashboard();await loadValidation()};
ACT['val-export']=async()=>{const v=state.validation;const k=await exportCombined([{id:v.data.cycle_id,no:'SO',store:labelStore(state.store),date:'',type:''}]);toast(`CSV diunduh: ${n(k)} SKU`)};

/* ---------- Export & Pembersihan Database ---------- */
const KEYS_EXPORT=['SO_NO','STORE','TANGGAL','TIPE','SKU','NAME_VARIANT','CATEGORY','TEAM','SYSTEM_AT_START','DISPLAY','REJECT','RAK_UTAMA','RAK_CADANGAN','ACTUAL','ADJUSTMENT','UNIT_COST','REASON'];
async function exportCombined(items,opts={}){
 const lines=[];
 for(const it of items){
  const vals=await rpc('export',{p_cycle:it.id});
  for(const x of vals)lines.push([it.no,it.store,it.date,it.type,x.SKU,x.NAME_VARIANT,x.CATEGORY,x.TEAM,x.SYSTEM_AT_START,x.DISPLAY,x.REJECT,x.RAK_UTAMA,x.RAK_CADANGAN,x.ACTUAL,x.ADJUSTMENT,x.UNIT_COST,x.REASON]);
 }
 if(!lines.length)throw Error('Tidak ada SKU untuk diexport.');
 const text='﻿'+[KEYS_EXPORT,...lines].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 const blob=new Blob([text],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(blob),a=document.createElement('a');
 const pre=opts.draft?'DRAFT_':'';
 a.href=u;a.download=pre+(items.length===1?`${String(items[0].no||'SO')}_${String(items[0].store||'').replace(/\s+/g,'_')}.csv`:`HASIL_SO_${iso(new Date())}_${items.length}SO.csv`);
 a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);
 // Export draft (Validasi) tidak menandai SO; hanya export final yang dicatat sebagai sudah diexport.
 if(!opts.draft)await rpc('mark_exported',{p_cycles:items.map(i=>i.id)});
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
 // Folder per bulan (berdasarkan tanggal SO), terbaru di atas. Status folder diingat di state.exp.months.
 const mLabel=k=>{if(k==='0000-00')return 'Tanpa tanggal';const [y,m]=k.split('-');return new Date(+y,+m-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})};
 const months=new Map();
 for(const r of rows){const k=(r.planned_date||'').slice(0,7)||'0000-00';if(!months.has(k))months.set(k,[]);months.get(k).push(r)}
 const expRowHTML=r=>`<tr>
    <td>${r.archived?'':`<input type="checkbox" data-change="exp-chk" value="${r.id}" ${x.sel.has(r.id)?'checked':''}/>`}</td>
    <td><b class="mono">${escapeHTML(r.no)}</b></td><td>${escapeHTML(r.store_name)}</td><td>${fmtDate(r.planned_date)}</td><td>${r.so_type==='PARTIAL'?'PARTIAL':'GRAND'}</td>
    <td class="num">${n(r.scope_count)}</td><td class="num">${n(r.tally)}</td><td class="num">${n(r.variance)}</td>
    <td>${r.archived?chip('APPROVED','Dibersihkan'):chip('APPROVED')}</td>
    <td class="actions">${isAdmin()?btn('Hapus Permanen','so-hard-del','danger',{id:r.id}):''}${r.archived?'<small class="muted">Detail dihapus; ringkasan tersimpan</small>':`${canManage()?btn('Bersihkan','exp-archive','danger',{id:r.id}):''}`}</td></tr>`;
 const mFolders=[...months.keys()].sort().reverse().map(k=>{const g=months.get(k);const left=g.filter(r=>!r.archived).length;const isOpen=(x.months||{})[k]!==false;
   return `<details class="card store-folder month-folder" data-mkey="${k}"${isOpen?' open':''}><summary><span class="sf-name">${mLabel(k)}</span><span class="sf-meta">${n(g.length)} SO · ${n(left)} belum dibersihkan</span></summary>
   <div class="tablewrap"><table><thead><tr><th></th><th>SO</th><th>Store</th><th>Tanggal</th><th>Tipe</th><th class="num">SKU</th><th class="num">Tally</th><th class="num">Selisih</th><th>Status</th><th>Action</th></tr></thead><tbody>${g.map(expRowHTML).join('')}</tbody></table></div></details>`}).join('');
 $('#content').innerHTML=`<div class="db-grid">
   <div class="db-tile"><small>Baris detail SKU aktif</small><b>${n(stats.active_lines)}</b><span>Sumber beban database</span></div>
   <div class="db-tile"><small>SO terbuka (belum diarsipkan)</small><b>${n(stats.open_cycles)}</b><span>Termasuk yang masih berjalan</span></div>
   <div class="db-tile"><small>SO sudah dibersihkan</small><b>${n(stats.archived_cycles)}</b><span>Ringkasan tetap tampil di Dashboard</span></div>
   <div class="db-tile"><small>Ukuran detail SO</small><b>${bytes(stats.lines_bytes)}</b><span>Total modul SO ${bytes(stats.total_bytes)}</span></div>
 </div>
 <div class="card filter-card">
  <div class="filters"><select class="input select" data-change="exp-store">${storeOptions(x.store,true)}</select>${rangeControlHTML('exp',x.range)}</div>
  <div class="pills"><span class="pill-stat">APPROVED belum dibersihkan · ${n(openCnt)}</span><span class="pill-stat ok">Sudah dibersihkan · ${n(rows.length-openCnt)}</span></div>
 </div>
 <div class="note info">Alur aman: <b>1)</b> pilih SO → <b>2)</b> Export CSV → <b>3)</b> simpan file ke Drive → <b>4)</b> Bersihkan. Pembersihan menghapus detail SKU dari database; ringkasan selisih dan nilai tetap dipakai Dashboard.</div>
 <div class="card">
  <div class="bulkbar"><button class="btn outline" data-act="exp-all">Pilih semua</button><button class="btn outline" data-act="exp-none">Kosongkan</button>
   <button class="btn dark" data-act="exp-bulk-csv">⤓ Export CSV terpilih</button>${canManage()?'<button class="btn danger" data-act="exp-bulk-clean">Export & bersihkan terpilih</button>':''}
   <span class="muted small" id="expSelCount">${n(x.sel.size)} dipilih</span></div>
 </div>
 ${mFolders||'<div class="card empty">Belum ada SO APPROVED pada filter ini.</div>'}
`;
}
CHG['exp-store']=async()=>{state.exp.store=$('.filter-card select[data-change="exp-store"]').value;state.exp.sel=new Set();await showExport()};
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

/* ---------- Upload Inventory (tanpa kunci: system SO aktif ikut diperbarui) ---------- */
async function showUpload(){
 const s=current();
 $('#content').innerHTML=`<div class="card">
  <div class="card-head"><div><h3>Upload Inventory</h3><p class="muted small">File CSV mengganti inventory aktif toko. Inventory tidak dikunci: system qty SO yang sedang berjalan (COUNTING/RECOUNT) ikut diperbarui. SO yang sudah SUBMITTED dikunci.</p></div>
   ${canManage()?`<select class="input select" data-change="up-store">${storeOptions(state.store,false)}</select>`:`<span class="chip blue"><i></i>${escapeHTML(labelStore(state.store))}</span>`}</div>
  <div class="note warning">Cost/HPP harus berasal dari sumber resmi agar Value Accuracy valid.</div>
  <label class="dropzone"><b>⬆ Pilih File CSV Inventory Summary</b><small>Name - Variant, Category, Ending. Kolom SKU, Cost, dan Harga Retail opsional.</small><input type="file" id="fileInput" accept=".csv,text/csv" data-change="file-pick"/></label>
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
  if($('#fileInfo'))$('#fileInfo').textContent=`Siap upload: ${n(upRows.length)} SKU; contoh SKU ${upRows[0]?.sku}${upRows.skipped?`; ${n(upRows.skipped)} baris Ending negatif dilewati`:''}`;
 }catch(ex){upRows=[];if($('#retailPreview'))$('#retailPreview').innerHTML='';if($('#fileInfo'))$('#fileInfo').textContent=ex.message;toast(ex.message,true)}
};
ACT['do-upload']=async()=>{
 if(!upRows.length)throw Error('Pilih CSV valid terlebih dahulu.');
 if(!confirm(`Ganti SEMUA inventory aktif ${labelStore(state.store)} dengan ${upRows.length} SKU?`))return;
 const out=await rpc('upload',{p_store:state.store,p_rows:upRows});
 toast(`Upload berhasil: ${n(out.sku_count)} SKU. ${n(out.synced_lines)} baris SO aktif diperbarui${out.locked_lines?`, ${n(out.locked_lines)} baris SO SUBMITTED dikunci`:''}.`);upRows=[];$('#upPanel')?.remove();await refreshDashboard();await render();
};
function renderRetailPreview(rows){
 const box=$('#retailPreview');if(!box)return;
 const zero=rows.filter(x=>x.retail===0).length;
 const cell=(l,v)=>`<div class="db-tile"><small>${l}</small><b>${v}</b></div>`;
 box.innerHTML=`<div class="db-grid">${cell('Item',n(rows.length))}${cell('Harga Retail 0',n(zero))}${cell('Dilewati (Ending negatif)',n(rows.skipped||0))}</div>
 <div class="tablewrap"><table><thead><tr><th>Item</th><th>Category</th><th class="num">Ending</th><th class="num">Harga Retail</th></tr></thead><tbody>${rows.slice(0,80).map(x=>`<tr><td>${escapeHTML(x.name)}</td><td>${escapeHTML(x.category)}</td><td class="num">${n(x.ending)}</td><td class="num">${n(x.retail)}</td></tr>`).join('')}</tbody></table></div>
 <p class="small muted">Menampilkan 80 baris pertama dari ${n(rows.length)} item.</p>`;
}
async function loadUploadHistory(){
 const box=$('#uploadHistory');if(!box)return;
 const all=isAdmin();
 if(!all&&!state.store)return;
 const rows=await rpc('upload_history',all?{p_store:null,p_limit:200}:{p_store:state.store,p_limit:20});
 const title=all?'Riwayat Upload Semua Toko':`Riwayat Upload ${escapeHTML(labelStore(state.store))}`;
 const line=r=>`<tr><td>${escapeHTML(new Date(r.uploaded_at).toLocaleString('id-ID'))}</td>${all?`<td><b>${escapeHTML(r.store_name)}</b><br><small class="mono muted">${escapeHTML(r.store_code)}</small></td><td>${escapeHTML(r.area||'—')}</td>`:''}<td class="num">${n(r.sku_count)}</td><td>${escapeHTML(r.uploaded_by||'-')}</td></tr>`;
 box.innerHTML=`<h3 class="heading">${title}</h3>${rows.length?`<div class="tablewrap"><table><thead><tr><th>Waktu</th>${all?'<th>Toko</th><th>Area</th>':''}<th class="num">SKU</th><th>Diupload oleh</th></tr></thead><tbody>${rows.map(line).join('')}</tbody></table></div>`:'<div class="empty">Belum ada riwayat upload.</div>'}`;
}

/* ---------- Manajemen Akses (Admin) ---------- */
async function showAdmin(){
 if(!isAdmin())throw Error('Akses Admin saja.');
 const [registered,pending,mapping]=await Promise.all([rpc('users_list'),rpc('pending_users'),rpc('spv_mapping')]);
 const users=registered||[],unknown=pending||[],map=mapping||[];
 const spvs=users.filter(x=>x.role==='spv');
 $('#content').innerHTML=`<div class="card"><div class="card-head"><h3>0. Password Saya</h3><span class="muted small">${escapeHTML(state.me.email)}</span></div><p class="small muted">Ganti password akun Admin yang sedang login. Password baru berlaku untuk login berikutnya.</p><div><button class="btn primary" data-act="pass-open">Ganti password saya</button></div></div>
  <div class="card">
   <div class="card-head"><h3>1. Aktivasi Akun Baru</h3><span class="muted small">${n(unknown.length)} akun menunggu</span></div>
   <p class="small muted">Admin memilih role dan toko untuk akun yang sudah terdaftar di sistem.</p>
   <div class="toolbar"><select class="input select grow" id="newUser"><option value="">Pilih akun belum aktif</option>${unknown.map(x=>`<option value="${escapeHTML(x.id)}">${escapeHTML(x.email)}</option>`).join('')}</select><select class="input select" id="newRole"><option value="store">STORE</option><option value="spv">SPV</option><option value="admin">ADMIN</option></select><select class="input select" id="newStore"><option value="">Pilih toko (khusus Store)</option>${state.stores.map(s=>`<option value="${escapeHTML(s.code)}">${escapeHTML(s.name)}</option>`).join('')}</select><input class="input grow" id="newName" maxlength="80" placeholder="Nama lengkap (opsional)"/>${btn('Aktifkan User','activate-user','primary')}</div>
  </div>
  <div class="card"><div class="card-head"><h3>2. Akun Aktif</h3><span class="muted small">${n(users.length)} akun</span></div>
   <div class="tablewrap"><table><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Toko</th><th>Area SPV</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${users.map(x=>{const isMe=x.id===state.me?.id,off=x.active===false;return `<tr><td><div style="display:flex;gap:6px;align-items:center;min-width:260px"><input class="input" style="flex:1;min-width:0" id="uname-${escapeHTML(x.id)}" maxlength="80" value="${escapeHTML(x.full_name||'')}" placeholder="Isi nama"/><button class="btn outline sm" style="white-space:nowrap" data-act="save-user-name" data-id="${escapeHTML(x.id)}">Simpan</button></div></td><td class="mono small">${escapeHTML(x.email)}</td><td>${chip(x.role.toUpperCase(),x.role.toUpperCase())}</td><td>${escapeHTML(x.store_code||'—')}</td><td>${escapeHTML((x.spv_stores||[]).map(labelStore).join(', ')||'—')}</td><td><span class="small" style="font-weight:700;color:${off?'#9a3412':'#047857'}">${off?'Nonaktif':'Aktif'}</span></td>
    <td>${isMe?'<span class="muted small">Akun Anda</span>':`<div style="display:flex;gap:6px;flex-wrap:wrap;min-width:250px">
      <button class="btn outline sm" data-act="admin-pass" data-id="${escapeHTML(x.id)}" data-email="${escapeHTML(x.email)}" data-name="${escapeHTML(x.name||'')}">Ubah password</button>
      <button class="btn outline sm" data-act="admin-active" data-id="${escapeHTML(x.id)}" data-email="${escapeHTML(x.email)}" data-on="${off?0:1}">${off?'Aktifkan':'Nonaktifkan'}</button>
      <button class="btn danger sm" data-act="admin-delete" data-id="${escapeHTML(x.id)}" data-email="${escapeHTML(x.email)}" ${off?'':'disabled title="Nonaktifkan dulu sebelum dihapus"'}>Hapus</button>
     </div>`}</td></tr>`}).join('')||'<tr><td colspan="7" class="empty">Belum ada akun.</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="card-head"><h3>3. SPV Mapping per Toko</h3><span class="muted small">${n(map.filter(x=>x.spv_user).length)} / ${n(map.length)} toko sudah punya SPV</span></div>
   <p class="small muted">Pilih area dan SPV untuk tiap toko. Perubahan tersimpan otomatis. SPV hanya melihat toko yang dipetakan kepadanya.</p>
   <div class="tablewrap"><table><thead><tr><th>Toko</th><th>Area</th><th>SPV</th></tr></thead><tbody>${map.map(x=>{const areaOpts=[...new Set([...SPV_AREAS,...(x.area?[x.area]:[])])];return `<tr><td><b>${escapeHTML(x.name)}</b><br><small class="mono muted">${escapeHTML(x.code)}</small></td>
    <td><select class="input select" data-change="map-area" data-store="${escapeHTML(x.code)}"><option value="">— Pilih area —</option>${areaOpts.map(a=>`<option value="${escapeHTML(a)}" ${a===x.area?'selected':''}>${escapeHTML(a)}</option>`).join('')}</select></td>
    <td><select class="input select" data-change="map-spv" data-store="${escapeHTML(x.code)}"><option value="">— Belum ada SPV —</option>${spvs.map(s=>`<option value="${escapeHTML(s.id)}" ${s.id===x.spv_user?'selected':''}>${escapeHTML(s.name||s.email)}</option>`).join('')}</select></td></tr>`}).join('')||'<tr><td colspan="3" class="empty">Belum ada toko.</td></tr>'}</tbody></table></div></div>
  ${isAdmin()?`<div class="card"><div class="card-head"><h3>4. Pembersihan Database</h3><span class="muted small">Membersihkan data sampah agar aplikasi tetap ringan</span></div>
   <p class="small muted">Tidak menghapus SO, detail SO, atau inventory aktif. Hanya menghapus rasio nol, audit lama, dan upload yang sudah tidak dipakai.</p>
   <div class="toolbar"><label class="small">Audit lebih tua dari (hari)<input class="input" id="clnAudit" type="number" min="30" value="365" style="width:110px"/></label><label class="small">Upload tak terpakai lebih tua dari (hari)<input class="input" id="clnUpload" type="number" min="1" value="30" style="width:110px"/></label>${btn('Pindai Sampah','cln-scan','outline')}${btn('Bersihkan Sekarang','cln-run','danger')}${btn('Bersihkan Draft Browser','cln-browser','dark')}</div>
   <div id="clnOut" class="note info small">Klik Pindai Sampah untuk melihat jumlah data yang bisa dibersihkan.</div></div>`:''}
  <div class="card" id="auditCard"></div>`;
 loadAudit().catch(()=>{});
}
ACT['activate-user']=async()=>{
 const p_user=$('#newUser').value,p_role=$('#newRole').value,p_store=p_role==='store'?$('#newStore').value:null,p_name=($('#newName')?.value||'').trim();
 if(!p_user)throw Error('Pilih akun yang akan diaktifkan.');
 await rpc('assign_user',{p_user,p_role,p_store});
 if(p_name)await rpc('set_user_name',{p_user,p_name});
 toast('Akun aktif');await render();
};
ACT['save-user-name']=async el=>{
 const id=el.dataset.id;const v=($('#uname-'+id)?.value||'').trim();
 await rpc('set_user_name',{p_user:id,p_name:v});toast(v?'Nama tersimpan':'Nama dikosongkan (tampil email)');await render();
};
CHG['map-spv']=async el=>{await rpc('set_store_spv',{p_store:el.dataset.store,p_user:el.value||null});toast('SPV Mapping disimpan');await render()};
CHG['map-area']=async el=>{await rpc('set_store_area',{p_store:el.dataset.store,p_area:el.value||null});toast('Area toko disimpan');await render()};

/* ---------- Audit ---------- */
async function loadAudit(){
 const box=$('#auditCard');if(!box)return;
 const rows=await rpc('audit_list',{p_limit:100});
 box.innerHTML=`<h3 class="heading">Audit Trail (100 aktivitas terakhir)</h3>${rows.length?`<div class="tablewrap"><table><thead><tr><th>Waktu</th><th>User</th><th>Toko</th><th>Aktivitas</th><th>Detail</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHTML(new Date(r.at).toLocaleString('id-ID'))}</td><td>${escapeHTML(r.user||'-')}</td><td>${escapeHTML(r.store||'-')}</td><td>${escapeHTML(r.event)}</td><td class="small mono">${escapeHTML(JSON.stringify(r.meta||{}).slice(0,160))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Belum ada aktivitas.</div>'}`;
}

/* ---------- Mulai ---------- */
(async()=>{const {data:{session}}=await sb.auth.getSession();if(session)await start();else loginView()})();

/* ---------- Cakupan SKU: rasio SO per SKU dan status bisa dipilih / terkunci ---------- */
async function showCoverage(){
 const c=state.cov;
 if(state.me.role==='store')c.store=state.me.store_code;
 else if(!c.store)c.store=state.store||state.stores[0]?.code||'';
 const d=await rpc('sku_coverage',{p_store:c.store,p_filter:c.filter,p_search:c.search,p_offset:c.offset,p_limit:50});c.data=d;
 const s2=d.summary||{};const pct=s2.total?Math.round(100*s2.sudah/s2.total):0;
 const mini=(cls,l,val,sub)=>`<div class="mini ${cls}"><small>${l}</small><b>${val}</b><span>${sub}</span></div>`;
 const filters=[['ALL','Semua'],['BELUM','Belum di-SO'],['SUDAH','Sudah di-SO'],['DIPILIH','Bisa dipilih'],['TERKUNCI','Terkunci']];
 $('#content').innerHTML=`${isAdmin()?`<div class="card"><div class="card-head"><h3>Sinkronisasi Rasio</h3><span class="muted small">Pakai jika ada SKU terkunci karena rasio dari SO yang sudah dihapus</span></div><div class="row">${btn('Cek Perubahan','cov-sync-check','outline')}${btn('Terapkan Sinkronisasi','cov-sync-apply','danger')}</div><div id="covSync" class="note info small">Klik Cek Perubahan untuk melihat rasio yang akan berubah sebelum diterapkan.</div></div>`:''}
 <div class="card filter-card"><div class="filters">
   ${state.me.role!=='store'?`<select class="input select" data-change="cov-store">${storeOptions(c.store,false)}</select>`:`<span class="chip blue">${escapeHTML(labelStore(c.store))}</span>`}
   <input id="covSearch" class="input grow" placeholder="Cari SKU / nama item" value="${escapeHTML(c.search)}"/>
   ${btn('Cari','cov-find','outline')}${rstHTML('cov')}
  </div>
  <div class="note info">Aturan: setiap SKU harus ter-SO sekali dulu. SKU yang sudah ter-SO tidak bisa dipilih sampai semua SKU lain naik ke rasio yang sama. Rasio = jumlah SO selesai yang memuat SKU itu.</div></div>
 <div class="mini-row">
   ${mini('','Total SKU',n(s2.total),'Seluruh SKU toko')}
   ${mini('g','Sudah di-SO',n(s2.sudah),pct+'% dari total')}
   ${mini('a','Belum di-SO',n(s2.belum),'Rasio 0x')}
   ${mini('o','Bisa dipilih sekarang',n(s2.dipilih),'Rasio terendah '+n(s2.min_ratio)+'x')}
   ${mini('r','Terkunci',n(s2.terkunci),'Menunggu SKU lain naik rasio')}
 </div>
 <div class="card">
  <div class="seg">${filters.map(([v,l])=>`<button class="${c.filter===v?'on':''}" data-act="cov-filter" data-v="${v}">${l}</button>`).join('')}</div>
  <div class="tablewrap" style="margin-top:10px"><table class="cov-table"><thead><tr><th>Item & Warna</th><th>SKU</th><th class="num">Rasio</th><th>Status</th><th>Pemilihan</th></tr></thead><tbody>
  ${(d.items||[]).map(x=>`<tr><td class="nm">${nameBadge(x.name,x.category)}</td><td class="mono">${escapeHTML(x.sku)}</td><td class="num"><span class="ratio ${x.ratio?'r1':'r0'}">${n(x.ratio)}x</span></td><td>${x.status==='SUDAH'?chip('TALLY','SUDAH SO'):chip('BELUM','BELUM SO')}</td><td>${x.eligible?'<span class="chip blue"><i></i>Bisa dipilih</span>':'<span class="chip red"><i></i>Terkunci</span>'}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Tidak ada SKU pada filter ini.</td></tr>'}
  </tbody></table></div>
  <div class="pager"><span class="small muted">${n(d.total_filtered?c.offset+1:0)}–${n(Math.min(c.offset+50,d.total_filtered))} dari ${n(d.total_filtered)} SKU</span><div class="row">${btn('← Sebelumnya','cov-prev','outline')}${btn('Berikutnya →','cov-next','outline')}</div></div>
 </div>`;
}
CHG['cov-store']=async el=>{const c=state.cov;c.store=el.value;c.offset=0;c.search='';await showCoverage()};
ACT['cov-filter']=async el=>{const c=state.cov;c.filter=el.dataset.v;c.offset=0;await showCoverage()};
ACT['cov-find']=async()=>{const c=state.cov;c.search=$('#covSearch').value.trim();c.offset=0;await showCoverage()};
ACT['cov-clear']=async()=>{const c=state.cov;c.search='';c.filter='ALL';c.offset=0;await showCoverage()};
ACT['cov-prev']=async()=>{const c=state.cov;c.offset=Math.max(0,c.offset-50);await showCoverage()};
ACT['cov-next']=async()=>{const c=state.cov;if(!c.data||c.offset+50>=c.data.total_filtered)return;c.offset+=50;await showCoverage()};

/* ---------- Pembersihan Database (Admin) ---------- */
const clnParams=()=>({p_audit_days:Math.max(1,Number($('#clnAudit')?.value)||365),p_upload_days:Math.max(1,Number($('#clnUpload')?.value)||30)});
const clnText=d=>`Rasio nol: ${n(d.zero_rounds)} · Audit lama: ${n(d.old_audit)} · Upload tak terpakai: ${n(d.stale_uploads)}`;
ACT['cln-scan']=async()=>{const d=await rpc('cleanup_scan',clnParams());$('#clnOut').textContent='Bisa dibersihkan — '+clnText(d)};
ACT['cln-run']=async()=>{
 if(!confirm('Bersihkan data sampah sekarang? SO, detail SO, dan inventory aktif tidak ikut terhapus.'))return;
 const d=await rpc('cleanup_run',clnParams());toast('Pembersihan selesai');
 $('#clnOut').textContent='Sudah dibersihkan — '+clnText(d);
};
ACT['cln-browser']=async()=>{
 const active=new Set((state.dashboard||[]).map(x=>x.cycle_id).filter(Boolean));
 let removed=0;
 try{
  Object.keys(localStorage).filter(k=>k.startsWith('tsiSO_draft_')).forEach(k=>{
   const cid=k.slice('tsiSO_draft_'.length);if(!active.has(cid)){localStorage.removeItem(k);removed++}});
 }catch(e){}
 toast(`Draft browser dibersihkan: ${n(removed)} item`);
};

/* ---------- Sinkronisasi rasio (Admin): membuka SKU yang terkunci karena rasio SO yang sudah dihapus ---------- */
const covSyncText=d=>d.changed
 ?`Akan berubah: ${n(d.changed)} SKU. Contoh: ${(d.sample||[]).slice(0,8).map(x=>`${x.sku} ${x.dari}x→${x.menjadi}x`).join(', ')}.${d.archived_recorded?` Catatan: ${n(d.archived_recorded)} SO arsip tidak bisa dihitung ulang.`:''}`
 :'Tidak ada perubahan. Rasio sudah sesuai dengan SO yang masih ada.';
ACT['cov-sync-check']=async()=>{const d=await rpc('rounds_resync',{p_store:state.cov.store,p_apply:false});$('#covSync').textContent=covSyncText(d)};
ACT['cov-sync-apply']=async()=>{
 const c=state.cov;const d=await rpc('rounds_resync',{p_store:c.store,p_apply:false});
 if(!d.changed){$('#covSync').textContent=covSyncText(d);return}
 if(!confirm('Terapkan sinkronisasi rasio?\n'+covSyncText(d)))return;
 await rpc('rounds_resync',{p_store:c.store,p_apply:true});toast('Rasio disinkronkan');await showCoverage();
};

/* ---------- Hapus permanen SO APPROVED yang salah (Admin, tanpa export) ---------- */
ACT['so-hard-del']=async el=>{
 const id=el.dataset.id;
 if(!confirm('HAPUS PERMANEN SO ini dari database dan aplikasi?\n\nDetail SKU dihapus, rasio SKU dikembalikan, dan SO tidak lagi dihitung di dashboard. Tidak perlu export. Lanjutkan?'))return;
 const out=await rpc('hard_delete',{p_cycles:[id]});
 toast(out.archived_rounds_not_reverted
  ?'SO dihapus. SO ini sudah dibersihkan, jadi rasio SKU-nya perlu disinkronkan lewat Cakupan SKU.'
  :'SO dihapus permanen');
 state.validation.open=false;state.validation.data=null;
 await refreshDashboard();await render();
};

/* ---------- Presence: siapa yang aktif, di menu mana, dan sedang mengerjakan apa ---------- */
let presCh=null,presKey=null,presTimer=null;
function presActivity(){
 const pg=state.page,f=document.activeElement;
 if(pg==='count'){
  if(f?.closest?.('#countTable')){
   const tr=f.closest('tr[data-sku]');const pos=POS.find(([k])=>k===f.dataset.pos);
   return `Mengisi ${pos?pos[1]:'alasan'} · SKU ${tr?.dataset.sku||''}`;
  }
  return (state.count.open||state.me.role==='store')?'Counting SO':'Daftar SO counting';
 }
 if(pg==='validation')return state.validation.open?'Validasi SPV (detail SO)':'Daftar validasi SPV';
 if(pg==='schedule')return state.builder?'Membuat / mengubah jadwal SO':'Melihat jadwal SO';
 if(pg==='ba')return state.ba?.open?'Berita Acara (detail)':'Daftar Berita Acara';
 if(pg==='coverage')return 'Cakupan SKU';
 if(pg==='upload')return 'Upload inventory';
 if(pg==='export')return 'Export & pembersihan';
 if(pg==='admin')return 'Manajemen akses';
 return 'Dashboard';
}
function presPayload(){
 const f=document.activeElement;const inTbl=f?.closest?.('#countTable, #valTable');
 const tr=inTbl?f.closest('tr[data-sku]'):null;
 return {key:presKey,name:state.me.name||state.me.email,role:state.me.role,store:state.store||'',storeLabel:presStoreLabel(),
  pid:state.page,so:presCycleId(),sku:tr?tr.dataset.sku:null,
  page:(PAGE[state.page]||PAGE.dashboard)[0],act:presActivity(),at:Date.now()};
}
function presStoreLabel(){
 if(state.me?.role==='store'||['count','validation'].includes(state.page))return labelStore(state.store)||'';
 if(state.page==='dashboard'&&state.dash.store)return labelStore(state.dash.store)||'';
 return 'Semua toko';
}
function presCycleId(){
 if(state.page==='count')return state.count.data?.cycle_id||null;
 if(state.page==='validation')return state.validation.data?.cycle_id||null;
 return null;
}
function updatePresence(){
 if(!presCh||!state.me)return;
 clearTimeout(presTimer);
 presTimer=setTimeout(()=>{presCh.track(presPayload()).catch(()=>{})},120);
}
function renderPresence(){
 if(!presCh||!state.me)return;
 const st=presCh.presenceState?presCh.presenceState():{};
 let list=Object.values(st).flat();
 if(state.me.role==='store')list=list.filter(x=>x.store===state.me.store_code);
 list.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
 const cnt=$('#presN');if(cnt)cnt.textContent=n(list.length);
 presOthers=list.filter(x=>x.key!==presKey);
 paintNavPresence();
 paintRowBusy();
 const panel=$('#presPanel');
 if(panel&&!panel.classList.contains('hidden')){
  panel.innerHTML=`<div class="pres-head"><b>User aktif</b><span class="small muted">${n(list.length)} sesi</span></div>`+
   (list.map(x=>{const mins=Math.max(0,Math.round((Date.now()-(x.at||Date.now()))/60000));
    return `<div class="pres-row"><div class="pres-av">${escapeHTML(ini(x.name))}</div><div class="pres-main">
      <div class="pres-name">${escapeHTML(x.name||'-')} ${chip(String(x.role||'').toUpperCase(),String(x.role||'').toUpperCase())}</div>
      <div class="small"><b>${escapeHTML(x.page||'-')}</b>${x.storeLabel?` · ${escapeHTML(x.storeLabel)}`:''}</div>
      <div class="small muted">${escapeHTML(x.act||'')}</div>
      <div class="small muted">${mins<1?'baru saja':mins+' menit lalu'}</div></div></div>`}).join('')||'<div class="empty small">Tidak ada user lain yang aktif.</div>');
 }
}
let syncCh=null,syncTimer=null;
function startSync(){
 if(syncCh)return;
 try{syncCh=sb.channel('so-sync',{config:{broadcast:{self:false}}}).on('broadcast',{event:'changed'},({payload})=>onRemoteChanged(payload)).subscribe()}
 catch(e){syncCh=null}
}
function stopSync(){if(syncCh){try{sb.removeChannel(syncCh)}catch(e){}syncCh=null}clearTimeout(syncTimer)}
function notifySync(kind,store){
 if(!syncCh)return;
 try{const r=syncCh.send({type:'broadcast',event:'changed',payload:{kind,store,at:Date.now()}});if(r&&r.catch)r.catch(()=>{})}catch(e){}
}
function onRemoteChanged(){
 clearTimeout(syncTimer);
 syncTimer=setTimeout(refreshFromRemote,400);
}
async function refreshFromRemote(){
 try{await refreshDashboard()}catch(e){return}
 const a=document.activeElement;
 const typing=!!(a&&a.closest&&a.closest('#content')&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
 if(typing||upRows.length)return;
 try{await render()}catch(e){}
}
function startPresence(){
 if(presCh||!state.me)return;
 presKey=`${state.me.id}-${Math.random().toString(36).slice(2,8)}`;
 try{
  const ch=sb.channel('so-presence',{config:{presence:{key:presKey}}});
  presCh=ch;
  ch.on('presence',{event:'sync'},()=>renderPresence())
   .subscribe(status=>{if(status==='SUBSCRIBED')ch.track(presPayload()).catch(()=>{})});
 }catch(e){presCh=null}
 document.addEventListener('focusin',updatePresence);
 document.addEventListener('focusout',updatePresence);
}
function stopPresence(){
 if(presCh){try{sb.removeChannel(presCh)}catch(e){}presCh=null}
 clearTimeout(presTimer);
}
ACT['presence-toggle']=async()=>{const p=$('#presPanel');if(!p)return;p.classList.toggle('hidden');renderPresence()};
document.addEventListener('click',e=>{const p=$('#presPanel');if(p&&!p.classList.contains('hidden')&&!e.target.closest('.presence-wrap'))p.classList.add('hidden')});

let presOthers=[];
// Avatar user lain di menu yang sedang mereka buka
function paintNavPresence(){
 $$('#nav [data-page]').forEach(b=>{
  const who=presOthers.filter(x=>x.pid===b.dataset.page);
  let box=b.querySelector('.pres-stack');
  if(!box){box=document.createElement('span');box.className='pres-stack';b.appendChild(box)}
  box.innerHTML=who.slice(0,3).map(x=>`<i class="pres-dot" title="${escapeHTML(x.name)} · ${escapeHTML(x.act||'')}">${escapeHTML(ini(x.name))}</i>`).join('')+(who.length>3?`<i class="pres-dot more">+${who.length-3}</i>`:'');
 });
}
// Tanda di baris yang sedang diisi user lain (pengingat agar tidak mengisi baris yang sama)
function paintRowBusy(){
 const cid=presCycleId();
 $$('#countTable tr[data-sku], #valTable tr[data-sku]').forEach(tr=>{tr.classList.remove('row-busy');tr.querySelectorAll('.busy-tag').forEach(e=>e.remove())});
 if(!cid)return;
 presOthers.filter(x=>x.sku&&x.so===cid).forEach(x=>{
  $$('#countTable tr[data-sku], #valTable tr[data-sku]').filter(r=>r.dataset.sku===x.sku).forEach(tr=>{
   tr.classList.add('row-busy');
   const cell=tr.querySelector('td.nm')||tr.firstElementChild;
   if(cell)cell.insertAdjacentHTML('beforeend',`<span class="busy-tag">✎ ${escapeHTML(x.name)} sedang mengisi</span>`);
  });
 });
}

// ===== Berita Acara (BA): approval berjenjang SPV lalu Manager, checklist adjust per BA =====
const BA_MATCH={ALL:()=>true,WAIT_SPV:x=>!x.spv_at,WAIT_MGR:x=>!!x.spv_at&&!x.mgr_at,WAIT_ADJ:x=>!!x.mgr_at&&!x.adj_at,ADJUSTED:x=>!!x.adj_at,NOT_EXPORTED:x=>!x.exported_at};
const BA_LABEL=[['ALL','Semua'],['WAIT_SPV','Menunggu SPV'],['WAIT_MGR','Menunggu Manager'],['WAIT_ADJ','Belum di-adjust'],['ADJUSTED','Sudah di-adjust'],['NOT_EXPORTED','Belum diekspor']];
const baState=()=>state.ba||(state.ba={status:'ALL',store:'ALL',open:null,all:[]});
const baFiltered=b=>(b.all||[]).filter(x=>(BA_MATCH[b.status]||BA_MATCH.ALL)(x)&&(b.store==='ALL'||x.store_code===b.store));
const fmtDT=t=>t?new Date(t).toLocaleString('id-ID',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})+' WITA':'—';
async function showBA(){
 const b=baState();
 if(b.open)return loadBADetail();
 const all=await rpc('ba_list',{p_store:null,p_status:'ALL',p_limit:500});
 b.all=all;b.sel=b.sel||new Set();
 for(const id of [...b.sel])if(!all.some(x=>x.id===id))b.sel.delete(id);
 const rows=baFiltered(b);
 const picked=all.filter(x=>b.sel.has(x.id));
 const useSel=picked.length>0;
 // Aksi hanya berlaku untuk BA yang dicentang. Tanpa pilihan, semua tombol aksi nonaktif.
 const scope=picked;
 const role=state.me.role;
 const canSpv=role==='spv'||role==='admin',canMgr=role==='admin';
 const cSpv=scope.filter(x=>!x.spv_at).length;
 const cMgr=scope.filter(x=>x.spv_at&&!x.mgr_at&&x.spv_by!==state.me.id).length;
 const cnt={html:scope.length,csv:scope.filter(x=>x.mgr_at).length,mark:scope.filter(x=>x.mgr_at&&!x.adj_at).length,clean:picked.filter(x=>x.exported_at).length,unmark:picked.filter(x=>x.adj_at).length};
 const stores=[...new Map(all.map(x=>[x.store_code,x.store_name])).entries()];
 const allOn=rows.length>0&&rows.every(x=>b.sel.has(x.id));
 const act=(lbl,k,c,kind)=>`<button class="btn ${kind}" data-act="ba-run" data-do="${k}" ${c?'':'disabled'}>${lbl} (${n(c)})</button>`;
 $('#content').innerHTML=`<div class="card">
  <div class="card-head"><div><h3>Berita Acara SO</h3><p class="muted small">SPV menandatangani dahulu, lalu Manager menyetujui. Unduh untuk Drive, export CSV untuk Moka, lalu bersihkan dari database.</p></div><span class="chip blue"><i></i>${n(all.length)} BA aktif</span></div>
  <div class="ba-tabs">${BA_LABEL.map(([k,l])=>`<button class="tab ${b.status===k?'on':''}" data-act="ba-filter" data-k="${k}">${l} <b>${n(all.filter(x=>BA_MATCH[k](x)&&(b.store==='ALL'||x.store_code===b.store)).length)}</b></button>`).join('')}</div>
  <div class="ba-bulk no-print"><select class="input" data-change="ba-store"><option value="ALL">Semua toko</option>${stores.map(([c,nm])=>`<option value="${escapeHTML(c)}" ${b.store===c?'selected':''}>${escapeHTML(nm||c)}</option>`).join('')}</select>${rstHTML('ba')}</div>
  <div class="ba-bar no-print">
   <div class="ba-scope"><div><b>Berlaku untuk:</b> ${useSel?`${n(picked.length)} BA yang dipilih`:'belum ada BA dipilih'}${useSel?`<button class="btn ghost sm" data-act="ba-clear-sel">Kosongkan pilihan</button>`:''}</div><small class="muted">Centang BA terlebih dahulu. Aksi hanya berlaku untuk BA yang dicentang.</small></div>
   <div class="ba-acts">
    ${canSpv?act('Tanda tangan SPV','sign-spv',cSpv,'primary'):''}
    ${canMgr?act('Setujui Manager','sign-mgr',cMgr,'primary'):''}
    ${act('Unduh HTML gabungan','html',cnt.html,'dark')}
    ${act('Export CSV adjust','csv',cnt.csv,'dark')}
    ${act('Tandai adjust','mark',cnt.mark,'primary')}
    ${useSel&&cnt.unmark?act('Batalkan tanda','unmark',cnt.unmark,'ghost'):''}
    ${useSel?act('Bersihkan dari database','clean',cnt.clean,'danger'):''}
   </div>
  </div>
  ${monthFolders('ba',rows,x=>mfKeyTs(x.created_at),g=>baTableHTML(g,b,allOn),g=>`${n(g.length)} BA`)||'<div class="empty">Tidak ada BA pada filter ini.</div>'}
 </div>`;
}
// Tabel BA untuk satu folder bulan.
function baTableHTML(g,b,allOn){return `<div class="tablewrap"><table><thead><tr><th><input type="checkbox" data-change="ba-pick-all" ${allOn?'checked':''}/></th><th>No BA</th><th>Toko</th><th>Dibuat</th><th>SPV</th><th>Manager</th><th>Adjust</th><th>Export</th><th>Aksi</th></tr></thead><tbody>
  ${g.map(x=>`<tr>
   <td><input type="checkbox" data-change="ba-pick" data-id="${escapeHTML(x.id)}" ${b.sel.has(x.id)?'checked':''}/></td>
   <td><b class="mono">${escapeHTML(x.ba_no)}</b></td>
   <td>${escapeHTML(x.store_name)}</td>
   <td class="small">${fmtDT(x.created_at)}</td>
   <td>${x.spv_at?`<span class="chip green"><i></i>${escapeHTML(x.spv_name)}</span>`:'<span class="chip gray"><i></i>Menunggu</span>'}</td>
   <td>${x.mgr_at?`<span class="chip green"><i></i>${escapeHTML(x.mgr_name)}</span>`:'<span class="chip gray"><i></i>Menunggu</span>'}</td>
   <td><label class="ba-adj"><input type="checkbox" data-change="ba-adj" data-id="${escapeHTML(x.id)}" ${x.adj_at?'checked':''} ${x.mgr_at?'':'disabled'}/> ${x.adj_at?`Sudah · ${escapeHTML(x.adj_name||'')}`:(x.mgr_at?'Tandai sudah':'Setelah Manager')}</label></td>
   <td>${x.exported_at?chip('TALLY','Sudah'):chip('SUBMITTED','Belum')}</td>
   <td>${btn('Detail','ba-open','ghost sm',{id:x.id})}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function baArticle(h,s,lines,total,full){
 const stamp=(at,name,empty)=>at?`<b>${escapeHTML(name||'')}</b><small>Ditandatangani secara elektronik · ${fmtDT(at)}</small>`:`<i class="muted">${empty}</i>`;
 return `<article class="ba-doc" id="${full?'':'baPrint'}">
  <header class="ba-head"><img src="logo.png" alt=""/><div><h2>BERITA ACARA STOCK OPNAME</h2><p class="mono">${escapeHTML(h.ba_no)}</p></div></header>
  <table class="ba-meta"><tr><td>Toko</td><td>${escapeHTML(h.store_name)} (${escapeHTML(h.store_code)})</td><td>Tanggal SO</td><td>${fmtDT(h.started_at)}</td></tr>
  <tr><td>Dibuat oleh</td><td>${escapeHTML(h.created_name||'')}</td><td>Tanggal BA</td><td>${fmtDT(h.created_at)}</td></tr></table>
  <p class="ba-text">Telah dilakukan stock opname pada toko tersebut, dengan hasil sebagai berikut:</p>
  <table class="ba-sum"><tbody>
   <tr><td>Total SKU dihitung</td><td class="num">${n(s.total_skus)}</td><td>SKU sesuai sistem</td><td class="num">${n(s.tally_count)}</td></tr>
   <tr><td>SKU selisih</td><td class="num">${n(s.variance_count)}</td><td>Net selisih qty</td><td class="num">${signed(s.net_qty)}</td></tr>
   <tr><td>Nilai kekurangan</td><td class="num">${rp(s.missing_value)}</td><td>Nilai kelebihan</td><td class="num">${rp(s.surplus_value)}</td></tr>
  </tbody></table>
  ${total?`<p class="ba-text">Daftar SKU selisih${!full&&lines.length<total?` (menampilkan ${n(lines.length)} dari ${n(total)} SKU, urut selisih terbesar; unduh untuk daftar lengkap)`:''}:</p>
  <div class="tablewrap ba-lines"><table><thead><tr><th>SKU</th><th>Nama item</th><th class="num">System</th><th class="num">Actual</th><th class="num">Selisih</th><th class="num">Nilai selisih</th></tr></thead><tbody>
  ${lines.map(l=>`<tr><td class="mono">${escapeHTML(l.sku)}</td><td>${escapeHTML(l.item_name)}</td><td class="num">${n(l.system_qty)}</td><td class="num">${n(l.actual_qty)}</td><td class="num">${signed(l.diff_qty)}</td><td class="num">${rp(l.diff_qty*l.unit_cost,true)}</td></tr>`).join('')}
  </tbody></table></div>`:'<p class="ba-text">Tidak ada selisih. Seluruh SKU sesuai dengan sistem.</p>'}
  <div class="ba-sign">
   <div><span>SPV Toko</span><div class="ba-stamp">${stamp(h.spv_at,h.spv_name,'Belum ditandatangani')}</div></div>
   <div><span>Manager</span><div class="ba-stamp">${stamp(h.mgr_at,h.mgr_name,'Belum disetujui')}</div></div>
  </div>
  ${h.adj_at?`<p class="ba-adjnote">Sudah di-adjust di sistem oleh ${escapeHTML(h.adj_name||'')} · ${fmtDT(h.adj_at)}</p>`:''}
 </article>`;
}
async function loadBADetail(){
 const b=baState();
 const d=await rpc('ba_get',{p_ba:b.open});
 const h=d.header,s=d.summary||{},lines=d.lines||[],total=s.variance_count||0,role=state.me.role;
 const canSpv=!h.spv_at&&(role==='spv'||role==='admin');
 const canMgr=!h.mgr_at&&!!h.spv_at&&role==='admin';
 const stamp=(at,name,empty)=>at?`<b>${escapeHTML(name||'')}</b><small>Ditandatangani secara elektronik · ${fmtDT(at)}</small>`:`<i class="muted">${empty}</i>`;
 $('#content').innerHTML=`<div class="crumb no-print"><button class="btn ghost" data-act="ba-back">← Daftar BA</button></div>
 <div class="card ba-actions no-print">
  <div class="row"><b class="mono">${escapeHTML(h.ba_no)}</b>${h.adj_at?chip('TALLY','Sudah di-adjust'):chip('SUBMITTED',h.mgr_at?'Siap di-adjust':(h.spv_at?'Menunggu Manager':'Menunggu SPV'))}</div>
  <div class="row">${canSpv?btn('Tanda tangan SPV','ba-sign','primary',{id:h.id,level:'SPV'}):''}${canMgr?btn('Setujui Manager','ba-sign','dark',{id:h.id,level:'MGR'}):''}${h.mgr_at?btn('Export CSV Adjust','ba-adj-csv','dark'):''}${btn('Unduh HTML','ba-download','ghost')}${btn('Cetak / PDF','ba-print','ghost')}</div>
 </div>
 ${baArticle(h,s,lines,total,false)}`;
}
ACT['ba-open']=async el=>{baState().open=el.dataset.id;await render()};
ACT['ba-back']=async()=>{baState().open=null;await render()};
ACT['ba-filter']=async el=>{baState().status=el.dataset.k;await render()};
ACT['ba-print']=async()=>window.print();
// Unduh BA (lengkap, semua SKU selisih) sebagai satu file HTML. Dibuat di browser, tidak disimpan di server.
async function baDownload(ids){
 if(!ids.length){toast('Pilih BA dulu.',true);return}
 const docs=await rpc('ba_export',{p_bas:ids});
 const css='body{font-family:system-ui,Arial,sans-serif;color:#111;margin:24px;font-size:12.5px}table{width:100%;border-collapse:collapse}td,th{padding:5px 8px;border:1px solid #d1d5db;text-align:left}th{background:#f5f3ff}.num{text-align:right}.mono{font-family:monospace}.ba-head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #111;padding-bottom:12px}.ba-head h2{margin:0;font-size:18px}.ba-meta td{border:0}.ba-sum td{border-color:#999}.ba-sign{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}.ba-sign>div{border:1px solid #d1d5db;border-radius:8px;padding:12px;min-height:90px}.ba-stamp{margin-top:8px;display:grid;gap:2px}.ba-stamp small{color:#6b7280}.ba-text{margin:10px 0}.ba-adjnote{color:#065f46}.ba-doc{border:0;padding:0;max-width:none}.ba-page{break-after:page;margin-bottom:24px}.ba-page:last-child{break-after:auto}tr{break-inside:avoid}';
 const body=docs.map(d=>`<section class="ba-page">${baArticle(d.header,d.summary,d.lines,d.summary.variance_count||0,true).replace(/<img[^>]*>/,'')}</section>`).join('');
 const title=docs.length===1?docs[0].header.ba_no:`BA gabungan ${docs.length} BA`;
 const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"/><title>${escapeHTML(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
 const fname=docs.length===1?docs[0].header.ba_no.replace(/[\/\\]+/g,'-')+'.html':`BA_GABUNGAN_${iso(new Date())}_${docs.length}BA.html`;
 const u=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
 const a=document.createElement('a');a.href=u;a.download=fname;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(u),1000);
 await rpc('ba_mark_exported',{p_bas:ids});
 toast(`${n(docs.length)} BA diunduh dan ditandai sudah diekspor.`);
}
// CSV adjust untuk Moka: No BA, Item Name, Qty Selisih (hanya SKU yang selisih). Satu file gabungan.
function baAdjNote(h){
 const d=new Date(h.created_at);
 const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Makassar',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(d);
 const g=t=>p.find(x=>x.type===t)?.value||'';
 return `ADJ SO.P ${String(h.store_code||'').replace(/-/g,' ')} ${g('day')}/${g('month')}/${g('year')}`;
}
function baAdjCsvText(docs){
 const rows=[['No BA','Item Name','Qty Selisih','Note']];
 docs.forEach(d=>{const note=baAdjNote(d.header);d.lines.forEach(l=>rows.push([d.header.ba_no,l.item_name,l.diff_qty,note]))});
 return '\uFEFF'+rows.map(r=>r.map(v=>typeof v==='number'?String(v):'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
}
function baSaveFile(text,fname,type){
 const u=URL.createObjectURL(new Blob([text],{type}));
 const a=document.createElement('a');a.href=u;a.download=fname;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(u),2000);
}
async function baAdjCsv(ids){
 if(!ids.length){toast('Tidak ada BA yang sudah disetujui Manager pada pilihan ini.',true);return}
 const docs=await rpc('ba_export',{p_bas:ids});
 const rowsN=docs.reduce((t,d)=>t+d.lines.length,0);
 const fname=docs.length===1?'ADJ_'+docs[0].header.ba_no.replace(/[\/\\]+/g,'-')+'.csv':`ADJ_GABUNGAN_${iso(new Date())}_${docs.length}BA.csv`;
 baSaveFile(baAdjCsvText(docs),fname,'text/csv;charset=utf-8');
 toast(`CSV adjust diunduh: ${n(docs.length)} BA, ${n(rowsN)} baris selisih.`);
}
ACT['ba-adj-csv']=async()=>{await baAdjCsv([baState().open])};
async function baMark(ids,done){
 if(!ids.length){toast('Tidak ada BA yang bisa diproses.',true);return}
 const r=await rpc('ba_adjust_bulk',{p_bas:ids,p_done:done});
 toast(`${n(r.done)} BA ${done?'ditandai sudah di-adjust':'tanda adjust dibatalkan'}${r.skipped?` (${n(r.skipped)} dilewati)`:''}.`);
}
ACT['ba-download']=async()=>{await baDownload([baState().open]);await render()};
// Satu pintu untuk semua aksi massal. Cakupan: BA yang dicentang, atau semua BA di filter bila tidak ada centang.
ACT['ba-run']=async el=>{
 const b=baState();const k=el.dataset.do;
 const picked=(b.all||[]).filter(x=>b.sel.has(x.id));
 const scope=picked;
 if(!picked.length)return toast('Pilih BA terlebih dahulu dengan mencentangnya.',true);
 if(k==='html'){
  if(!picked.length&&!confirm(`Unduh ${n(scope.length)} BA dalam satu file dan tandai sudah diekspor?`))return;
  await baDownload(scope.map(x=>x.id));
 }else if(k==='sign-spv'||k==='sign-mgr'){
  const lv=k==='sign-spv'?'SPV':'MGR';
  const ids=scope.filter(x=>lv==='SPV'?!x.spv_at:(x.spv_at&&!x.mgr_at&&x.spv_by!==state.me.id)).map(x=>x.id);
  if(!ids.length)return toast('Tidak ada BA yang bisa ditandatangani pada cakupan ini.',true);
  if(!confirm(`${lv==='SPV'?'Tanda tangani':'Setujui'} ${n(ids.length)} BA sebagai ${lv==='SPV'?'SPV':'Manager'}? Nama dan waktu Anda akan tercatat.`))return;
  const r=await rpc('ba_sign_bulk',{p_bas:ids,p_level:lv});
  toast(`${n(r.done)} BA ${lv==='SPV'?'ditandatangani SPV':'disetujui Manager'}${r.skipped?` (${n(r.skipped)} dilewati)`:''}.`);
 }else if(k==='csv'){
  await baAdjCsv(scope.filter(x=>x.mgr_at).map(x=>x.id));
 }else if(k==='mark'){
  const ids=scope.filter(x=>x.mgr_at&&!x.adj_at).map(x=>x.id);
  if(!picked.length&&!confirm(`Tandai ${n(ids.length)} BA sebagai sudah di-adjust?`))return;
  await baMark(ids,true);
 }else if(k==='unmark'){
  await baMark(picked.filter(x=>x.adj_at).map(x=>x.id),false);
 }else if(k==='clean'){
  const ids=picked.filter(x=>x.exported_at).map(x=>x.id);
  if(!ids.length)return toast('Pilih BA yang sudah diekspor.',true);
  if(!confirm(`Bersihkan ${n(ids.length)} BA dari database?\n\nPastikan file sudah tersimpan di Google Drive. Setelah dibersihkan, detail BA tidak bisa dibuka lagi di aplikasi.`))return;
  const c=await rpc('ba_clean',{p_bas:ids});b.sel.clear();toast(`${n(c)} BA dibersihkan dari database.`);
 }
 await render();
};
ACT['ba-clear-sel']=async()=>{baState().sel.clear();await render()};
CHG['ba-pick']=async el=>{const b=baState();b.sel=b.sel||new Set();el.checked?b.sel.add(el.dataset.id):b.sel.delete(el.dataset.id);await render()};
CHG['ba-pick-all']=async el=>{const b=baState();b.sel=b.sel||new Set();baFiltered(b).forEach(x=>el.checked?b.sel.add(x.id):b.sel.delete(x.id));await render()};
CHG['ba-store']=async el=>{const b=baState();b.store=el.value;await render()};

ACT['ba-create']=async el=>{const r=await rpc('ba_create',{p_cycle:el.dataset.id});toast(r.existed?`BA sudah ada: ${r.ba_no}`:`BA dibuat: ${r.ba_no}`);const b=baState();b.open=r.id;state.validation.open=false;state.page='ba';await render()};
ACT['ba-sign']=async el=>{const lv=el.dataset.level;if(!confirm(lv==='SPV'?'Tanda tangani BA ini sebagai SPV? Nama dan waktu Anda akan tercatat.':'Setujui BA ini sebagai Manager? Nama dan waktu Anda akan tercatat.'))return;await rpc('ba_sign',{p_ba:el.dataset.id,p_level:lv});toast('BA berhasil ditandatangani.');await render()};
CHG['ba-adj']=async el=>{await rpc('ba_adjust',{p_ba:el.dataset.id,p_done:el.checked});toast(el.checked?'BA ditandai sudah di-adjust.':'Tanda adjust dibatalkan.');await render()};

// ===== Ganti password (akun sendiri) dan kirim link reset (Admin) =====
function openPassModal(forced=false){
 if($('#passModal'))return;
 const ov=document.createElement('div');ov.id='passModal';ov.className='modal-bg';
 ov.innerHTML=`<div class="modal" style="max-width:420px">
  <div class="modal-head"><div><h3>${forced?'Buat password baru':'Ganti password'}</h3><p>${forced?'Anda membuka link reset password. Masukkan password baru untuk akun Anda.':'Password baru berlaku untuk login berikutnya.'}</p></div>${forced?'':'<button class="btn ghost" data-act="pass-close" aria-label="Tutup">✕</button>'}</div>
  <div style="display:grid;gap:10px;padding:4px 2px">
   <label class="field"><span>Password baru</span><input class="input" id="pNew" type="password" minlength="6" autocomplete="new-password"/></label>
   <label class="field"><span>Ulangi password baru</span><input class="input" id="pNew2" type="password" minlength="6" autocomplete="new-password"/></label>
   <small class="muted">Minimal 6 karakter.</small>
  </div>
  <div class="modal-foot">${forced?'':'<button class="btn outline" data-act="pass-close">Batal</button>'}<button class="btn primary" id="pSave">Simpan password</button></div>
 </div>`;
 document.body.appendChild(ov);
 $('#pSave').onclick=async()=>{
  const p1=$('#pNew').value,p2=$('#pNew2').value;
  if(p1.length<6)return toast('Password minimal 6 karakter.',true);
  if(p1!==p2)return toast('Konfirmasi password tidak sama.',true);
  const btn=$('#pSave');btn.disabled=true;
  try{const {error}=await sb.auth.updateUser({password:p1});if(error)throw error;toast('Password berhasil diganti.');$('#passModal')?.remove()}
  catch(ex){toast(ex.message,true);btn.disabled=false}
 };
}
ACT['pass-open']=async()=>openPassModal(false);
ACT['pass-close']=async()=>{$('#passModal')?.remove()};
ACT['user-reset']=async el=>{
 const email=el.dataset.email;
 if(!confirm(`Kirim link reset password ke ${email}?\n\nUser akan menerima email dan membuat password baru sendiri.`))return;
 const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.href.split('?')[0].split('#')[0]});
 if(error)return toast(error.message,true);
 toast(`Link reset dikirim ke ${email}.`);
};
function openAdminPass(id,email,name){
 if($('#admPassModal'))return;
 const ov=document.createElement('div');ov.id='admPassModal';ov.className='modal-bg';
 ov.innerHTML=`<div class="modal" style="max-width:420px">
  <div class="modal-head"><div><h3>Ubah password</h3><p>${escapeHTML(name||email)} · <span class="mono small">${escapeHTML(email)}</span></p></div><button class="btn ghost" data-act="adm-pass-close" aria-label="Tutup">✕</button></div>
  <div style="display:grid;gap:10px;padding:4px 2px">
   <label class="field"><span>Password baru</span><input class="input" id="apNew" type="password" minlength="6" autocomplete="new-password"/></label>
   <label class="field"><span>Ulangi password baru</span><input class="input" id="apNew2" type="password" minlength="6" autocomplete="new-password"/></label>
   <small class="muted">Minimal 6 karakter. Sesi user tersebut dicabut, jadi harus login ulang dengan password baru.</small>
  </div>
  <div class="modal-foot"><button class="btn outline" data-act="adm-pass-close">Batal</button><button class="btn primary" id="apSave">Simpan password</button></div>
 </div>`;
 document.body.appendChild(ov);
 $('#apSave').onclick=async()=>{
  const p1=$('#apNew').value,p2=$('#apNew2').value;
  if(p1.length<6)return toast('Password minimal 6 karakter.',true);
  if(p1!==p2)return toast('Konfirmasi password tidak sama.',true);
  const btn=$('#apSave');btn.disabled=true;
  try{await rpc('admin_set_password',{p_user:id,p_password:p1});toast('Password '+email+' berhasil diubah.');$('#admPassModal')?.remove()}
  catch(ex){toast(ex.message,true);btn.disabled=false}
 };
}
ACT['admin-pass']=async el=>openAdminPass(el.dataset.id,el.dataset.email,el.dataset.name);
ACT['adm-pass-close']=async()=>{$('#admPassModal')?.remove()};
ACT['admin-active']=async el=>{
 const on=el.dataset.on==='1',email=el.dataset.email||'';
 const msg=on?`Nonaktifkan ${email}?\n\nUser tidak bisa login atau memakai aplikasi sampai diaktifkan lagi.`:`Aktifkan kembali ${email}?`;
 if(!confirm(msg))return;
 await rpc('admin_set_active',{p_user:el.dataset.id,p_active:!on});
 toast(on?'Akun dinonaktifkan.':'Akun diaktifkan.');await render();
};
ACT['admin-delete']=async el=>{
 const email=el.dataset.email||'';
 if(!confirm(`HAPUS PERMANEN akun ${email}?\n\nLogin dan akun akan dihapus dan tidak bisa dikembalikan.\nJika akun punya riwayat SO/upload/BA, penghapusan ditolak dan akun tetap nonaktif.`))return;
 await rpc('admin_delete_user',{p_user:el.dataset.id});
 toast('Akun dihapus permanen.');await render();
};
sb.auth.onAuthStateChange((ev)=>{if(ev==='PASSWORD_RECOVERY')setTimeout(()=>openPassModal(true),400)});
