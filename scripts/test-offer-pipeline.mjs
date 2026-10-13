import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {offerDataQuality,verifiedRecordErrors} from './offer-quality.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=html.split('<script>')[1].split('</script>')[0].replace(/bootstrap\(\);\s*$/,'');
const storage=new Map();
const element={classList:{add(){},remove(){},toggle(){}},addEventListener(){},style:{}};
const context=vm.createContext({console:{...console,error(){}},Date,Intl,URL,Set,Map,JSON,Math,Number,String,Array,Object,
  document:{querySelector:()=>element,querySelectorAll:()=>[],getElementById:()=>element},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  window:{},navigator:{},alert(){},setTimeout,clearTimeout});
vm.runInContext(script,context);
const original={id:1,name:'Test Travel Card',issuer:'Test',type:'Personal',bonus:50000,spend:3000,
  af:95,unit:'points',verified:true,verifiedDate:new Date().toISOString().slice(0,10),tags:['points'],
  issuerUrl:'https://issuer.example/test',issuerUrlVerified:true,spendPeriod:'3 months',offerState:'verified-current'};

assert(verifiedRecordErrors({...original,spend:null}).length>0,'False verified flag must fail validation');
assert(verifiedRecordErrors({...original,verified:false}).length>0,'Pending items must have a review owner trail');
assert.equal(offerDataQuality({...original,bonus:0,spend:0,offerState:'first-year-cashback-match'}).needsReview,false);
assert(offerDataQuality({...original,offerExpires:'2000-01-01'}).needsReview);
context.payload={cards:[original],catalogVersion:'same-version'};
vm.runInContext("data.profile={cardPath:'either',interests:['none'],subInterests:{},relationships:{}};data.cards=[{id:'wallet-card'}];data.savedCardIds=['saved-card'];data.catalogVersion='same-version';data.offers=[{id:1,bonus:1}];",context);
context.fetch=async()=>({ok:true,json:async()=>context.payload});
await vm.runInContext('loadCatalog()',context);
assert.equal(vm.runInContext('data.offers[0].bonus',context),50000,'Same-version downloads must replace saved offers');
assert.equal(vm.runInContext('data.cards[0].id',context),'wallet-card');
assert.equal(vm.runInContext('data.savedCardIds[0]',context),'saved-card');
context.payload={cards:[{...original,bonus:60000}],catalogVersion:'new-version'};
await vm.runInContext('loadCatalog()',context);
assert.equal(vm.runInContext('data.catalogVersion',context),'new-version');
context.fetch=async()=>{throw new Error('Fixture offline')};
await vm.runInContext('loadCatalog()',context);
assert.equal(vm.runInContext('data.offers[0].bonus',context),60000,'Failed requests must preserve the last loaded catalog');
context.offer={...original,verified:false,reviewReason:'terms pending'};
assert.equal(vm.runInContext('offerFit(offer).status',context),'verify','Known spend must not bypass verification');
assert.equal(vm.runInContext('offerDataQuality(offer).needsReview',context),offerDataQuality(context.offer).needsReview);

const checker=fs.readFileSync(path.join(root,'scripts/check-offers.mjs'),'utf8');
const parserSource=checker.slice(checker.indexOf('function normalize('),checker.indexOf('async function fetchCard('));
const parser=vm.createContext({console,Date,Number,String,Set,offerDataQuality});vm.runInContext(parserSource,parser);
parser.card=original;
parser.text='Test Travel Card Earn 50,000 bonus points after spending $3,000 on purchases within the first 3 months. $95 annual fee.';
assert.equal(vm.runInContext('extractOffer(text,card).confidence',parser),'high');
parser.text='Test Travel Card Earn 50,000 bonus points after spending $3,000 on purchases. $95 annual fee.';
assert.equal(vm.runInContext('extractOffer(text,card).confidence',parser),'review','Missing period is not safe to auto-update');
parser.text='Test Travel Card Earn 50,000 bonus points after spending $3,000 within the first 3 months. $95 annual fee. Earn 100,000 bonus points after spending $8,000 within the first 3 months.';
assert.equal(vm.runInContext('extractOffer(text,card).confidence',parser),'review','Multiple product offers must not auto-update');
parser.text='Test Travel Card Earn 50,000 bonus points after spending $3,000 within the first 3 months. $200 travel credit.';
assert.equal(vm.runInContext('extractOffer(text,card).af',parser),null,'Travel credits are not annual fees');
parser.text='Test Travel Card As high as 75,000 bonus points after you spend $4,000 within the first 3 months. $95 annual fee.';
assert.equal(vm.runInContext('extractOffer(text,card).confidence',parser),'review','A second parser pattern must not strip the personalized qualifier');

