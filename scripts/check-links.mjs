import fs from 'fs';

const catalogPath = process.argv[2] || 'cards.json';
const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const cards = Array.isArray(payload.cards) ? payload.cards : [];
const cardsWithUrl = cards.filter(c => c.issuerUrl);

const grouped = new Map();
for (const c of cardsWithUrl) {
  const key = c.issuerUrl;
  if (!grouped.has(key)) grouped.set(key, {url:key, cards:[]});
  grouped.get(key).cards.push({
    id:c.id, issuer:c.issuer, name:c.name,
    kind:c.issuerUrlKind || 'unknown',
    tier:c.monitoringTier || 'standard',
    lastVerified:c.issuerUrlVerified || null
  });
}

function classifyStatus(status, error) {
  if (error) return {state:'warning', reason:'Unable to verify automatically'};
  if (status >= 200 && status < 400) return {state:'ok', reason:'Working'};
  if (status === 404 || status === 410) return {state:'broken', reason:'Page not found'};
  if ([401,403,405,406,409,418,429].includes(status)) return {state:'warning', reason:'Issuer may block automated checks'};
  if (status >= 500) return {state:'warning', reason:'Issuer/server error; retry later'};
  return {state:'warning', reason:'Unexpected response; review manually'};
}

async function check(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(target.url, {
      method:'GET', redirect:'follow', signal:controller.signal,
      headers:{
        'user-agent':'Mozilla/5.0 (compatible; CardPilot-LinkCheck/1.2; +https://github.com/)',
        'accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
    const finalUrl = res.url;
    let hostChanged = false;
    try { hostChanged = new URL(finalUrl).hostname !== new URL(target.url).hostname; } catch {}
    const cls = classifyStatus(res.status, null);
    return {...target, state:cls.state, reason:cls.reason, status:res.status, finalUrl, hostChanged, checkedAt:new Date().toISOString()};
  } catch (error) {
    const cls = classifyStatus(null, error);
    return {...target, state:cls.state, reason:cls.reason, status:null, finalUrl:null, error:String(error), checkedAt:new Date().toISOString()};
  } finally { clearTimeout(timer); }
}

const targets=[...grouped.values()];
const results=[];
for (let i=0;i<targets.length;i+=5) results.push(...await Promise.all(targets.slice(i,i+5).map(check)));

const broken = results.filter(r=>r.state==='broken');
const warnings = results.filter(r=>r.state==='warning');
const ok = results.filter(r=>r.state==='ok');
const report={
  catalogVersion:payload.catalogVersion||null,
  checkedAt:new Date().toISOString(),
  totalCards:cards.length,
  cardsWithUrl:cardsWithUrl.length,
  coveragePercent:cards.length ? Math.round(cardsWithUrl.length/cards.length*1000)/10 : 0,
  uniqueUrlsChecked:results.length,
  workingUniqueUrls:ok.length,
  warningUniqueUrls:warnings.length,
  brokenUniqueUrls:broken.length,
  cardsAffectedByBrokenUrls:broken.reduce((n,r)=>n+r.cards.length,0),
  results
};
fs.writeFileSync('link-report.json',JSON.stringify(report,null,2));

const icon={ok:'✅',warning:'⚠️',broken:'❌'};
const lines=[
  '# CardPilot issuer-link check','',
  `Catalog: ${report.catalogVersion || 'unknown'}`,
  `Card URL coverage: ${report.cardsWithUrl}/${report.totalCards} (${report.coveragePercent}%)`,
  `Unique official URLs checked: ${report.uniqueUrlsChecked}`,
  `Working: ${report.workingUniqueUrls} · Warnings: ${report.warningUniqueUrls} · Broken: ${report.brokenUniqueUrls}`,'',
  '> Warnings do not fail the workflow. Some financial institutions block automated requests even when the page works normally in a browser.',''
];
for(const r of results){
  const names=r.cards.slice(0,4).map(c=>c.name).join(', ')+(r.cards.length>4?` +${r.cards.length-4} more`:'');
  lines.push(`- ${icon[r.state]} **${r.cards[0]?.issuer || 'Issuer'}** (${r.cards[0]?.kind || 'unknown'}): ${r.status ?? 'AUTO-CHECK BLOCKED'} — ${r.reason} — ${names}${r.finalUrl && r.finalUrl!==r.url ? ` → ${r.finalUrl}`:''}`);
}
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
// Intentionally do not fail on link findings. Catalog validation is the hard gate.
