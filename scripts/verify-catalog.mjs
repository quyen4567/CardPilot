import fs from 'fs';
const p=process.argv[2]||'cards.json';
const payload=JSON.parse(fs.readFileSync(p,'utf8'));
if(!Array.isArray(payload.cards)) throw new Error('cards.json must contain cards[]');
const ids=new Set();
const errors=[];
const warnings=[];
for(const c of payload.cards){
  if(c.id==null) errors.push('Card missing id: '+JSON.stringify(c));
  else if(ids.has(c.id)) errors.push('Duplicate id '+c.id); else ids.add(c.id);
  if(!c.issuer) errors.push(`Card ${c.id} missing issuer`);
  if(!c.name) errors.push(`Card ${c.id} missing name`);
  if(!['Personal','Business'].includes(c.type)) errors.push(`Card ${c.id} invalid type ${c.type}`);
  if(c.af!=null && !Number.isFinite(Number(c.af))) errors.push(`Card ${c.id} invalid annual fee`);
  if(c.issuerUrl){try{new URL(c.issuerUrl)}catch{errors.push(`Card ${c.id} invalid issuerUrl`)}}
  if(c.verified && !c.verifiedDate) warnings.push(`Card ${c.id} ${c.name}: verified=true but verifiedDate is missing`);
  if(c.verified && /verify current offer/i.test(String(c.offerNote||''))) warnings.push(`Card ${c.id} ${c.name}: verified=true conflicts with offerNote "Verify current offer"`);
  if(Number(c.bonus||0)>0 && c.spend==null && !['qualifying-activities','personalized','up-to'].includes(c.offerRequirementType)) warnings.push(`Card ${c.id} ${c.name}: bonus present but minimum spend is missing`);
  if(c.monitorExpected && !c.issuerUrl) warnings.push(`Card ${c.id} ${c.name}: monitorExpected is configured without issuerUrl`);
}
if(warnings.length){
  console.warn('Catalog warnings:\n'+warnings.join('\n'));
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Catalog warnings\n\n'+warnings.map(x=>'- ⚠️ '+x).join('\n')+'\n');
}
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Catalog OK: ${payload.cards.length} cards, version ${payload.catalogVersion||'unknown'}; warnings ${warnings.length}`);
