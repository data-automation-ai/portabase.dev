param([Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit,[string]$BuildId='20261024a',
  [string]$AdmissionEndpoint='', [switch]$BuildOnly)
$ErrorActionPreference='Stop'
if($BuildId -notmatch '^[a-z0-9]{6,20}$'){throw 'Invalid build id'}
if($AdmissionEndpoint -and $AdmissionEndpoint -notmatch '^https://[a-f0-9]{24}--portabase-dev\.netlify\.app/\.netlify/functions/cloud-confidential-admission$'){throw 'Invalid isolated admission endpoint'}
$buildProject='portabase-dev';$buildAccount='rfiddomains@gmail.com';$buildRegion='us-central1'
$builder='pb-conf-builder@portabase-dev.iam.gserviceaccount.com'
$runner='pb-conf-runtime@portabase-dev.iam.gserviceaccount.com'
$repository='portabase-confidential';$bucket='pb-conf-source-495102144848'
function G([string[]]$CommandArgs){
  $result=& gcloud @CommandArgs --project=$buildProject --account=$buildAccount --quiet
  if($LASTEXITCODE -ne 0){throw "gcloud failed: $($CommandArgs[0..1] -join ' ')"}
  return $result
}
$identity=G @('projects','describe',$buildProject,'--format=json(projectId,projectNumber,name)') | ConvertFrom-Json
if($identity.projectNumber -ne '495102144848' -or $identity.name -ne 'Portabase'){throw 'Wrong Google project'}
$source=(Resolve-Path -LiteralPath $SourceRoot).Path
if($source.StartsWith('F:',[StringComparison]::OrdinalIgnoreCase)){throw 'Forbidden drive'}
$root=& git -C $source rev-parse --show-toplevel
if($LASTEXITCODE -ne 0 -or $root.Replace('/','\') -ne $source){throw 'Source must be a verified Git root'}
$commit=& git -C $source rev-parse "$SourceCommit^{commit}"
if($LASTEXITCODE -ne 0 -or $commit -ne $SourceCommit){throw 'SourceCommit must identify the reviewed commit exactly'}
# Unknown dirty files stay untouched; only immutable reviewed Git objects enter the image.
$stage=Join-Path $source ".portabase/confidential-build-$BuildId"
if(Test-Path -LiteralPath $stage){throw 'Stage already exists; inspect before reuse'}
New-Item -ItemType Directory -Path "$stage/cloud/confidential","$stage/cloud/runner","$stage/utility" | Out-Null
$runtime=@('attestation.mjs','google-token.mjs','command-channel.mjs','customer-identity.mjs','customer-profile.mjs',
  'oauth-connections.mjs','dropbox-vault.mjs','supabase-access.mjs','pg-command.mjs','supabase-root.crt','engine-jobs.mjs','application.mjs',
  'cloud-config.mjs','server.mjs','production-workload.mjs','Dockerfile.application','package.json','package-lock.json',
  'controller.mjs','controller-main.mjs','compute-control.mjs','Dockerfile.controller',
  's3-vault.mjs','r2-vault.mjs','binary-vault-store.mjs','binary-catalog.mjs','manifest-envelope.mjs','usage-meter.mjs','usage-attestation.mjs',
  'beacon-config.mjs','beacon-storage.mjs','beacon-crypto.mjs','destination-beacon.mjs','beacon-worker.mjs',
  'beacon-scheduler.mjs','beacon-scheduler-identity.mjs','runner-usage.mjs')
$paths=@('package.json','package-lock.json','cloud/control-plane/forbidden.mjs')
$tree=@(& git -C $source ls-tree -r --name-only $commit -- cloud/runner utility)
if($LASTEXITCODE -ne 0){throw 'Unable to enumerate reviewed source tree'}
$paths+=@($tree | Where-Object {$_ -match '^cloud/runner/.+\.mjs$' -and $_ -notmatch '\.test\.mjs$'})
$paths+=@($runtime | ForEach-Object {"cloud/confidential/$_"})
$paths+=@($tree | Where-Object {($_ -match '^utility/.+\.mjs$' -and $_ -notmatch '\.test\.mjs$') -or $_ -match '^utility/aws/schema/[^/]+\.json$'})
$paths=@($paths | Sort-Object -Unique)
foreach($relative in $paths){
  if($relative -match '(^|/)(\.env|node_modules|evidence|credentials)' -or $relative -match '\.\.'){throw 'Unsafe source path'}
}
$archive=Join-Path $stage 'reviewed-source.tar'
& git -C $source archive --format=tar "--output=$archive" $commit -- @paths
if($LASTEXITCODE -ne 0){throw 'Unable to archive reviewed source; required modules may not be committed'}
& tar -xf $archive -C $stage
if($LASTEXITCODE -ne 0){throw 'Unable to extract reviewed source'}
$manifest=@()
foreach($relative in $paths){
  $to=Join-Path $stage $relative
  if(-not (Test-Path -LiteralPath $to -PathType Leaf)){throw 'Reviewed source is incomplete'}
  $manifest+=@{path=$relative;sha256=(Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash.ToLower()}
}
if(-not $BuildOnly){
$repos=G @('artifacts','repositories','list',"--location=$buildRegion",'--format=value(name)')
if($repos -notcontains $repository -and -not ($repos | Where-Object {$_ -match "/$repository$"})){
  G @('artifacts','repositories','create',$repository,'--repository-format=docker',"--location=$buildRegion",'--description=Portabase attested application images','--format=value(name)')
}
$accounts=G @('iam','service-accounts','list','--format=value(email)')
foreach($id in @('pb-conf-builder','pb-conf-runtime')){
  if($accounts -notcontains "$id@$buildProject.iam.gserviceaccount.com"){
    G @('iam','service-accounts','create',$id,"--display-name=$id",'--format=value(email)')
  }
}
G @('artifacts','repositories','add-iam-policy-binding',$repository,"--location=$buildRegion","--member=serviceAccount:$builder",'--role=roles/artifactregistry.writer','--format=value(etag)')
G @('artifacts','repositories','add-iam-policy-binding',$repository,"--location=$buildRegion","--member=serviceAccount:$runner",'--role=roles/artifactregistry.reader','--format=value(etag)')
G @('projects','add-iam-policy-binding',$buildProject,"--member=serviceAccount:$builder",'--role=roles/logging.logWriter','--condition=None','--format=value(etag)')
G @('projects','add-iam-policy-binding',$buildProject,"--member=serviceAccount:$runner",'--role=roles/confidentialcomputing.workloadUser','--condition=None','--format=value(etag)')
G @('secrets','add-iam-policy-binding','portabase-confidential-oauth',"--member=serviceAccount:$runner",'--role=roles/secretmanager.secretAccessor','--format=value(etag)')
$buckets=G @('storage','buckets','list','--format=value(name)')
if($buckets -notcontains $bucket){G @('storage','buckets','create',"gs://$bucket","--location=$buildRegion",'--uniform-bucket-level-access','--public-access-prevention')}
G @('storage','buckets','add-iam-policy-binding',"gs://$bucket","--member=serviceAccount:$builder",'--role=roles/storage.objectViewer','--format=value(etag)')
}
$image="$buildRegion-docker.pkg.dev/$buildProject/$repository/application:$BuildId"
$controllerImage="$buildRegion-docker.pkg.dev/$buildProject/$repository/controller:$BuildId"
$config=@{steps=@(@{name='gcr.io/cloud-builders/docker';args=@('build','--build-arg',"VALIDATION_ADMISSION_ENDPOINT=$AdmissionEndpoint",'-f','cloud/confidential/Dockerfile.application','-t',$image,'.')},
    @{name='gcr.io/cloud-builders/docker';args=@('build','-f','cloud/confidential/Dockerfile.controller','-t',$controllerImage,'.')});
  images=@($image,$controllerImage);timeout='1200s';serviceAccount="projects/$buildProject/serviceAccounts/$builder";options=@{logging='CLOUD_LOGGING_ONLY'}}
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$stage/cloudbuild.json" -Encoding utf8
$record=@{project=$buildProject;projectNumber='495102144848';sourceCommit=$commit;buildId=$BuildId;image=$image;admissionEndpoint=$AdmissionEndpoint;stage=$stage;files=$manifest;createdAt=[DateTime]::UtcNow.ToString('o')}
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot "evidence/application-inputs-$BuildId.json") -Encoding utf8
G @('builds','submit',$stage,"--config=$stage/cloudbuild.json","--region=$buildRegion","--gcs-source-staging-dir=gs://$bucket/source",'--async','--format=json(id,status,createTime)')
