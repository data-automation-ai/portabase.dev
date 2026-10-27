import test from 'node:test';
import assert from 'node:assert/strict';
import {freshPostgresEnvironment,postgresArguments} from './pg-command.mjs';
const ref='a'.repeat(20),path='/tmp/portabase-job-Ab1234/database-access.json';
const env={PORTABASE_DB_REFRESH_FILE:path,PGHOST:'aws-0-us-east-1.pooler.supabase.com',PGUSER:`cli_login_old.${ref}`,PGPASSWORD:'expired'};
const credential={ref,readOnly:false,enforceReadOnly:true,accessToken:'fixture-token-'.repeat(5)};
const read=async()=>JSON.stringify(credential);
test('each connection gets a new password and verifies the database hostname and CA',async()=>{
  let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;assert.equal(url,`https://api.supabase.com/v1/projects/${ref}/cli/login-role`);
    assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{read_only:false});
    return Response.json({role:'cli_login_postgres',password:`fresh-${calls}`,ttl_seconds:300});
  };
  const first=await freshPostgresEnvironment('psql',env,{read,fetchImpl});
  const second=await freshPostgresEnvironment('pg_dump',env,{read,fetchImpl});
  assert.equal(first.PGPASSWORD,'fresh-1');assert.equal(second.PGPASSWORD,'fresh-2');
  assert.equal(first.PGSSLMODE,'verify-full');assert.match(first.PGSSLROOTCERT,/supabase-root.crt$/);
  assert.equal(first.PORTABASE_PG_READ_ONLY,'1');assert.equal(env.PGPASSWORD,'expired');
});
test('rejects another project, arbitrary credential paths and provider hosts before fetching',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw new Error('should_not_fetch');};
  for(const change of [{PGUSER:`cli_login_postgres.${'b'.repeat(20)}`},{PGHOST:'attacker.example'},{PORTABASE_DB_REFRESH_FILE:'/etc/passwd'}]){
    await assert.rejects(freshPostgresEnvironment('psql',{...env,...change},{read,fetchImpl}),/invalid_/);
  }
  assert.equal(calls,0);
});
test('provider failure never falls back to an expired database password',async()=>{
  await assert.rejects(freshPostgresEnvironment('psql',env,{read,fetchImpl:async()=>new Response('secret provider body',{status:401})}),/^Error: database_login_refresh_failed$/);
});
test('source psql explicitly sets a read-only session; target retains explicit postgres role',()=>{
  const args=['--command','SELECT 1'];
  assert.deepEqual(postgresArguments('psql',args,{...env,PORTABASE_PG_READ_ONLY:'1'}),['--quiet','--command','SET ROLE postgres; SET default_transaction_read_only = on;',...args]);
  assert.deepEqual(postgresArguments('psql',args,{...env,PORTABASE_PG_READ_ONLY:'0'}),['--quiet','--command','SET ROLE postgres;',...args]);
  assert.deepEqual(postgresArguments('psql',args,{}),args);
});
