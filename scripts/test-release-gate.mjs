import assert from 'node:assert/strict';
import {releaseAudit} from './release-audit.mjs';
import {offerDataQuality,verifiedRecordErrors} from './offer-quality.mjs';
const today=new Date().toISOString().slice(0,10);
const good={id:1,name:'Fixture',issuer:'Fixture issuer',bonus:50000,spend:3000,spendPeriod:'3 months',
  af:95,unit:'points',verified:true,verifiedDate:today,issuerUrl:'https://issuer.example/card',issuerUrlVerified:today};
const audit=c=>releaseAudit({cards:[c],catalogVersion:'fixture'});
assert.equal(audit(good).releaseReady,true);
for(const bad of [{...good,spend:null},{...good,af:null},{...good,unit:null},{...good,verified:'false'},{...good,issuerUrl:null},{...good,issuerUrlVerified:false},
  {...good,verified:false},{...good,spendPeriod:null},{...good,verifiedDate:'2000-01-01'},
  {...good,offerExpires:'2000-01-01'}])assert.equal(audit(bad).releaseReady,false);
assert.equal(audit({...good,status:'closed-new',verified:false}).releaseReady,true,'Closed products do not block a release');
assert.equal(verifiedRecordErrors({...good,offerExpires:'2000-01-01'}).length,0,'Expiry must not prevent monitoring a replacement');
assert.equal(offerDataQuality({...good,offerExpires:'2000-01-01'}).needsReview,true,'Expired offers must be excluded from recommendations');
assert.equal(offerDataQuality({...good,verifiedDate:'2000-01-01'}).needsReview,true,'Offer verification cannot remain valid indefinitely');
console.log('Release gate regression checks passed.');
