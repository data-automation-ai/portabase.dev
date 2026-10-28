import {testS3Connection,listS3Capsules} from './s3-vault.mjs';

export function r2Endpoint(accountId){
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('invalid_r2_account_id');
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function r2Vault({fetchImpl=globalThis.fetch}={}){
  const configuration=profile=>{
    if(!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(profile.r2?.endpoint||'')||profile.r2?.roleArn)throw Error('invalid_r2_configuration');
    return Object.fromEntries(['bucket','prefix','region','endpoint','accessKeyId','secretAccessKey'].filter(key=>profile.r2[key]!==undefined).map(key=>[key,profile.r2[key]]));
  };
  return {
    async connect(profile,input={}){
      if(!input.bucket||!input.accessKeyId||!input.secretAccessKey)throw Error('missing_r2_credentials');
      const config={bucket:input.bucket,prefix:input.prefix||'Portabase/capsules',region:'auto',
        endpoint:r2Endpoint(input.accountId),accessKeyId:input.accessKeyId,secretAccessKey:input.secretAccessKey};
      await testS3Connection({...config,fetchImpl});
      profile.r2=config;profile.activeVault='r2';
      return {connected:true,bucket:config.bucket,prefix:config.prefix,accountId:input.accountId};
    },
    async provider(profile){
      if(!profile.r2?.bucket||!profile.r2?.accessKeyId||!profile.r2?.secretAccessKey)throw Error('r2_not_connected');
      const config=configuration(profile);await testS3Connection({...config,fetchImpl});
      return {type:'r2',mode:'api',...config};
    },
    async capsules(profile){return profile.r2?.bucket?listS3Capsules({...configuration(profile),type:'r2',fetchImpl}):[];},
  };
}
