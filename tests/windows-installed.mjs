import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const results = { platform: process.platform, checks: [], started: new Date().toISOString() };
await mkdir('artifacts', {recursive:true});
let app, page, input;
function pass(name) { results.checks.push(name); console.log('PASS: '+name); }
const sleep = ms => new Promise(r => setTimeout(r,ms));
async function state() { const r=await page.evaluate(()=>window.worktrail.status()); assert.equal(r.ok,true);return r.data; }
async function until(fn, label, ms=60000) { const end=Date.now()+ms; while(Date.now()<end) { if(await fn())return;await sleep(500); } throw Error('Timed out: '+label); }
try {
  assert.equal(process.platform,'win32');
  assert.ok(process.env.WT_TEST_EMAIL && process.env.WT_TEST_PASSWORD,'Dedicated test credentials required');
  input=spawn('powershell.exe',['-NoProfile','-File','tests/keep-active.ps1'],{stdio:'inherit'});
  app=await electron.launch({executablePath:process.env.WORKTRAIL_EXE, timeout:60000});
  page=await app.firstWindow();
  await page.locator('#login').waitFor({state:'visible'});
  const initial=await state(); assert.equal(initial.configured,true); assert.equal(initial.running,null);
  pass('Installed app launches with workspace configured and tracking off');
  const displays=await app.evaluate(async({screen,desktopCapturer})=>{
    const d=screen.getAllDisplays();const s=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1280,height:1280}});
    return {displays:d.map(x=>({id:String(x.id),width:x.size.width,height:x.size.height})),sources:s.map(x=>({id:String(x.display_id),empty:x.thumbnail.isEmpty()}))};
  });
  results.displays=displays; assert.ok(displays.displays.length>0);assert.equal(displays.sources.length,displays.displays.length);assert.ok(displays.sources.every(x=>!x.empty));
  pass('Real Windows display enumeration and nonempty screen capture');
  await page.locator('#email').fill(process.env.WT_TEST_EMAIL);
  await page.locator('#password').fill(process.env.WT_TEST_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.locator('#passwordSetup').waitFor({state:'visible',timeout:60000});
  const password=randomBytes(24).toString('base64url')+'aA9!';
  await page.locator('#newPassword').fill(password);await page.locator('#confirmPassword').fill(password);
  await page.getByRole('button',{name:'Finish account setup'}).click();
  await page.locator('#tracker').waitFor({state:'visible',timeout:60000});
  assert.equal((await state()).needsPassword,false);pass('Live sign-in and first-use password setup');
  await until(async()=>await app.evaluate(({powerMonitor})=>powerMonitor.getSystemIdleTime()<10),'real Windows input activity',20000);
  pass('Runner receives real simulated mouse input without mocking idle detection');
  await page.locator('#note').fill('Automated Windows installer acceptance');
  await page.locator('#consent').check();await page.locator('#start').click();
  await until(async()=>{const s=await state(); return !!s.running && !!s.lastCapture && !s.busy;},'first live capture',90000);
  const first=await state();results.sessionId=first.running.id;results.firstCapture=first.lastCapture;
  pass('Clock in and upload initial full-display capture to live backend');
  await until(async()=>(await state()).todaySeconds>first.todaySeconds+15,'server time accrual',70000);
  pass('Live server heartbeat credits tracked time');
  await page.locator('#break').click();await until(async()=>{const s=await state();return !s.running&&!s.busy;},'break');
  await until(async()=>(await page.locator('#message').innerText())==='On break. Screenshots are stopped.','break server acknowledgement');
  const paused=await state();await sleep(25000);await page.evaluate(()=>window.worktrail.refresh());
  await until(async()=>!(await state()).busy,'refresh');const after=await state();
  assert.equal(after.running,null);assert.equal(after.lastCapture,paused.lastCapture);assert.equal(after.todaySeconds,paused.todaySeconds);
  pass('Break stops time and screenshot capture');
  await page.locator('#consent').check();await page.locator('#start').click();
  await until(async()=>{const s=await state();return !!s.running&&!s.busy&&s.lastCapture!==paused.lastCapture;},'resume and capture',90000);
  await page.locator('#stop').click();await until(async()=>{const s=await state();return !s.running&&!s.busy;},'clock out');
  await until(async()=>(await page.locator('#message').innerText())==='Clocked out. Screenshots are stopped.','clock out server acknowledgement');
  const stopped=await state();await sleep(25000);await page.evaluate(()=>window.worktrail.refresh());
  await until(async()=>!(await state()).busy,'refresh');const final=await state();assert.equal(final.running,null);assert.equal(final.lastCapture,stopped.lastCapture);assert.equal(final.todaySeconds,stopped.todaySeconds);
  pass('Resume captures again; manual clock out stops time and captures');
  await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});
  pass('Sign out');results.ok=true;
} catch(e) {results.ok=false;results.error=e.message;console.error(e.message);process.exitCode=1;}
finally {
  if(page) {try {await page.evaluate(()=>window.worktrail.stop('clock_out'));}catch{} }
  if(app)await app.close().catch(()=>{});
  input?.kill();
  results.finished=new Date().toISOString();await writeFile('artifacts/result.json',JSON.stringify(results,null,2));
}
