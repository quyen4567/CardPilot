import fs from 'fs';

const catalogPath = process.argv[2] || 'cards.json';
const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const cards = Array.isArray(payload.cards) ? payload.cards : [];
const monitorCards = cards.filter(c => c.offerMonitor?.mode === 'tokens' && c.issuerUrlKind === 'product' && c.issuerUrl);

function normalize(s='') {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&#39;/g,"'")
    .replace(/&quot;/g,'"')
    .replace(/\s+/g,' ')
    .toLowerCase();
}
function ageDays(dateStr){
  if(!dateStr) return null;
  const d=new Date(dateStr+'T00:00:00Z');
  if(Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now()-d.getTime())/86400000);
}

async function fetchPage(card){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const res=await fetch(card.issuerUrl,{redirect:'follow',signal:controller.signal,headers:{
      'user-agent':'Mozilla/5.0 (compatible; CardPilot-OfferCheck/0.1; +https://github.com/)',
      'accept':'text/html,application/xhtml+xml,*/*;q=0.8'
    }});
    if([401,403,405,406,409,418,429].includes(res.status)) return {state:'warning',reason:'Issuer may block automated offer checks',status:res.status};
    if(res.status===404||res.status===410) return {state:'broken',reason:'Product page not found',status:res.status};
    if(res.status<200||res.status>=400) return {state:'warning',reason:`Unexpected HTTP ${res.status}`,status:res.status};
    const html=await res.text();
    const text=normalize(html);
    const tokens=(card.offerMonitor.tokens||[]).map(String);
    const checks=tokens.map(t=>({token:t,found:text.includes(normalize(t))}));
    const missing=checks.filter(x=>!x.found).map(x=>x.token);
    return {state:missing.length?'review':'match',reason:missing.length?'Expected offer terms not all found on issuer page':'Expected offer terms found',status:res.status,missing,checks,finalUrl:res.url};
  }catch(error){
    return {state:'warning',reason:'Unable to verify automatically',status:null,error:String(error)};
  }finally{clearTimeout(timer)}
}

const results=[];
for(const card of monitorCards){
  const r=await fetchPage(card);
  results.push({id:card.id,issuer:card.issuer,name:card.name,url:card.issuerUrl,verifiedDate:card.verifiedDate||null,ageDays:ageDays(card.verifiedDate),tier:card.monitoringTier||'standard',...r,checkedAt:new Date().toISOString()});
}

const stale=cards.filter(c=>c.verifiedDate && ageDays(c.verifiedDate)>30).map(c=>({id:c.id,issuer:c.issuer,name:c.name,verifiedDate:c.verifiedDate,ageDays:ageDays(c.verifiedDate),tier:c.monitoringTier||'standard'}));
const report={catalogVersion:payload.catalogVersion||null,checkedAt:new Date().toISOString(),configuredOfferMonitors:monitorCards.length,matches:results.filter(r=>r.state==='match').length,needsReview:results.filter(r=>r.state==='review').length,warnings:results.filter(r=>r.state==='warning').length,broken:results.filter(r=>r.state==='broken').length,staleVerifiedRecordsOver30Days:stale.length,results,stale};
fs.writeFileSync('offer-report.json',JSON.stringify(report,null,2));

const icon={match:'✅',review:'🔎',warning:'⚠️',broken:'❌'};
const lines=[
  '# CardPilot offer-monitoring foundation','',
  `Catalog: ${report.catalogVersion || 'unknown'}`,
  `Cards configured for automated offer-term checks: ${report.configuredOfferMonitors}`,
  `Matched: ${report.matches} · Needs review: ${report.needsReview} · Warnings: ${report.warnings} · Broken: ${report.broken}`,
  `Records older than 30 days since verification: ${report.staleVerifiedRecordsOver30Days}`,'',
  '> Offer checks are conservative. A change is flagged for human review; CardPilot does not automatically publish a new bonus, fee, or spending requirement.',''
];
for(const r of results){
  lines.push(`- ${icon[r.state]} **${r.name}** — ${r.reason}${r.missing?.length?` · Missing expected text: ${r.missing.join(', ')}`:''}${r.ageDays!=null?` · Last verified ${r.ageDays} day(s) ago`:''}`);
}
if(stale.length){
  lines.push('','## Verification-age queue');
  for(const r of stale.slice(0,40)) lines.push(`- ⏱️ ${r.name} (${r.issuer}) — ${r.ageDays} days since verification`);
  if(stale.length>40) lines.push(`- …and ${stale.length-40} more`);
}
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
// Never fail merely because terms changed; changes require review.
