import {testS3Connection,listS3Capsules} from './s3-vault.mjs';

export function r2Endpoint(accountId){
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('invalid_r2_account_id');
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function r2Vault({fetchImpl=globalThis.fetch}={}){
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
      await testS3Connection({...profile.r2,fetchImpl});
      return {type:'r2',mode:'api',...profile.r2};
    },
    async capsules(profile){return profile.r2?.bucket?listS3Capsules({...profile.r2,type:'r2',fetchImpl}):[];},
  };
}
