import fs from 'fs';

const catalogPath=process.argv[2]||'cards.json';
const reportPath=process.argv[3]||'offer-report.json';
const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const today=new Date().toISOString().slice(0,10);
const byId=new Map((report.results||[]).map(r=>[String(r.id),r]));
const updates=[];
const reviews=[];
const catalogBefore=JSON.stringify(catalog);
if(!Number.isFinite(Date.parse(report.checkedAt)) || Date.parse(report.checkedAt)>Date.now()+5*60*1000 || Date.now()-Date.parse(report.checkedAt)>24*60*60*1000 || report.catalogVersion!==catalog.catalogVersion) throw new Error('Offer report is stale or belongs to another catalog.');

function money(n){return Number(n).toLocaleString('en-US');}
function expectedTerms(card){
  const terms=[];
  if(Number(card.bonus||0)>0) terms.push(money(card.bonus));
  if(Number(card.spend||0)>0) terms.push(money(card.spend));
  if(card.spendPeriod) terms.push(card.spendPeriod);
  if(Number(card.af||0)===0) terms.push('no annual fee'); else if(card.af!=null) terms.push(String(card.af));
  return terms;
}

for(const card of catalog.cards||[]){
  const r=byId.get(String(card.id));
  if(!r||!card.issuerUrl){reviews.push({id:card.id,issuer:card.issuer,name:card.name,reason:'Issuer monitoring source is missing; offer needs source review.'});continue;}
  const d=r.detectedOffer;
  if(r.status==='verified' && r.url===card.issuerUrl && d?.confidence==='high' && !d.changed){
    card.verified=true;
    card.verifiedDate=today;
    card.lastSuccessfulCheck=report.checkedAt;
    delete card.reviewReason;
    delete card.reviewOpenedDate;
    continue;
  }
  if(!d?.changed){if(r.status!=='verified')reviews.push({id:card.id,issuer:card.issuer,name:card.name,reason:(r.issues||[]).join('; ')||'Issuer offer could not be reconfirmed.'});continue;}
  const direct=!!card.issuerUrlVerified;
  const safe=d.confidence==='high' && d.spendPeriod && Number.isFinite(d.bonus) && Number.isFinite(d.spend) && d.bonus>0 && d.spend>0 && Number.isFinite(d.af) && direct && r.url===card.issuerUrl && r.httpStatus===200 && !/up to|targeted|personalized/i.test(String(card.offerType||'')+' '+String(card.offerState||''));
  if(!safe){ reviews.push({id:card.id,issuer:card.issuer,name:card.name,reason:'Detected change did not meet strict auto-update rules',detectedOffer:d}); continue; }
  // Do not auto-update tiered/multi-part or zero-offer structures.
  if(['up-to','qualifying-activities','personalized'].includes(card.offerRequirementType) || /statement credit|certificate|free night|\+ credit/i.test(card.unit||'') || (card.offerExpires && card.offerExpires<today) || Number(card.bonus||0)===0){ reviews.push({id:card.id,issuer:card.issuer,name:card.name,reason:'Complex offer structure requires review',detectedOffer:d}); continue; }
  const before={bonus:card.bonus,spend:card.spend,spendPeriod:card.spendPeriod,af:card.af};
  card.lastKnownOffer={...before,verifiedDate:card.verifiedDate,source:card.issuerUrl};
  card.bonus=d.bonus;
  card.spend=d.spend;
  card.spendPeriod=d.spendPeriod;
  delete card.reviewReason;
  delete card.reviewOpenedDate;
  if(d.af!=null) card.af=d.af;
  card.verified=true;
  card.verifiedDate=today;
  card.offerState='verified-current';
  card.confidence='high';
  card.monitorExpected=expectedTerms(card);
  card.offerNote=`Automatically verified on the issuer product page ${today}. Current public offer: ${money(card.bonus)} ${card.unit||'reward'} after ${money(card.spend)} in qualifying spend within ${card.spendPeriod}.${card.af===0?' No annual fee.':` Annual fee: $${money(card.af)}.`} Offers can vary by channel and change over time.`;
  updates.push({id:card.id,issuer:card.issuer,name:card.name,before,after:{bonus:card.bonus,spend:card.spend,af:card.af}});
}

if(JSON.stringify(catalog)!==catalogBefore){
  const stamp=new Date().toISOString();
  catalog.generatedAt=stamp;
  const base=today.replaceAll('-','');
  const old=String(catalog.catalogVersion||'');
  const suffix=(old.startsWith(today)?Number(old.split('.').pop()||0)+1:1);
  catalog.catalogVersion=`${today}.${suffix}`;
  fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
}
const out={checkedAt:report.checkedAt,autoUpdated:updates.length,needsHumanReview:reviews.length,updates,reviews};
fs.writeFileSync('auto-update-report.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
