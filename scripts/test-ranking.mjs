import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.split('<script>')[1].split('</script>')[0].replace(/bootstrap\(\);\s*$/,'');
const storage=new Map();
const element={classList:{add(){},remove(){},toggle(){}},addEventListener(){},style:{}};
const context=vm.createContext({console,Date,Intl,URL,Set,Map,JSON,Math,Number,String,Array,Object,
  document:{documentElement:element,querySelector:()=>element,querySelectorAll:()=>[],getElementById:()=>element},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  window:{scrollTo(){}},navigator:{},alert(){},setTimeout,clearTimeout});
vm.runInContext(script,context);
const base={issuer:'Fixture',type:'Business',bonus:200,unit:'cash',af:0,verified:true,
  verifiedDate:new Date().toISOString().slice(0,10),tags:['cash'],issuerUrl:'https://issuer.example/card',
  issuerUrlVerified:true,spendPeriod:'3 months',offerState:'verified-current'};
context.fixtures=[
  {...base,id:1,name:'Purchase required',spend:3000},
  {...base,id:2,name:'Approval only',spend:0},
  {...base,id:3,name:'Unknown requirement',spend:null},
  {...base,id:4,name:'Personal approval only',type:'Personal',spend:0,bonus:1000},
];
vm.runInContext("data.offers=fixtures;data.cards=[];data.profile={cardPath:'business',interests:['none'],subInterests:{},relationships:{},feePref:'any',subSpendPref:'10000plus',ownedCardMode:'include',refineCardType:'Business'}",context);
const run=code=>vm.runInContext(code,context);
assert.equal(run('offerFit(data.offers[0]).status'),'consider');
assert.equal(run('offerFit(data.offers[1]).status'),'consider');
assert.equal(run('offerFit(data.offers[2]).status'),'verify');
assert.equal(run('rankedOffers()[0].offer.id'),2,'Equal bonuses must favor $0 required spend over $3,000');
assert.equal(run('rankedOffers().at(-1).offer.id'),3,'Unknown spend must not be treated as zero');
run("data.profile.refineRank='leastspend'");
assert.equal(run('refinementCandidates()[0].offer.id'),2);
assert.equal(run('refinementCandidates().some(x=>x.offer.type!=="Business")'),false);
run("data.profile.refineRank='efficiency'");
assert.equal(run('refinementCandidates()[0].offer.id'),1,'Finite bonus return must not divide by zero');
assert.equal(run('refinementCandidates().some(x=>x.offer.id===3)'),false,'Unverified offers must not displace confirmed matches');
run("data.profile.relationships={bofaPersonal:'premier',bofaBusiness:'none'}");
assert.equal(run("bofaTierBonus('Business')"),0,'Personal status must not boost business rewards');
run("data.profile.relationships.bofaBusiness='platinum-honors'");
assert.equal(run("bofaTierBonus('Business')"),0.75);
// Exercise the real reviewed catalog with a business search and a saved
// banking relationship, not just the isolated sorting fixtures above.
context.reviewedCatalog=JSON.parse(fs.readFileSync(new URL('../cards.json',import.meta.url),'utf8')).cards;
const reviewedAt=Date.parse(JSON.parse(fs.readFileSync(new URL('../cards.json',import.meta.url),'utf8')).generatedAt);
context.Date=class extends Date {
  constructor(...args){super(...(args.length?args:[reviewedAt]));}
  static now(){return reviewedAt;}
};
run("data.offers=reviewedCatalog;data.profile.cardPath='business';data.profile.refineRank='leastspend'");
const reviewedIds=new Set([7001,7002,7003,7004,7005,7006,7007,7008,7009,7010,7011,7401,7402,7403,7404]);
const actual=run('refinementCandidates()');
assert(actual.length>0,'The reviewed catalog must produce business recommendations');
assert(actual.every(x=>x.offer.type==='Business'&&x.offer.verified===true),'Pending Amex records must not enter the confirmed recommendation pool');
assert(actual.some(x=>reviewedIds.has(x.offer.id)),'The search must include reviewed business offers');
assert.equal(run('data.offers.find(x=>x.id===7010).bonus'),90000,'United numeric bonus must exclude employee-card miles and PQP');
assert.equal(run('data.offers.find(x=>x.id===7007).bonus'),150000);
assert.equal(run('data.offers.find(x=>x.id===7007).additionalBonus'),10000);
assert.equal(run('data.offers.find(x=>x.id===7201).bonus'),150000,'Venture X Business must not price the full tiered maximum against first-tier spend');
assert.equal(run('data.offers.find(x=>x.id===7201).spend'),40000);
assert.equal(run('data.offers.find(x=>x.id===7201).maximumCombinedBonus'),300000);
assert.equal(run('data.offers.find(x=>x.id===7501).spendPeriod'),'180 days','Preserve day-based deadlines without converting to calendar months');
// Restricted currencies and certificates must not inflate cash or point values.
for(const id of [8012,8016,8507,8816]){
  context.reviewOffer=context.reviewedCatalog.find(c=>c.id===id);
  assert.equal(run('cashWelcomeValue(reviewOffer)'),0,`Restricted reward ${id} must not be cash`);
  assert.equal(run('bonusValueRange(reviewOffer)'),null);
  assert.equal(run('offerEstimatedSubValue(reviewOffer)'),0);
}
context.reviewOffer=context.reviewedCatalog.find(c=>c.id===8817);
assert.equal(run('offerCashValue(reviewOffer)'),0,'Bilt Cash must not be unrestricted cash');
assert.equal(run('pointCurrency(reviewOffer)'),'bilt','Palladium points remain points');
context.reviewOffer=context.reviewedCatalog.find(c=>c.id===8704);
assert.equal(run('reviewOffer.bonus'),45000,'Wyndham hotel-spend tier must not inflate base bonus');
assert.equal(run('reviewOffer.maximumCombinedBonus'),100000);
// Both ranking choices run through the welcome bonus wizard and respect the search filters.
assert.match(run('home()'),/chooseSimpleGoal\('bonus'\)/);
assert.doesNotMatch(run('home()'),/chooseSimpleGoal\('cashBonus'\)/);
run("chooseSimpleGoal('bonus');chooseSimplePath('business');data.profile.reduceMotion=true");
assert.match(run('simpleWizard()'),/value="cashBonus" selected>Highest cash welcome bonus/);
assert.match(run('simpleWizard()'),/value="pointsBonus">Highest point bonus/);
const fields={simpleSpend:{value:'10000plus'},simpleFee:{value:'any'},simpleBonusRank:{value:'cashBonus'}};
context.document.getElementById=id=>fields[id]||element;
run('finishSimpleSearch()');
assert.equal(run('data.profile.refineRank'),'cashBonus');
assert.match(run('refinementPanelHTML()'),/value="cashBonus" selected/);
const cashBonuses=run('refinementCandidates().map(({offer})=>({id:offer.id,bonus:offer.bonus,unit:offer.unit,spend:offer.spend,type:offer.type}))');
assert.equal(cashBonuses[0].id,7204,'Spark Cash Plus must rank first among business cash offers at the widest limits');
assert(cashBonuses.every(({unit,type})=>unit==='cash'&&type==='Business'));
assert(cashBonuses.every((offer,i)=>i===0||cashBonuses[i-1].bonus>=offer.bonus));
run("data.profile.subSpendPref='10000';data.profile.feePref='0'");
const limitedCashBonuses=run('refinementCandidates()');
assert(limitedCashBonuses.length>0);
assert(limitedCashBonuses.every(({offer})=>offer.spend<=10000&&offer.af===0));
assert.equal(run("fixedCashWelcomeBonus(data.offers.find(o=>o.id===8112))"),0,'Separate statement credits must not enter the cash ranking');
assert.equal(run("fixedCashWelcomeBonus(data.offers.find(o=>o.id===8816))"),0,'Restricted Bilt Cash must not enter the cash ranking');
assert.equal(run("fixedCashWelcomeBonus({unit:'cash / UR',bonus:200})"),200,'Advertised fixed cash remains cash when the issuer also allows points');

