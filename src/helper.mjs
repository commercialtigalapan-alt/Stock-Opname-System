// Synchronous legacy boundaries run in an isolated helper; no Google services.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const action=process.argv[2],input=JSON.parse(readFileSync(0,'utf8'));
try{
 let out;
 if(action==='pdf'){
  const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});
  try{const page=await browser.newPage();await page.setContent(input.html,{waitUntil:'load'});const data=await page.pdf({format:'A4',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'12mm',right:'12mm'}});out={data:data.toString('base64')}}finally{await browser.close()}
 }else if(action==='zip'||action==='unzip'){
  const py=`import sys,json,io,zipfile,base64\na=json.load(sys.stdin)\nif sys.argv[1]=='zip':\n b=io.BytesIO()\n with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:\n  for f in a['files']: z.writestr(f['name'],base64.b64decode(f['data']))\n print(json.dumps({'data':base64.b64encode(b.getvalue()).decode()}))\nelse:\n with zipfile.ZipFile(io.BytesIO(base64.b64decode(a['data']))) as z:\n  if sum(f.file_size for f in z.infolist())>100*1024*1024: raise ValueError('Archive too large')\n  print(json.dumps({'files':[{'name':f.filename,'data':base64.b64encode(z.read(f)).decode()} for f in z.infolist() if not f.is_dir()]}))`;
  const p=spawnSync('python3',['-c',py,action],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:160*1024*1024});if(p.status!==0)throw Error(p.stderr);out=JSON.parse(p.stdout);
 }else if(action==='google-sheet'){
  const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON||(process.env.GOOGLE_SERVICE_ACCOUNT_FILE?readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE,'utf8'):'');
  if(!raw)throw Error('Atur GOOGLE_SERVICE_ACCOUNT_FILE atau GOOGLE_SERVICE_ACCOUNT_JSON untuk impor Google Sheet; atau gunakan upload Excel/CSV.');
  const credentials=JSON.parse(raw),iat=Math.floor(Date.now()/1000),b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned=b64({alg:'RS256',typ:'JWT',kid:credentials.private_key_id})+'.'+b64({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600});
  const assertion=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),credentials.private_key).toString('base64url');
  const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(30000)});if(!tokenRes.ok)throw Error('Google OAuth HTTP '+tokenRes.status);const token=await tokenRes.json();
  if(!/^[a-zA-Z0-9_-]{20,}$/.test(input.id))throw Error('Spreadsheet ID tidak valid');
  const fields='spreadsheetId,properties(title,timeZone),sheets(properties(title,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(effectiveValue,formattedValue,effectiveFormat(numberFormat)))))';
  const r=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+input.id+'?includeGridData=true&fields='+encodeURIComponent(fields),{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('Google Sheets HTTP '+r.status+'; aktifkan Sheets API dan bagikan spreadsheet ke '+credentials.client_email+' sebagai Viewer.');out=await r.json();
 }else if(action==='storage-read'){
  const k=process.env.SUPABASE_SECRET_KEY,h={apikey:k};if(k.startsWith('eyJ'))h.Authorization='Bearer '+k;
  const r=await fetch(process.env.SUPABASE_URL+'/storage/v1/object/authenticated/'+process.env.SUPABASE_BUCKET+'/'+input.path,{headers:h,signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Storage HTTP '+r.status);out={data:Buffer.from(await r.arrayBuffer()).toString('base64')};
 }else throw Error('Helper action tidak diizinkan');
 process.stdout.write(JSON.stringify(out));
}catch(e){process.stderr.write(String(e.stack||e));process.exitCode=1}
