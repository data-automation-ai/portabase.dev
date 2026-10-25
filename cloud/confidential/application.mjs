import { recoveryKeyBytes, sealProfile, openProfile } from './customer-profile.mjs';
import { oauthConnections } from './oauth-connections.mjs';
import { engineJobs } from './engine-jobs.mjs';
import { projectRef } from './supabase-access.mjs';
import { dropboxVault } from './dropbox-vault.mjs';
const fail = code => { throw new Error(code); };
export function confidentialApplication({ oauthConfig, jobs = engineJobs(), connections = oauthConnections(oauthConfig),
  vault = oauthConfig?.dropboxClientId ? dropboxVault({clientId:oauthConfig.dropboxClientId}) : null, admit, now = Date.now }) {
  const customers = new Map(), locks = new Set();
  return async ({owner,operation,input,authorization}) => {
    if (locks.has(owner)) fail('request_in_progress');
    locks.add(owner);
    try {
      let customer = customers.get(owner);
      if (operation === 'session.open') {
        recoveryKeyBytes(input.recoveryKey).fill(0);
        if (customer && customer.recoveryKey !== input.recoveryKey) fail('session_key_mismatch');
        if (!customer) {
          const profile = input.sealedProfile ? await openProfile(input.sealedProfile,input.recoveryKey,owner)
            : {version:1,owner,connections:{},selection:{},keyAcknowledged:false};
          customer = { profile, recoveryKey: input.recoveryKey, touched: now() };
          customers.set(owner,customer);
        }
      }
      if (!customer) fail('session_open_required');
      customer.touched=now();
      const {profile,recoveryKey} = customer;
      let data;
      switch(operation) {
        case 'session.open': data={ connected:{source:!!profile.connections.source,target:!!profile.connections.target,dropbox:!!profile.dropbox?.refreshToken},selection:profile.selection,keyAcknowledged:!!profile.keyAcknowledged }; break;
        case 'key.acknowledge': profile.keyAcknowledged=true; data={acknowledged:true}; break;
        case 'oauth.begin': data=connections.begin(profile,input.slot,input.redirectUri); break;
        case 'oauth.finish': data=await connections.finish(profile,input); break;
        case 'oauth.disconnect': data=connections.disconnect(profile,input.slot); break;
        case 'vault.begin': if(!vault)fail('dropbox_app_not_configured');data=vault.begin(profile);break;
        case 'vault.finish': if(!vault)fail('dropbox_app_not_configured');data=await vault.finish(profile,input.code);break;
        case 'vault.check': if(!vault)fail('dropbox_app_not_configured');data={connected:!!profile.dropbox?.refreshToken};
          if(data.connected)await vault.provider(profile);break;
        case 'projects.list': data={projects:await (await connections.access(profile,input.slot)).api.projects()}; break;
        case 'project.select': {
          const ref=projectRef(input.ref);
          const status=await (await connections.access(profile,input.slot)).api.inspect(ref);
          if(input.slot==='target' && (ref===profile.selection.source || ref==='eoiqvdmvgaurlecdzqkp')) fail('unsafe_restore_target');
          if(input.slot==='source' && ref===profile.selection.target) fail('unsafe_restore_target');
          profile.selection[input.slot]=ref;
          data=status; break;
        }
        case 'preflight': {
          const source=await connections.access(profile,'source'), target=await connections.access(profile,'target');
          const [from,to]=await Promise.all([source.api.inspect(projectRef(profile.selection.source)),target.api.inspect(projectRef(profile.selection.target))]);
          if(from.ref===to.ref || to.ref==='eoiqvdmvgaurlecdzqkp') fail('unsafe_restore_target');
          data={source:from,target:to,keyAcknowledged:!!profile.keyAcknowledged,
            dataFlow:{source:'Supabase',processor:'Google Confidential Space',capsule:'Encrypted inside runner',destination:'Customer-selected Supabase',verified:false},
            ready:to.blank && !!profile.keyAcknowledged}; break;
        }
        case 'backup.start':
        case 'restore.start': {
          if(!profile.keyAcknowledged) fail('save_recovery_key_first');
          const source=await connections.access(profile,'source'), target=await connections.access(profile,'target');
          const sourceRef=projectRef(profile.selection.source), targetRef=projectRef(profile.selection.target);
          if(operation==='restore.start' && (input.confirmTarget!==targetRef || input.acknowledgeManualConfig!==true)) fail('restore_acknowledgement_required');
          if(typeof admit!=='function') fail('quota_service_unavailable');
          const admission=await admit({authorization,operation:'quota.inspect',requestId:input.requestId});
          const provider=operation==='backup.start' && input.vault==='dropbox'
            ? await vault?.provider(profile) : undefined;
          if(operation==='backup.start' && input.vault==='dropbox' && !provider)fail('dropbox_connection_required');
          data=await jobs.start({owner,sourceRef,targetRef,sourceToken:source.token,targetToken:target.token,
            passphrase:recoveryKey,provider,maxBytes:admission.maxBytes,operation:operation==='backup.start'?'backup':'restore',capsuleId:input.capsuleId,
            authorize:()=>admit({authorization,operation,requestId:input.requestId}),
            refreshAccess:async()=>(await connections.access(profile,operation==='backup.start'?'source':'target')).token}); break;
        }
        case 'jobs.list': data={jobs:jobs.list(owner)}; break;
        case 'job.status': data=jobs.status(owner,input.id); break;
        default: fail('unsupported_operation');
      }
      return { ...data, sealedProfile:await sealProfile(profile,recoveryKey) };
    } finally { locks.delete(owner); }
  };
}
