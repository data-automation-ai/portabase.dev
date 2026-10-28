import { applicationServer } from './server.mjs';
import { loadWorkloadConfig, admitJob } from './cloud-config.mjs';
import {beaconBootIdentity,runBeaconWorker} from './beacon-worker.mjs';
try {
  const oauthConfig=await loadWorkloadConfig();
  const beacon=await beaconBootIdentity();
  if(beacon){
    await runBeaconWorker({...beacon,oauthConfig});
    // Controller deletes the exact leased beacon VM; platform enforces ten
    // minutes maximum even if controller is unavailable. No HTTP command API.
    process.exitCode=0;
  }else{
  const server=applicationServer({oauthConfig,admit:admitJob});
  server.listen(8080,'0.0.0.0');
  const shutdown=()=>{server.close();setTimeout(()=>process.exit(0),3000).unref();};
  process.on('SIGTERM',shutdown);
  setTimeout(shutdown,230*60*1000).unref();
  }
} catch { process.stderr.write('confidential_runner_startup_failed\n');process.exitCode=1; }
