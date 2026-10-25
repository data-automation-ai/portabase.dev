// A live drill writes only the explicitly named, blank synthetic target.
import {randomUUID} from 'node:crypto';
const SOURCE='uloqvqdkeiwvnnnfdvrc',TARGET='jmqjsyyyhhwvkbqexxog';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function executeDryRun({command,status,persist}) {
 if(status.executing)throw new Error('drill_already_running');
 status.executing=true;status.state='checking_target';await persist();
 try {
  const check=await command('preflight');
  if(!check.ready||check.source.ref!==SOURCE||check.target.ref!==TARGET||!check.target.blank)throw new Error('unsafe_test_selection');
  async function wait(job,kind){
   const deadline=Date.now()+90*60000;
   do {
    const current=await command('job.status',{id:job.id});
    status[kind]=current;await persist();
    if(current.state==='complete')return current;
    if(current.state==='failed')throw new Error(current.error||'drill_job_failed');
    if(Date.now()>deadline)throw new Error('drill_wait_timeout');
    await sleep(4000);
   }while(true);
  }
  status.state='capturing';
  const backup=await command('backup.start',{requestId:randomUUID()});
  status.backupExecuted=true;
  const captured=await wait(backup,'backup');
  if(!captured.result?.captureComplete)throw new Error('capture_not_complete');
  status.state='restoring';await persist();
  const restore=await command('restore.start',{requestId:randomUUID(),capsuleId:backup.id,confirmTarget:TARGET,acknowledgeManualConfig:true});
  status.restoreExecuted=true;
  const restored=await wait(restore,'restore');
  if(!restored.result?.restoreVerified)throw new Error('restore_not_verified');
  status.state='recovery_data_path_verified';
 }catch(e){status.state='drill_failed';status.error=/^[a-z0-9_]{3,100}$/.test(e.message)?e.message:'drill_failed';}
 finally{status.executing=false;await persist();}
}
