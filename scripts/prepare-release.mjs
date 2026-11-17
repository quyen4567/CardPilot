import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {releaseAudit} from './release-audit.mjs';

const source=process.argv[2]||'staging';
const output=process.argv[3]||'candidate-dist';
const index=fs.readFileSync(path.join(source,'index.html'));
const cards=fs.readFileSync(path.join(source,'cards.json'));
const catalog=JSON.parse(cards);
if(!Array.isArray(catalog.cards)||catalog.cards.length<100||!catalog.cards.some(c=>c.status!=='closed-new'))
  throw new Error('Publication blocked: catalog is empty or unexpectedly small.');
const audit=releaseAudit(catalog);
if(!audit.releaseReady)throw new Error(`Publication blocked: ${audit.blockers.length} unresolved card records. See release-audit.json.`);
const qa=JSON.parse(fs.readFileSync(path.join(source,'browser-qa.json'),'utf8'));
const hash=crypto.createHash('sha256').update(index).update(cards).digest('hex');
if(!qa.passed || qa.candidateHash!==hash || !Number.isFinite(Date.parse(qa.checkedAt)) || Date.now()-Date.parse(qa.checkedAt)>24*60*60*1000)
  throw new Error('Publication blocked: browser QA is missing, stale, or belongs to different files.');
// A release artifact is built only after the data and exact browser-tested files pass.
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'index.html'),index);
fs.writeFileSync(path.join(output,'cards.json'),cards);
for(const file of ['manifest.webmanifest','sw.js'])if(fs.existsSync(file))fs.copyFileSync(file,path.join(output,file));
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({catalogVersion:audit.catalogVersion,candidateHash:hash,preparedAt:new Date().toISOString()},null,2)+'\n');
console.log(`Release artifact prepared: ${output}`);
