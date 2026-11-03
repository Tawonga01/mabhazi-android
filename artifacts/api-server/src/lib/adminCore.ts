import {createHmac,timingSafeEqual} from 'node:crypto';
import {validAdminId} from './adminEvidence';

export const coreFields=['route.origin','route.destination','operator.reported','departure.reported'] as const;
export type CoreField=typeof coreFields[number];
export const coreBases=['unprovided','travelled','saw_operating','observed_sign','operator_statement','heard_from_other'] as const;
export type CoreProposal={routeId:string;operation:'correct'|'reverse';field:CoreField;value:Record<string,unknown>|null;
 basis:typeof coreBases[number];observedDate:string|null;reason:string;reversedActionId:string|null};
type Proof=CoreProposal&{version:1;actor:string;revision:string;issuedAt:number;expiresAt:number};
const domain='mabhazi-admin-core/1\0';
export function parseCoreProposal(raw:unknown):CoreProposal|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const p=raw as Record<string,unknown>;
 if(Object.keys(p).sort().join(',')!=='basis,field,observedDate,operation,reason,reversedActionId,routeId,value'
  ||!validAdminId(p.routeId)||!coreFields.includes(p.field as CoreField)||!['correct','reverse'].includes(String(p.operation))
  ||!coreBases.includes(p.basis as typeof coreBases[number])||!['source_checked','typing_error','operator_checked','decision_incorrect'].includes(String(p.reason))
  ||p.observedDate!==null&&(typeof p.observedDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.observedDate)
   ||!Number.isFinite(Date.parse(p.observedDate))||new Date(p.observedDate).toISOString().slice(0,10)!==p.observedDate))return null;
 if(p.operation==='reverse')return validAdminId(p.reversedActionId)&&p.value===null&&p.basis==='unprovided'&&p.observedDate===null?p as CoreProposal:null;
 if(p.reversedActionId!==null||!p.value||typeof p.value!=='object'||Array.isArray(p.value))return null;
 const v=p.value as Record<string,unknown>;
 if(p.field==='route.origin'||p.field==='route.destination'){
  if(Object.keys(v).join(',')!=='cityId'||!Number.isSafeInteger(v.cityId)||Number(v.cityId)<1||Number(v.cityId)>2147483647)return null;
 }else if(p.field==='operator.reported'){
  if(Object.keys(v).join(',')!=='name'||typeof v.name!=='string'||!v.name.trim()||v.name!==v.name.trim()||v.name.length>120||/[\u0000-\u001f\u007f]/.test(v.name))return null;
 }else if(Object.keys(v).sort().join(',')!=='basis,time'||typeof v.time!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v.time)
  ||!['unspecified','scheduled','actual'].includes(String(v.basis)))return null;
 return p as CoreProposal;
}
export function createCorePreview(p:CoreProposal,actor:string,revision:string,secret:string,now=Date.now()){
 if(secret.length<16)throw Error('admin_signing_unavailable');
 const body=Buffer.from(JSON.stringify({...p,version:1,actor,revision,issuedAt:now,expiresAt:now+300000})).toString('base64url');
 return body+'.'+createHmac('sha256',secret).update(domain+body).digest('base64url');
}
export function readCorePreview(token:unknown,actor:string,secret:string,now=Date.now()):Proof|null{
 if(secret.length<16||typeof token!=='string'||token.length>5000)return null;
 const [body,sig,...extra]=token.split('.');if(extra.length||!body||!/^[A-Za-z0-9_-]+$/.test(body)||!sig||!/^[A-Za-z0-9_-]{43}$/.test(sig))return null;
 const mac=createHmac('sha256',secret).update(domain+body).digest(),given=Buffer.from(sig,'base64url');
 if(mac.length!==given.length||!timingSafeEqual(mac,given))return null;
 try{const p=JSON.parse(Buffer.from(body,'base64url').toString()) as Proof;
  const {version,actor:owner,revision,issuedAt,expiresAt,...proposal}=p;
  if(version!==1||owner!==actor||typeof revision!=='string'||!/^[1-9][0-9]{0,15}$/.test(revision)||BigInt(revision)>9007199254740991n
   ||!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(expiresAt)||expiresAt-issuedAt!==300000||issuedAt>now+30000
   ||!parseCoreProposal(proposal))return null;
  // Expiry is enforced under the SQL lock after exact receipt replay.
  return p;
 }catch{return null;}
}
