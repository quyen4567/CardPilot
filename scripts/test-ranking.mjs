import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../staging/index.html',import.meta.url),'utf8');
const script=html.split('<script>')[1].split('</script>')[0].replace(/bootstrap\(\);\s*$/,'');
const storage=new Map();
const element={classList:{add(){},remove(){},toggle(){}},addEventListener(){},style:{}};
const context=vm.createContext({console,Date,Intl,URL,Set,Map,JSON,Math,Number,String,Array,Object,
  document:{querySelector:()=>element,querySelectorAll:()=>[],getElementById:()=>element},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  window:{},navigator:{},alert(){},setTimeout,clearTimeout});
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
context.reviewedCatalog=JSON.parse(fs.readFileSync(new URL('../staging/cards.json',import.meta.url),'utf8')).cards;
const review=JSON.parse(fs.readFileSync(new URL('../staging/business-offer-review.json',import.meta.url),'utf8'));
const reviewedAt=Date.parse(review.reviewDate+'T12:00:00Z');
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
console.log('Ranking and relationship regression checks passed.');