fields.simpleBonusRank.value='pointsBonus';
run('finishSimpleSearch()');
assert.equal(run('data.profile.refineRank'),'pointsBonus');
assert.match(run('apply()'),/Ranked by the number of points or miles/);
run('simpleGo(2)');
assert.match(run('simpleWizard()'),/value="pointsBonus" selected/);
const pointBonuses=run('refinementCandidates().map(({offer})=>({id:offer.id,bonus:pointsWelcomeBonus(offer),type:offer.type}))');
assert(pointBonuses.length>0);
assert(pointBonuses.every(({bonus,type})=>bonus>0&&type==='Business'));
assert(pointBonuses.every((offer,i)=>i===0||pointBonuses[i-1].bonus>=offer.bonus));
assert(pointBonuses.some(({id})=>id===7010),'Include miles from airline currencies without a redemption valuation');
assert(!pointBonuses.some(({id})=>id===7204),'Exclude fixed cash from the points ranking');
assert.equal(run("pointsWelcomeBonus({unit:'Free Night Awards',bonus:4,bonusIsCertificate:true})"),0);
assert.equal(run("pointsWelcomeBonus({unit:'OneKeyCash',bonus:250,bonusRestricted:true})"),0);
assert.equal(run("pointsWelcomeBonus({unit:'Avios',bonus:75000})"),75000);
assert.equal(run("pointsWelcomeBonus(data.offers.find(o=>o.id===7201))"),150000,'Use the bonus tied to the displayed spend tier');
run("chooseSimpleGoal('travel');chooseSimplePath('personal')");
assert.doesNotMatch(run('simpleWizard()'),/id="simpleBonusRank"/);

const fullReview=JSON.parse(fs.readFileSync(new URL('../staging/offer-review-118.json',import.meta.url),'utf8'));
assert.equal(fullReview.records.length,118);
assert.equal(new Set(fullReview.records.map(c=>c.id)).size,118);
assert.equal(fullReview.records.filter(c=>c.status==='confirmed').length,fullReview.confirmedCount);
for(const record of fullReview.records){
  const card=context.reviewedCatalog.find(c=>c.id===record.id);
  assert(record.evidence.sourceUrl);
  // Business Altitude Connect was verified after the archived review.
  if(card&&card.id!==7504)assert.equal(card.verified,record.status==='confirmed');
}
context.fetch=async()=>({ok:true,json:async()=>({cards:context.reviewedCatalog})});
await run('loadCatalog()');
run("data.profile.cardPath='either';data.profile.marketPath='either'");
const usb=run("marketOffers().filter(card=>card.issuer==='U.S. Bank')");
assert.equal(usb.length,13,'Browse must include the complete public U.S. Bank lineup');
assert.equal(usb.filter(card=>card.type==='Business').length,5);
const secured=usb.filter(card=>/secured/i.test(card.name));
assert.equal(secured.length,3,'The loaded catalog must retain the secured cards');
assert(secured.every(card=>card.issuerUrlVerified&&card.bonus===0));
assert.equal(run('recommendationPool().some(({offer})=>isSecuredOffer(offer))'),false);
const connect=usb.find(card=>card.id===7504);
assert.equal(connect.name,'Business Altitude Connect','Reuse the archived product identity');
assert.equal(connect.verified,true);
assert.equal(connect.firstYearAnnualFee,0);
assert.equal(connect.af,95);
console.log('Ranking and relationship regression checks passed.');
