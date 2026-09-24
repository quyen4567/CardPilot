import fs from 'fs';

const catalogPath = process.argv[2] || 'cards.json';
const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const cards = Array.isArray(payload.cards) ? payload.cards : [];
const monitorCards = cards.filter(c => c.offerMonitor?.mode === 'tokens' && c.issuerUrl && (c.issuerUrlKind === 'product' || c.offerMonitor?.allowDirectory));

function htmlToText(s='') {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&quot;/gi,'"')
    .replace(/&#36;/gi,'$')
    .replace(/\s+/g,' ');
}

function canonical(s='') {
  return htmlToText(String(s))
    .toLowerCase()
    .replace(/[®™℠†‡*]/g,' ')
    .replace(/\b(?:usd|u\.s\. dollars?)\b/g,' ')
    .replace(/\$/g,'')
    .replace(/,/g,'')
    .replace(/[–—−]/g,'-')
    .replace(/[^a-z0-9%+.-]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function numericKVariants(token) {
  const raw = canonical(token);
  const out = new Set([raw]);
  const exact = raw.match(/^([0-9]+)$/);
  if (exact) {
    const n = Number(exact[1]);
    if (n >= 1000 && n % 1000 === 0) out.add(`${n/1000}k`);
  }
  const km = raw.match(/^([0-9]+(?:\.[0-9]+)?)k$/);
  if (km) out.add(String(Math.round(Number(km[1]) * 1000)));
  return [...out];
}

function tokenVariants(token) {
  const raw = canonical(token);
  const variants = new Set(numericKVariants(token));

  // Common issuer wording equivalences.
  if (/\b90 day\b|\b90 days\b/.test(raw)) {
    variants.add('90 day'); variants.add('90 days'); variants.add('3 month'); variants.add('3 months'); variants.add('three month'); variants.add('three months');
  }
  if (/\b3 month\b|\b3 months\b/.test(raw)) {
    variants.add('3 month'); variants.add('3 months'); variants.add('90 day'); variants.add('90 days'); variants.add('three month'); variants.add('three months');
  }
  if (/\b6 month\b|\b6 months\b/.test(raw)) {
    variants.add('6 month'); variants.add('6 months'); variants.add('180 day'); variants.add('180 days'); variants.add('six month'); variants.add('six months');
  }
  if (/\b180 day\b|\b180 days\b/.test(raw)) {
    variants.add('180 day'); variants.add('180 days'); variants.add('6 month'); variants.add('6 months'); variants.add('six month'); variants.add('six months');
  }
  if (raw.includes('no annual fee') || raw.includes('0 annual fee') || raw.includes('annual fee 0')) {
    variants.add('no annual fee'); variants.add('0 annual fee'); variants.add('annual fee 0'); variants.add('annual fee 0.00');
  }
  if (raw.includes('no minimum spend')) {
    variants.add('no minimum spend'); variants.add('no spend required'); variants.add('no minimum spending requirement');
  }
  return [...variants].filter(Boolean);
}

function containsVariant(pageText, token) {
  const text = canonical(pageText);
  const variants = tokenVariants(token);
  for (const v of variants) {
    if (text.includes(v)) return {found:true,matched:v,variants};
  }
  return {found:false,matched:null,variants};
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
      'user-agent':'Mozilla/5.0 (compatible; CardPilot-OfferCheck/0.2; +https://github.com/)',
      'accept':'text/html,application/xhtml+xml,*/*;q=0.8'
    }});
    if([401,403,405,406,409,418,429].includes(res.status)) return {state:'warning',reason:'Issuer may block automated offer checks',status:res.status};
    if(res.status===404||res.status===410) return {state:'broken',reason:'Product page not found',status:res.status};
    if(res.status<200||res.status>=400) return {state:'warning',reason:`Unexpected HTTP ${res.status}`,status:res.status};
    const html=await res.text();
    const tokens=(card.offerMonitor.tokens||[]).map(String);
    const checks=tokens.map(t=>({token:t,...containsVariant(html,t)}));
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
  '# CardPilot offer monitoring','',
  `Catalog: ${report.catalogVersion || 'unknown'}`,
  `Cards configured for automated offer-term checks: ${report.configuredOfferMonitors}`,
  `Matched: ${report.matches} · Needs review: ${report.needsReview} · Warnings: ${report.warnings} · Broken: ${report.broken}`,
  `Records older than 30 days since verification: ${report.staleVerifiedRecordsOver30Days}`,'',
  '> The checker normalizes common issuer wording differences (for example $1,000 vs 1,000; 30K vs 30,000; 90 days vs 3 months; and $0 annual fee vs no annual fee). A change is still flagged for human review; CardPilot never automatically publishes new financial terms.',''
];
for(const r of results){
  lines.push(`- ${icon[r.state]} **${r.name}** (${r.issuer}) — ${r.reason}${r.missing?.length?` · Missing expected terms: ${r.missing.join(', ')}`:''}${r.ageDays!=null?` · Last verified ${r.ageDays} day(s) ago`:''}`);
}
if(stale.length){
  lines.push('','## Verification-age queue');
  for(const r of stale.slice(0,40)) lines.push(`- ⏱️ ${r.name} (${r.issuer}) — ${r.ageDays} days since verification`);
  if(stale.length>40) lines.push(`- …and ${stale.length-40} more`);
}
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
// Offer mismatches are review items, not workflow failures.
