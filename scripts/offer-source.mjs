const HILTON_COMPARISON='https://www.hilton.com/en/hilton-honors/credit-cards';

export function sourceKey(value){
  if(!value || !URL.canParse(value)) return null;
  const url=new URL(value);
  return url.origin+url.pathname.replace(/\/+$/,'');
}

export function sharedOfferSources(cards){
  const shared=new Set([HILTON_COMPARISON]);
  const seen=new Set();
  for(const card of cards){
    const key=sourceKey(card.issuerUrl);
    if(!key) continue;
    if(seen.has(key)) shared.add(key);
    seen.add(key);
  }
  return shared;
}

export function isHiltonComparison(value){
  return sourceKey(value)===HILTON_COMPARISON;
}
