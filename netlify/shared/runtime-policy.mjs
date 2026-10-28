import { getStore } from '@netlify/blobs';
/** Read-only pins tolerate propagation delay (missing or old pins fail closed). Private site configuration; avoids changing unrelated functions' environment digests. */
export async function runtimePolicy() {
  const value=await getStore({name:'portabase-runtime-policy',...(process.env.NETLIFY_BLOBS_SITE_ID&&process.env.NETLIFY_BLOBS_TOKEN?{siteID:process.env.NETLIFY_BLOBS_SITE_ID,token:process.env.NETLIFY_BLOBS_TOKEN}:{})}).get('starter-nine',{type:'json'});
  if(!value)return {};
  if(value.version!==1||value.starterVariationId!=null&&!/^[A-Za-z0-9_-]{1,100}$/.test(value.starterVariationId)
    ||value.usageImageDigest!=null&&!/^sha256:[a-f0-9]{64}$/.test(value.usageImageDigest))throw Error('runtime_policy_invalid');
  return {starterVariationId:value.starterVariationId,usageImageDigest:value.usageImageDigest,managedStarterEnabled:value.managedStarterEnabled===true};
}

export function managedStarterReady(value={}) {
  return value.managedStarterEnabled===true&&/^[A-Za-z0-9_-]{1,100}$/.test(value.starterVariationId||'')&&/^sha256:[a-f0-9]{64}$/.test(value.usageImageDigest||'');
}
