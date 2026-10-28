import {casesDatabase,submitCase} from '../shared/cases-store.mjs';
import {casesAccess,requireCasesPartner} from '../shared/cases-access.mjs';
import {casesResponse,casesError,casesBody} from '../shared/cases-http.mjs';
export function createCasesSubmitHandler({database=casesDatabase,configuration=casesAccess,clock=Date.now}={}){
  return async request=>{
    if(request.method!=='POST')return casesResponse(405,{error:'method_not_allowed'});
    try{
      const partner=await requireCasesPartner(request.headers.get('authorization'),await configuration());
      const body=await casesBody(request);
      if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['externalId','case'].includes(k)))return casesResponse(400,{error:'invalid_submission'});
      const result=await submitCase(database(),{partner,externalId:body.externalId,content:body.case},{now:clock()});
      return casesResponse(result.duplicate?200:202,{ok:true,...result,reviewRequired:true});
    }catch(error){return casesError(error);}
  };
}
export default createCasesSubmitHandler();
