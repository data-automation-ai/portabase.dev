const REF=/^[a-z]{20}$/;
const fixture={source:'uloqvqdkeiwvnnnfdvrc',target:'jmqjsyyyhhwvkbqexxog'};
const names={source:'portabase-confidential-source',target:'portabase-confidential-target'};
const fail=()=>{throw new Error('invalid_validation_selection');};

// The larger owner drill must name both projects and their expected provider
// names. A partial configuration never falls back to the synthetic fixture.
export function dryRunSelection(env=process.env) {
  const fields=['PORTABASE_VALIDATION_SOURCE_REF','PORTABASE_VALIDATION_SOURCE_NAME',
    'PORTABASE_VALIDATION_TARGET_REF','PORTABASE_VALIDATION_TARGET_NAME'];
  const configured=fields.map(key=>env[key]);
  if(configured.every(value=>value===undefined))return {refs:fixture,names,synthetic:true};
  if(configured.some(value=>typeof value!=='string'||!value.trim()))fail();
  const [source,sourceName,target,targetName]=configured.map(value=>value.trim());
  if(!REF.test(source)||!REF.test(target)||source===target||target==='eoiqvdmvgaurlecdzqkp'
    ||sourceName.length>100||targetName.length>100)fail();
  return {refs:{source,target},names:{source:sourceName,target:targetName},synthetic:false};
}
