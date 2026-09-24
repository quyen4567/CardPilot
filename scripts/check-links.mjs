import fs from 'fs';

const catalogPath = process.argv[2] || 'cards.json';
const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const cards = Array.isArray(payload.cards) ? payload.cards : [];
const targets = cards.filter(c => c.issuerUrl).map(c => ({
  id: c.id,
  issuer: c.issuer,
  name: c.name,
  url: c.issuerUrl,
  lastVerified: c.issuerUrlVerified || null
}));

async function check(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {'user-agent':'CardPilot-LinkCheck/1.0 (+https://github.com/)'}
    });
    const finalUrl = res.url;
    const ok = res.status >= 200 && res.status < 400;
    const hostChanged = new URL(finalUrl).hostname !== new URL(target.url).hostname;
    return {...target, ok, status: res.status, finalUrl, hostChanged, checkedAt: new Date().toISOString()};
  } catch (error) {
    return {...target, ok:false, status:null, finalUrl:null, error:String(error), checkedAt:new Date().toISOString()};
  } finally {
    clearTimeout(timer);
  }
}

const results=[];
for (let i=0;i<targets.length;i+=5) {
  results.push(...await Promise.all(targets.slice(i,i+5).map(check)));
}
const report={catalogVersion:payload.catalogVersion||null,checkedAt:new Date().toISOString(),checked:results.length,broken:results.filter(r=>!r.ok).length,results};
fs.writeFileSync('link-report.json',JSON.stringify(report,null,2));

const lines=['# CardPilot issuer-link check','',`Catalog: ${report.catalogVersion || 'unknown'}`,`Checked: ${report.checked}`,`Broken: ${report.broken}`,''];
for(const r of results){
  lines.push(`- ${r.ok?'✅':'❌'} **${r.issuer} — ${r.name}**: ${r.status ?? 'ERROR'}${r.finalUrl && r.finalUrl!==r.url ? ` → ${r.finalUrl}`:''}`);
}
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
if(report.broken) process.exitCode=1;
