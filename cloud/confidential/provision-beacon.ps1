param(
  [Parameter(Mandatory=$true)][string]$ApplicationDigest,
  [Parameter(Mandatory=$true)][string]$ControllerUrl,
  [switch]$Apply
)
$ErrorActionPreference='Stop'
if($ApplicationDigest -notmatch '^sha256:[a-f0-9]{64}$'){throw 'Reviewed immutable application digest required'}
if($ControllerUrl -notmatch '^https://portabase-confidential-controller-[a-z0-9-]+\.a\.run\.app$'){throw 'Approved controller URL required'}
$beaconProject='portabase-dev';$beaconAccount='rfiddomains@gmail.com';$number='495102144848'
$bucket='portabase-beacon-delegations-495102144848';$pool='portabase-beacon';$provider='confidential-space'
$runtime='pb-conf-runtime@portabase-dev.iam.gserviceaccount.com';$controller='pb-conf-controller@portabase-dev.iam.gserviceaccount.com'
$scheduler='pb-beacon-scheduler@portabase-dev.iam.gserviceaccount.com'
$principal="principalSet://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/$pool/attribute.image_digest/$ApplicationDigest"
# Google token claims define cmd_override as a list and env_override as a map.
# Match the independent verifier: absent or empty only; reject NODE_OPTIONS etc.
# https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/attestation-assertions
$condition="assertion.swname == 'CONFIDENTIAL_SPACE' && assertion.secboot == true && assertion.dbgstat == 'disabled-since-boot' && assertion.hwmodel == 'GCP_INTEL_TDX' && assertion.submods.gce.project_number == '$number' && assertion.submods.container.image_digest == '$ApplicationDigest' && assertion.submods.container.args == ['node','/app/cloud/confidential/production-workload.mjs'] && (!has(assertion.submods.container.cmd_override) || size(assertion.submods.container.cmd_override) == 0) && (!has(assertion.submods.container.env_override) || size(assertion.submods.container.env_override) == 0) && assertion.submods.container.restart_policy == 'Never' && 'STABLE' in assertion.submods.confidential_space.support_attributes && 'USABLE' in assertion.submods.confidential_space.support_attributes && '$runtime' in assertion.google_service_accounts"
$mapping="google.subject='gcpcs::'+assertion.submods.gce.instance_id,attribute.image_digest=assertion.submods.container.image_digest"
$commands=@(
  ,@('services','enable','cloudkms.googleapis.com','iam.googleapis.com','sts.googleapis.com','storage.googleapis.com','cloudscheduler.googleapis.com','monitoring.googleapis.com')
  ,@('storage','buckets','create',"gs://$bucket",'--location=us-central1','--uniform-bucket-level-access','--public-access-prevention')
  ,@('kms','keyrings','create','portabase-beacon','--location=us-central1')
  ,@('kms','keys','create','delegations','--keyring=portabase-beacon','--location=us-central1','--purpose=encryption')
  ,@('iam','workload-identity-pools','create',$pool,'--location=global','--display-name=Portabase attested beacon')
  ,@('iam','workload-identity-pools','providers','create-oidc',$provider,"--workload-identity-pool=$pool",'--location=global','--issuer-uri=https://confidentialcomputing.googleapis.com','--allowed-audiences=https://sts.googleapis.com',"--attribute-mapping=$mapping","--attribute-condition=$condition")
  ,@('kms','keys','add-iam-policy-binding','delegations','--keyring=portabase-beacon','--location=us-central1',"--member=$principal",'--role=roles/cloudkms.cryptoKeyEncrypterDecrypter')
  ,@('storage','buckets','add-iam-policy-binding',"gs://$bucket","--member=$principal",'--role=roles/storage.objectAdmin')
  ,@('storage','buckets','add-iam-policy-binding',"gs://$bucket","--member=serviceAccount:$controller",'--role=roles/storage.objectViewer')
  ,@('storage','buckets','add-iam-policy-binding',"gs://$bucket","--member=serviceAccount:$controller",'--role=roles/storage.objectAdmin',"--condition=expression=resource.name.startsWith('projects/_/buckets/$bucket/objects/leases/'),title=beacon-leases-only")
  ,@('projects','add-iam-policy-binding',$beaconProject,"--member=serviceAccount:$controller",'--role=roles/monitoring.viewer','--condition=None')
  ,@('iam','service-accounts','create','pb-beacon-scheduler','--display-name=Portabase beacon scheduler')
  ,@('scheduler','jobs','create','http','portabase-destination-beacons','--location=us-central1','--schedule=* * * * *','--time-zone=UTC',"--uri=$ControllerUrl/beacon/tick",'--http-method=POST','--message-body={}',"--oidc-service-account-email=$scheduler","--oidc-token-audience=$ControllerUrl/beacon/tick",'--attempt-deadline=60s','--max-retry-attempts=0')
  ,@('run','services','update','portabase-confidential-controller','--region=us-central1',"--update-env-vars=PORTABASE_BEACONS_ENABLED=1,BEACON_SCHEDULER_AUDIENCE=$ControllerUrl/beacon/tick")
)
if(-not $Apply){$commands|ForEach-Object{[pscustomobject]@{program='gcloud';args=@($_)+@("--project=$beaconProject","--account=$beaconAccount",'--quiet')}}|ConvertTo-Json -Depth 5;return}
# Apply is deliberately strict: stop on existing resources or partial failures.
# Inspect and reconcile them before continuing, never replace an IAM policy.
$identity=& gcloud projects describe $beaconProject "--account=$beaconAccount" '--format=value(projectNumber)'
if($LASTEXITCODE -ne 0 -or "$identity".Trim() -ne $number){throw 'Wrong Google project'}
foreach($command in $commands){
  & gcloud @command "--project=$beaconProject" "--account=$beaconAccount" --quiet
  if($LASTEXITCODE -ne 0){throw "Beacon provisioning stopped at $($command[0..1] -join ' '); inspect state before retry"}
}
