import fs from 'fs';

const catalogPath = process.argv[2] || 'cards.json';
const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const cards = Array.isArray(payload.cards) ? payload.cards : [];
const now = new Date();

function ageDays(dateStr){
  if(!dateStr) return Infinity;
  const d = new Date(dateStr + 'T00:00:00Z');
  if(Number.isNaN(d.getTime())) return Infinity;
  return Math.floor((now - d) / 86400000);
}
function normalize(s){
  return String(s||'')
    .toLowerCase()
    .replace(/\$\s*/g,'')
    .replace(/,/g,'')
    .replace(/\bthousand\b/g,'000')
    .replace(/\b3\s*months?\b/g,'90 days')
    .replace(/\bfirst\s+3\s+months?\b/g,'first 90 days')
    .replace(/\bno\s+annual\s+fee\b/g,'0 annual fee')
    .replace(/\$?0\s+annual\s+fee/g,'0 annual fee')
    .replace(/\b([0-9]+)k\b/g,(_,n)=>String(Number(n)*1000))
    .replace(/\s+/g,' ')
    .trim();
}
function termFound(body,term){
  const b=normalize(body), t=normalize(term);
  if(b.includes(t)) return true;
  // Also accept 90 days / 3 months equivalence in either direction.
  if(t.includes('90 days') && b.includes(t.replace('90 days','3 months'))) return true;
  return false;
}
function localQuality(c){
  const issues=[];
  if(c.verified && /verify current offer/i.test(String(c.offerNote||''))) issues.push('Catalog contradiction: verified=true while offer note says Verify current offer.');
  if(c.verified && !c.verifiedDate) issues.push('Verified offer is missing verifiedDate.');
  if(Number(c.bonus||0)>0 && c.spend==null && !['qualifying-activities','personalized','up-to'].includes(c.offerRequirementType)) issues.push('Bonus is present but spend requirement is missing.');
  if(Number(c.bonus||0)===0 && !['no-standard-public-sub','invitation-waitlist','personalized','historical-only'].includes(c.offerState)) issues.push('No current bonus is stored and no explicit no-offer state is set.');
  const age=ageDays(c.verifiedDate);
  if(age>14 && age!==Infinity) issues.push(`Verification is ${age} days old.`);
  return issues;
}
async function fetchCard(c){
  const localIssues=localQuality(c);
  if(!c.issuerUrl){
    return {id:c.id,issuer:c.issuer,name:c.name,status:localIssues.length?'needs_review':'verified',source:'catalog-only',issues:localIssues,checkedAt:now.toISOString()};
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const res=await fetch(c.issuerUrl,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'CardPilot-OfferMonitor/1.1 (+https://github.com/)'}});
    const body=await res.text();
    if([401,403,406,429].includes(res.status)) return {id:c.id,issuer:c.issuer,name:c.name,status:'blocked_by_issuer',httpStatus:res.status,url:c.issuerUrl,issues:localIssues,checkedAt:now.toISOString()};
    if(res.status<200||res.status>=400) return {id:c.id,issuer:c.issuer,name:c.name,status:'broken',httpStatus:res.status,url:c.issuerUrl,issues:[...localIssues,`HTTP ${res.status}`],checkedAt:now.toISOString()};
    const expected=Array.isArray(c.monitorExpected)?c.monitorExpected:[];
    const missing=expected.filter(t=>!termFound(body,t));
    const issues=[...localIssues,...missing.map(t=>`Missing expected term: ${t}`)];
    const status=issues.length?'needs_review':'verified';
    return {id:c.id,issuer:c.issuer,name:c.name,status,httpStatus:res.status,url:c.issuerUrl,finalUrl:res.url,expectedTerms:expected,missingTerms:missing,issues,checkedAt:now.toISOString()};
  }catch(error){
    const msg=String(error);
    const blocked=/abort|timeout/i.test(msg);
    return {id:c.id,issuer:c.issuer,name:c.name,status:blocked?'blocked_by_issuer':'broken',url:c.issuerUrl,issues:[...localIssues,msg],checkedAt:now.toISOString()};
  }finally{clearTimeout(timer)}
}

const results=[];
for(let i=0;i<cards.length;i+=5){
  results.push(...await Promise.all(cards.slice(i,i+5).map(fetchCard)));
}
const counts={verified:0,needs_review:0,blocked_by_issuer:0,broken:0};
for(const r of results) counts[r.status]=(counts[r.status]||0)+1;
const report={catalogVersion:payload.catalogVersion||null,checkedAt:now.toISOString(),counts,results};
fs.writeFileSync('offer-report.json',JSON.stringify(report,null,2));
const lines=['# CardPilot offer monitoring','',`Catalog: ${report.catalogVersion||'unknown'}`,`Verified: ${counts.verified}`,`Needs review: ${counts.needs_review}`,`Blocked by issuer: ${counts.blocked_by_issuer}`,`Broken: ${counts.broken}`,''];
for(const r of results.filter(x=>x.status!=='verified')) lines.push(`- ${r.status==='needs_review'?'🔎':r.status==='blocked_by_issuer'?'⚠️':'❌'} **${r.issuer} — ${r.name}**: ${r.status}${r.issues?.length?` — ${r.issues.join('; ')}`:''}`);
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
// Missing/unverified data and issuer blocks are warnings, not workflow failures.
// Only genuinely broken configured sources fail the job.
if(counts.broken) process.exitCode=1;
