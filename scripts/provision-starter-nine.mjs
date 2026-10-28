// Operator-only. No subscriptions, charges, existing prices or customer records are changed.
import { mkdir,writeFile } from 'node:fs/promises';
import { getStore } from '@netlify/blobs';
import { operatorConfig,SITE_ID } from '../cloud/confidential/operator-config.mjs';
import { VARIATION_NAMES,assertStarterVariation,SQUARE_API_VERSION,resolvePortabaseSquareSecret } from '../netlify/shared/square-cloud.mjs';
const mode=process.argv[2]||'plan';
if(!['plan','apply'].includes(mode))throw Error('use_plan_or_apply');
const op=await operatorConfig();
const fallback={SQUARE_ACCESS_TOKEN:op.value('PORTABASE_SQUARE_ACCESS_TOKEN')||op.value('SQUARE_ACCESS_TOKEN'),
  SQUARE_LOCATION_ID:op.value('PORTABASE_SQUARE_LOCATION_ID')||op.value('SQUARE_LOCATION_ID')};
const [token,location]=await Promise.all([
  resolvePortabaseSquareSecret('SQUARE_ACCESS_TOKEN','access_token',{env:fallback}),
  resolvePortabaseSquareSecret('SQUARE_LOCATION_ID','location_id',{env:fallback})]);
if(!token||!location)throw Error('square_configuration_missing');
const env=op.value('SQUARE_ENVIRONMENT')||op.value('SQUARE_ENV')||'production';
if(env!=='production')throw Error('production_square_required');
async function square(path,body){
  const response=await fetch('https://connect.squareup.com'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,
    'Square-Version':SQUARE_API_VERSION,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),
    redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('square_http_'+response.status);return response.json();
}
const locations=await square('/v2/locations'),selected=locations.locations?.find(row=>row.id===location);
if(!selected?.merchant_id||selected.status!=='ACTIVE')throw Error('square_location_identity_unverified');
const key='SQUARE_CLOUD_PLAN_VARIATION_ID_9';
const policyStore=getStore({name:'portabase-runtime-policy',siteID:SITE_ID,token:op.value('NETLIFY_BLOBS_TOKEN'),consistency:'strong'});
const oldPolicy=await policyStore.getWithMetadata('starter-nine',{type:'json'});
let existing=op.value(key)||oldPolicy?.data?.starterVariationId,cursor;
if(!existing)do{
  const page=await square('/v2/catalog/list?types=SUBSCRIPTION_PLAN_VARIATION'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
  const matches=(page.objects||[]).filter(o=>o.subscription_plan_variation_data?.name===VARIATION_NAMES['cloud-9']);
  if(matches.length>1||existing&&matches.length)throw Error('duplicate_starter_variations');
  if(matches.length)existing=assertStarterVariation(matches[0]);cursor=page.cursor;
}while(cursor);
if(existing)assertStarterVariation((await square('/v2/catalog/object/'+encodeURIComponent(existing))).object);
const review={siteId:SITE_ID,merchantId:selected.merchant_id,locationId:location,businessName:selected.business_name||selected.name,
  plan:'cloud-9',monthlyCents:900,currency:'USD',trialDays:7,existingVariationId:existing||null,
  changes:existing?['Set private site $9 variation policy']:['Create separate $9 subscription plan and variation','Set private site $9 variation policy'],
  managedStarterEnabled:oldPolicy?.data?.managedStarterEnabled===true,requestedManagedActivation:process.argv.includes('--enable-managed-starter'),
  existingSubscriptionsChanged:false,existingPricesChanged:false,functionEnvironmentChanged:false};
console.log(JSON.stringify(review));
if(mode==='apply'){
  const approved=process.argv.find(arg=>arg.startsWith('--merchant='))?.slice(11);
  if(approved!==selected.merchant_id)throw Error('reviewed_merchant_argument_required');
  if(!existing){
    const result=await square('/v2/catalog/batch-upsert',{idempotency_key:'portabase-starter-nine-20261028-v1',batches:[{objects:[
      {type:'SUBSCRIPTION_PLAN',id:'#portabase-starter-nine',present_at_all_locations:true,subscription_plan_data:{name:'Portabase Starter $9',all_items:true}},
      {type:'SUBSCRIPTION_PLAN_VARIATION',id:'#portabase-starter-nine-monthly',present_at_all_locations:true,subscription_plan_variation_data:{
        name:VARIATION_NAMES['cloud-9'],subscription_plan_id:'#portabase-starter-nine',phases:[
          {ordinal:0,cadence:'DAILY',periods:7,pricing:{type:'STATIC',price:{amount:0,currency:'USD'}}},
          {ordinal:1,cadence:'MONTHLY',pricing:{type:'STATIC',price:{amount:900,currency:'USD'}}}]}}
    ]}]});
    existing=result.id_mappings?.find(row=>row.client_object_id==='#portabase-starter-nine-monthly')?.object_id;
    if(!existing)throw Error('starter_variation_id_missing');
    assertStarterVariation((await square('/v2/catalog/object/'+encodeURIComponent(existing))).object);
  }
  if(op.value(key)&&op.value(key)!==existing)throw Error('starter_pin_conflict');
  const image=process.argv.find(arg=>arg.startsWith('--image='))?.slice(8)||oldPolicy?.data?.usageImageDigest;
  if(image&&!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('invalid_usage_image');
  const enable=process.argv.includes('--enable-managed-starter'),validatedRelease=process.argv.find(arg=>arg.startsWith('--validated-release='))?.slice(20);
  if(enable&&(!image||!/^[a-f0-9]{40}$/.test(validatedRelease||'')))throw Error('validated_release_and_image_required');
  const managedStarterEnabled=enable||(oldPolicy?.data?.managedStarterEnabled===true&&oldPolicy?.data?.usageImageDigest===image);
  const next={version:1,starterVariationId:existing,...(image?{usageImageDigest:image}:{}),managedStarterEnabled,...(enable?{validatedRelease}:{}),updatedAt:new Date().toISOString()};
  const result=await policyStore.setJSON('starter-nine',next,oldPolicy?{onlyIfMatch:oldPolicy.etag}:{onlyIfNew:true});
  if(!result.modified)throw Error('runtime_policy_changed');
  const check=await policyStore.get('starter-nine',{type:'json'});
  if(check.starterVariationId!==existing||check.usageImageDigest!==image||check.managedStarterEnabled!==managedStarterEnabled)throw Error('starter_policy_readback_failed');
  const evidence={...review,variationId:existing,verifiedAt:new Date().toISOString(),deploymentRequired:true};
  await mkdir('.portabase',{recursive:true});await writeFile('.portabase/starter-nine-provision.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({configured:true,variationId:existing,managedStarterEnabled,deploymentRequired:true}));
}
