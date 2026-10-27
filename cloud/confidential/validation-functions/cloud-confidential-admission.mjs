// Dedicated development deployment only; never used by the production function entrypoint.
import {confidentialAdmission} from '../../../netlify/functions/cloud-confidential-admission.mjs';
const admission=confidentialAdmission({operatingMode:'development',
  validationOwnerId:'6f454f7b-b490-4fe9-9c49-48ce5b6f4408',validationMaxBytes:25*1024**3});
export default async function handler(request){
  const result=await admission({httpMethod:request.method,headers:Object.fromEntries(request.headers),
    body:request.method==='POST'?await request.text():''});
  return new Response(result.body,{status:result.statusCode,headers:result.headers});
}
