import {casesDatabase,readCases,editCase} from '../shared/cases-store.mjs';
import {casesAccess,requireCasesEditor} from '../shared/cases-access.mjs';
import {verifyCloudUser} from '../shared/verify-user.mjs';
import {casesResponse,casesError,casesBody,casesOrigin,casesPage} from '../shared/cases-http.mjs';
export function createCasesManageHandler({database=casesDatabase,configuration=casesAccess,authenticate=verifyCloudUser,clock=Date.now}={}){
  return async request=>{
    if(!['GET','POST'].includes(request.method))return casesResponse(405,{error:'method_not_allowed'});
    let user;
    try{user=await authenticate({headers:Object.fromEntries(request.headers),httpMethod:request.method});}
    catch{return casesResponse(401,{error:'sign_in_required'});}
    try{
      casesOrigin(request);const editor=await requireCasesEditor(user,await configuration());
      if(request.method==='GET'){
        const offset=casesPage(request),data=await readCases(database(),{editor:true});
        const counts={total:data.cases.length,pending:data.cases.filter(x=>x.state==='pending').length,published:data.cases.filter(x=>x.published).length};
        return casesResponse(200,{...data,cases:data.cases.slice(offset,offset+100),counts,nextOffset:offset+100<data.cases.length?offset+100:null});
      }
      const result=await editCase(database(),await casesBody(request),{editor,now:clock()});
      return casesResponse(200,{ok:true,...result});
    }catch(error){return casesError(error);}
  };
}
export default createCasesManageHandler();
