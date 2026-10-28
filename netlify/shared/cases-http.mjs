export const casesResponse=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export const casesError=error=>casesResponse(error.status||503,{error:error.code||'cases_service_unavailable'});
export async function casesBody(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw Object.assign(Error(),{code:'json_required',status:415});
  if(Number(request.headers.get('content-length'))>12000)throw Object.assign(Error(),{code:'body_too_large',status:413});
  const raw=await request.text();
  if(Buffer.byteLength(raw)>12000)throw Object.assign(Error(),{code:'body_too_large',status:413});
  try{return JSON.parse(raw);}catch{throw Object.assign(Error(),{code:'invalid_json',status:400});}
}
export function casesOrigin(request){
  const origin=request.headers.get('origin');
  if(origin&&origin!=='https://portabase.dev')throw Object.assign(Error(),{code:'origin_rejected',status:403});
}
export function casesPage(request){
  const params=new URL(request.url).searchParams,raw=params.get('offset')||'0';
  if(!/^\d{1,5}$/.test(raw)||Number(raw)>5000)throw Object.assign(Error(),{code:'invalid_offset',status:400});
  return Number(raw);
}
