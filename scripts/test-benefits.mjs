import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')
  .split('<script>')[1].split('</script>')[0].replace(/bootstrap\(\);\s*$/,'');
const NativeDate=Date;
let now=new NativeDate(2026,10,26,0,5).getTime();
class TestDate extends NativeDate {
  constructor(...args){super(...(args.length?args:[now]));}
  static now(){return now;}
}

const legacy={
  id:10,name:'Atmos fare & "guest"',kind:'companion',program:'Atmos',
  value:'Keep this <note>',expires:'2027-04-30',extra:'Retained'
};
const expired={...legacy,id:20,name:'Expired fare',expires:'2026-11-25',companionType:'single'};
const fixture={
  id:1,issuer:'Fixture',name:'Atmos companion card',type:'Personal',tags:['airline'],
  bonus:20000,unit:'miles',af:95,spend:1000,spendPeriod:'3 months',verified:true,
  verifiedDate:'2026-11-26',issuerUrl:'https://issuer.example/card',issuerUrlVerified:true,offerState:'verified-current'
};

let persisted=JSON.stringify({
  profile:{interests:['airline'],subInterests:{airline:['companion']},onboardingVersion:'10.8'},
  benefits:[legacy,expired],cards:[],expenses:[],offers:[],savedCardIds:['20']
});
let confirmRemoval=false;
let failStorage=false;
let alerts=0;
function boot(){
  const fields=new Map();
  const element={classList:{add(){},remove(){},toggle(){}},style:{},addEventListener(){}};
  const field=key=>{
    if(!fields.has(key))fields.set(key,{value:'',innerHTML:'',focus(){}});
    return fields.get(key);
  };
  const context=vm.createContext({
    console,Date:TestDate,URL,fixture,window:{},navigator:{},setTimeout,clearTimeout,
    document:{documentElement:element,querySelector:field,querySelectorAll:()=>[],getElementById:()=>element},
    localStorage:{
      getItem:()=>persisted,
      setItem(key,value){assert.equal(key,'cardpilotData');if(failStorage)throw Error('Storage denied');persisted=value;}
    },
    confirm:()=>confirmRemoval,alert:()=>{alerts++;}
  });
  vm.runInContext(script,context);
  const run=expression=>vm.runInContext(expression,context);
  run('render=()=>{}');
  return {run,field};
}
const saved=()=>JSON.parse(persisted);
let app=boot();
const run=expression=>app.run(expression);
const score=()=>run('offerFit(fixture).score');

assert.deepEqual(saved().benefits,[legacy,expired],'Loading must preserve both legacy rows');
assert.equal(run('daysTo("2026-11-25")'),-1,'Yesterday is expired just after local midnight');
assert.equal(run('daysTo("2026-11-26")'),0,'Today has zero calendar days remaining');
assert.equal(run('daysTo("2027-04-30")'),155);
assert(Number.isNaN(run('daysTo("2027-02-30")')));
assert.equal(run('benefitIsActive({expires:""})'),false);
assert.equal(run('activeCompanionBenefits().map(b=>b.id).join()'),'10');
assert.match(run('benefits()'),/type unspecified/);
assert.match(run('benefits()'),/Keep this &lt;note&gt;/);
run('showBenefitForm(0)');
assert.match(app.field('#addBenefitBox').innerHTML,/Atmos fare &amp; &quot;guest&quot;/);

const withLegacy=score();
assert.match(run('offerFit(fixture).cautions.join()'),/155 more days/);
const saveForm=(index,{name,type,program='',note='',expires=''})=>{
  for(const [id,value] of Object.entries({bn:name,bk:type,bp:program,bv:note,be:expires}))app.field('#'+id).value=value;
  run(`saveBenefit(${index})`);
};
saveForm(0,{name:'  Atmos updated  ',type:'single',program:legacy.program,note:legacy.value,expires:legacy.expires});
assert.deepEqual(saved().benefits[0],{...legacy,name:'Atmos updated',companionType:'single'});
assert.equal(score(),withLegacy);
assert.match(run('benefits()'),/Mark redeemed/);

run('toggleBenefitRedemption(0)');
assert.equal(saved().benefits[0].redeemed,true);
assert.equal(run('activeCompanionBenefits().length'),0);
assert.match(run('benefits()'),/Redeemed/);
const withoutOverlap=score();
assert.equal(withoutOverlap-withLegacy,28,'Removing the -16 overlap penalty restores the +12 preference boost');
assert.doesNotMatch(run('offerFit(fixture).cautions.join()'),/155 more days/);
app=boot();
assert.equal(score(),withoutOverlap,'Redemption persists after reload');
assert.deepEqual(saved().savedCardIds,['20']);

saveForm(0,{name:'Atmos updated',type:'single',program:legacy.program,note:'Updated note',expires:'2026-11-26'});
assert.equal(saved().benefits[0].redeemed,true,'Editing a redeemed fare keeps it redeemed');
assert.equal(score(),withoutOverlap);
run('toggleBenefitRedemption(0)');
assert.equal(run('activeCompanionBenefits()[0].id'),10);
assert.equal(score(),withoutOverlap-6,'A fare expiring today gets the existing replacement score');
now=new NativeDate(2026,10,26,23,59).getTime();
assert.equal(run('activeCompanionBenefits().length'),1,'Expiration includes the full local day');
now=new NativeDate(2026,10,27,0,0).getTime();
assert.equal(run('activeCompanionBenefits().length'),0);
assert.equal(score(),withoutOverlap,'An expired fare scores the same as no tracked benefit');

saveForm(null,{name:'Southwest Companion Pass',type:'reusable',program:'Southwest',expires:'2027-12-31'});
assert.equal(run('activeCompanionBenefits()[0].name'),'Southwest Companion Pass');
assert.doesNotMatch(run('benefitRow(data.benefits[2],2)'),/Mark redeemed|Undo redemption/);
run('toggleBenefitRedemption(2)');
assert.equal(run('activeCompanionBenefits().length'),1,'A reusable pass remains active after use');

run('removeBenefit(2)');
assert.equal(saved().benefits.length,3,'Canceling removal preserves the pass');
confirmRemoval=true;
failStorage=true;
run('removeBenefit(2)');
assert.equal(run('activeCompanionBenefits().length'),1,'A storage failure leaves the pass active');
assert.equal(saved().benefits.length,3);
assert.equal(alerts,1);
failStorage=false;
run('removeBenefit(2)');
assert.deepEqual(saved().benefits.map(b=>b.id),[10,20],'Removing a row preserves the other entries');
assert.equal(score(),withoutOverlap);
console.log('Benefit regression checks passed: legacy data, edits, redemption and undo, expiration, reusable passes, removal, storage failure, and scoring.');
