param([Parameter(Mandatory=$true)][string]$ApplicationDigest,
  [Parameter(Mandatory=$true)][string]$ControllerDigest,
  [Parameter(Mandatory=$true)][string]$ValidationCustomer,
  [Parameter(Mandatory=$true)][string]$AdmissionEndpoint)
$ErrorActionPreference='Stop'
if($ApplicationDigest -notmatch '^sha256:[a-f0-9]{64}$' -or $ControllerDigest -notmatch '^sha256:[a-f0-9]{64}$'){throw 'Immutable image digests required'}
if($ValidationCustomer -notmatch '^[a-f0-9-]{36}$'){throw 'Explicit validation customer required'}
if($AdmissionEndpoint -notmatch '^https://[a-f0-9]{24}--portabase-dev\.netlify\.app/\.netlify/functions/cloud-confidential-admission$'){throw 'Explicit isolated admission endpoint required'}
$controlProject='portabase-dev';$controlAccount='rfiddomains@gmail.com';$controlRegion='us-central1'
$network='portabase-confidential';$controller='pb-conf-controller@portabase-dev.iam.gserviceaccount.com'
$runner='pb-conf-runtime@portabase-dev.iam.gserviceaccount.com'
function G([string[]]$CommandArgs){
  $result=& gcloud @CommandArgs --project=$controlProject --account=$controlAccount --quiet
  if($LASTEXITCODE -ne 0){throw "gcloud failed: $($CommandArgs[0..1] -join ' ')"};return $result
}
$identity=G @('projects','describe',$controlProject,'--format=json(projectId,projectNumber,name)') | ConvertFrom-Json
if($identity.projectNumber -ne '495102144848' -or $identity.name -ne 'Portabase'){throw 'Wrong project'}
$networks=G @('compute','networks','list','--format=value(name)')
if($networks -notcontains $network){G @('compute','networks','create',$network,'--subnet-mode=custom','--format=value(name)')}
$subnets=G @('compute','networks','subnets','list',"--regions=$controlRegion",'--format=value(name)')
if($subnets -notcontains $network){G @('compute','networks','subnets','create',$network,"--network=$network","--region=$controlRegion",'--range=10.98.0.0/24','--enable-private-ip-google-access','--format=value(name)')}
$subnet=G @('compute','networks','subnets','describe',$network,"--region=$controlRegion",'--format=json(network,ipCidrRange)') | ConvertFrom-Json
if($subnet.ipCidrRange -ne '10.98.0.0/24' -or $subnet.network -notmatch '/networks/portabase-confidential$'){throw 'Network identity mismatch'}
$firewalls=G @('compute','firewall-rules','list','--format=value(name)')
if($firewalls -notcontains 'portabase-confidential-private'){
  G @('compute','firewall-rules','create','portabase-confidential-private',"--network=$network",'--allow=tcp:8080',
    '--source-ranges=10.98.0.0/24','--target-tags=portabase-confidential-runner','--description=Encrypted workload API from private controller subnet only','--format=value(name)')
}
$accounts=G @('iam','service-accounts','list','--format=value(email)')
if($accounts -notcontains $controller){G @('iam','service-accounts','create','pb-conf-controller','--display-name=Portabase confidential compute controller','--format=value(email)')}
G @('projects','add-iam-policy-binding',$controlProject,"--member=serviceAccount:$controller",'--role=roles/compute.instanceAdmin.v1','--condition=None','--format=value(etag)')
G @('iam','service-accounts','add-iam-policy-binding',$runner,"--member=serviceAccount:$controller",'--role=roles/iam.serviceAccountUser','--format=value(etag)')
G @('compute','networks','subnets','add-iam-policy-binding',$network,"--region=$controlRegion","--member=serviceAccount:$controller",'--role=roles/compute.networkUser','--format=value(etag)')
$imageBase="$controlRegion-docker.pkg.dev/$controlProject/portabase-confidential"
G @('run','deploy','portabase-confidential-controller',"--region=$controlRegion","--image=$imageBase/controller@$ControllerDigest",
  "--service-account=$controller",'--execution-environment=gen2','--cpu=1','--memory=512Mi','--min-instances=0','--max-instances=3',
  '--concurrency=8','--timeout=75s',"--network=$network","--subnet=$network",'--vpc-egress=private-ranges-only',
  "--set-env-vars=APPLICATION_IMAGE=$imageBase/application@$ApplicationDigest,VALIDATION_CUSTOMERS=$ValidationCustomer,PORTABASE_ADMISSION_ENDPOINT=$AdmissionEndpoint",
  '--ingress=all','--allow-unauthenticated','--labels=product=portabase,purpose=confidential-validation','--async','--format=json(metadata.name,status.url)')
