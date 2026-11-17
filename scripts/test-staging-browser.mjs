import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {extractOffer} from './check-offers.mjs';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const runProcess=promisify(execFile);
import {fileURLToPath} from 'node:url';
import {readRenderedOfferPage,closeRenderedBrowser,launchOfferBrowser} from './read-rendered-offer.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidate=path.resolve(root,process.env.CARDPILOT_CANDIDATE_DIRECTORY||'staging');
const original=JSON.parse(fs.readFileSync(path.join(candidate,'cards.json'),'utf8'));
let catalog=structuredClone(original),offline=false,dynamicOutage=false;
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/dynamic-offer'){
    res.setHeader('Content-Type','text/html');
    res.end(dynamicOutage?'<h1>Fixture Travel Card</h1>Offer unavailable':'<h1>Fixture Travel Card</h1><div id="offer">Earn points after purchases</div><p>$95 annual fee.</p><script>setTimeout(()=>document.getElementById("offer").textContent="Earn 80,000 bonus points after spending $3,500 on purchases within the first 4 months.",200)</script>');return;
  }
  if(pathname==='/cards.json'){
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    res.statusCode=offline?503:200;res.end(JSON.stringify(offline?{error:'fixture outage'}:catalog));return;
  }
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(candidate,'index.html')));return;}
  res.statusCode=404;res.end('Not found');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let browser;
const results=[];
try{
  // Real Chromium runs the delayed DOM update: a static text read has no terms.
  const rendered=await readRenderedOfferPage(url+'/dynamic-offer');
  assert(rendered.text.includes('80,000'));
  assert.equal(extractOffer(rendered.text,{name:'Fixture Travel Card',unit:'points',bonus:80000,spend:3500,spendPeriod:'4 months',af:95}).confidence,'high');
  results.push('Rendered fallback extracts terms populated by JavaScript.');
  await closeRenderedBrowser();

  // Exercise the actual checker and updater, not only the extraction helper.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardpilot-dynamic-pipeline-'));
  try{
    const fixture={id:1,name:'Fixture Travel Card',issuer:'Fixture issuer',type:'Personal',unit:'points',af:95,
      bonus:0,spend:null,verified:false,offerState:'needs-review',reviewReason:'fixture terms pending',reviewOpenedDate:'2000-01-01',
      issuerUrl:url+'/dynamic-offer',issuerUrlVerified:true};
    fs.writeFileSync(path.join(dir,'cards.json'),JSON.stringify({catalogVersion:'fixture-dynamic',cards:[fixture]}));
    const env={...process.env,CARDPILOT_RENDERED_FALLBACK:'1'};
    await runProcess(process.execPath,[path.join(root,'scripts/check-offers.mjs'),'cards.json','offer-report.json'],{cwd:dir,env,stdio:'pipe',timeout:60000});
    const report=JSON.parse(fs.readFileSync(path.join(dir,'offer-report.json')));
    assert.equal(report.results[0].extractionMethod,'rendered-public-page');
    assert.equal(report.results[0].detectedOffer.confidence,'high');
    await runProcess(process.execPath,[path.join(root,'scripts/auto-update-offers.mjs'),'cards.json','offer-report.json'],{cwd:dir,env,stdio:'pipe'});
    const updated=JSON.parse(fs.readFileSync(path.join(dir,'cards.json'))).cards[0];
    assert.equal(updated.bonus,80000);assert.equal(updated.spend,3500);assert.equal(updated.spendPeriod,'4 months');assert.equal(updated.verified,true);
    dynamicOutage=true;
    await runProcess(process.execPath,[path.join(root,'scripts/check-offers.mjs'),'cards.json','offer-report.json'],{cwd:dir,env,stdio:'pipe',timeout:60000});
    await runProcess(process.execPath,[path.join(root,'scripts/auto-update-offers.mjs'),'cards.json','offer-report.json'],{cwd:dir,env,stdio:'pipe'});
    const preserved=JSON.parse(fs.readFileSync(path.join(dir,'cards.json'))).cards[0];
    assert.equal(preserved.bonus,80000);assert.equal(preserved.spend,3500);
    results.push('The daily pipeline fills missing dynamic terms and preserves them when the next read fails.');
  }finally{dynamicOutage=false;fs.rmSync(dir,{recursive:true,force:true});}

  browser=await launchOfferBrowser();
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>data.catalogLoadStatus==='live');
  const base=original.cards.find(c=>c.id===8207);
  assert.equal(await page.evaluate(()=>data.offers.find(c=>c.id===8207).bonus),base.bonus);
  results.push('A new user loads the staging catalog.');
  await page.evaluate(()=>{
    data.cards=[{id:'fixture-wallet',name:'Fixture Wallet Card',issuer:'Fixture'}];
    data.savedCardIds=['8207'];data.profile.preferredAirlines=['american'];
    localStorage.setItem('cardpilotData',JSON.stringify(data));
  });
  catalog.cards=catalog.cards.map(c=>c.id===8207?{...c,bonus:90000,spend:4000}:c);
  // Keep catalogVersion unchanged to catch the original refresh regression.
  await page.reload();await page.waitForFunction(()=>data.catalogLoadStatus==='live');
  assert.equal(await page.evaluate(()=>data.offers.find(c=>c.id===8207).bonus),90000);
  assert.equal(await page.evaluate(()=>data.cards[0].id),'fixture-wallet');
  assert.equal(await page.evaluate(()=>data.savedCardIds[0]),'8207');
  assert.equal(await page.evaluate(()=>data.profile.preferredAirlines[0]),'american');
  await page.evaluate(()=>browseCards());
  assert((await page.locator('#offersView').innerText()).includes('90,000 AAdvantage miles'));
  results.push('A returning user receives changed terms without losing wallet, shortlist or preferences.');
  catalog.cards=catalog.cards.map(c=>c.id===8207?{...c,offerExpires:'2000-01-01'}:c);
  await page.reload();await page.waitForFunction(()=>data.catalogLoadStatus==='live');
  assert.equal(await page.evaluate(()=>offerFit(data.offers.find(c=>c.id===8207)).status),'verify');
  results.push('Expired offers leave apply-now recommendations.');
  offline=true;await page.reload();await page.waitForFunction(()=>data.catalogLoadStatus==='fallback');
  assert.equal(await page.evaluate(()=>data.offers.find(c=>c.id===8207).bonus),90000);
  assert.equal(await page.evaluate(()=>data.cards[0].id),'fixture-wallet');
  results.push('A failed update preserves the last loaded terms and user data.');
  offline=false;catalog=structuredClone(original);
  await page.reload();await page.waitForFunction(()=>data.catalogLoadStatus==='live');
  assert.equal(await page.evaluate(()=>data.offers.find(c=>c.id===8207).bonus),base.bonus);
  assert.equal(await page.evaluate(()=>data.savedCardIds[0]),'8207');
  results.push('Restoring the previous catalog rolls back offers without resetting the user.');
  assert.deepEqual(errors,[]);
  const candidateHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(candidate,'index.html')))
    .update(fs.readFileSync(path.join(candidate,'cards.json'))).digest('hex');
  const report={passed:true,checkedAt:new Date().toISOString(),candidateHash,checks:results};
  fs.writeFileSync(path.join(candidate,'browser-qa.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{
  await closeRenderedBrowser();if(browser)await browser.close();server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
