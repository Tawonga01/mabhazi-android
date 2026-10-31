import {createHmac,timingSafeEqual} from 'node:crypto';

export type AdminReviewItem={routeId:string;subjectId:string;contributionId:string;observationId:string|null;
 fieldKey:string;subjectRevision:string;observationRevision:string|null;targetRevision:string|null;
 assessmentId:string|null;caseRevision:string;reviewId?:string|null};
export type AdminReviewPreview={version:1;actor:string;operation:'approve'|'reverse';issuedAt:number;expiresAt:number;items:AdminReviewItem[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields=new Set(['route.origin','route.destination','operator.reported','operator.identity','departure.reported',
 'departure.scheduled','departure.actual','arrival.scheduled','arrival.actual','service.calendar','fare.paid','fare.quoted',
 'fare.advertised','boarding.pickup','alighting.dropoff','stop.location','pattern.stops','timetable.sign_presence']);
const keys=['routeId','subjectId','contributionId','observationId','fieldKey','subjectRevision','observationRevision','targetRevision','assessmentId','caseRevision','reviewId'];
const revision=(v:unknown,zero=false)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)>=(zero?0n:1n)&&BigInt(v)<=9007199254740991n;
const id=(v:unknown)=>typeof v==='string'&&uuid.test(v);
export function validReviewItems(items:unknown,operation:'approve'|'reverse'):items is AdminReviewItem[]{
 if(!Array.isArray(items)||!items.length||items.length>2000)return false;
 const claims=new Set<string>(),routes=new Set<string>();
 for(const raw of items){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!keys.includes(k)))return false;
  const i=raw as AdminReviewItem,core=i.fieldKey==='route.origin'||i.fieldKey==='route.destination';
  if(!id(i.routeId)||!id(i.subjectId)||!id(i.contributionId)||!fields.has(i.fieldKey)||!revision(i.subjectRevision)||!revision(i.caseRevision,true))return false;
  if(core?(i.observationId!==null||i.subjectId!==i.routeId||i.observationRevision!==null||i.targetRevision!==null||i.assessmentId!==null):
   (!id(i.observationId)||!revision(i.observationRevision)||!revision(i.targetRevision)||(i.assessmentId!==null&&!id(i.assessmentId))))return false;
  if(operation==='reverse'?!id(i.reviewId):(i.reviewId!==undefined&&i.reviewId!==null&&!id(i.reviewId)))return false;
  const key=JSON.stringify([i.routeId,i.fieldKey,i.observationId]);if(claims.has(key))return false;claims.add(key);routes.add(i.routeId);
 }
 return routes.size<=100;
}
const key=(secret:string)=>{if(typeof secret!=='string'||secret.length<16)throw new Error('admin_signing_unavailable');return secret;};
export function createReviewPreview(actor:string,operation:'approve'|'reverse',items:AdminReviewItem[],secret:string,now=Date.now()):string{
 if(typeof actor!=='string'||!actor||actor.length>200||!['approve','reverse'].includes(operation)||!validReviewItems(items,operation))throw new Error('admin_preview_invalid');
 const value:AdminReviewPreview={version:1,actor,operation,issuedAt:now,expiresAt:now+300000,items};
 const body=Buffer.from(JSON.stringify(value)).toString('base64url');
 return body+'.'+createHmac('sha256',key(secret)).update('mabhazi-admin-preview/1\0'+body).digest('base64url');
}
// An expired but authentic preview may retrieve an already committed identical
// command. It may never start a new write; the action handler checks the receipt.
export function readReviewPreview(token:unknown,actor:string,secret:string,now=Date.now()):{value:AdminReviewPreview;expired:boolean}|null{
 if(typeof token!=='string'||token.length>900000)return null;
 const parts=token.split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))return null;
 const expected=createHmac('sha256',key(secret)).update('mabhazi-admin-preview/1\0'+parts[0]).digest();
 const signature=Buffer.from(parts[1],'base64url');if(signature.length!==expected.length||!timingSafeEqual(expected,signature))return null;
 try{
  const v=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')) as AdminReviewPreview;
  if(!v||Object.keys(v).sort().join(',')!=='actor,expiresAt,issuedAt,items,operation,version'||v.version!==1||v.actor!==actor||!['approve','reverse'].includes(v.operation)
   ||!Number.isSafeInteger(v.issuedAt)||!Number.isSafeInteger(v.expiresAt)||v.expiresAt-v.issuedAt!==300000||v.issuedAt>now+30000||!validReviewItems(v.items,v.operation))return null;
  return {value:v,expired:v.expiresAt<=now};
 }catch{return null;}
}
