import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./prepare-release.mjs',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardpilot-publication-'));
try{
  const source=path.join(dir,'source'),output=path.join(dir,'dist');fs.mkdirSync(source);
  const today=new Date().toISOString().slice(0,10);
  const cards=Array.from({length:100},(_,i)=>({id:i+1,name:'Fixture Card',issuer:'Fixture',type:'Personal',bonus:50000,unit:'points',
    spend:3000,spendPeriod:'3 months',af:95,verified:true,verifiedDate:today,issuerUrl:'https://issuer.example/card',issuerUrlVerified:today}));
  const write=(list=cards,qaExtra={})=>{
    fs.writeFileSync(path.join(source,'index.html'),'<html>Fixture release</html>');
    fs.writeFileSync(path.join(source,'cards.json'),JSON.stringify({catalogVersion:'fixture',cards:list}));
    const candidateHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'index.html'))).update(fs.readFileSync(path.join(source,'cards.json'))).digest('hex');
    fs.writeFileSync(path.join(source,'browser-qa.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),candidateHash,...qaExtra}));
  };
  const prepare=()=>execFileSync(process.execPath,[script,source,output],{cwd:dir,stdio:'pipe'});
  write();prepare();assert(fs.existsSync(path.join(output,'release-manifest.json')));
  fs.rmSync(output,{recursive:true});
  write(cards,{candidateHash:'wrong'});assert.throws(prepare);assert(!fs.existsSync(output));
  write(cards,{checkedAt:'2000-01-01T00:00:00Z'});assert.throws(prepare);
  write();fs.appendFileSync(path.join(source,'index.html'),'changed after QA');assert.throws(prepare);
  write(cards.map(c=>({...c,issuerUrl:null})));assert.throws(prepare);
  write([]);assert.throws(prepare);
  write(cards.map(c=>({...c,offerExpires:'2000-01-01'})));assert.throws(prepare);
  console.log('Publication integrity checks passed.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
