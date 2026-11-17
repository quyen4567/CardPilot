import {chromium} from 'playwright';

let browserPromise;
const pageCache=new Map();

export function launchOfferBrowser(){
  // Optional executable/arguments support controlled CI and local QA images.
  const options=process.env.CARDPILOT_BROWSER_OPTIONS?JSON.parse(process.env.CARDPILOT_BROWSER_OPTIONS):{};
  const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
  if(proxyUrl && !options.proxy){
    const proxy=new URL(proxyUrl);
    options.proxy={server:proxy.origin,bypass:'127.0.0.1,localhost'};
    if(proxy.username)options.proxy.username=decodeURIComponent(proxy.username);
    if(proxy.password)options.proxy.password=decodeURIComponent(proxy.password);
  }
  return chromium.launch({...options,headless:true});
}

async function read(url){
  browserPromise ||= launchOfferBrowser();
  const browser=await browserPromise;
  const contextOptions=process.env.CARDPILOT_CONTEXT_OPTIONS?JSON.parse(process.env.CARDPILOT_CONTEXT_OPTIONS):{};
  const context=await browser.newContext({...contextOptions,serviceWorkers:'block'});
  await context.route('**/*',route=>['image','media','font'].includes(route.request().resourceType())?route.abort():route.continue());
  const page=await context.newPage();
  try{
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
    const httpStatus=response?.status()||0;
    if([401,403,406,429].includes(httpStatus))return {httpStatus,blocked:true,finalUrl:page.url(),text:''};
    if(httpStatus<200||httpStatus>=400)return {httpStatus,finalUrl:page.url(),text:''};
    // Wait for initial application rendering; avoid networkidle on analytics-heavy pages.
    await page.locator('body').waitFor({state:'visible',timeout:10000});
    let text='',unchanged=0;
    for(let i=0;i<12;i++){
      const next=await page.locator('body').innerText({timeout:10000});
      unchanged=next===text?unchanged+1:0;text=next;
      // Allow late pricing/offer calls at least six seconds to fill placeholders.
      if(i>=6&&unchanged>=3)break;
      await page.waitForTimeout(1000);
    }
    return {httpStatus,finalUrl:page.url(),text,title:await page.title(),method:'rendered-public-page'};
  }finally{await context.close();}
}

export async function readRenderedOfferPage(url){
  const parsed=new URL(url);
  if(!['http:','https:'].includes(parsed.protocol))throw new Error('Unsupported offer source protocol');
  // Reuse one public-page snapshot when several cards share a comparison page.
  if(!pageCache.has(url))pageCache.set(url,read(url));
  return pageCache.get(url);
}

export async function closeRenderedBrowser(){
  if(browserPromise){try{await (await browserPromise).close();}finally{browserPromise=undefined;pageCache.clear();}}
}
