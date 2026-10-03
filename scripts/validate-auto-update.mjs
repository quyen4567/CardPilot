import fs from 'fs';
const path=process.argv[2]||'cards.json';
const p=JSON.parse(fs.readFileSync(path,'utf8'));
const cards=Array.isArray(p.cards)?p.cards:[];
const errs=[];
const ids=new Set();
for(const c of cards){
  if(c.id==null) errs.push('Card missing id');
  else if(ids.has(String(c.id))) errs.push(`Duplicate id ${c.id}`); else ids.add(String(c.id));
  if(!c.name||!c.issuer) errs.push(`Card ${c.id} missing name/issuer`);
  if(/secured/i.test(String(c.name||''))) errs.push(`Secured card present: ${c.name}`);
  for(const k of ['bonus','spend','af']) if(c[k]!=null && (!Number.isFinite(Number(c[k]))||Number(c[k])<0)) errs.push(`Card ${c.id} invalid ${k}`);
  if(c.verified && !c.verifiedDate) errs.push(`Card ${c.id} verified without verifiedDate`);
}
if(cards.length<100) errs.push(`Unexpectedly small catalog: ${cards.length}`);
if(errs.length){ console.error(errs.join('\n')); process.exit(1); }
console.log(`Catalog validation passed: ${cards.length} cards, ${ids.size} unique IDs.`);
