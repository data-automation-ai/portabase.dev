// Runs only inside the production container. A five-minute CLI login password
// must be minted before EACH new PG connection, not once per multi-GB job.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const TOOLS = new Set(['psql','pg_dump','pg_dumpall']);
export async function freshPostgresEnvironment(tool, env, {read=readFile,fetchImpl=fetch}={}) {
  if(!TOOLS.has(tool))throw new Error('invalid_postgres_tool');
  if(!env.PORTABASE_DB_REFRESH_FILE)return {...env};
  if(!/^\/tmp\/portabase-job-[A-Za-z0-9]+\/database-access\.json$/.test(env.PORTABASE_DB_REFRESH_FILE))throw new Error('invalid_credentials_path');
  const credential=JSON.parse(await read(env.PORTABASE_DB_REFRESH_FILE,'utf8'));
  const {ref,accessToken,readOnly,enforceReadOnly}=credential;
  if(!/^[a-z]{20}$/.test(ref||'') || typeof accessToken!=='string' || accessToken.length<20
    || typeof readOnly!=='boolean' || typeof enforceReadOnly!=='boolean' || !env.PGUSER?.endsWith(`.${ref}`)
    || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(env.PGHOST||''))throw new Error('invalid_database_access');
  const response=await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/cli/login-role`,{
    method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'content-type':'application/json'},
    body:JSON.stringify({read_only:readOnly}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('database_login_refresh_failed');
  const login=await response.json();
  if(!/^cli_login_[a-z0-9_]+$/i.test(login.role||'') || !login.password || login.ttl_seconds<30)throw new Error('database_login_refresh_failed');
  return {...env,PGUSER:`${login.role}.${ref}`,PGPASSWORD:login.password,PGSSLMODE:'verify-full',
    PGSSLROOTCERT:'/app/cloud/confidential/supabase-root.crt',
    PORTABASE_PG_READ_ONLY:enforceReadOnly?'1':'0'};
}
export function postgresArguments(tool,args,env) {
  if(tool!=='psql' || !env.PORTABASE_DB_REFRESH_FILE)return args;
  // The hosted session pooler ignores PGOPTIONS. Execute these statements on
  // the actual session before the engine's SQL; never depend on startup options.
  return ['--quiet','--command',`SET ROLE postgres;${env.PORTABASE_PG_READ_ONLY==='1'?' SET default_transaction_read_only = on;':''}`,...args];
}
async function main() {
  const [tool,...args]=process.argv.slice(2);
  if(!TOOLS.has(tool))throw new Error('invalid_postgres_tool');
  const versionOnly=args.length===1 && ['--version','-V'].includes(args[0]);
  const env=versionOnly?process.env:await freshPostgresEnvironment(tool,process.env);
  const child=spawn(`/usr/lib/postgresql/17/bin/${tool}`,versionOnly?args:postgresArguments(tool,args,env),{env,stdio:'inherit'});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
  child.on('error',()=>{process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
  process.stderr.write('database_login_refresh_failed\n');process.exitCode=1;
});
