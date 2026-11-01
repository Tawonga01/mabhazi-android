// Injected into the existing workbench closure, sharing its authenticated API,
// account-bound encryption, notices and receipt-first command recovery.
export const adminCoreWorkbench=String.raw`
 const coreLabels={'route.origin':'Departure city','route.destination':'Destination city','operator.reported':'Operator','departure.reported':'Departure time'};
 const basisLabels={travelled:'Travelled on this service',saw_operating:'Saw the service operating',observed_sign:'Read a timetable or sign',operator_statement:'The operator told me',heard_from_other:'Another person told me',unprovided:'Source not known'};
 const reasonLabels={source_checked:'Checked the source',typing_error:'Correcting a typing error',operator_checked:'Checked with the operator',decision_incorrect:'Previous decision was incorrect'};
 function coreValue(value){if(value===null||value===undefined)return 'Unavailable';if(value.cityId)return S.core?.cities.find(c=>c.id===value.cityId)?.name||'City '+value.cityId;if(value.name)return value.name;if(value.time)return clock(value.time)+' · '+({scheduled:'Scheduled',actual:'Actual',unspecified:'Time basis unknown'}[value.basis]||value.basis);return '—';}
 function coreDraft(field){const v=S.core.current[field];return {routeId:S.core.id,operation:'correct',field,value:v?JSON.parse(JSON.stringify(v)):null,basis:'',observedDate:null,reason:'',reversedActionId:null};}
 let coreSaving=Promise.resolve(),coreSaveTimer;
 function coreStore(){const snapshot=S.coreDraft?JSON.parse(JSON.stringify(S.coreDraft)):null;coreSaving=coreSaving.catch(()=>{}).then(()=>coreWrite(snapshot));return coreSaving;}
 async function coreWrite(snapshot){if(!S.storage||!snapshot)return;const value=snapshot,id=value.routeId,key=await recoveryKey(),iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(account+':'+id)},key,new TextEncoder().encode(JSON.stringify(value)));
  await stored('commands',account+':core-draft:'+id,{iv,cipher});}
 async function coreRead(id){const saved=await stored('commands',account+':core-draft:'+id),key=await stored('keys',account);if(!saved||!key)return null;
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:new TextEncoder().encode(account+':'+id)},key,saved.cipher),draft=JSON.parse(new TextDecoder().decode(clear));
  return draft.routeId===id&&coreLabels[draft.field]&&draft.operation==='correct'?draft:null;}
 async function coreOpen(id){message('');S.core=await api('/corrections/'+id);S.corePreview=null;S.coreCities=[];S.coreDraft=await coreRead(id)||coreDraft('departure.reported');S.view='correction';render();}
 function coreForm(){const r=S.core,d=S.coreDraft,p=S.corePreview;if(!r||!d)return '<p class="br-loading">Loading route…</p>';
  const row=S.rows.find(a=>a.id===r.id),title=row?row.origin+' → '+row.destination:'Route report';
  const heading='<div class="ad-heading"><div>'+btn('← Back to reports','back')+'<h1 style="margin-top:14px">Correct route details</h1><p class="ad-subtitle">'+e(title)+'</p></div></div>';
  if(p){const reverse=p.proposal.operation==='reverse';return heading+'<section class="ad-panel"><div class="ad-panel-head"><h2>'+e(reverse?'Reverse this correction?':coreLabels[d.field])+'</h2></div><div class="ad-panel-body">'+
   '<div class="core-comparison"><div><span class="ad-subtitle">Originally submitted</span><strong>'+e(coreValue(r.original[p.proposal.field]))+'</strong></div><div><span class="ad-subtitle">Current</span><strong>'+e(coreValue(r.current[p.proposal.field]))+'</strong></div><div><span class="ad-subtitle">'+(reverse?'Action':'Proposed correction')+'</span><strong>'+e(reverse?'Reverse this exact correction':coreValue(p.proposal.value))+'</strong></div></div>'+
   '<p style="margin-top:22px">'+e(reverse?'Newer corrections and other properties stay in place.':'Only this property changes. The original report stays saved.')+'</p>'+
   (!reverse?'<dl class="core-source"><div><dt>Source</dt><dd>'+e(basisLabels[p.proposal.basis])+'</dd></div><div><dt>Observed</dt><dd>'+e(p.proposal.observedDate||'Unknown')+'</dd></div><div><dt>Reason</dt><dd>'+e(reasonLabels[p.proposal.reason])+'</dd></div></dl>':'')+
   '<div class="ad-actions" style="margin-top:24px">'+btn(reverse?'Reverse correction':'Save correction','core-apply',S.storage&&!S.pending&&!S.busy?'':'disabled',true)+btn('Back','core-edit')+'</div></div></section>';}
  const city=d.field.startsWith('route.'),time=d.field==='departure.reported';
  const current=r.current[d.field],old=r.original[d.field];
  const input=city?'<label for="core-city-query">Find city</label><div class="core-city-search"><input id="core-city-query" maxlength="120" placeholder="City name" value="'+e(S.coreCityQuery||'')+'">'+btn('Find','core-find-city')+'</div><label for="core-city">City</label><select id="core-city"><option value="">Choose city</option>'+[...new Map([...r.cities,...S.coreCities].map(c=>[c.id,c])).values()].map(c=>'<option value="'+c.id+'" '+(d.value?.cityId===c.id?'selected':'')+'>'+e(c.name)+'</option>').join('')+'</select>':
   time?'<label for="core-clock">Departure time</label><input id="core-clock" type="time" step="60" value="'+e(d.value?.time||'')+'"><label for="core-clock-basis">Time refers to</label><select id="core-clock-basis">'+[['unspecified','Unknown'],['scheduled','Scheduled departure'],['actual','Actual departure']].map(([k,v])=>'<option value="'+k+'" '+(d.value?.basis===k?'selected':'')+'>'+v+'</option>').join('')+'</select>':
   '<label for="core-operator">Operator name</label><input id="core-operator" maxlength="120" value="'+e(d.value?.name||'')+'">';
  return heading+'<section class="ad-panel"><div class="ad-panel-head"><h2>Property correction</h2></div><div class="ad-panel-body">'+
   (Number(r.dependencies)>0?'<div class="ad-message">This route has linked evidence. Its identity needs a separate review before changing these details.</div>':'')+
   '<div class="core-editor"><div><label for="core-field">Property</label><select id="core-field">'+Object.entries(coreLabels).map(([k,v])=>'<option value="'+k+'" '+(d.field===k?'selected':'')+'>'+e(v)+'</option>').join('')+'</select>'+
   '<div class="core-current"><span class="ad-subtitle">Current</span><strong>'+e(coreValue(current))+'</strong>'+ (JSON.stringify(old)!==JSON.stringify(current)?'<small>Originally: '+e(coreValue(old))+'</small>':'')+'</div>'+input+'</div>'+
   '<div><label for="core-source">How do you know?</label><select id="core-source"><option value="">Choose source</option>'+Object.entries(basisLabels).map(([k,v])=>'<option value="'+k+'" '+(d.basis===k?'selected':'')+'>'+e(v)+'</option>').join('')+'</select>'+
   '<label for="core-observed">Observed date (optional)</label><input id="core-observed" type="date" value="'+e(d.observedDate||'')+'">'+
   '<label for="core-reason">Reason</label><select id="core-reason"><option value="">Choose reason</option>'+Object.entries(reasonLabels).map(([k,v])=>'<option value="'+k+'" '+(d.reason===k?'selected':'')+'>'+e(v)+'</option>').join('')+'</select></div></div>'+
   '<div class="ad-actions" style="margin-top:24px">'+btn('Review correction','core-preview',!S.busy&&!S.pending&&S.storage?'':'disabled',true)+btn('Save draft','core-save-draft')+'</div></div></section>'+
   (r.history.length?'<section class="ad-panel" style="margin-top:24px"><div class="ad-panel-head"><h2>Recent corrections</h2></div>'+r.history.map(a=>'<article class="br-history-row"><div><h2>'+e(coreLabels[a.field])+' · '+e(a.outcome.replaceAll('_',' '))+'</h2><p>'+e(a.value?coreValue(a.value):a.actorErased||a.sourceErased?'Evidence removed':'Reversal')+' · '+e(new Date(a.createdAt).toLocaleString())+'</p></div>'+ (a.outcome==='corrected'&&!a.actorErased&&!a.sourceErased?btn('Review reversal','core-reverse','data-correction="'+e(a.id)+'" data-field="'+e(a.field)+'"'):'')+'</article>').join('')+'</section>':'');
 }
 async function coreClick(a,t){
  if(a==='core-open'){await coreOpen(t.dataset.record);return true;}
  if(a==='core-find-city'){S.coreCities=(await api('/corrections/cities?q='+encodeURIComponent(S.coreCityQuery||''))).cities;render();return true;}
  if(a==='core-save-draft'){await coreStore();message('Correction draft saved.');return true;}
  if(a==='core-preview'){await coreStore();S.corePreview=await api('/corrections/preview',S.coreDraft);S.core=S.corePreview.route;render();return true;}
  if(a==='core-edit'){S.corePreview=null;render();return true;}
  if(a==='core-reverse'){await coreStore();S.corePreview=await api('/corrections/preview',{routeId:S.core.id,operation:'reverse',field:t.dataset.field,value:null,basis:'unprovided',observedDate:null,reason:'decision_incorrect',reversedActionId:t.dataset.correction});render();return true;}
  if(a==='core-apply'){const body={clientRequestId:crypto.randomUUID(),previewToken:S.corePreview.previewToken};await savePending({account,body,kind:'core',routeId:S.core.id,at:Date.now()});await submit(body);return true;}
  return false;
 }
 function coreInput(t){if(!S.coreDraft||!t.id.startsWith('core-'))return false;const d=S.coreDraft;
  if(t.id==='core-city-query'){S.coreCityQuery=t.value;return true;}
  if(t.id==='core-field'){S.coreDraft=coreDraft(t.value);S.corePreview=null;S.coreCityQuery='';S.coreCities=[];coreStore().catch(error);render();return true;}
  if(t.id==='core-clock')d.value={time:t.value,basis:d.value?.basis||'unspecified'};
  else if(t.id==='core-clock-basis')d.value={time:d.value?.time||'',basis:t.value};
  else if(t.id==='core-operator')d.value={name:t.value};
  else if(t.id==='core-city')d.value=t.value?{cityId:Number(t.value)}:null;
  else if(t.id==='core-source')d.basis=t.value;
  else if(t.id==='core-observed')d.observedDate=t.value||null;
  else if(t.id==='core-reason')d.reason=t.value;
  else return false;
  S.corePreview=null;clearTimeout(coreSaveTimer);coreSaveTimer=setTimeout(()=>coreStore().catch(error),250);return true;
 }
`;
