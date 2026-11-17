import fs from 'node:fs';
import {offerDataQuality} from './offer-quality.mjs';

export function releaseAudit(catalog,now=new Date()){
  const active=(catalog.cards||[]).filter(c=>c.status!=='closed-new');
  const blockers=[];
  for(const c of active){
    const issues=[...offerDataQuality(c).issues];
    if(!c.issuerUrl)issues.push('No issuer monitoring source');
    if(c.issuerUrl && !c.issuerUrlVerified)issues.push('Product-specific monitoring source not confirmed');
    const verified=Date.parse((c.verifiedDate||'')+'T00:00:00Z');
    if(!Number.isFinite(verified)||now.getTime()-verified>14*86400000)issues.push('Offer needs a successful check or manual official-source review within 14 days');
    if(Number(c.bonus)>0 && Number(c.spend)>0 && !c.spendPeriod)issues.push('Spending deadline is missing');
    if(issues.length)blockers.push({id:c.id,name:c.name,issuer:c.issuer,issues:[...new Set(issues)],source:c.issuerUrl||null});
  }
  return {catalogVersion:catalog.catalogVersion,checkedAt:now.toISOString(),releaseReady:blockers.length===0,
    totalCards:catalog.cards?.length||0,activeCards:active.length,
    sourceCoverage:active.filter(c=>c.issuerUrl).length,
    confirmedSourceCoverage:active.filter(c=>c.issuerUrlVerified).length,
    unresolvedOffers:active.filter(c=>offerDataQuality(c).needsReview).length,blockers};
}

if(process.argv[1]?.endsWith('release-audit.mjs')){
  const catalog=JSON.parse(fs.readFileSync(process.argv[2]||'staging/cards.json','utf8'));
  const report=releaseAudit(catalog);
  fs.writeFileSync(process.argv[3]||'release-audit.json',JSON.stringify(report,null,2)+'\n');
  console.log(`Release ${report.releaseReady?'READY':'BLOCKED'}: ${report.blockers.length} card records need review; monitoring ${report.sourceCoverage}/${report.activeCards}.`);
  if(!report.releaseReady && !process.argv.includes('--report-only'))process.exitCode=1;
}
