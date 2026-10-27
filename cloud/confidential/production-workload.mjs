import { applicationServer } from './server.mjs';
import { loadWorkloadConfig, admitJob } from './cloud-config.mjs';
try {
  const oauthConfig=await loadWorkloadConfig();
  const server=applicationServer({oauthConfig,admit:admitJob});
  server.listen(8080,'0.0.0.0');
  const shutdown=()=>{server.close();setTimeout(()=>process.exit(0),3000).unref();};
  process.on('SIGTERM',shutdown);
  setTimeout(shutdown,230*60*1000).unref();
} catch { process.stderr.write('confidential_runner_startup_failed\n');process.exitCode=1; }
