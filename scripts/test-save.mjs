import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const script=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0].replace(/bootstrap\(\);\s*$/,'');
let persisted=null,failStorage=false,alerts=0;
function boot(){
 const button={dataset:{saveCard:'8406'},setAttribute(k,v){this[k]=v;},textContent:'Save for later'};
 const nav={textContent:'Saved'},element={classList:{add(){},remove(){},toggle(){}},innerHTML:''};
 const context=vm.createContext({console:{log(){},error(){},warn(){}},Date,Intl,URL,Set,Map,JSON,Math,Number,String,Array,Object,
 document:{documentElement:element,querySelectorAll:selector=>selector==='[data-save-card]'?[button]:selector==='[data-saved-nav]'?[nav]:[],querySelector:()=>element,getElementById:()=>null,createElement:()=>({setAttribute(){},remove(){}}),body:{appendChild(){}}},
 localStorage:{getItem:()=>persisted,setItem(_,value){if(failStorage)throw Error('Storage denied');persisted=value;}},window:{matchMedia:()=>({matches:false})},alert(){alerts++;},setTimeout(){return 1;},clearTimeout(){}});
 vm.runInContext(script,context);vm.runInContext("savedCardsPage=()=>'';morePage=()=>'';data.cards=[{id:'wallet-fixture',name:'Retained wallet card'}]",context);
 return {context,button,nav,run:code=>vm.runInContext(code,context)};
}
let app=boot();
assert.equal(app.run('toggleSavedCard(8406,{})'),true,'A browser without element.animate must save successfully');
assert.deepEqual(JSON.parse(persisted).savedCardIds,['8406']);assert.equal(app.nav.textContent,'Saved (1)');assert.equal(app.button.textContent,'Saved ✓');
app=boot();assert.equal(app.run('isCardSaved(8406)'),true,'A saved card must survive reload');assert.equal(app.run('data.cards[0].name'),'Retained wallet card');
assert.equal(app.run('toggleSavedCard(8406,{})'),true);assert.deepEqual(JSON.parse(persisted).savedCardIds,[]);
assert.equal(app.run('toggleSavedCard(8406,{animate(){throw Error("Animation unavailable")}})'),true,'Animation failures must not block persistence');
assert.deepEqual(JSON.parse(persisted).savedCardIds,['8406']);
app.run('savedMotion=()=>{throw Error("Visual feedback unavailable")}');assert.equal(app.run('toggleSavedCard(8501,{})'),true,'A feedback failure must not undo a successful save');assert.deepEqual(JSON.parse(persisted).savedCardIds,['8406','8501']);
failStorage=true;const before=persisted;assert.equal(app.run('toggleSavedCard(8001,{})'),false);assert.equal(persisted,before);assert.equal(app.run('isCardSaved(8001)'),false);assert.equal(alerts,1,'Storage failure must be visible rather than falsely reporting success');
console.log('Save regression checks passed: unavailable/failed animation, reload, unsave, wallet retention, storage failure.');
