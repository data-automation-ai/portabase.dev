import {createHash,timingSafeEqual} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {casesFailure} from './cases-store.mjs';
export const casesAccessDatabase=()=>getStore({name:'portabase-cases-access',consistency:'strong'});
export async function casesAccess(db=casesAccessDatabase()){
  const value=await db.get('access-v1',{type:'json'});
  if(!value)return {version:1,editors:[],partners:{}};
  if(value.version!==1||!Array.isArray(value.editors)||!value.editors.every(x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x))||!value.partners||typeof value.partners!=='object'||Array.isArray(value.partners))casesFailure('cases_access_unavailable',503);
  return value;
}
export async function requireCasesEditor(user,access){
  if(user.cloudVersion!=='supabase'||!user.emailVerified||!access.editors.includes(user.id))casesFailure('cases_editor_required',403);
  return user.id;
}
export async function requireCasesPartner(authorization,access){
  const match=/^Bearer (pbc_([a-f0-9]{16})_[A-Za-z0-9_-]{43})$/.exec(authorization||'');
  if(!match)casesFailure('partner_unauthorized',401);
  const row=access.partners[match[2]];
  if(!row||row.revoked===true||!/^[a-f0-9]{64}$/.test(row.tokenHash||''))casesFailure('partner_unauthorized',401);
  const actual=createHash('sha256').update(match[1]).digest(),expected=Buffer.from(row.tokenHash,'hex');
  if(!timingSafeEqual(actual,expected))casesFailure('partner_unauthorized',401);
  if(typeof row.name!=='string'||row.name.length>120||!Number.isInteger(row.dailyLimit)||row.dailyLimit<1||row.dailyLimit>1000)casesFailure('cases_access_unavailable',503);
  return {id:match[2],name:row.name,dailyLimit:row.dailyLimit};
}
