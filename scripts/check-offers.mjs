import fs from 'fs';

const catalogPath = process.argv[2] || 'cards.json';
const reportPath = process.argv[3] || 'offer-report.json';
const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const cards = Array.isArray(payload.cards) ? payload.cards : [];
const now = new Date();

function ageDays(dateStr){
  if(!dateStr) return Infinity;
  const d = new Date(dateStr + 'T00:00:00Z');
  if(Number.isNaN(d.getTime())) return Infinity;
  return Math.floor((now - d) / 86400000);
}
function htmlToText(s){
  return String(s||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&#39;/g,"'")
    .replace(/&quot;/gi,'"')
    .replace(/\s+/g,' ')
    .trim();
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
function unitKind(c){
  const u=String(c.unit||'').toLowerCase();
  return u.includes('cash') || u.includes('$') ? 'cash' : 'points';
}
function parseNum(x){ return Number(String(x).replace(/[$,\s]/g,'')); }
function extractOffer(text,c){
  const t=String(text||'').replace(/\s+/g,' ');
  const candidates=[];
  const kind=unitKind(c);
  const patterns = kind==='cash' ? [
    /(?:earn|get|receive)\s+(?:a\s+)?\$?([0-9][0-9,]{1,6})\s+(?:cash back|statement credit|bonus)[^.!?]{0,180}?(?:after|when)\s+(?:you\s+)?(?:spend|make)\s+\$?([0-9][0-9,]{2,7})/ig,
    /\$?([0-9][0-9,]{1,6})\s+(?:cash back|statement credit|bonus)[^.!?]{0,180}?\$?([0-9][0-9,]{2,7})\s+(?:in purchases|on purchases|spend)/ig
  ] : [
    /(?:earn|get|receive)\s+(?:up to\s+)?([0-9][0-9,]{3,7})\s+(?:bonus\s+)?(?:points|miles)[^.!?]{0,220}?(?:after|when)\s+(?:you\s+)?(?:spend|make)\s+\$?([0-9][0-9,]{2,7})/ig,
    /([0-9][0-9,]{3,7})\s+(?:bonus\s+)?(?:points|miles)[^.!?]{0,220}?\$?([0-9][0-9,]{2,7})\s+(?:in purchases|on purchases|spend)/ig
  ];
  for(const re of patterns){
    for(const m of t.matchAll(re)){
      const bonus=parseNum(m[1]), spend=parseNum(m[2]);
      const snippet=m[0].slice(0,320);
      if(!Number.isFinite(bonus)||!Number.isFinite(spend)||bonus<=0||spend<=0) continue;
      if(/\b(up to|additional|plus another|each year|anniversary)\b/i.test(snippet)) continue;
      if(kind==='cash' && bonus>5000) continue;
      if(kind==='points' && bonus<5000) continue;
      candidates.push({bonus,spend,snippet});
    }
  }
  const uniq=[];
  const seen=new Set();
  for(const x of candidates){ const k=`${x.bonus}:${x.spend}`; if(!seen.has(k)){seen.add(k);uniq.push(x);} }
  const afMatches=[...t.matchAll(/(?:annual fee(?:\s+is|:)?|\$)(?:\s*)\$?([0-9]{1,4})\s*(?:annual fee|per year|a year)?/ig)]
    .map(m=>parseNum(m[1])).filter(x=>Number.isFinite(x)&&x>=0&&x<=1500);
  if(/no annual fee/i.test(t)) afMatches.push(0);
  const afUniq=[...new Set(afMatches)];
  if(uniq.length!==1) return {confidence:'review',reason:`Detected ${uniq.length} unique bonus/spend pairs`,candidates:uniq.slice(0,6)};
  const x=uniq[0];
  const af = afUniq.includes(Number(c.af)) ? Number(c.af) : (afUniq.length===1 ? afUniq[0] : null);
  const currentName=normalize(c.name).split(' ').filter(w=>w.length>3).slice(0,3);
  const pageNorm=normalize(t.slice(0,30000));
  const nameSignal=currentName.length===0 || currentName.some(w=>pageNorm.includes(w));
  const changed=x.bonus!==Number(c.bonus||0) || x.spend!==Number(c.spend||0) || (af!=null && af!==Number(c.af||0));
  const safe = nameSignal && !/\b(up to|targeted|preselected|pre-selected|mail offer|invitation only)\b/i.test(x.snippet);
  return {confidence:safe?'high':'review',changed,bonus:x.bonus,spend:x.spend,af,snippet:x.snippet,reason:safe?'Unique direct offer pattern detected':'Offer pattern requires review'};
}

async function fetchCard(c){
  const localIssues=localQuality(c);
  if(!c.issuerUrl){
    return {id:c.id,issuer:c.issuer,name:c.name,status:localIssues.length?'needs_review':'unmonitored',source:'catalog-only',issues:localIssues,checkedAt:now.toISOString()};
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const res=await fetch(c.issuerUrl,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 CardPilotOfferMonitor/2.0'}});
    const body=await res.text();
    if([401,403,406,429].includes(res.status)) return {id:c.id,issuer:c.issuer,name:c.name,status:'blocked_by_issuer',httpStatus:res.status,url:c.issuerUrl,issues:localIssues,checkedAt:now.toISOString()};
    if(res.status<200||res.status>=400) return {id:c.id,issuer:c.issuer,name:c.name,status:'broken',httpStatus:res.status,url:c.issuerUrl,issues:[...localIssues,`HTTP ${res.status}`],checkedAt:now.toISOString()};
    const expected=Array.isArray(c.monitorExpected)?c.monitorExpected:[];
    const missing=expected.filter(t=>!termFound(body,t));
    const detectedOffer=extractOffer(htmlToText(body),c);
    const issues=[...localIssues,...missing.map(t=>`Issuer page loaded, but expected offer wording was not fully extracted: ${t}`)];
    const status=issues.length?'needs_review':'verified';
    return {id:c.id,issuer:c.issuer,name:c.name,status,httpStatus:res.status,url:c.issuerUrl,finalUrl:res.url,source:c.issuerUrlVerified?'direct-product-page':'issuer-page',expectedTerms:expected,missingTerms:missing,issues,detectedOffer,checkedAt:now.toISOString()};
  }catch(error){
    const msg=String(error);
    const blocked=/abort|timeout/i.test(msg);
    return {id:c.id,issuer:c.issuer,name:c.name,status:blocked?'blocked_by_issuer':'broken',url:c.issuerUrl,issues:[...localIssues,msg],checkedAt:now.toISOString()};
  }finally{clearTimeout(timer)}
}

const monitored=cards.filter(c=>c.issuerUrl);
const unmonitored=cards.filter(c=>!c.issuerUrl).map(c=>({id:c.id,issuer:c.issuer,name:c.name,status:'unmonitored',source:'catalog-only',issues:localQuality(c),checkedAt:now.toISOString()}));
const results=[];
for(let i=0;i<monitored.length;i+=5) results.push(...await Promise.all(monitored.slice(i,i+5).map(fetchCard)));
results.push(...unmonitored);
const counts={verified:0,needs_review:0,blocked_by_issuer:0,broken:0,unmonitored:0};
for(const r of results) counts[r.status]=(counts[r.status]||0)+1;
const changeCandidates=results.filter(r=>r.detectedOffer?.changed).map(r=>({id:r.id,issuer:r.issuer,name:r.name,status:r.status,url:r.url,detectedOffer:r.detectedOffer}));
const report={catalogVersion:payload.catalogVersion||null,checkedAt:now.toISOString(),counts,monitoredCards:monitored.length,totalCards:cards.length,changeCandidates,results};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
const lines=['# CardPilot offer monitoring','',`Catalog: ${report.catalogVersion||'unknown'}`,`Monitored issuer pages: ${monitored.length}/${cards.length}`,`Verified: ${counts.verified}`,`Needs review: ${counts.needs_review}`,`Blocked by issuer: ${counts.blocked_by_issuer}`,`Broken: ${counts.broken}`,`Unmonitored: ${counts.unmonitored}`,`Detected offer changes: ${changeCandidates.length}`,''];
for(const r of results.filter(x=>['needs_review','blocked_by_issuer','broken'].includes(x.status))) lines.push(`- ${r.status==='needs_review'?'🔎':r.status==='blocked_by_issuer'?'⚠️':'❌'} **${r.issuer} — ${r.name}**: ${r.status}${r.issues?.length?` — ${r.issues.join('; ')}`:''}`);
if(changeCandidates.length){ lines.push('','## Detected offer changes'); for(const c of changeCandidates) lines.push(`- ${c.detectedOffer.confidence==='high'?'✅':'🔎'} **${c.issuer} — ${c.name}**: ${c.detectedOffer.bonus} / spend ${c.detectedOffer.spend}${c.detectedOffer.af!=null?` / AF ${c.detectedOffer.af}`:''} (${c.detectedOffer.confidence})`); }
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
if(counts.broken) process.exitCode=1;
