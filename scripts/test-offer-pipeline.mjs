import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {offerDataQuality,verifiedRecordErrors} from './offer-quality.mjs';
import {isHiltonComparison,sharedOfferSources,sourceKey} from './offer-source.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=html.split('<script>')[1].split('</script>')[0].replace(/bootstrap\(\);\s*$/,'');
const storage=new Map();
const element={classList:{add(){},remove(){},toggle(){}},addEventListener(){},style:{}};
const context=vm.createContext({console:{...console,error(){}},Date,Intl,URL,Set,Map,JSON,Math,Number,String,Array,Object,
  document:{documentElement:element,querySelector:()=>element,querySelectorAll:()=>[],getElementById:()=>element},
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
const parser=vm.createContext({console,process:{env:{}},Date,Number,String,Set,offerDataQuality});vm.runInContext(parserSource,parser);
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

const unitedExplorer=JSON.parse(fs.readFileSync(path.join(root,'cards.json'),'utf8')).cards.find(c=>c.id===8008);
assert.equal(unitedExplorer.af,150);
assert.equal(unitedExplorer.firstYearAnnualFee,0);
context.unitedExplorer=unitedExplorer;
assert.equal(vm.runInContext('annualFeeLabel(unitedExplorer)',context),'$0 first year, then $150');
parser.card=unitedExplorer;
const unitedBonus='United℠ Explorer Card Earn 70,000 bonus miles after spending $3,000 within the first 3 months. ';
parser.text=unitedBonus+'$0 intro annual fee for the first year, then $150.';
const unitedDetected=vm.runInContext('extractOffer(text,card)',parser);
assert.equal(unitedDetected.af,150);
assert.equal(unitedDetected.firstYearAnnualFee,0);
assert.equal(unitedDetected.changed,false);
assert.equal(unitedDetected.confidence,'high');
parser.text=unitedBonus+'$0 annual fee for the first year.';
assert.equal(vm.runInContext('extractOffer(text,card).confidence',parser),'review','A first-year fee without an ongoing amount is ambiguous');
parser.text=unitedBonus.replace('Explorer','Gateway')+'$0 intro annual fee for the first year, then $150.';
assert.equal(vm.runInContext('extractOffer(text,card).confidence',parser),'review','A shared word in two product names cannot confirm a match');

parser.AbortController=AbortController;parser.setTimeout=setTimeout;parser.clearTimeout=clearTimeout;
parser.now=new Date();
Object.assign(parser,{isHiltonComparison,sourceKey,sharedSources:sharedOfferSources([original])});
vm.runInContext(checker.slice(checker.indexOf('function ageDays('),checker.indexOf('function htmlToText(')),parser);
vm.runInContext(checker.slice(checker.indexOf('function htmlToText('),checker.indexOf('export function normalize(')),parser);
vm.runInContext(checker.slice(checker.indexOf('async function fetchCard('),checker.indexOf('if(process.argv[1]')),parser);
parser.card={...original,verifiedDate:'2000-01-01',monitorExpected:['50000','3000','3 months']};
parser.fetch=async()=>({status:200,url:original.issuerUrl,text:async()=>'<h1>Test Travel Card</h1>Earn 50,000 bonus points after spending $3,000 on purchases within the first 3 months. $95 annual fee.'});
assert.equal((await vm.runInContext('fetchCard(card)',parser)).status,'verified','Age alone must not prevent current-page reconfirmation');
parser.fetch=async()=>({status:200,url:original.issuerUrl,text:async()=>'<h1>Test Travel Card</h1>Application unavailable'});
assert.equal((await vm.runInContext('fetchCard(card)',parser)).status,'needs_review','A loaded page without terms must never count as verified');


const hiltonUrl='https://www.hilton.com/en/hilton-honors/credit-cards/';
const hiltonCards=JSON.parse(fs.readFileSync(path.join(root,'cards.json'),'utf8')).cards
  .filter(c=>[7111,8109,8110,8111].includes(c.id));
assert.equal(hiltonCards.length,4);
const sections=[
  ['Hilton Honors Card','70,000','2,000','No annual fee',true],
  ['Hilton Honors Surpass® Card','130,000','3,000','$150 annual fee',true],
  ['Hilton Honors Aspire Card - Our Best Points Offer Yet','200,000','6,000','$550 annual fee',false],
  ['Hilton Honors Business Card','150,000','8,000','$195 annual fee',true]
].map(([title,bonus,spend,fee,night])=>
  `<section><h3>${title}</h3><p>${fee}</p><h4>Earn ${bonus} Bonus Points</h4>`+
  `<p>Earn ${night?'a Free Night Reward + ':''}${bonus} Hilton Honors Bonus Points after you spend $${spend} within the first 6 months.</p></section>`);
const renderHilton=sections=>`<h1>Compare Hilton Honors cards</h1><h2>Card Breakdown</h2>${sections.join('')}`+
  '<h2>Compare Credit Cards</h2><h3>Hilton Honors Card</h3><p>Earn 200,000 bonus points after you spend $6,000 in the first 6 months.</p>';
async function check(card,body,finalUrl=card.issuerUrl){
  parser.card=card;
  parser.fetch=async()=>({status:200,url:finalUrl,text:async()=>body});
  return vm.runInContext('fetchCard(card)',parser);
}
const htmlFixture=renderHilton(sections);
for(const card of hiltonCards){
  const r=await check(card,htmlFixture);
  assert.equal(r.source,'shared-issuer-page',card.name);
  assert.equal(r.status,'needs_review',card.name);
  assert.equal(r.detectedOffer.confidence,'review',card.name);
  for(const field of ['bonus','spend','spendPeriod','af']) assert.equal(r.detectedOffer[field],card[field],card.name+' '+field);
  assert.equal(r.detectedOffer.changed,false,card.name);
  assert.equal(/Free Night Reward/i.test(r.detectedOffer.snippet),card.offerRequirementType==='split');
}
const hiltonBase=hiltonCards.find(c=>c.id===8109);
const scopedExpected=await check({...hiltonBase,monitorExpected:['70,000','200,000']},htmlFixture);
assert.deepEqual(Array.from(scopedExpected.missingTerms),['200,000'],'Expected terms must come from the same product section');
for(const body of [
  renderHilton(sections.slice(1)), // Base title occurs in the comparison table only.
  renderHilton([...sections,sections[0]]), // Duplicate product heading.
  renderHilton([sections[0].replace('</section>',
    '<p>Earn 70,000 Hilton Honors Bonus Points after you spend $2,000 within the first 3 months.</p></section>'),...sections.slice(1)]),
  htmlFixture.replace('Card Breakdown','New page layout')
]){
  const r=await check(hiltonBase,body);
  assert.equal(r.detectedOffer.confidence,'review');
  assert.equal(r.detectedOffer.bonus,undefined,'Ambiguous or missing sections must not produce an attributed bonus');
  assert.equal(r.detectedOffer.changed,undefined);
}
const aspire=hiltonCards.find(c=>c.id===8111);
const aspireChange=await check(aspire,htmlFixture.replaceAll('200,000','210,000'));
assert.equal(aspireChange.detectedOffer.bonus,210000);
assert.equal(aspireChange.detectedOffer.changed,true);
assert.equal(aspireChange.detectedOffer.confidence,'review');
const otherSharedCard={...original,issuerUrl:original.issuerUrl+'/?offer=a'};
const otherVariant={...original,id:2,issuerUrl:original.issuerUrl+'?offer=b'};
parser.sharedSources=sharedOfferSources([otherSharedCard,otherVariant]);
const sharedResult=await check(otherSharedCard,'<h1>Test Travel Card</h1>Earn 60,000 points after you spend $4,000 within the first 3 months. $95 annual fee.');
assert.equal(sharedResult.detectedOffer.bonus,undefined,'Unmapped shared sources must not use page-wide terms');
const redirected=await check(original,htmlFixture,hiltonUrl);
assert.equal(redirected.detectedOffer.bonus,undefined,'Redirects must respect the shared destination');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardpilot-test-'));
try{
  function update(card,result,extra={},otherCards=[]){
    const catalog={catalogVersion:'fixture-v1',cards:[card,...otherCards]};
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
  output=update({...original,verifiedDate:'2000-01-01'},{...result,status:'verified',detectedOffer:{confidence:'high',changed:false,af:95}});
  assert.notEqual(output.cards[0].verifiedDate,'2000-01-01','Unchanged successful checks must persist renewed verification');
  assert.notEqual(output.catalogVersion,'fixture-v1','Verification-only changes must persist and update the catalog revision');
  assert.deepEqual(update(aspire,aspireChange).cards[0],aspire,'Scoped Hilton changes require human review');
  const wrongUnitedFee={...result,id:unitedExplorer.id,url:unitedExplorer.issuerUrl,
    detectedOffer:{...unitedDetected,af:0,firstYearAnnualFee:null,changed:true}};
  assert.deepEqual(update(unitedExplorer,wrongUnitedFee).cards[0],unitedExplorer,'The introductory fee must never overwrite the ongoing fee');
  assert.deepEqual(update(unitedExplorer,{...wrongUnitedFee,status:'verified',detectedOffer:{...wrongUnitedFee.detectedOffer,changed:false}}).cards[0],unitedExplorer,
    'An incorrect fee cannot refresh verification');
  for(const fees of [{af:195},{af:95,firstYearAnnualFee:0}]){
    assert.deepEqual(update(original,{...result,detectedOffer:{...result.detectedOffer,...fees}}).cards[0],original,
      'Ongoing or first-year fee changes require review even on direct product pages');
  }
  const falseHigh={...result,url:hiltonUrl};
  assert.deepEqual(update(aspire,falseHigh).cards[0],aspire,'An old or erroneous high-confidence comparison-page result must not update');
  const falseVerified={...falseHigh,status:'verified',detectedOffer:{confidence:'high',changed:false}};
  assert.deepEqual(update(aspire,falseVerified).cards[0],aspire,'Shared pages must not refresh verification either');
  assert.deepEqual(update(original,{...result,finalUrl:hiltonUrl}).cards[0],original,'The updater must block redirects to known comparison pages');
  assert.deepEqual(update(otherSharedCard,{...result,url:otherSharedCard.issuerUrl},{},[otherVariant]).cards[0],otherSharedCard,
    'Shared URL aliases must not overwrite catalog entries');
  assert.throws(()=>update(original,result,{checkedAt:'2000-01-01T00:00:00Z'}),'Old reports must be rejected');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('Offer pipeline regression checks passed.');