parser.AbortController=AbortController;parser.setTimeout=setTimeout;parser.clearTimeout=clearTimeout;
parser.now=new Date();
vm.runInContext(checker.slice(checker.indexOf('function ageDays('),checker.indexOf('function htmlToText(')),parser);
vm.runInContext(checker.slice(checker.indexOf('function htmlToText('),checker.indexOf('function normalize(')),parser);
vm.runInContext(checker.slice(checker.indexOf('async function fetchCard('),checker.indexOf('const monitored=')),parser);
parser.card={...original,verifiedDate:'2000-01-01',monitorExpected:['50000','3000','3 months']};
parser.fetch=async()=>({status:200,url:original.issuerUrl,text:async()=>'<h1>Test Travel Card</h1>Earn 50,000 bonus points after spending $3,000 on purchases within the first 3 months. $95 annual fee.'});
assert.equal((await vm.runInContext('fetchCard(card)',parser)).status,'verified','Age alone must not prevent current-page reconfirmation');
parser.fetch=async()=>({status:200,url:original.issuerUrl,text:async()=>'<h1>Test Travel Card</h1>Application unavailable'});
assert.equal((await vm.runInContext('fetchCard(card)',parser)).status,'needs_review','A loaded page without terms must never count as verified');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardpilot-test-'));
try{
  function update(card,result,extra={}){
    const catalog={catalogVersion:'fixture-v1',cards:[card]};
    fs.writeFileSync(path.join(dir,'cards.json'),JSON.stringify(catalog));
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({catalogVersion:'fixture-v1',checkedAt:new Date().toISOString(),results:[result],...extra}));
    execFileSync(process.execPath,[path.join(root,'scripts/auto-update-offers.mjs'),'cards.json','report.json'],{cwd:dir,stdio:'pipe'});
    return JSON.parse(fs.readFileSync(path.join(dir,'cards.json'),'utf8'));
  }
  const result={id:1,url:original.issuerUrl,status:'needs_review',httpStatus:200,detectedOffer:{confidence:'high',changed:true,bonus:60000,spend:4000,spendPeriod:'3 months',af:95}};
  let output=update(original,result);assert.equal(output.cards[0].bonus,60000);assert.equal(output.cards[0].lastKnownOffer.bonus,50000);
  output=update(original,{...result,status:'blocked_by_issuer',httpStatus:403,detectedOffer:null});assert.equal(output.cards[0].bonus,50000);
  output=update({...original,offerRequirementType:'personalized'},result);assert.equal(output.cards[0].bonus,50000,'Personalized offers require review');
  output=update(original,{...result,url:'https://wrong.example'});assert.equal(output.cards[0].bonus,50000,'Wrong source must not update');
  output=update({...original,verifiedDate:'2000-01-01'},{...result,status:'verified',detectedOffer:{confidence:'high',changed:false}});
  assert.notEqual(output.cards[0].verifiedDate,'2000-01-01','Unchanged successful checks must persist renewed verification');
  assert.notEqual(output.catalogVersion,'fixture-v1','Verification-only changes must persist and update the catalog revision');
  assert.throws(()=>update(original,result,{checkedAt:'2000-01-01T00:00:00Z'}),'Old reports must be rejected');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('Offer pipeline regression checks passed.');
