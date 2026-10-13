// Shared contract for catalog validation and monitoring. Embedded in index.html.
export function offerDataQuality(o){
  const issues=[];
  if(!o.verified) issues.push('Offer has not been verified yet.');
  if(o.verified && !o.verifiedDate) issues.push('Verification date is missing.');
  if(Number(o.bonus||0)>0 && o.spend==null) issues.push('Minimum-spend requirement is not yet verified.');
  if(!Number(o.bonus||0) && !['no-standard-public-sub','invitation-waitlist','personalized','first-year-cashback-match'].includes(o.offerState)) issues.push('Current public welcome offer is not yet verified.');
  if(o.verified && /verify current offer/i.test(String(o.offerNote||''))) issues.push('Offer note contradicts verification.');
  if(o.offerExpires && o.offerExpires < new Date().toISOString().slice(0,10)) issues.push('The recorded welcome offer has expired.');
  return {issues,needsReview:issues.length>0};
}

export function verifiedRecordErrors(c){
  const errors=[];
  if(c.verified) errors.push(...offerDataQuality(c).issues);
  if(c.verified && c.spend===0 && Number(c.bonus)>0 && !c.offerRequirementType) errors.push('Zero spend requires an explicit approval/first-purchase requirement.');
  if(!c.verified && (!c.reviewReason || !c.reviewOpenedDate)) errors.push('Unverified records must have a tracked review reason and date.');
  return errors;
}
