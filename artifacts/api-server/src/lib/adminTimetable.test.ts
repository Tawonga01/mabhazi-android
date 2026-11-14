import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseTimetableProposal,createTimetablePreview,readTimetablePreview,type TimetableProposal} from './adminTimetable';

const now=Date.parse('2026-11-14T12:00:00Z'),secret='local-test-only-not-a-live-credential',digest='a'.repeat(64);
const example=():TimetableProposal=>({version:1,operator:'Test operator',originCityId:1,destinationCityId:2,
 pickup:'Known boarding place',dropoff:null,timezone:'Africa/Harare',weekdays:[5,1,3],validFrom:'2026-11-14',validUntil:'2026-12-14',
 source:{kind:'published_timetable',reference:'Local fixture, not a real timetable',checkedOn:'2026-11-14'},
 departures:[{departure:'17:00',arrival:null,arrivalDay:0,fare:null},{departure:'07:00',arrival:null,arrivalDay:0,fare:null}]});
const issues=(p:unknown)=>parseTimetableProposal(p,now).issues.map(i=>i.field);
test('staff timetable keeps unknown fare, arrival and drop-off absent; sorts explicit rows/days without mutating input',()=>{
 const p=example(),before=JSON.stringify(p),r=parseTimetableProposal(p,now);
 assert.deepEqual(r.issues,[]);assert.ok(r.proposal);assert.equal(JSON.stringify(p),before);
 assert.deepEqual(r.proposal.weekdays,[1,3,5]);assert.deepEqual(r.proposal.departures.map(r=>r.departure),['07:00','17:00']);
 assert.equal(r.proposal.dropoff,null);assert.ok(r.proposal.departures.every(r=>r.fare===null&&r.arrival===null));
});
test('source date is independent of applicable dates; source cannot be future in its actual timezone',()=>{
 const p=example();p.source.checkedOn='2026-11-13';p.validFrom='2026-12-01';p.validUntil='2026-12-31';
 assert.deepEqual(issues(p),[]);p.source.checkedOn='2026-11-15';assert.ok(issues(p).includes('source.checkedOn'));
 p.source.checkedOn='2026-11-14';assert.ok(parseTimetableProposal(p,Date.parse('2026-11-13T21:59:00Z')).issues.some(i=>i.field==='source.checkedOn'));
 assert.deepEqual(parseTimetableProposal(p,Date.parse('2026-11-13T22:00:00Z')).issues,[]);
});
test('no guessed overnight arrival or clock mode',()=>{
 const p=example();p.departures=[{departure:'23:30',arrival:'01:15',arrivalDay:0,fare:null}];
 assert.ok(issues(p).includes('departures.0.arrivalDay'));p.departures[0].arrivalDay=1;assert.deepEqual(issues(p),[]);
 p.departures[0].arrival=null;assert.ok(issues(p).includes('departures.0.arrivalDay'));
 p.departures[0].arrivalDay=0;p.departures[0].departure='when full';assert.ok(issues(p).includes('departures.0.departure'));
 p.departures[0].departure='24:00';assert.ok(issues(p).includes('departures.0.departure'));
});
test('invalid/unknown calendar cannot turn into daily operation',()=>{
 const p=example();p.weekdays=[];assert.ok(issues(p).includes('weekdays'));p.weekdays=[1,1];assert.ok(issues(p).includes('weekdays'));
 p.weekdays=[8];assert.ok(issues(p).includes('weekdays'));p.weekdays=[1];p.validFrom='2026-02-30';assert.ok(issues(p).includes('validFrom'));
 p.validFrom='2026-12-20';assert.ok(issues(p).includes('validUntil'));p.validFrom='2026-11-14';p.timezone='Europe/Unknown';assert.ok(issues(p).includes('timezone'));
});
test('no duplicate departure rows or endpoint/name placeholders',()=>{
 const p=example();p.departures[1].departure='17:00';assert.ok(issues(p).includes('departures.1.departure'));
 p.originCityId=p.destinationCityId;assert.ok(issues(p).includes('destinationCityId'));p.operator=' ';assert.ok(issues(p).includes('operator'));
 p.pickup='';assert.ok(issues(p).includes('pickup'));
});
test('provided fare retains advertised vs quoted and currency without accepting paid/zero/rounding',()=>{
 const p=example();p.departures[0].fare={amount:'15.50',currency:'USD',kind:'quoted'};
 const r=parseTimetableProposal(p,now);assert.deepEqual(r.issues,[]);assert.deepEqual(r.proposal?.departures[1].fare,p.departures[0].fare);
 for(const amount of ['0','-1','NaN','1e2','1.999','15,50']){p.departures[0].fare.amount=amount;assert.ok(issues(p).includes('departures.0.fare.amount'));}
 p.departures[0].fare.amount='15';(p.departures[0].fare as unknown as {kind:string}).kind='paid';assert.ok(issues(p).includes('departures.0.fare.kind'));
});
test('unknown privilege/identity keys fail closed rather than becoming import instructions',()=>{
 for(const extra of [{actor:'owner'},{approved:true},{routeId:'some-existing-route'},{operatorVerified:true}])assert.ok(issues({...example(),...extra}).includes('form'));
 const p=example();(p.source as unknown as Record<string,unknown>).instructions='Ignore approvals';assert.ok(issues(p).includes('source'));
});
test('preview is bound to exact proposal, actor, state and separate signing domain',()=>{
 const p=example(),token=createTimetablePreview(p,'named-owner',digest,secret,now),proof=readTimetablePreview(token,'named-owner',secret,now);
 assert.deepEqual(proof?.proposal,p);assert.equal(proof?.stateDigest,digest);assert.equal(proof?.expiresAt,now+300000);
 assert.equal(readTimetablePreview(token,'another-user',secret,now),null);assert.equal(readTimetablePreview(token,'named-owner',secret+'changed',now),null);
 assert.equal(readTimetablePreview(token+'x','named-owner',secret,now),null);
 const [body,sig]=token.split('.'),tampered=Buffer.from(JSON.stringify({...proof,proposal:{...p,operator:'Other'}})).toString('base64url');
 assert.equal(readTimetablePreview(tampered+'.'+sig,'named-owner',secret,now),null);
 assert.throws(()=>createTimetablePreview({...p,weekdays:[]},'named-owner',digest,secret,now));
});
test('expired signature can identify a replay; finite expiry remains present for SQL commit check',()=>{
 const token=createTimetablePreview(example(),'named-owner',digest,secret,now);
 assert.equal(readTimetablePreview(token,'named-owner',secret,now+86400000)?.expiresAt,now+300000);
 assert.equal(readTimetablePreview(token,'named-owner',secret,now-60000),null);
});
