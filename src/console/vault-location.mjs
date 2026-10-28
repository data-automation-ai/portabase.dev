const bucketPattern=/^(?!-)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export function validateVaultLocation(provider, input={}) {
  if(!['s3','r2'].includes(provider))throw Error('Unsupported storage provider.');
  const bucket=String(input.bucket||'').trim().toLowerCase();
  if(!bucketPattern.test(bucket)||bucket.includes('..')||bucket.includes('.-')||bucket.includes('-.'))
    throw Error('Enter a valid bucket name (3–63 lowercase letters, numbers, dots, or hyphens).');
  const prefix=String(input.prefix||'').trim().replace(/^\/+|\/+$/g,'');
  if(!prefix||prefix.length>256||prefix.split('/').some(part=>!part||part==='.'||part==='..'||!(/^[A-Za-z0-9._-]+$/).test(part)))
    throw Error('Enter a folder using letters, numbers, dots, underscores, hyphens, and slashes.');
  const naming=String(input.naming||'');
  if(!['overwrite','date-stamped'].includes(naming))throw Error('Choose a capsule naming option.');
  const accountId=String(input.accountId||'').trim().toLowerCase();
  if(provider==='r2'&&!/^[a-f0-9]{32}$/.test(accountId))throw Error('Enter the 32-character Cloudflare account ID.');
  const region=provider==='s3'?String(input.region||'us-east-1').trim():undefined;
  if(provider==='s3'&&!/^[a-z]{2}-[a-z]+-\d$/.test(region))throw Error('Enter a valid AWS region.');
  return {bucket,prefix,naming,...(provider==='r2'?{accountId}:{region})};
}
