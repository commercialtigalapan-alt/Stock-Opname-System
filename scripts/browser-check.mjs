// Run AFTER installing Playwright Chromium and configuring a test database.
// This smoke test does not replace business UAT or a comparison to the old app.
import fs from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.APP_ORIGIN,username=process.env.TEST_USERNAME,password=process.env.TEST_PASSWORD;
if(!url||!username||!password)throw Error('Isi APP_ORIGIN, TEST_USERNAME dan TEST_PASSWORD untuk akun UAT');
fs.mkdirSync('test-results',{recursive:true});const errors=[],browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#v13User').fill(username);await page.locator('#v13Pass').fill(password);await page.locator('#v13LoginBtn').click();
 await page.waitForFunction(()=>typeof S!=='undefined'&&S.boot?.user,{timeout:60000});await page.screenshot({path:'test-results/desktop-dashboard.png',fullPage:true});
 const pages=await page.evaluate(()=>S.boot.pages||[]);
 for(const p of pages){await page.evaluate(p=>window.setPage(p),p);await page.waitForTimeout(500);await page.locator('#content').waitFor();if(!await page.locator('#content').innerText())errors.push('Halaman kosong: '+p)}
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>setPage('dashboard'));await page.waitForTimeout(500);await page.screenshot({path:'test-results/mobile-dashboard.png',fullPage:true});
 fs.writeFileSync('test-results/browser.json',JSON.stringify({pages,errors,scope:'Rendering and navigation smoke only'},null,2));if(errors.length)throw Error(errors.join('\n'));console.log('Browser smoke selesai; periksa screenshot dan lanjutkan UAT bisnis.');
}finally{await browser.close()}
