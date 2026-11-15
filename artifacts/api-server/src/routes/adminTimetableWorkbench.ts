import {adminTimetableManagement} from './adminTimetableManagement';
// Reuses the authenticated workbench closure and its account-bound recovery.
// Publishing is offered only when the server advertises a working writer.
export const adminTimetableWorkbench=String.raw`
 const TT={draft:null,preview:null,issues:[],cities:{originCityId:[],destinationCityId:[]},queries:{originCityId:'',destinationCityId:''},available:false,revision:0,saveError:false,operators:[]};
 let ttWrites=Promise.resolve(),ttFindSequence={originCityId:0,destinationCityId:0};
 const ttDays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 const ttBlankRow=()=>({departure:'',arrival:null,arrivalDay:0,fare:null});
 const ttBlank=()=>({version:1,operator:'',operatorRef:null,separateOperator:false,originCityId:null,destinationCityId:null,pickup:'',dropoff:null,timezone:'Africa/Harare',weekdays:[],validFrom:'',validUntil:'',source:{kind:'published_timetable',reference:'',checkedOn:''},departures:[ttBlankRow()]});
 const ttDraftKey=account+':timetable-draft';
 async function ttWrite(snapshot){
  if(!S.storage)throw Error('Encrypted draft storage is unavailable.');
  const key=await recoveryKey(),iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(ttDraftKey)},key,new TextEncoder().encode(JSON.stringify(snapshot)));
  const expected=TT.revision;
  await new Promise((resolve,reject)=>{
   const tx=cache.transaction('commands','readwrite'),store=tx.objectStore('commands'),get=store.get(ttDraftKey);let changed=false;
   get.onsuccess=()=>{if((get.result?.revision||0)!==expected){changed=true;tx.abort();return;}store.put({revision:expected+1,iv,cipher},ttDraftKey);};
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(changed?Error('Another tab changed this timetable draft. Reopen Timetables before continuing.'):tx.error);
  });TT.revision=expected+1;
 }
 function ttStore(){
  const snapshot=JSON.parse(JSON.stringify({proposal:TT.draft,cities:TT.cities}));
  // A failed write stays a failure until the user reloads; later writes must not
  // silently overwrite an unseen draft from another tab.
  ttWrites=ttWrites.then(()=>ttWrite(snapshot)).catch(err=>{TT.saveError=true;throw err;});return ttWrites;
 }
 async function ttRead(){
  const saved=await stored('commands',ttDraftKey);TT.revision=saved?.revision||0;
  if(!saved)return null;
  const key=await stored('keys',account);if(!key)throw Error('The timetable draft cannot be unlocked in this browser.');
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:new TextEncoder().encode(ttDraftKey)},key,saved.cipher);
  const value=JSON.parse(new TextDecoder().decode(clear));
  if(!value?.proposal||value.proposal.version!==1||!Array.isArray(value.proposal.departures)||value.proposal.departures.length>30)throw Error('The saved draft could not be read.');
  return value;
 }
 async function ttOpen(){
  if(S.pending){message('Check the saved action receipt before starting another action.');return;}
  await api('/timetables/state');
  const saved=await ttRead();TT.draft=saved?.proposal||ttBlank();if(TT.draft.operatorRef===undefined)TT.draft.operatorRef=null;if(TT.draft.separateOperator===undefined)TT.draft.separateOperator=false;TT.cities=saved?.cities||{originCityId:[],destinationCityId:[]};
  for(const k of ['originCityId','destinationCityId'])TT.queries[k]=TT.cities[k]?.find(c=>c.id===TT.draft[k])?.name||'';TT.operators=[];++ttOperatorSequence;clearTimeout(ttOperatorTimer);TT.preview=null;TT.issues=[];TT.saveError=false;ttWrites=Promise.resolve();if(!saved)await ttStore();await tmLoad();TT.mode='records';TM.record=null;TM.confirmation=null;S.view='timetable';message('');render();
 }
 function ttField(label,key,value,type='text',attrs=''){
  const issue=TT.issues.find(i=>i.field===key),id='tt-'+key.replaceAll('.','-');
  return '<div class="tt-field"><label for="'+id+'">'+label+'</label><input id="'+id+'" data-tt="'+key+'" type="'+type+'" value="'+e(value??'')+'" '+attrs+(issue?' aria-invalid="true" aria-describedby="'+id+'-error"':'')+'>'+(issue?'<p class="tt-field-error" id="'+id+'-error">'+e(issue.message)+'</p>':'')+'</div>';
 }
 function ttOperatorChoices(){
  if(TT.draft.operatorRef)return '';
  return TT.operators.map(o=>'<button type="button" class="tt-city-option" data-do="tt-operator-select" data-operator="'+e(o.id)+'">'+e(o.name)+(o.countryCode?' · '+e(o.countryCode):'')+'</button>').join('')+
   (TT.operators.some(o=>o.name.toLowerCase()===TT.draft.operator.toLowerCase())?'<label class="tt-next-day"><input type="checkbox" data-tt="separateOperator" '+(TT.draft.separateOperator?'checked':'')+'> This is a different operator with the same name</label>':'');
 }
 function ttOperator(){return ttField('Operator','operator',TT.draft.operator,'text','maxlength="120" autocomplete="off"')+'<div id="tt-operator-choices" class="tt-city-choices">'+ttOperatorChoices()+'</div>';}
 let ttOperatorTimer,ttOperatorSequence=0;
 async function ttFindOperator(q){const seq=++ttOperatorSequence;try{const data=await api('/timetables/operators?q='+encodeURIComponent(q));
  if(seq!==ttOperatorSequence||q!==TT.draft.operator.trim()||S.view!=='timetable')return;
  TT.operators=data.operators;const choices=screen.querySelector('#tt-operator-choices');if(choices)choices.innerHTML=ttOperatorChoices();
 }catch(err){if(seq===ttOperatorSequence&&S.view==='timetable')error(err);}}
 function ttCityChoices(key){return (TT.cities[key]||[]).filter(c=>c.name.toLowerCase().includes(TT.queries[key].trim().toLowerCase())).map(c=>'<button type="button" class="tt-city-option" data-do="tt-city-select" data-key="'+key+'" data-city="'+c.id+'">'+e(c.name)+'</button>').join('');}
 function ttCity(key,label){
  return '<div class="tt-field"><label for="tt-'+key+'-query">'+label+'</label><input id="tt-'+key+'-query" data-tt-query="'+key+'" autocomplete="off" placeholder="City name" maxlength="120" value="'+e(TT.queries[key])+'" aria-controls="tt-'+key+'-choices"><div class="tt-city-choices" id="tt-'+key+'-choices">'+(!TT.draft[key]&&TT.queries[key]?ttCityChoices(key):'')+'</div>'+(TT.issues.some(i=>i.field===key)?'<p class="tt-field-error">'+e(TT.issues.find(i=>i.field===key).message)+'</p>':'')+'</div>';
 }
 let ttCityTimers={};
 async function ttFindCity(k,q){
  const seq=++ttFindSequence[k];
  try{const data=await api('/timetables/cities?q='+encodeURIComponent(q));
   if(seq!==ttFindSequence[k]||q!==TT.queries[k].trim()||S.view!=='timetable')return;
   TT.cities[k]=data.cities;
   const choices=screen.querySelector('#tt-'+k+'-choices');if(choices)choices.innerHTML=data.cities.length?ttCityChoices(k):'<p class="tt-city-empty">No matching cities</p>';
  }catch(err){if(seq===ttFindSequence[k]&&S.view==='timetable')error(err);}
 }
 function ttForm(){
  if(TT.mode==='records')return tmPage();
  if(!TT.draft)return '<p class="br-loading">Opening timetable…</p>';
  const d=TT.draft,p=TT.preview;
  const heading=btn('← All timetables','tt-records')+'<div class="ad-heading"><div><h1>'+e(p?'Review timetable':'Add timetable')+'</h1><p class="ad-subtitle">'+e(p?p.cities.origin+' → '+p.cities.destination:'One route. Add its departures together.')+'</p></div></div>';
  if(p){
   const q=p.proposal;
   return heading+'<section class="ad-panel"><div class="ad-panel-head"><h2>'+e(q.operator)+'</h2></div><div class="ad-panel-body"><div class="tt-review-facts"><div><span>Boarding</span><strong>'+e(q.pickup)+'</strong></div>'+(q.dropoff?'<div><span>Drop-off</span><strong>'+e(q.dropoff)+'</strong></div>':'')+'<div><span>Operating days</span><strong>'+q.weekdays.map(n=>ttDays[n-1]).join(' · ')+'</strong></div><div><span>Applies</span><strong>'+e(q.validFrom)+' — '+e(q.validUntil)+'</strong></div><div><span>Timezone</span><strong>'+e(q.timezone)+'</strong></div></div></div><div class="ad-table-wrap"><table><thead><tr><th>Departure</th><th>Arrival</th><th>Price</th></tr></thead><tbody>'+q.departures.map(r=>'<tr><td><strong>'+e(clock(r.departure))+'</strong></td><td>'+e(r.arrival?clock(r.arrival)+(r.arrivalDay?' · next day':''):'—')+'</td><td>'+e(r.fare?r.fare.currency+' '+r.fare.amount+' · '+r.fare.kind:'—')+'</td></tr>').join('')+'</tbody></table></div><div class="ad-panel-body"><dl class="tt-source-review"><dt>Source</dt><dd>'+e(q.source.kind==='published_timetable'?'Published timetable':'Operator confirmation')+'</dd><dt>Reference</dt><dd>'+e(q.source.reference)+'</dd><dt>Checked</dt><dd>'+e(q.source.checkedOn)+'</dd></dl>'+(p.replacements?.length?'<div class="ad-message">'+p.replacements.length+' matching '+(p.replacements.length===1?'record will':'records will')+' be removed from the app when this replacement is saved. Originals and history remain restorable.</div>':'')+(p.duplicates?.length?'<div class="ad-message">'+p.duplicates.map(d=>d.kind==='operator'?'Choose the existing operator, or confirm this is a different company.':d.kind==='legacy'?'A legacy departure at '+e(clock(d.departure))+' needs separate review.':('<div>'+e(clock(d.departure))+' · matching '+(d.kind==='lead'?'route report':'timetable')+' '+btn('Replace this record','tt-replace-candidate','data-kind="'+e(d.kind)+'" data-record="'+e(d.id)+'"')+'</div>')).join('')+'</div>':'')+'<div class="ad-actions">'+btn('Approve '+q.departures.length+' '+(q.departures.length===1?'departure':'departures'),'tt-apply',p.writable&&!p.duplicates?.length&&S.storage&&!S.pending&&!S.busy&&!TT.saveError?'':'disabled',true)+btn('Edit','tt-edit',S.busy?'disabled':'')+'</div></div></section>';
  }
  return heading+'<form id="tt-form" novalidate><div class="tt-layout"><div class="tt-primary"><section class="ad-panel"><div class="ad-panel-head"><h2>Route</h2></div><div class="ad-panel-body"><div class="tt-grid">'+'<div class="tt-operator-field">'+ttOperator()+'</div>'+ttCity('originCityId','From')+ttCity('destinationCityId','To')+ttField('Boarding place','pickup',d.pickup,'text','maxlength="200"')+ttField('Drop-off · optional','dropoff',d.dropoff,'text','maxlength="200"')+'</div></div></section><section class="ad-panel"><div class="ad-panel-head"><h2>Departures</h2><span class="ad-subtitle">'+d.departures.length+'</span></div><div class="ad-table-wrap tt-departures"><table><thead><tr><th>Departure</th><th>Arrival · optional</th><th>Price · optional</th><th></th></tr></thead><tbody>'+d.departures.map((r,i)=>'<tr><td>'+ttField('Departure '+(i+1),'departures.'+i+'.departure',r.departure,'time','step="60"')+'</td><td>'+ttField('Arrival '+(i+1),'departures.'+i+'.arrival',r.arrival,'time','step="60"')+'<label class="tt-next-day"><input type="checkbox" data-tt-day="'+i+'" '+(r.arrivalDay?'checked ':'')+(!r.arrival?'disabled':'')+'> Next day</label></td><td><div class="tt-price">'+ttField('Price '+(i+1),'departures.'+i+'.fare.amount',r.fare?.amount,'text','inputmode="decimal" maxlength="12"')+'<select data-tt="departures.'+i+'.fare.currency" aria-label="Currency '+(i+1)+'">'+['USD','ZAR','ZMW','MWK','BWP','ZWG'].map(c=>'<option '+((r.fare?.currency||'USD')===c?'selected':'')+'>'+c+'</option>').join('')+'</select></div><select class="tt-price-kind" data-tt="departures.'+i+'.fare.kind" aria-label="Price basis '+(i+1)+'"><option value="advertised" '+(r.fare?.kind!=='quoted'?'selected':'')+'>Advertised</option><option value="quoted" '+(r.fare?.kind==='quoted'?'selected':'')+'>Quoted by operator</option></select></td><td>'+btn('Remove','tt-remove','data-index="'+i+'" '+(d.departures.length===1?'disabled':'') )+'</td></tr>').join('')+'</tbody></table></div><div class="ad-panel-body">'+btn('+ Departure','tt-add',d.departures.length>=30?'disabled':'')+'</div></section></div><div class="tt-secondary"><section class="ad-panel"><div class="ad-panel-head"><h2>Operating schedule</h2></div><div class="ad-panel-body"><fieldset class="tt-weekdays"><legend>Days</legend><div>'+ttDays.map((name,i)=>'<label><input type="checkbox" data-tt-weekday="'+(i+1)+'" '+(d.weekdays.includes(i+1)?'checked':'')+'><span>'+name+'</span></label>').join('')+'</div></fieldset>'+ttField('From date','validFrom',d.validFrom,'date')+ttField('Until date','validUntil',d.validUntil,'date')+ttField('Timezone','timezone',d.timezone,'text','list="tt-timezones" maxlength="100"')+'<datalist id="tt-timezones"><option value="Africa/Harare"><option value="Africa/Lusaka"><option value="Africa/Blantyre"><option value="Africa/Johannesburg"><option value="Africa/Gaborone"></datalist></div></section><section class="ad-panel"><div class="ad-panel-head"><h2>Source</h2></div><div class="ad-panel-body"><div class="tt-field"><label for="tt-source-kind">Information from</label><select id="tt-source-kind" data-tt="source.kind"><option value="published_timetable" '+(d.source.kind==='published_timetable'?'selected':'')+'>Published timetable</option><option value="operator_confirmation" '+(d.source.kind==='operator_confirmation'?'selected':'')+'>Operator confirmation</option></select></div>'+ttField('Reference','source.reference',d.source.reference,'text','maxlength="1000" placeholder="Link, document or contact reference"')+ttField('Checked on','source.checkedOn',d.source.checkedOn,'date')+'</div></section></div></div><div id="tt-errors" role="alert">'+(TT.issues.length?'<p class="tt-field-error">'+e(TT.issues[0].message)+'</p>':'')+'</div><div class="tt-footer"><span id="tt-draft-state">'+e(TT.saveError?'Draft could not be saved':S.storage?'Draft saved privately in this browser':'Encrypted draft storage unavailable')+'</span>'+btn('Review timetable','tt-review',S.busy||S.pending||!S.storage||TT.saveError?'disabled':'',true)+'</div></form>';
 }
 function ttInput(t){
  if(t.id==='tt-command-reason'){TM.reason=t.value;render();return true;}
  if(S.view!=='timetable'||!TT.draft)return false;
  if(t.dataset.ttQuery){const k=t.dataset.ttQuery;TT.queries[k]=t.value;TT.draft[k]=null;TT.preview=null;++ttFindSequence[k];clearTimeout(ttCityTimers[k]);
   const choices=screen.querySelector('#tt-'+k+'-choices');if(choices)choices.innerHTML='';
   if(t.value.trim())ttCityTimers[k]=setTimeout(()=>ttFindCity(k,t.value.trim()),180);
   ttStore().catch(error);return true;}
  if(!t.dataset.tt&&!t.dataset.ttWeekday&&!t.dataset.ttDay)return false;
  const d=TT.draft,k=t.dataset.tt;delete d.replacements;TT.preview=null;TT.issues=[];
  if(t.dataset.ttWeekday){const day=Number(t.dataset.ttWeekday);d.weekdays=t.checked?[...new Set([...d.weekdays,day])].sort((a,b)=>a-b):d.weekdays.filter(v=>v!==day);}
  else if(t.dataset.ttDay)d.departures[Number(t.dataset.ttDay)].arrivalDay=t.checked?1:0;
  else if(k.startsWith('departures.')){
   const [,index,field,part]=k.split('.'),r=d.departures[Number(index)];
   if(field==='fare'){
    if(!r.fare)r.fare={amount:'',currency:'USD',kind:'advertised'};
    r.fare[part]=t.value;
   }else if(field==='arrival'){
    r.arrival=t.value||null;if(!r.arrival)r.arrivalDay=0;
    const next=screen.querySelector('[data-tt-day="'+index+'"]');if(next){next.disabled=!r.arrival;next.checked=!!r.arrivalDay;}
   }else r[field]=t.value;
  }else if(k.startsWith('source.'))d.source[k.slice(7)]=t.value;
  else if(k==='separateOperator')d.separateOperator=t.checked;
  else if(k==='operator'){d.operator=t.value;d.operatorRef=null;d.separateOperator=false;TT.operators=[];++ttOperatorSequence;clearTimeout(ttOperatorTimer);const choices=screen.querySelector('#tt-operator-choices');if(choices)choices.innerHTML='';if(t.value.trim())ttOperatorTimer=setTimeout(()=>ttFindOperator(t.value.trim()),180);}
  else d[k]=k.endsWith('CityId')?Number(t.value)||null:k==='dropoff'?t.value||null:t.value;
  const state=screen.querySelector('#tt-draft-state');if(state)state.textContent='Saving draft…';
  ttStore().then(()=>{if(state?.isConnected)state.textContent='Draft saved privately in this browser';}).catch(err=>{if(state?.isConnected)state.textContent='Draft could not be saved';error(err);});return true;
 }
 async function ttClick(action,t){
  if(action==='timetables'){if(!TT.available){message('Timetable entry is not available yet.');return true;}await ttOpen();return true;}
  if(!action?.startsWith('tt-'))return false;
  if(S.busy||S.pending)return true;
  if(await tmClick(action,t))return true;
  if(action==='tt-add'){if(TT.draft.departures.length<30){TT.draft.departures.push(ttBlankRow());await ttStore();render();}return true;}
  if(action==='tt-remove'){if(TT.draft.departures.length>1){TT.draft.departures.splice(Number(t.dataset.index),1);await ttStore();render();}return true;}
  if(action==='tt-edit'){TT.preview=null;render();root.scrollIntoView({block:'start'});return true;}
  if(action==='tt-operator-select'){
   const o=TT.operators.find(o=>o.id===t.dataset.operator);if(!o)return true;
   ++ttOperatorSequence;clearTimeout(ttOperatorTimer);TT.draft.operator=o.name;TT.draft.operatorRef={id:o.id,revision:o.revision};TT.draft.separateOperator=false;TT.issues=[];TT.preview=null;await ttStore();render();return true;
  }
  if(action==='tt-city-select'){
   const k=t.dataset.key,c=TT.cities[k].find(c=>c.id===Number(t.dataset.city));if(!c)return true;
   ++ttFindSequence[k];clearTimeout(ttCityTimers[k]);TT.draft[k]=c.id;TT.queries[k]=c.name;await ttStore();render();return true;
  }
  if(action==='tt-city-find'){
   const k=t.dataset.key,q=TT.queries[k].trim();if(!q){message('Type a city name.');return true;}
   const seq=++ttFindSequence[k],data=await api('/timetables/cities?q='+encodeURIComponent(q));
   if(seq!==ttFindSequence[k]||q!==TT.queries[k].trim())return true;
   const selected=TT.cities[k].find(c=>c.id===TT.draft[k]);TT.cities[k]=[...new Map([...(selected?[selected]:[]),...data.cities].map(c=>[c.id,c])).values()];
   await ttStore();render();screen.querySelector('#tt-'+k)?.focus();message(data.cities.length?'':'No matching cities.');return true;
  }
  if(action==='tt-review'){
   await ttWrites;S.busy=true;message('');render();
   try{const proposal=JSON.parse(JSON.stringify(TT.draft));for(const row of proposal.departures)if(row.fare?.amount==='')row.fare=null;TT.preview=await api('/timetables/preview',proposal);TT.operators=TT.preview.operatorOptions||[];TT.draft=TT.preview.proposal;await ttStore();}
   catch(err){TT.issues=err.issues||[];error(err);}finally{S.busy=false;render();root.scrollIntoView({block:'start'});screen.querySelector('[aria-invalid="true"]')?.focus();}return true;
  }
  if(action==='tt-apply'){
   if(!TT.preview?.writable||TT.preview.duplicates?.length)return true;
   await ttWrites;const body={clientRequestId:crypto.randomUUID(),previewToken:TT.preview.previewToken};
   await savePending({account,kind:'timetable',body,draftRevision:TT.revision,at:Date.now()});await submit(body);return true;
  }
  return true;
 }
 async function ttFinish(receipt){
  if(!receipt||receipt.kind!=='timetable'||receipt.id!==S.pending?.body.clientRequestId||!['approved','changed'].includes(receipt.outcome))throw Error('The timetable receipt could not be confirmed. Keep the saved action.');
  let newerDraft=false;
  if(receipt.outcome==='approved'){
   const expected=S.pending.draftRevision;
   // A receipt for this frozen command must not delete a newer draft that was
   // edited in another tab while the request/recovery was in flight.
   await new Promise((resolve,reject)=>{
    const tx=cache.transaction('commands','readwrite'),store=tx.objectStore('commands'),get=store.get(ttDraftKey);
    get.onsuccess=()=>{if(get.result&&get.result.revision===expected)store.delete(ttDraftKey);else if(get.result)newerDraft=true;};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
   });
  }
  await savePending(null);S.busy=false;await ttOpen();
  message(receipt.outcome==='approved'?'Timetable saved and approved.'+(newerDraft?' Your newer draft is kept.':''):'The matching records changed. Review this timetable again.');
  render();
 }
`+adminTimetableManagement;

