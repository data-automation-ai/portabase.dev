import {casesDatabase,readCases} from '../shared/cases-store.mjs';
import {casesResponse,casesError,casesPage} from '../shared/cases-http.mjs';
export function createCasesHandler({database=casesDatabase}={}){
  return async request=>{
    if(request.method!=='GET')return casesResponse(405,{error:'method_not_allowed'});
    try{
      const offset=casesPage(request),params=new URL(request.url).searchParams,order=params.get('order')||'recent';
      if(!['recent','impact'].includes(order))return casesResponse(400,{error:'invalid_order'});
      const result=await readCases(database(),{order});
      if(!result.available)return casesResponse(503,{error:'cases_not_initialized'});
      return casesResponse(200,{...result,cases:result.cases.slice(offset,offset+200),total:result.cases.length,nextOffset:offset+200<result.cases.length?offset+200:null});
    }catch(error){return casesError(error);}
  };
}
export default createCasesHandler();
