// Local helper routing; credentials travel only through the attested command channel.
export async function handleVaultAction({pathname,form,status,command,beginDropbox,persist}) {
  if(!['/vault-provider','/s3'].includes(pathname))return false;
  if(status.executing)throw new Error('drill_already_running');
  if(pathname==='/vault-provider'){
    const provider=form.get('provider');
    if(!['dropbox','s3'].includes(provider))throw new Error('invalid_vault_provider');
    if(provider==='dropbox'&&status.connections.dropbox){
      const result=await command('vault.check');
      status.connections.dropbox=result?.connected===true;
    }
    if(provider==='dropbox'&&!status.connections.dropbox)await beginDropbox();
    status.activeVault=provider;
  }else{
    const input=Object.fromEntries(['bucket','region','prefix','accessKeyId','secretAccessKey','endpoint'].map(key=>[key,form.get(key)||'']));
    if(!input.bucket||!input.accessKeyId||!input.secretAccessKey)throw new Error('missing_s3_credentials');
    const result=await command('vault.s3.connect',input);
    if(result?.connected!==true)throw new Error('s3_connection_failed');
    status.connections.s3=true;status.activeVault='s3';
    status.s3Summary={bucket:result.bucket,region:result.region,prefix:result.prefix};
  }
  delete status.error;
  await persist();return true;
}