export const adminTimetableStyles=String.raw`
#mabhazi-admin-design .tt-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:24px;align-items:start}
#mabhazi-admin-design .tt-layout .ad-panel{margin-bottom:24px}
#mabhazi-admin-design .tt-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}
#mabhazi-admin-design .tt-operator-field{grid-column:1/-1}
#mabhazi-admin-design .tt-field{min-width:0;margin-bottom:16px}
#mabhazi-admin-design .tt-field:last-child{margin-bottom:0}
#mabhazi-admin-design .tt-field label{display:block;font-size:13px;font-weight:600;margin-bottom:7px}
#mabhazi-admin-design .tt-field input,#mabhazi-admin-design .tt-field select,#mabhazi-admin-design .tt-price select,#mabhazi-admin-design .tt-price-kind{width:100%;min-height:44px;box-sizing:border-box;border:1px solid var(--ad-line);border-radius:8px;padding:10px 12px;background:var(--ad-panel);color:var(--ad-ink);font:inherit;font-size:14px}
#mabhazi-admin-design .tt-field [aria-invalid=true]{border-color:var(--ad-red)}
#mabhazi-admin-design .tt-field-error{color:var(--ad-red);margin:6px 0 0;font-size:13px}
#mabhazi-admin-design .tt-city-choices{display:grid;gap:2px;margin-top:5px;max-height:180px;overflow:auto}
#mabhazi-admin-design .tt-city-option{background:var(--ad-subtle);border:1px solid var(--ad-line);border-radius:6px;padding:10px 12px;text-align:left;color:inherit;font:inherit;font-size:14px;min-height:44px}
#mabhazi-admin-design .tt-city-empty{font-size:13px;color:var(--ad-muted);padding:8px 0}
#mabhazi-admin-design .tt-city-search{display:flex;gap:8px;margin-bottom:8px}
#mabhazi-admin-design .tt-city-search input{min-width:0;flex:1}
#mabhazi-admin-design .tt-weekdays{border:0;margin:0 0 20px;padding:0;min-width:0}
#mabhazi-admin-design .tt-weekdays legend{font-size:13px;font-weight:600;margin-bottom:10px}
#mabhazi-admin-design .tt-weekdays>div{display:flex;gap:4px;flex-wrap:wrap}
#mabhazi-admin-design .tt-weekdays label{position:relative;display:flex;align-items:center;justify-content:center;min-height:40px;flex:1;min-width:33px;font-size:12px;cursor:pointer}
#mabhazi-admin-design .tt-weekdays input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
#mabhazi-admin-design .tt-weekdays span{padding:10px 3px;border:1px solid var(--ad-line);border-radius:7px;width:100%;text-align:center}
#mabhazi-admin-design .tt-weekdays input:checked+span{background:var(--ad-navy);border-color:var(--ad-navy);color:white}
#mabhazi-admin-design .tt-weekdays input:focus-visible+span{outline:2px solid var(--ad-orange);outline-offset:2px}
#mabhazi-admin-design .tt-departures table{min-width:580px}
#mabhazi-admin-design .tt-departures td{vertical-align:top}
#mabhazi-admin-design .tt-departures td:last-child{width:80px}
#mabhazi-admin-design .tt-departures .tt-field label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
#mabhazi-admin-design .tt-next-day{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ad-muted);margin-top:9px;min-height:30px}
#mabhazi-admin-design .tt-price{display:flex;gap:6px;min-width:150px}
#mabhazi-admin-design .tt-price .tt-field{flex:1;margin:0;min-width:65px}
#mabhazi-admin-design .tt-price select{width:80px}
#mabhazi-admin-design .tt-price-kind{margin-top:8px;font-size:12px;min-height:32px;padding:5px 8px}
#mabhazi-admin-design .tt-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0 28px}
#mabhazi-admin-design .tt-footer>span{color:var(--ad-muted);font-size:12px}
#mabhazi-admin-design .tt-review-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
#mabhazi-admin-design .tt-review-facts span{display:block;font-size:12px;color:var(--ad-muted);margin-bottom:7px}
#mabhazi-admin-design .tt-review-facts strong{font-size:15px}
#mabhazi-admin-design .tt-source-review{display:grid;grid-template-columns:90px 1fr;gap:10px;font-size:13px;margin-bottom:24px;overflow-wrap:anywhere}
#mabhazi-admin-design .tt-source-review dt{color:var(--ad-muted)}
#mabhazi-admin-design .tt-source-review dd{margin:0}
@media(max-width:1150px){#mabhazi-admin-design .tt-layout{grid-template-columns:minmax(0,1fr)}#mabhazi-admin-design .tt-secondary{display:grid;grid-template-columns:1fr 1fr;gap:24px}}
@media(max-width:650px){#mabhazi-admin-design .tt-grid,#mabhazi-admin-design .tt-secondary{grid-template-columns:1fr}#mabhazi-admin-design .tt-grid>div:empty{display:none}#mabhazi-admin-design .tt-review-facts{grid-template-columns:1fr 1fr}#mabhazi-admin-design .tt-footer{align-items:flex-start;flex-direction:column}}
`;
