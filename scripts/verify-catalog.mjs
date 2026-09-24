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
  if(c.issuerUrl){ try{ new URL(c.issuerUrl); } catch{ errors.push(`Card ${c.id} invalid issuerUrl`); } }
  else warnings.push(`Card ${c.id} ${c.name} has no official URL`);
  if(c.issuerUrlKind && !['product','issuer-directory','missing','unknown'].includes(c.issuerUrlKind)) errors.push(`Card ${c.id} invalid issuerUrlKind ${c.issuerUrlKind}`);
  if(c.monitoringTier && !['core','secondary','specialty','standard'].includes(c.monitoringTier)) errors.push(`Card ${c.id} invalid monitoringTier ${c.monitoringTier}`);
  if(c.offerMonitor?.mode && c.offerMonitor.mode!=='tokens') errors.push(`Card ${c.id} unsupported offerMonitor mode ${c.offerMonitor.mode}`);
  if(c.offerMonitor?.allowDirectory && c.issuerUrlKind!=='issuer-directory') warnings.push(`Card ${c.id} allowDirectory is set but issuerUrlKind is ${c.issuerUrlKind}`);
}
if(warnings.length) console.warn(warnings.join('\n'));
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
const withUrl=payload.cards.filter(c=>c.issuerUrl).length;
const monitored=payload.cards.filter(c=>c.offerMonitor?.mode==='tokens').length;
console.log(`Catalog OK: ${payload.cards.length} cards, version ${payload.catalogVersion||'unknown'}, official URL coverage ${withUrl}/${payload.cards.length}, offer monitors ${monitored}`);
