import fs from 'fs';

const catalogPath = process.argv[2] || 'cards.json';
const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const cards = Array.isArray(payload.cards) ? payload.cards : [];
const cardsWithUrl = cards.filter(c => c.issuerUrl);

// Check each unique URL once, even if many cards share an issuer-directory fallback.
const grouped = new Map();
for (const c of cardsWithUrl) {
  const key = c.issuerUrl;
  if (!grouped.has(key)) grouped.set(key, {url:key, cards:[]});
  grouped.get(key).cards.push({
    id:c.id, issuer:c.issuer, name:c.name,
    kind:c.issuerUrlKind || 'unknown',
    lastVerified:c.issuerUrlVerified || null
  });
}

async function check(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(target.url, {
      method:'GET', redirect:'follow', signal:controller.signal,
      headers:{'user-agent':'CardPilot-LinkCheck/1.1 (+https://github.com/)'}
    });
    const finalUrl = res.url;
    const ok = res.status >= 200 && res.status < 400;
    let hostChanged = false;
    try { hostChanged = new URL(finalUrl).hostname !== new URL(target.url).hostname; } catch {}
    return {...target, ok, status:res.status, finalUrl, hostChanged, checkedAt:new Date().toISOString()};
  } catch (error) {
    return {...target, ok:false, status:null, finalUrl:null, error:String(error), checkedAt:new Date().toISOString()};
  } finally { clearTimeout(timer); }
}

const targets=[...grouped.values()];
const results=[];
for (let i=0;i<targets.length;i+=5) results.push(...await Promise.all(targets.slice(i,i+5).map(check)));

const broken = results.filter(r=>!r.ok);
const report={
  catalogVersion:payload.catalogVersion||null,
  checkedAt:new Date().toISOString(),
  totalCards:cards.length,
  cardsWithUrl:cardsWithUrl.length,
  coveragePercent:cards.length ? Math.round(cardsWithUrl.length/cards.length*1000)/10 : 0,
  uniqueUrlsChecked:results.length,
  brokenUniqueUrls:broken.length,
  cardsAffectedByBrokenUrls:broken.reduce((n,r)=>n+r.cards.length,0),
  results
};
fs.writeFileSync('link-report.json',JSON.stringify(report,null,2));

const lines=[
  '# CardPilot issuer-link check','',
  `Catalog: ${report.catalogVersion || 'unknown'}`,
  `Card URL coverage: ${report.cardsWithUrl}/${report.totalCards} (${report.coveragePercent}%)`,
  `Unique official URLs checked: ${report.uniqueUrlsChecked}`,
  `Broken unique URLs: ${report.brokenUniqueUrls}`,
  `Cards affected by broken URLs: ${report.cardsAffectedByBrokenUrls}`,''] ;
for(const r of results){
  const names=r.cards.slice(0,4).map(c=>c.name).join(', ')+(r.cards.length>4?` +${r.cards.length-4} more`:'');
  lines.push(`- ${r.ok?'✅':'❌'} **${r.cards[0]?.issuer || 'Issuer'}** (${r.cards[0]?.kind || 'unknown'}): ${r.status ?? 'ERROR'} — ${names}${r.finalUrl && r.finalUrl!==r.url ? ` → ${r.finalUrl}`:''}`);
}
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
if(report.brokenUniqueUrls) process.exitCode=1;
