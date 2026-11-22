import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';

// Actual private HTML/API in the existing disposable CI database, never hosted data.
export async function reportCategoryBrowser({browser,admin,users,tokens,publicCities,seedPublic,takeShot,results,consoleErrors}){
 assert.equal(process.env.CONTRIBUTION_BROWSER_FIXTURE,'ci-only');
 assert.equal(new URL(process.env.DATABASE_URL).hostname,'localhost');
 const prior=process.env.NAMED_ADMIN_CONSOLE_ENABLED;process.env.NAMED_ADMIN_CONSOLE_ENABLED='true';
 const local='http://127.0.0.1:5000',owner=users[0],transport=randomUUID(),transportToken=randomBytes(32).toString('hex');
 const headers={Authorization:'Bearer '+tokens[0],'X-Mabhazi-Account':owner,'Content-Type':'application/json',Origin:'http://127.0.0.1:5000'};
 const api=async(path,body)=>{const response=await fetch(local+'/api/admin-console'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(response.status,200,path);return await response.json();};
 let context;
 try{
  await admin.query("INSERT INTO users(id,terms_accepted_version,terms_accepted_at) VALUES($1,'2026-09-12',now())",[transport]);
  await admin.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[transportToken,{user:{id:transport},access_token:'synthetic-category-user',expires_at:Math.floor(Date.now()/1000)+3600}]);
  await admin.query("INSERT INTO v2_review_roles(user_id,role,reason_code) SELECT $1::varchar,'administrator','category_browser_fixture' WHERE NOT EXISTS(SELECT 1 FROM v2_review_roles WHERE user_id=$1 AND role='administrator' AND revoked_at IS NULL)",[owner]);
  const lead=await seedPublic('Category review coach','16:10'),ids=[lead.subjectId];
  const day=(await admin.query("SELECT to_char(statement_timestamp()-interval '2 days','YYYY-MM-DD') d")).rows[0].d,revision=Number((await admin.query('SELECT revision FROM v2_subjects WHERE id=$1',[lead.subjectId])).rows[0].revision);
  for(const [amount,currency] of [['15','USD'],['270','ZAR']]){
   const r=await fetch(local+'/api/v2/actual-journeys',{method:'POST',headers:{...headers,Authorization:'Bearer '+transportToken,'X-Mabhazi-Account':transport},body:JSON.stringify({schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'route_detail',target:{newActualJourney:{intendedSubject:{id:lead.subjectId,kind:'lead',expectedRevision:revision}}},observations:[{fieldKey:'fare.paid',value:{amount,currency},scope:{schemaVersion:'1.0',segment:{kind:'city_pair',originCityId:publicCities[0],destinationCityId:publicCities[1]},serviceDate:day,passengerCategory:'adult',ticketBasis:'one_way'}}]})});const saved=await r.json();assert.equal(r.status,200,JSON.stringify(saved));ids.push(saved.subjectId);
  }
  const ctxResponse=await fetch(local+'/api/v2/subjects/'+lead.subjectId+'/contribution-context',{headers:{Authorization:'Bearer '+transportToken,'X-Mabhazi-Account':transport}}),ctx=await ctxResponse.json();assert.equal(ctxResponse.status,200);
  const places=await fetch(local+'/api/v2/route-observations',{method:'POST',headers:{...headers,Authorization:'Bearer '+transportToken,'X-Mabhazi-Account':transport},body:JSON.stringify({schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'route_detail',target:{existing:{subjectId:lead.subjectId,expectedRevision:ctx.revision,identityKey:ctx.identityKey}},observations:[{fieldKey:'boarding.pickup',value:{cityId:publicCities[0],name:'Category terminal'},scope:{}},{fieldKey:'alighting.dropoff',value:{cityId:publicCities[1],name:'Category destination'},scope:{}}]})});assert.equal(places.status,200);
  await admin.query("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE state='pending' AND NOT(subject_id=ANY($1::uuid[]))",[ids]);
  for(let n=0;n<4;n++)for(const kind of ['normalise','associate','assess'])assert.equal((await admin.query('SELECT v2_worker_drain_'+kind+'(20) r')).rows[0].r.failedAttempts,0);
  context=await browser.newContext({viewport:{width:1440,height:1000},extraHTTPHeaders:{Authorization:'Bearer '+tokens[0]}});
  let lose=true,posts=0,firstReceipt;const previews=[];
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==local){await route.abort();return;}const h={...request.headers(),...(request.method()==='POST'?{origin:'http://127.0.0.1:5000'}:{})};
   if(url.pathname==='/api/admin-console/preview'&&request.method()==='POST')previews.push(request.postDataJSON());
   if(url.pathname==='/api/admin-console/actions'&&request.method()==='POST'){posts++;const response=await route.fetch({headers:h});if(lose){lose=false;assert.equal(response.status(),200);firstReceipt=await response.json();await route.abort('failed');return;}await route.fulfill({response});return;}
   await route.continue({headers:h});
  });
  const page=await context.newPage();page.on('pageerror',e=>consoleErrors.push(e.message));
  await page.goto(local+'/api/admin-console?q=Category%20review%20coach');await page.getByRole('button',{name:'Fares',exact:true}).click();await page.getByRole('heading',{name:'Fare reports',exact:true}).waitFor();
  await page.getByLabel('Select Paid fare USD 15',{exact:true}).check();await page.getByRole('button',{name:'Review selected (1)',exact:true}).click();await page.getByRole('heading',{name:'Review selected reports',exact:true}).waitFor();
  assert.equal(previews.at(-1).observationIds.length,1);assert.equal(await page.getByText('ZAR 270',{exact:true}).count(),0);
  await takeShot(page,'admin-fare-exact-selection.png');results.push('private category preview selects one exact USD observation with original date/segment evidence, without selecting its ZAR neighbour');
  await page.getByLabel('Reason for this batch').selectOption('evidence_checked');await page.getByRole('button',{name:'Approve 1 property',exact:true}).click();await page.getByText('Check your previous action',{exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Check receipt',exact:true}).click();await page.getByRole('heading',{name:'Fare reports',exact:true}).waitFor();await page.getByText('ZAR 270',{exact:true}).waitFor();assert.equal(posts,1);
  const evidence=await api('/evidence?record='+lead.subjectId),usd=evidence.claims.find(c=>c.field==='fare.paid'&&c.value.currency==='USD');assert.equal(usd.review,'approved');assert.equal(evidence.claims.find(c=>c.field==='fare.paid'&&c.value.currency==='ZAR').review,'pending');assert.equal(evidence.claims.find(c=>c.field==='operator.reported').review,'pending');
  const publicResponse=await fetch(local+'/api/v2/subjects/'+lead.subjectId,{headers:{'X-Mabhazi-Route-Display':'reviewed-timetable/1'}}),publicRoute=await publicResponse.json();assert.equal(publicResponse.status,200);assert.equal(publicRoute.subject.cardDetails.fare.currency,'USD');
  results.push('real named category approval survives a lost response and browser reload through the existing encrypted receipt; one command publishes only the chosen currency and leaves core fields pending');
  await page.getByRole('button',{name:'Locations',exact:true}).click();await page.getByRole('heading',{name:'Location reports',exact:true}).waitFor();await page.getByLabel('Select Pickup Category terminal',{exact:true}).check();await page.getByRole('button',{name:'Review selected (1)',exact:true}).click();await page.getByRole('heading',{name:'Review selected reports',exact:true}).waitFor();assert.equal(await page.getByText('Category destination',{exact:true}).count(),0);
  await page.getByLabel('Reason for this batch').selectOption('evidence_checked');await page.getByRole('button',{name:'Approve 1 property',exact:true}).click();await page.getByRole('heading',{name:'Location reports',exact:true}).waitFor();await page.getByText('Category destination',{exact:true}).waitFor();assert.equal(posts,2);
  const locationEvidence=await api('/evidence?record='+lead.subjectId);assert.equal(locationEvidence.claims.find(c=>c.field==='boarding.pickup').review,'approved');assert.equal(locationEvidence.claims.find(c=>c.field==='alighting.dropoff').review,'pending');results.push('location category approves one pickup while the drop-off remains independently pending');
  await page.getByLabel('Report review status').selectOption('all');await page.setViewportSize({width:320,height:700});await takeShot(page,'admin-locations-narrow.png');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);results.push('actual category rows and controls remain readable at320px without page overflow');
  await page.getByRole('button',{name:'Fares',exact:true}).click();await page.getByLabel('Select Paid fare ZAR 270',{exact:true}).check();await page.getByLabel('Find reports by route').fill('Changed route lookup');assert.equal(await page.getByRole('button',{name:'Review selected',exact:true}).isDisabled(),true);assert.equal(posts,2);results.push('typing a new category search clears the previous selection and cannot approve stale visible rows');
  const reversal=await api('/reverse-preview',{batchId:firstReceipt.id,reviewIds:[firstReceipt.items[0].reviewId]});assert.equal(reversal.ready,1);await api('/actions',{clientRequestId:randomUUID(),previewToken:reversal.previewToken,reason:'decision_incorrect'});
  const final=await api('/evidence?record='+lead.subjectId);assert.equal(final.claims.find(c=>c.observationId===usd.observationId).review,'pending');assert.equal(final.claims.find(c=>c.field==='boarding.pickup').review,'approved');assert.equal(final.claims.find(c=>c.field==='fare.paid'&&c.value.currency==='ZAR').review,'pending');results.push('reversing the selected fare approval preserves the separately approved pickup, unselected currency and original evidence');
  const denied=await fetch(local+'/api/admin-console/data',{headers:{Authorization:'Bearer '+transportToken}});assert.equal(denied.status,403);results.push('ordinary signed-in travellers cannot read the private category catalogue');
 }finally{await context?.close();if(prior===undefined)delete process.env.NAMED_ADMIN_CONSOLE_ENABLED;else process.env.NAMED_ADMIN_CONSOLE_ENABLED=prior;}
}
