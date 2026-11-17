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
console.log('Ranking and relationship regression checks passed.');
