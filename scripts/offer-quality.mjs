// Shared contract for catalog validation and monitoring. Embedded in index.html.
export function offerDataQuality(o){
  const issues=[];
  if(o.verified!==true) issues.push('Offer has not been verified yet.');
  if(o.af==null) issues.push('Annual fee is not yet verified.');
  if(Number(o.bonus)>0 && !o.unit) issues.push('Welcome reward unit is missing.');
  if(o.verified && !o.verifiedDate) issues.push('Verification date is missing.');
  const checked=Date.parse((o.verifiedDate||'')+'T00:00:00Z');
  if(o.verifiedDate && !Number.isFinite(checked)) issues.push('Verification date is invalid.');
  if(o.verified && Number.isFinite(checked) && Date.now()-checked>30*86400000) issues.push('The recorded offer needs a fresh check.');
  if(Number(o.bonus||0)>0 && o.spend==null) issues.push('Minimum-spend requirement is not yet verified.');
  if(!Number(o.bonus||0) && !['no-standard-public-sub','invitation-waitlist','personalized','first-year-cashback-match'].includes(o.offerState)) issues.push('Current public welcome offer is not yet verified.');
  if(o.verified && /verify current offer/i.test(String(o.offerNote||''))) issues.push('Offer note contradicts verification.');
  if(o.offerExpires && o.offerExpires < new Date().toISOString().slice(0,10)) issues.push('The recorded welcome offer has expired.');
  return {issues,needsReview:issues.length>0};
}

export function verifiedRecordErrors(c){
  const errors=[];
  if(typeof c.verified!=='boolean')errors.push('verified must be a boolean');
  // Expiry/freshness are live recommendation and release states. They must not
  // prevent the monitor from running and discovering a replacement offer.
  if(c.verified) errors.push(...offerDataQuality(c).issues.filter(x=>!['The recorded welcome offer has expired.','The recorded offer needs a fresh check.'].includes(x)));
  if(c.verified && c.spend===0 && Number(c.bonus)>0 && !c.offerRequirementType) errors.push('Zero spend requires an explicit approval/first-purchase requirement.');
  if(!c.verified && (!c.reviewReason || !c.reviewOpenedDate)) errors.push('Unverified records must have a tracked review reason and date.');
  return errors;
}
