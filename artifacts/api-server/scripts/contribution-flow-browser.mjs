import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { pool } from '@workspace/db';

// CI only: disposable Postgres, local API, local exported real app, synthetic sessions.
assert.equal(process.env.CONTRIBUTION_BROWSER_FIXTURE, 'ci-only');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'localhost');
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(process.env.PLAYWRIGHT_RUNTIME, 'node_modules/playwright'));
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
let apiServer, webServer, browser;
const root = path.resolve('../mobile/dist-flow-web'), output = path.resolve('../../flow-browser-evidence');
fs.mkdirSync(output, { recursive: true });
const results = [], consoleErrors = [];
results.push=(...cases)=>{for(const item of cases)console.log('MABHAZI_BROWSER_PROGRESS '+item);return Array.prototype.push.apply(results,cases);};
const users = [randomUUID(), randomUUID(), randomUUID()], tokens = users.map(() => randomBytes(32).toString('hex'));
let cities;
// Screenshots must represent the settled UI, not the first frame of a modal
// fade/slide. Geometry/opacity stability also covers RN's JavaScript animation.
async function boundedBrowserStep(label,run,ms=20000){let timer;try{return await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Browser step timed out: '+label)),ms);})]);}finally{clearTimeout(timer);}}
async function takeShot(page,name){
  console.log('MABHAZI_SCREENSHOT_START '+name);
  await boundedBrowserStep('settle '+name,()=>page.evaluate(async()=>{
    await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,2000))]);
    const limit=performance.now()+2500;let previous='',stableSince=performance.now();
    while(performance.now()<limit){
      const signature=JSON.stringify([...document.querySelectorAll('[role="heading"],[role="button"],[tabindex],input,[style*="opacity"],[style*="transform"]')].map(el=>{const r=el.getBoundingClientRect();return [Math.round(r.x*10),Math.round(r.y*10),Math.round(r.width*10),Math.round(r.height*10),getComputedStyle(el).opacity];}));
      if(signature!==previous){previous=signature;stableSince=performance.now();}
      else if(performance.now()-stableSince>180)break;
      await new Promise(requestAnimationFrame);
    }
  }));
  console.log('MABHAZI_SCREENSHOT_SETTLED '+name);
  await boundedBrowserStep('screenshot '+name,()=>page.screenshot({path:path.join(output,name),fullPage:true,animations:'disabled',timeout:15000}));
  console.log('MABHAZI_SCREENSHOT_SAVED '+name);
}

try {
  await admin.connect();
  for (let i = 0; i < users.length; i++) {
    await admin.query('INSERT INTO users(id,terms_accepted_version,terms_accepted_at) VALUES($1,$2,$3)', [users[i], i === 0 ? '2026-09-12' : null, i === 0 ? new Date() : null]);
    await admin.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')", [tokens[i], { user: { id: users[i] }, access_token: 'synthetic-ci-session', expires_at: Math.floor(Date.now()/1000)+3600 }]);
  }
  cities = (await admin.query("INSERT INTO cities(name,place_type) VALUES('Flow Origin fixture','city'),('Flow Destination fixture','city') RETURNING id")).rows.map(r => r.id);
  pool.on('connect', client => { void client.query('SET ROLE mabhazi_api'); });
  const { default: app } = await import('../src/app.ts');
  apiServer = createServer(app);
  await new Promise(resolve => apiServer.listen(5000, '127.0.0.1', resolve));
  webServer = createServer((req, res) => {
    const requested = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (requested !== root && !requested.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html');
    const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, {'Content-Type':type}); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => webServer.listen(4173, '127.0.0.1', resolve));
  browser = await chromium.launch();
  async function session(account = 0, loseResponse = false, mode = 'route') {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(20000);
    // Cancel previous route handlers only after intentional session shutdown.
    let closing=false;const closeContext=context.close.bind(context);context.close=async options=>{closing=true;console.log('MABHAZI_CONTEXT_CLOSING');try{await boundedBrowserStep('drain context routes',()=>context.unrouteAll({behavior:'ignoreErrors'}));}finally{await boundedBrowserStep('close context',()=>closeContext(options));}console.log('MABHAZI_CONTEXT_CLOSED');};
    if (account !== null) await context.addInitScript(token => localStorage.setItem('mabhazi_session_v2', token), tokens[account]);
    let postCount = 0; const sent=[];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:4173') { await route.continue(); return; }
      // Fail closed: no request reaches real Mabhazi, Google, Render or Supabase.
      if (url.origin !== 'https://preview.mabhazi.invalid') { await route.abort(); return; }
      const response = await route.fetch({url:'http://127.0.0.1:5000'+url.pathname+url.search});
      if ((['/api/v2/contributions','/api/v2/actual-journeys','/api/v2/route-observations'].includes(url.pathname) || /^\/api\/v2\/pickup-questions\/[^/]+\/answers$/.test(url.pathname)) && request.method() === 'POST') {
        postCount++; sent.push(request.postDataJSON());
        if (loseResponse) { loseResponse = false; await route.abort('failed'); return; }
      }
      try{await route.fulfill({response});}catch(error){
        // A cancelled query or intentional context shutdown can finish its local
        // fetch after Playwright has handled the browser request. Ignore only
        // that proven cancellation; live duplicate handlers and all assertions fail.
        if(!/Route is already handled|Target page, context or browser has been closed/.test(String(error))||(!closing&&!request.failure()&&!request.frame().isDetached()))throw error;
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => consoleErrors.push(error.message));
    const surfaces={search:'/',profile:'/profile',departures:'/departures',home:'/contribute'};
    await page.goto('http://127.0.0.1:4173'+(surfaces[mode] ?? '/contribute'));
    if (surfaces[mode]) return {context,page,posts:()=>postCount,requests:()=>sent,loseNext:()=>{loseResponse=true;}};
    await page.getByRole('heading',{name:'Contribute',exact:true}).waitFor();
    if (!results.length) {
      await takeShot(page,'contribution-menu.png');
      const help=page.getByRole('button',{name:'About drafts',exact:true});
      assert.equal(await help.getAttribute('aria-expanded'),'false');
      await help.click();await page.getByText('Drafts stay in this browser session only.',{exact:false}).waitFor();
      assert.equal(await help.getAttribute('aria-expanded'),'true');await help.click();
      assert.equal(await help.getAttribute('aria-expanded'),'false');assert.equal(postCount,0);
    }
    await page.getByRole('button',{name:mode === 'route' ? 'Add a route' : 'Report a journey',exact:true}).click();
    await page.getByRole('heading',{name:mode === 'route' ? 'Add a bus route' : 'Report a journey',exact:true}).waitFor();
    async function fill() {
      await page.getByRole('button',{name:'Choose departure city',exact:true}).click();
      await page.getByLabel('Search cities',{exact:true}).fill('Flow Origin fixture');
      await page.getByRole('button',{name:new RegExp('Flow Origin fixture, city')}).click();
      await page.getByRole('button',{name:'Choose destination city',exact:true}).click();
      await page.getByLabel('Search cities',{exact:true}).fill('Flow Destination fixture');
      await page.getByRole('button',{name:new RegExp('Flow Destination fixture, city')}).click();
      await page.getByLabel('Departure time in 24-hour format',{exact:true}).fill('08:30');
      await page.getByLabel('Bus operator name',{exact:true}).fill('Browser fixture bus');
    }
    return {context,page,fill,posts:()=>postCount,requests:()=>sent,loseNext:()=>{loseResponse=true;}};
  }
  // Actual rendered screen -> generated client -> authenticated HTTP -> restricted
  // facade -> committed Postgres receipt, with no fare or recurrence invention.
  {
    const s = await session();
    assert.equal(await s.page.getByLabel('Departure time in 24-hour format').inputValue(),'');
    const saveBox=await s.page.getByRole('button',{name:'Review route',exact:true}).boundingBox();
    await takeShot(s.page,'minimum-form.png');
    assert.ok(saveBox && saveBox.y>=0&&saveBox.y+saveBox.height<=832,`Review should fit inside the modal safe footer: ${JSON.stringify(saveBox)}`);
    await s.fill();
    await s.page.getByRole('button',{name:'Review route',exact:true}).click();
    await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    assert.equal(s.posts(),1);
    const row=(await admin.query('SELECT payload FROM v2_contributions WHERE user_id=$1',[users[0]])).rows[0];
    assert.equal(row.payload.target.newLead.originCityId,cities[0]);assert.equal(row.payload.target.newLead.destinationCityId,cities[1]);assert.equal('price' in row.payload.target.newLead,false);
    await takeShot(s.page,'saved-result.png');
    const receiptHelp=s.page.getByRole('button',{name:'View receipt',exact:true});
    assert.equal(await receiptHelp.getAttribute('aria-expanded'),'false');
    await receiptHelp.click();await s.page.getByText('Received and awaiting processing.',{exact:true}).waitFor();
    assert.equal(await receiptHelp.getAttribute('aria-expanded'),'true');await receiptHelp.click();assert.equal(s.posts(),1);
    results.push('four answers render and save through real API/PostgreSQL; no price/calendar/default clock');

    assert.equal(await s.page.getByRole('heading',{name:'Report a journey',exact:true}).count(),0);
    await s.page.getByRole('button',{name:'Add details',exact:true}).click();
    await s.page.getByText('Your submitted route',{exact:true}).waitFor();
    assert.equal(await s.page.getByRole('checkbox',{name:'Actual departure',exact:true}).getAttribute('aria-checked'),'false');
    await s.page.getByRole('checkbox',{name:'Fare',exact:true}).click();
    await s.page.getByRole('button',{name:'Choose fare departure city',exact:true}).getByText('Flow Origin fixture',{exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Choose fare destination city',exact:true}).getByText('Flow Destination fixture',{exact:true}).waitFor();
    assert.equal(await s.page.getByLabel('Fare amount').inputValue(),'');
    assert.equal(await s.page.getByRole('radio',{name:'Price type: Paid',exact:true}).getAttribute('aria-checked'),'false');
    await s.page.getByRole('button',{name:'Choose fare currency',exact:true}).click();await s.page.getByRole('radio',{name:'Currency: USD',exact:true}).click();
    await s.page.getByLabel('Fare amount').fill('17.50');await s.page.getByRole('radio',{name:'Price type: Quoted',exact:true}).click();
    await s.page.getByRole('button',{name:'Fare conditions',exact:true}).click();
    await s.page.getByRole('radio',{name:'Passenger: Unknown',exact:true}).click();await s.page.getByRole('radio',{name:'Ticket: Unknown',exact:true}).click();
    await s.page.getByRole('button',{name:'Preview fare',exact:true}).click();await s.page.getByRole('button',{name:'Use this fare',exact:true}).click();
    await s.page.getByRole('button',{name:'Review journey',exact:true}).click();
    await s.page.evaluate(async()=>{await Promise.race([Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined))),new Promise(resolve=>setTimeout(resolve,2000))]);});
    await takeShot(s.page,'own-route-followup.png');
    s.loseNext();await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();
    await s.page.getByText('Save not confirmed.',{exact:false}).waitFor();
    await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();
    await s.page.getByRole('button',{name:'Continue journey draft',exact:true}).click();await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();
    await s.page.getByText('Your submitted route',{exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Check and retry',exact:true}).click();await s.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();
    assert.equal(s.posts(),2);
    const follow=s.requests()[1];assert.equal(follow.entrySurface,'own_contribution');assert.equal(follow.target.newActualJourney.intendedSubject.id,(await admin.query('SELECT initial_response FROM v2_receipts WHERE user_id=$1 AND client_submission_id=$2',[users[0],s.requests()[0].clientSubmissionId])).rows[0].initial_response.subjectId);
    const actual=(await admin.query("SELECT intended_subject_id,matched_run_subject_id FROM v2_actual_journeys WHERE initial_contribution_id=(SELECT id FROM v2_contributions WHERE user_id=$1 AND client_submission_id=$2)",[users[0],follow.clientSubmissionId])).rows[0];
    assert.equal(actual.intended_subject_id,follow.target.newActualJourney.intendedSubject.id);assert.equal(actual.matched_run_subject_id,null);
    assert.equal((await admin.query('SELECT count(*) FROM journeys')).rows[0].count,'0');
    results.push('Saved offers optional owned-lead Fare follow-up before approval; city context only, secure close/resume and lost-response recovery preserve one intended report');

    await s.context.close();
  }
  {
    const s=await session(0,true), before=(await admin.query('SELECT count(*) FROM v2_contributions WHERE user_id=$1',[users[0]])).rows[0].count;
    await s.fill();await s.page.getByRole('button',{name:'Review route',exact:true}).click();
    await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByText('Save not confirmed.',{exact:false}).waitFor();
    assert.equal(await s.page.getByRole('button',{name:'Edit answers',exact:true}).count(),0);
    assert.equal(await s.page.getByLabel('Bus operator name').count(),0);
    await takeShot(s.page,'retry-result.png');
    await s.page.getByRole('button',{name:'Check and retry',exact:true}).click();
    await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    assert.equal(s.posts(),1);assert.equal(Number((await admin.query('SELECT count(*) FROM v2_contributions WHERE user_id=$1',[users[0]])).rows[0].count),Number(before)+1);
    results.push('lost acknowledgement recovers committed receipt without second POST or duplicate contribution');
    await s.context.close();
  }
  {
    const s=await session(1);await s.fill();
    await s.page.getByRole('button',{name:'Review route',exact:true}).click();
    await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByText('Accept the current Terms, then tap Save.',{exact:false}).waitFor();
    assert.equal(s.posts(),0);await s.page.getByRole('button',{name:'Edit answers',exact:true}).click();
    assert.equal(await s.page.getByLabel('Bus operator name').inputValue(),'Browser fixture bus');
    await takeShot(s.page,'terms-preserved.png');
    results.push('Terms gate retains all entered answers without automatic submission');
    await s.context.close();
  }
  {
    const s=await session();await s.fill();
    await s.page.getByLabel('Departure time in 24-hour format').fill('24:00');
    await s.page.getByRole('button',{name:'Review route',exact:true}).click();
    await s.page.getByText('Enter a departure time in 24-hour format, for example 08:30.',{exact:true}).waitFor();
    assert.equal(s.posts(),0);assert.equal(await s.page.getByLabel('Departure time in 24-hour format').inputValue(),'24:00');
    results.push('invalid clock shows inline explanation and retains answers without submitting');
    await s.context.close();
  }
  {
    const s=await session(); await s.fill();
    await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();
    await s.page.getByRole('button',{name:'Continue route draft',exact:true}).click();
    await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();
    assert.equal(await s.page.getByLabel('Bus operator name').inputValue(),'Browser fixture bus');
    assert.equal(s.posts(),0);
    results.push('closing and explicit resumption retain route input without submitting'); await s.context.close();
  }
  {
    const s=await session(0,false,'journey');
    await s.page.getByRole('checkbox',{name:'Operator',exact:true}).click();
    await s.page.getByLabel('Observed operator',{exact:true}).fill('Journey fixture bus');
    await s.page.getByRole('button',{name:'Review journey',exact:true}).click();
    await takeShot(s.page,'journey-review.png');
    await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();
    await s.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor(); assert.equal(s.posts(),1);
    const payloads=(await admin.query("SELECT payload FROM v2_contributions WHERE user_id=$1 AND payload->'target' ? 'newActualJourney'",[users[0]])).rows;
    const payload=payloads.find(r=>r.payload.observations.some(o=>o.value.name==='Journey fixture bus')).payload;
    assert.deepEqual(payload.target,{newActualJourney:{}});assert.equal(payload.observations.length,1);assert.equal(payload.observations[0].fieldKey,'operator.reported');
    results.push('one operator observation saves as independent actual report without invented route/date/time'); await s.context.close();
  }
  {
    const s=await session(0,true,'journey');
    await s.page.getByRole('checkbox',{name:'Fare',exact:true}).click();
    await s.page.getByRole('button',{name:'Choose fare currency',exact:true}).click();
    assert.equal(await s.page.getByRole('radio',{name:'Currency: USD',exact:true}).getAttribute('aria-checked'),'false');
    await s.page.getByRole('radio',{name:'Currency: USD',exact:true}).click();
    await s.page.getByLabel('Fare amount',{exact:true}).fill('0');
    await s.page.getByRole('radio',{name:'Price type: Paid',exact:true}).click();
    async function fareCity(label, name) {
      await s.page.getByRole('button',{name:label,exact:true}).click();
      await s.page.getByLabel('Search cities',{exact:true}).fill(name);
      await s.page.getByRole('button',{name:new RegExp(name+', city')}).click();
    }
    await fareCity('Choose fare departure city','Flow Origin fixture');
    await fareCity('Choose fare destination city','Flow Destination fixture');
    await s.page.getByRole('button',{name:'Fare conditions',exact:true}).click();
    await s.page.getByRole('radio',{name:'Passenger: Unknown',exact:true}).click();
    await s.page.getByRole('radio',{name:'Ticket: Unknown',exact:true}).click();
    await s.page.getByRole('button',{name:'Preview fare',exact:true}).click();
    await s.page.getByText('Enter a valid date as YYYY-MM-DD. A paid fare needs its travel date.',{exact:true}).waitFor();assert.equal(s.posts(),0);
    await s.page.getByLabel('Fare date',{exact:true}).fill('2026-10-22');
    await takeShot(s.page,'focused-fare-conditions.png');
    await s.page.getByLabel('Fare amount',{exact:true}).scrollIntoViewIfNeeded();
    await takeShot(s.page,'focused-fare.png');
    await s.page.getByRole('button',{name:'Preview fare',exact:true}).click();await s.page.getByRole('button',{name:'Use this fare',exact:true}).click();
    await s.page.getByRole('button',{name:'Review journey',exact:true}).click();
    await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();
    await s.page.getByText('Save not confirmed.',{exact:false}).waitFor();
    await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();
    await s.page.getByRole('button',{name:'Continue journey draft',exact:true}).click();
    await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();
    await s.page.getByRole('button',{name:'Check and retry',exact:true}).click();
    await s.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();assert.equal(s.posts(),1);
    const rows=(await admin.query("SELECT payload FROM v2_contributions WHERE user_id=$1 AND payload->'target' ? 'newActualJourney'",[users[0]])).rows;
    const fares=rows.flatMap(r=>r.payload.observations).filter(o=>o.fieldKey==='fare.paid');assert.equal(fares.length,1);
    assert.deepEqual(fares[0].value,{amount:'0',currency:'USD'});assert.equal(fares[0].scope.serviceDate,'2026-10-22');assert.equal(fares[0].scope.passengerCategory,'unknown');assert.equal(fares[0].scope.ticketBasis,'unknown');
    results.push('focused fare requires paid date, preserves explicit zero/unknown conditions and recovers receipt after close/resume with no duplicate POST'); await s.context.close();
  }
  {
    const s=await session(0,false,'journey');
    await s.page.setViewportSize({width:390,height:450});
    await s.page.getByRole('checkbox',{name:'Fare',exact:true}).click();
    for(const name of ['Close form and keep draft','Preview fare','Skip fare']) {
      const box=await s.page.getByRole('button',{name,exact:true}).boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=450,`${name} remains visible at450px`);
    }
    const width=await s.page.locator('body').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));assert.equal(width.scroll,width.client);
    await s.page.getByLabel('Fare amount',{exact:true}).fill('12');
    await s.page.getByRole('button',{name:'Skip fare',exact:true}).click();
    await s.page.getByRole('checkbox',{name:'Fare',exact:true}).click();assert.equal(await s.page.getByLabel('Fare amount',{exact:true}).inputValue(),'');
    await takeShot(s.page,'focused-fare-compact.png');
    assert.equal(s.posts(),0);results.push('compact390x450 fare keeps close/primary/skip visible and removing a fact clears hidden answers');await s.context.close();
  }

  const emptyCities=(await admin.query("INSERT INTO cities(name,place_type) VALUES('Empty Origin fixture','city'),('Empty Destination fixture','city') RETURNING id")).rows.map(r=>r.id);
  async function emptySearch(page, custom = false) {
    await page.getByText('Search for a route',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Add a route',exact:true}).count(),0);
    for(const [label,name] of [['From city','Empty Origin fixture'],['To city','Empty Destination fixture']]) {
      await page.getByText(label,{exact:true}).click();
      await page.getByPlaceholder('Type a city name…',{exact:true}).fill(custom ? 'Unlisted city fixture' : name);
      await page.getByText(custom ? 'Use "Unlisted city fixture"' : name,{exact:true}).click();
    }
    await page.getByText('Search Routes',{exact:true}).click();
    await page.getByText('No routes found',{exact:true}).waitFor();
  }
  assert.equal((await admin.query('SELECT count(*) FROM journeys')).rows[0].count,'0');
  {
    const s=await session(0,true,'search');
    await emptySearch(s.page);
    assert.equal(await s.page.getByRole('heading',{name:'Add a bus route',exact:true}).count(),0);
    await takeShot(s.page,'empty-search.png');
    await s.page.getByRole('button',{name:'Add a route',exact:true}).click();
    await s.page.getByRole('heading',{name:'Add a bus route',exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Choose departure city',exact:true}).getByText('Empty Origin fixture',{exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Choose destination city',exact:true}).getByText('Empty Destination fixture',{exact:true}).waitFor();
    assert.equal(await s.page.getByLabel('Departure time in 24-hour format').inputValue(),'');
    assert.equal(await s.page.getByLabel('Bus operator name').inputValue(),'');
    // Wait for finite dialog transitions so the proof is the settled UI, not a fade frame.
    await s.page.evaluate(async () => { await Promise.race([Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))),new Promise(resolve=>setTimeout(resolve,2000))]); });
    await takeShot(s.page,'empty-search-form.png');
    await s.page.getByLabel('Departure time in 24-hour format').fill('09:45');
    await s.page.getByLabel('Bus operator name').fill('Empty search fixture bus');
    await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();
    await s.page.getByText('No routes found',{exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Add a route',exact:true}).click();
    await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();
    assert.equal(await s.page.getByLabel('Bus operator name').inputValue(),'Empty search fixture bus');
    await s.page.getByRole('button',{name:'Review route',exact:true}).click();
    await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByText('Save not confirmed.',{exact:false}).waitFor();
    await s.page.getByRole('button',{name:'Check and retry',exact:true}).click();
    await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    const rows=(await admin.query("SELECT entry_surface,payload FROM v2_contributions WHERE user_id=$1 AND entry_surface='search_empty'",[users[0]])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].payload.target.newLead.originCityId,emptyCities[0]);assert.equal(rows[0].payload.target.newLead.destinationCityId,emptyCities[1]);
    assert.equal(rows[0].payload.target.newLead.departureTime,'09:45');assert.equal('price' in rows[0].payload.target.newLead,false);
    assert.equal(s.posts(),1);assert.equal((await admin.query('SELECT count(*) FROM journeys')).rows[0].count,'0');
    results.push('true empty search opens only on tap, retains selected city IDs and draft, and saves one search_empty receipt after lost response without approved routes');
    await s.context.close();
  }
  {
    const s=await session(null,false,'search');await emptySearch(s.page,true);
    await s.page.getByRole('button',{name:'Add a route',exact:true}).click();
    await s.page.getByRole('button',{name:'Choose departure city',exact:true}).getByText('Unlisted city fixture — choose a city',{exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Review route',exact:true}).click();
    await s.page.getByLabel('Search cities',{exact:true}).waitFor();
    assert.equal(await s.page.getByLabel('Search cities').inputValue(),'Unlisted city fixture');
    await s.page.getByRole('button',{name:'Close city search',exact:true}).click();
    assert.equal(s.posts(),0);
    results.push('unresolved search names remain visible lookup hints and require explicit city selection; guest input is allowed');
    await s.context.close();
  }
  {
    const s=await session(0,false,'search');let fail=true;
    await s.context.route(/\/api\/journeys(?:\?|$)/,async route=>{if(fail) await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'fixture unavailable'})});else await route.fallback();});
    await s.page.getByText('Search for a route',{exact:true}).waitFor();await s.page.getByText('Search Routes',{exact:true}).click();
    await s.page.getByText('Search could not load',{exact:true}).waitFor({timeout:20000});
    assert.equal(await s.page.getByRole('button',{name:'Add a route',exact:true}).count(),0);
    await takeShot(s.page,'search-error.png');
    fail=false;await s.page.getByRole('button',{name:'Try search again',exact:true}).click();
    await s.page.getByText('Route report',{exact:true}).first().waitFor();
    assert.equal(await s.page.getByRole('button',{name:'Add a route',exact:true}).count(),0);
    results.push('failed search never invites duplicate intake and retry recovers to current public reports instead of a false empty state');
    await s.context.close();
  }


  {
    const s=await session();await s.fill();await s.page.getByRole('button',{name:'Review route',exact:true}).click();await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();await s.page.getByRole('button',{name:'Add details',exact:true}).click();await s.page.getByText('Your submitted route',{exact:true}).waitFor();
    const lead=(await admin.query('SELECT initial_response FROM v2_receipts WHERE user_id=$1 AND client_submission_id=$2',[users[0],s.requests()[0].clientSubmissionId])).rows[0].initial_response;
    await admin.query('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[lead.subjectId]);
    await s.page.getByRole('checkbox',{name:'Operator',exact:true}).click();await s.page.getByLabel('Observed operator').fill('Preserved changed-target bus');await s.page.getByRole('button',{name:'Review journey',exact:true}).click();await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();
    await s.page.getByRole('button',{name:'Keep as independent report',exact:true}).waitFor();const frozen=s.requests()[1].clientSubmissionId;
    let unavailable=true;await s.context.route(/\/api\/v2\/receipts\//,async route=>{if(unavailable)await route.fulfill({status:503,contentType:'application/json',body:'{}'});else await route.fallback();});
    await s.page.getByRole('button',{name:'Keep as independent report',exact:true}).click();await s.page.getByText('Could not check the previous save.',{exact:false}).waitFor();assert.equal(s.posts(),2);
    unavailable=false;await s.page.getByRole('button',{name:'Keep as independent report',exact:true}).click();
    await s.page.getByText('Independent report',{exact:true}).waitFor();assert.equal(await s.page.getByLabel('Observed operator').inputValue(),'Preserved changed-target bus');assert.equal(s.posts(),2);
    await s.page.getByRole('button',{name:'Review journey',exact:true}).click();await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();await s.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();
    const independent=s.requests()[2];assert.notEqual(independent.clientSubmissionId,frozen);assert.equal('intendedSubject' in independent.target.newActualJourney,false);assert.equal(independent.entrySurface,'own_contribution');
    assert.equal((await admin.query('SELECT count(*) FROM v2_receipts WHERE user_id=$1 AND client_submission_id=$2',[users[0],frozen])).rows[0].count,'0');
    await s.page.getByRole('button',{name:'Report another journey',exact:true}).click();
    await s.page.getByText('Independent report',{exact:true}).waitFor();
    assert.equal(await s.page.getByRole('checkbox',{name:'Operator',exact:true}).getAttribute('aria-checked'),'false');
    results.push('stale target keeps frozen answers; receipt-checked independent recovery and another report never restore the rejected target');
    await s.context.close();
  }
  {
    const s=await session(0,false,'journey');await s.page.getByRole('checkbox',{name:'Operator',exact:true}).click();await s.page.getByLabel('Observed operator').fill('Earlier independent bus');
    await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await s.page.getByRole('button',{name:'Add a route',exact:true}).click();
    await s.fill();await s.page.getByRole('button',{name:'Review route',exact:true}).click();await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Add details',exact:true}).click();await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();
    await s.page.getByText('Independent report',{exact:true}).waitFor();assert.equal(await s.page.getByLabel('Observed operator').inputValue(),'Earlier independent bus');
    await s.page.getByRole('button',{name:'Review journey',exact:true}).click();await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();await s.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();
    assert.equal(s.requests()[1].entrySurface,'contribute_tab');assert.equal('intendedSubject' in s.requests()[1].target.newActualJourney,false);
    results.push('existing independent draft wins over new Saved-route context and is never silently retargeted');
    await s.context.close();
  }


  {
    const s=await session();await s.fill();await s.page.getByRole('button',{name:'Review route',exact:true}).click();await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    await s.context.route(/\/api\/v2\/receipts\//,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await s.page.getByRole('button',{name:'Add details',exact:true}).click();await s.page.getByText('Could not load this route.',{exact:false}).waitFor();
    assert.equal(await s.page.getByRole('heading',{name:'Report a journey',exact:true}).count(),0);
    await s.page.getByRole('button',{name:'Add another route',exact:true}).click();await s.page.getByRole('heading',{name:'Add a bus route',exact:true}).waitFor();
    assert.equal(await s.page.getByText('Could not load this route.',{exact:false}).count(),0);assert.equal(s.posts(),1);
    results.push('failed Saved follow-up leaves the receipt intact and its error does not leak into another route entry');await s.context.close();
  }
  // Same real exported app and API, now exercise the remaining principal
  // screens. This synthetic legacy fixture exists only in disposable CI.
  const legacy=(await admin.query("INSERT INTO journeys(from_city,to_city,departure_time,arrival_time,travel_date,bus_company,pickup_point,dropoff_point,price,contributed_by,contributor_name) VALUES('Harare','Bulawayo','08:30','14:00','Mon, Tue, Wed, Thu, Fri, Sat, Sun','UI fixture bus','Fixture pickup','Fixture drop-off',12.50,$1,'UI fixture contributor') RETURNING id",[users[0]])).rows[0].id;
  {
    const s=await session(null,false,'search');
    await s.page.getByText('Search for a route',{exact:true}).waitFor();
    await takeShot(s.page,'search-home.png');
    await s.page.setViewportSize({width:320,height:568});
    await s.page.evaluate(()=>{for(const el of document.querySelectorAll('div[dir="auto"],input')){const computed=getComputedStyle(el);if(computed.fontSize){el.dataset.originalUiFont=el.style.fontSize;el.style.fontSize=(parseFloat(computed.fontSize)*1.4)+'px';}}});
    await s.page.getByText('Search Routes',{exact:true}).scrollIntoViewIfNeeded();
    const searchBounds=await s.page.getByText('Search Routes',{exact:true}).boundingBox();assert(searchBounds&&searchBounds.y>=0&&searchBounds.y+searchBounds.height<568,'Search action remains reachable with larger text');
    assert.equal(await s.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal page overflow on narrow Search');
    await takeShot(s.page,'search-small-large-text.png');
    await s.page.evaluate(()=>{for(const el of document.querySelectorAll('[data-original-ui-font]')){el.style.fontSize=el.dataset.originalUiFont;delete el.dataset.originalUiFont;}});
    await s.page.setViewportSize({width:390,height:844});
    await s.page.getByText('Search Routes',{exact:true}).click();
    const card=s.page.getByRole('button',{name:'View route: Harare to Bulawayo, UI fixture bus',exact:true});await card.waitFor();
    const compactSearch=s.page.getByText('Any',{exact:true}).first();await compactSearch.waitFor();
    await s.page.waitForFunction(()=>{const labels=[...document.querySelectorAll('div[dir="auto"]')].filter(el=>el.textContent==='Any');return labels.some(el=>{const r=el.getBoundingClientRect();return r.y>=0&&r.y+r.height<300;});});
    await takeShot(s.page,'search-results.png');
    await card.click();await s.page.getByText('Route confidence',{exact:true}).waitFor();
    await s.page.getByText('Manage blocked contributors',{exact:true}).waitFor();
    await takeShot(s.page,'route-details.png');
    await s.page.getByText('Manage blocked contributors',{exact:true}).click();
    await s.page.getByText('Routes and comments are hidden on this device. Unblock anytime.',{exact:true}).waitFor();
    await takeShot(s.page,'device-block-manager.png');
    assert.equal(s.posts(),0);results.push('guest search/results opens real route details and local block manager with retained safety controls');await s.context.close();
  }

  {
    const s=await session(null,false,'search');
    await s.context.addInitScript(id=>localStorage.setItem('mabhazi.blocked-contributors.v1',JSON.stringify([{id,name:'Blocked fixture',blockedAt:'2026-10-24T00:00:00Z'}])),users[0]);
    await s.page.reload();await s.page.getByText('Search for a route',{exact:true}).waitFor();
    await s.page.getByText('Search Routes',{exact:true}).click();
    await s.page.getByText('Results hidden by your block settings',{exact:true}).waitFor();
    assert.equal(await s.page.getByRole('button',{name:'Add a route',exact:true}).count(),0);
    assert.equal(await s.page.getByText('UI fixture bus',{exact:true}).count(),0);
    results.push('blocked existing results stay hidden and never become a missing-route invitation');
    await s.context.close();
  }

  {
    const s=await session(0,false,'profile');
    await s.page.getByRole('button',{name:'Edit display name',exact:true}).waitFor();
    await takeShot(s.page,'profile.png');
    await s.page.getByRole('button',{name:'Edit display name',exact:true}).click();
    await s.page.getByLabel('Display name',{exact:true}).fill('Unsaved UI name');
    await takeShot(s.page,'profile-edit.png');
    await s.page.getByText('You can change your name once every 30 days.',{exact:true}).waitFor();
    await s.page.getByText('Cancel',{exact:true}).click();
    await s.page.getByText('Delete my account',{exact:true}).click();
    await s.page.getByText('Type DELETE MY ACCOUNT to confirm',{exact:true}).waitFor();
    await s.page.getByText('This permanently deletes your Mabhazi account,',{exact:false}).waitFor();
    assert.equal(await s.page.getByText('Delete permanently',{exact:true}).isVisible(),true);
    await takeShot(s.page,'profile-delete-confirmation.png');
    await s.page.getByText('Cancel',{exact:true}).click();assert.equal(s.posts(),0);
    assert.equal((await admin.query('SELECT count(*) FROM users WHERE id=$1',[users[0]])).rows[0].count,'1');
    results.push('signed-in profile retains name edit/cancel, limit guidance and deletion warning/confirmation; no deletion performed');await s.context.close();
  }
  {
    const s=await session(null,false,'profile');
    await s.page.getByText('Join Mabhazi',{exact:true}).waitFor();
    await s.page.getByText('Sign in to contribute.',{exact:true}).waitFor();
    await s.page.getByText('Manage blocked contributors',{exact:true}).waitFor();
    await s.page.getByText('Privacy',{exact:true}).waitFor();await s.page.getByText('Terms',{exact:true}).waitFor();
    await takeShot(s.page,'guest-profile.png');
    assert.equal(s.posts(),0);results.push('guest profile keeps sign-in, safety and legal/help links without the repeated feature list');await s.context.close();
  }
  {
    const s=await session(null,false,'departures');
    await s.page.getByRole('button',{name:'Choose departure city',exact:true}).click();await s.page.getByRole('button',{name:'Departures from Harare',exact:true}).click();
    await s.page.getByText('UI fixture bus',{exact:true}).waitFor();
    await takeShot(s.page,'departures.png');
    assert.equal(s.posts(),0);results.push('departure board selects a real legacy origin and shows its reported schedule without unsupported countdowns');await s.context.close();
  }
  {
    const s=await session();
    await s.page.getByRole('button',{name:'More route details',exact:true}).click();
    await s.page.getByText('Contribute a Route',{exact:true}).waitFor();
    const monday=s.page.getByRole('checkbox',{name:'Operating day Mon',exact:true});
    assert.equal(await monday.getAttribute('aria-checked'),'false');await monday.click();assert.equal(await monday.getAttribute('aria-checked'),'true');
    await s.page.getByText('Add a stop',{exact:true}).click();
    await takeShot(s.page,'full-route-form.png');
    assert.equal(s.posts(),0);results.push('legacy full form retains explicit operating-day selection and optional stop entry without submitting');await s.context.close();
  }
  // Server-backed own history survives leaving Saved and a fresh browser session.
  let historyKey, historySubject;
  {
    const s=await session();await s.fill();await s.page.getByLabel('Bus operator name').fill('History browser bus');
    await s.page.getByRole('button',{name:'Review route',exact:true}).click();await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    historyKey=s.requests()[0].clientSubmissionId;historySubject=(await admin.query('SELECT initial_response FROM v2_receipts WHERE user_id=$1 AND client_submission_id=$2',[users[0],historyKey])).rows[0].initial_response.subjectId;
    await s.page.getByRole('button',{name:'Done',exact:true}).click();await s.context.close();
    const h=await session(0,false,'home');await h.page.getByRole('button',{name:'My routes',exact:true}).click();await h.page.getByRole('heading',{name:'My routes',exact:true}).waitFor();
    const card=h.page.getByText('History browser bus · 08:30',{exact:true}).locator('..');await card.getByRole('button',{name:'Add details',exact:true}).waitFor();
    assert.equal(await h.page.getByRole('heading',{name:'Report a journey',exact:true}).count(),0);
    await h.page.evaluate(async()=>{await Promise.race([Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined))),new Promise(resolve=>setTimeout(resolve,2000))]);});
    await takeShot(h.page,'my-routes.png');
    await card.getByRole('button',{name:'Add details',exact:true}).click();await h.page.getByText('Your submitted route',{exact:true}).waitFor();
    await h.page.getByRole('checkbox',{name:'Fare',exact:true}).click();
    await h.page.getByRole('button',{name:'Choose fare departure city',exact:true}).getByText('Flow Origin fixture',{exact:true}).waitFor();
    await h.page.getByRole('button',{name:'Choose fare destination city',exact:true}).getByText('Flow Destination fixture',{exact:true}).waitFor();assert.equal(await h.page.getByLabel('Fare amount').inputValue(),'');
    await h.page.getByRole('button',{name:'Choose fare currency',exact:true}).click();await h.page.getByRole('radio',{name:'Currency: USD',exact:true}).click();await h.page.getByLabel('Fare amount').fill('12');await h.page.getByRole('radio',{name:'Price type: Quoted',exact:true}).click();
    await h.page.getByRole('button',{name:'Fare conditions',exact:true}).click();await h.page.getByRole('radio',{name:'Passenger: Unknown',exact:true}).click();await h.page.getByRole('radio',{name:'Ticket: Unknown',exact:true}).click();
    await h.page.getByRole('button',{name:'Preview fare',exact:true}).click();await h.page.getByRole('button',{name:'Use this fare',exact:true}).click();
    await h.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await h.page.getByRole('button',{name:'Continue journey draft',exact:true}).click();await h.page.getByRole('button',{name:'Resume draft',exact:true}).click();await h.page.getByText('Your submitted route',{exact:true}).waitFor();
    await h.page.getByRole('button',{name:'Review journey',exact:true}).click();await h.page.getByRole('button',{name:'Save journey report',exact:true}).click();await h.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();
    assert.equal(h.posts(),1);const request=h.requests()[0];assert.equal(request.entrySurface,'own_contribution');assert.equal(request.target.newActualJourney.intendedSubject.id,historySubject);assert.equal(request.observations.length,1);assert.equal(request.observations[0].fieldKey,'fare.quoted');
    results.push('owned route history reopens after leaving Saved in a fresh session; scoped fare and route context survive close/resume and commit once');await h.context.close();
  }
  {
    const h=await session(0,false,'home');await h.context.route('**/api/v2/my-routes',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'TEMPORARILY_UNAVAILABLE',error:'CI injected history outage'})}));
    await h.page.getByRole('button',{name:'My routes',exact:true}).click();await h.page.getByText('Your routes could not be loaded. Try again.',{exact:true}).waitFor();assert.equal(await h.page.getByText('No submitted routes yet.',{exact:true}).count(),0);
    await h.context.unroute('**/api/v2/my-routes');await h.page.getByRole('button',{name:'Refresh routes',exact:true}).click();
    const card=h.page.getByText('History browser bus · 08:30',{exact:true}).locator('..');await card.getByRole('button',{name:'Add details',exact:true}).waitFor();
    await admin.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[historySubject]);await card.getByRole('button',{name:'Add details',exact:true}).click();await h.page.getByText('Details are unavailable for this submitted route.',{exact:true}).waitFor();
    assert.equal(await card.getByRole('button',{name:'Add details',exact:true}).count(),0);assert.equal(await h.page.getByRole('heading',{name:'Report a journey',exact:true}).count(),0);assert.equal(h.posts(),0);
    results.push('history errors stay distinct from empty results; refreshed selection detects a newly retired route without opening or posting a report');await h.context.close();
  }
  {
    const h=await session(0,false,'journey');await h.page.getByRole('checkbox',{name:'Operator',exact:true}).click();await h.page.getByLabel('Observed operator').fill('History independent bus');await h.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();
    await h.page.getByRole('button',{name:'My routes',exact:true}).click();await h.page.getByRole('button',{name:'Add details',exact:true}).first().click();await h.page.getByRole('button',{name:'Resume draft',exact:true}).click();
    await h.page.getByText('Independent report',{exact:true}).waitFor();assert.equal(await h.page.getByText('Your submitted route',{exact:true}).count(),0);assert.equal(await h.page.getByLabel('Observed operator').inputValue(),'History independent bus');
    await h.page.getByRole('button',{name:'Review journey',exact:true}).click();await h.page.getByRole('button',{name:'Save journey report',exact:true}).click();await h.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();assert.equal(h.posts(),1);assert.equal(h.requests()[0].entrySurface,'contribute_tab');assert.equal('intendedSubject' in h.requests()[0].target.newActualJourney,false);
    results.push('existing independent draft wins over a history selection and saves without a silently added route target');await h.context.close();
  }
  {
    const guest=await session(null,false,'home');await guest.page.getByRole('button',{name:'My routes',exact:true}).click();await guest.page.getByText('Sign in to see your submitted routes.',{exact:true}).waitFor();assert.equal(await guest.page.getByText('History browser bus · 08:30',{exact:true}).count(),0);assert.equal(guest.posts(),0);await guest.context.close();
    const empty=await session(2,false,'home');await empty.page.getByRole('button',{name:'My routes',exact:true}).click();await empty.page.getByText('No submitted routes yet.',{exact:true}).waitFor();assert.equal(await empty.page.getByText('History browser bus · 08:30',{exact:true}).count(),0);assert.equal(empty.posts(),0);await empty.context.close();
    results.push('guest history asks for sign-in and another authenticated account has an honest empty list without private route leakage');
  }

  // Public UI: actual selected IDs, another account, existing fact forms and safety.
  const publicCities=[];
  for(const name of ['Bulawayo','Gweru']){let city=(await admin.query('SELECT id FROM cities WHERE name=$1 ORDER BY id LIMIT 1',[name])).rows[0];if(!city)city=(await admin.query("INSERT INTO cities(name,place_type) VALUES($1,'city') RETURNING id",[name])).rows[0];publicCities.push(city.id);}
  await admin.query("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=now() WHERE id=$1",[users[1]]);
  async function seedPublic(name,time){const response=await fetch('http://127.0.0.1:5000/api/v2/contributions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[0],'X-Mabhazi-Account':users[0]},body:JSON.stringify({schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newLead:{originCityId:publicCities[0],destinationCityId:publicCities[1],departureTime:time,operator:{name}}},observations:[]})});assert.equal(response.status,200);return await response.json();}
  const publicA=await seedPublic('Public popup A','08:30'),publicB=await seedPublic('Public popup B','14:00'),publicC=await seedPublic('Road Wolf','07:00');
  async function publicSearch(s){await s.page.getByText('Search for a route',{exact:true}).waitFor();for(const[label,name]of[['From city','Bulawayo'],['To city','Gweru']]){await s.page.getByText(label,{exact:true}).click();await s.page.getByPlaceholder('Type a city name…',{exact:true}).fill(name);await s.page.getByText(name,{exact:true}).click();}await s.page.getByText('Search Routes',{exact:true}).click();}
  async function publicShot(s,name){await takeShot(s.page,name);}
  async function openPublic(s,name='Public popup A',time='08:30'){await s.page.getByRole('button',{name:'Open route report '+name+' '+time,exact:true}).click();await s.page.getByRole('heading',{name:'Route report',exact:true}).waitFor();await s.page.getByRole('heading',{name:'Route report',exact:true}).locator('..').locator('..').getByText(name,{exact:true}).waitFor();}
  {
   const s=await session(1,true,'search');await publicSearch(s);await s.page.getByRole('button',{name:'Open route report Public popup B 14:00',exact:true}).waitFor();await publicShot(s,'public-search.png');await openPublic(s);await s.page.getByRole('heading',{name:'Route report',exact:true}).locator('..').locator('..').getByText('Days not confirmed',{exact:true}).waitFor();assert.equal(s.posts(),0);await publicShot(s,'public-route-detail.png');
   await s.page.getByRole('button',{name:'Add fare',exact:true}).click();await s.page.getByRole('button',{name:'Choose fare departure city',exact:true}).getByText('Bulawayo',{exact:true}).waitFor();await s.page.getByRole('button',{name:'Choose fare destination city',exact:true}).getByText('Gweru',{exact:true}).waitFor();assert.equal(await s.page.getByLabel('Fare amount').inputValue(),'');
   await s.page.getByRole('button',{name:'Choose fare currency',exact:true}).click();await s.page.getByRole('radio',{name:'Currency: USD',exact:true}).click();await s.page.getByLabel('Fare amount').fill('12.50');await s.page.getByRole('radio',{name:'Price type: Quoted',exact:true}).click();await s.page.getByRole('button',{name:'Fare conditions',exact:true}).click();await s.page.getByRole('radio',{name:'Passenger: Unknown',exact:true}).click();await s.page.getByRole('radio',{name:'Ticket: Unknown',exact:true}).click();await s.page.getByRole('button',{name:'Preview fare',exact:true}).click();await s.page.getByRole('button',{name:'Use this fare',exact:true}).click();await s.page.getByText('Selected route report',{exact:true}).waitFor();await s.page.getByRole('button',{name:'Review journey',exact:true}).click();await publicShot(s,'public-fare-review.png');await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();await s.page.getByText('Save not confirmed.',{exact:false}).waitFor();await s.page.getByRole('button',{name:'Check and retry',exact:true}).click();await s.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();assert.equal(s.posts(),1);
   const input=s.requests()[0];assert.equal(input.entrySurface,'route_detail');assert.equal(input.target.newActualJourney.intendedSubject.id,publicA.subjectId);assert.equal(input.observations.length,1);assert.equal(input.observations[0].fieldKey,'fare.quoted');assert.deepEqual(input.observations[0].scope.segment,{kind:'city_pair',originCityId:publicCities[0],destinationCityId:publicCities[1]});assert.equal(input.actualContext,undefined);assert.equal((await admin.query('SELECT count(*) FROM v2_receipts WHERE user_id=$1 AND client_submission_id=$2',[users[1],input.clientSubmissionId])).rows[0].count,'1');
   results.push('public Search keeps company/clock identities separate; another account opens Focused Fare with only explicit segment IDs and lost acknowledgement recovers one contextual receipt');await s.context.close();
  }
  {
   const s=await session(1,false,'search');await publicSearch(s);await openPublic(s,'Public popup B','14:00');await s.page.getByRole('button',{name:'Report a journey',exact:true}).click();await s.page.getByRole('checkbox',{name:'Operator',exact:true}).click();await s.page.getByLabel('Observed operator').fill('Preserved public evidence');await s.page.getByRole('button',{name:'Review journey',exact:true}).click();await admin.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[publicB.subjectId]);await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();await s.page.getByRole('button',{name:'Keep as independent report',exact:true}).waitFor();await publicShot(s,'public-stale-target.png');const oldKey=s.requests()[0].clientSubmissionId;
   await s.page.getByRole('button',{name:'Keep as independent report',exact:true}).click();await s.page.getByText('Independent report',{exact:true}).waitFor();assert.equal(await s.page.getByLabel('Observed operator').inputValue(),'Preserved public evidence');await s.page.getByRole('button',{name:'Review journey',exact:true}).click();await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();await s.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();assert.equal(s.posts(),2);assert.notEqual(s.requests()[1].clientSubmissionId,oldKey);assert.equal(s.requests()[1].entrySurface,'contribute_tab');assert.equal(s.requests()[1].target.newActualJourney.intendedSubject,undefined);
   results.push('public target retirement preserves the frozen report; receipt-checked independent recovery keeps facts and uses a new key without restoring a rejected target');await s.context.close();
  }
  {
   const guest=await session(null,false,'search');await publicSearch(guest);await openPublic(guest);await guest.page.getByRole('button',{name:'Sign in to contribute',exact:true}).waitFor();assert.equal(await guest.page.getByRole('button',{name:'Add fare',exact:true}).count(),0);assert.equal(guest.posts(),0);await guest.context.close();
   const s=await session(2,false,'search');await publicSearch(s);await openPublic(s);await s.page.getByRole('button',{name:'Report or hide',exact:true}).click();await s.page.getByRole('button',{name:'Report this route',exact:true}).click();await s.page.getByRole('radio',{name:'Report reason: Incorrect details',exact:true}).click();await s.page.getByRole('button',{name:'Send route report',exact:true}).click();await s.page.getByText('Report received.',{exact:true}).waitFor();await s.page.getByRole('button',{name:'Hide this contributor’s route reports',exact:true}).click();await s.page.getByText('Results hidden by your block settings',{exact:true}).waitFor();assert.equal(await s.page.getByRole('button',{name:'Add a route',exact:true}).count(),0);assert.equal(s.posts(),0);await s.context.close();
   const profile=await session(2,false,'profile');await profile.page.getByText('Manage blocked contributors',{exact:true}).click();await profile.page.getByRole('button',{name:'Account contributor blocks',exact:true}).click();await profile.page.getByRole('heading',{name:'Hidden contributors',exact:true}).waitFor();await profile.page.getByRole('button',{name:'Unblock contributor 1',exact:true}).click();await profile.page.getByText('No contributors hidden.',{exact:true}).waitFor();await publicShot(profile,'public-blocks.png');await profile.context.close();
   const restored=await session(2,false,'search');await publicSearch(restored);await restored.page.getByRole('button',{name:'Open route report Public popup A 08:30',exact:true}).waitFor();assert.equal(restored.posts(),0);await restored.context.close();
   results.push('guests read without write authority; reporting/blocking works without contribution Terms, hidden results never become empty intake and account-owned unblock restores discoverability without author IDs');
  }
  {
   const s=await session(1,false,'search');await publicSearch(s);await openPublic(s);await s.page.getByRole('button',{name:'Report a journey',exact:true}).click();await s.page.getByRole('checkbox',{name:'Operator',exact:true}).click();await s.page.getByLabel('Observed operator').fill('Earlier public draft');await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await openPublic(s,'Road Wolf','07:00');await s.page.getByRole('button',{name:'Add fare',exact:true}).click();await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();await s.page.getByText('Public popup A · 08:30',{exact:true}).waitFor();assert.equal(await s.page.getByLabel('Observed operator').inputValue(),'Earlier public draft');assert.equal(await s.page.getByLabel('Fare amount').count(),0);await s.page.getByRole('button',{name:'Review journey',exact:true}).click();await s.page.getByRole('button',{name:'Save journey report',exact:true}).click();await s.page.getByRole('heading',{name:'Journey report saved',exact:true}).waitFor();assert.equal(s.requests()[0].target.newActualJourney.intendedSubject.id,publicA.subjectId);results.push('an earlier public draft wins over another result’s Add fare action and keeps its own original target and entered facts');await s.context.close();
  }
  {
   const s=await session(1,false,'search');let fail=true;await s.context.route(/\/api\/v2\/search(?:\?|$)/,async route=>{if(fail)await route.fulfill({status:503,contentType:'application/json',body:'{}'});else await route.fallback();});await publicSearch(s);await s.page.getByText('Search could not load',{exact:true}).waitFor();assert.equal(await s.page.getByRole('button',{name:'Add a route',exact:true}).count(),0);fail=false;await s.page.getByRole('button',{name:'Try search again',exact:true}).click();await s.page.getByRole('button',{name:'Open route report Public popup A 08:30',exact:true}).waitFor();assert.equal(s.posts(),0);results.push('public catalog failure stays distinct from an empty legacy feed and explicit retry restores reports without duplicate-intake invitation');await s.context.close();
  }

  // Real dated fare projection, rendered in the existing safe-area route modal.
  const fareDay=(await admin.query("SELECT to_char(statement_timestamp()-interval '2 days','YYYY-MM-DD') d")).rows[0].d;
  async function seedDatedFare(kind,amount,currency){
   const revision=(await admin.query('SELECT revision FROM v2_subjects WHERE id=$1',[publicC.subjectId])).rows[0].revision;
   const input={schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'route_detail',target:{newActualJourney:{intendedSubject:{id:publicC.subjectId,kind:'lead',expectedRevision:Number(revision)}}},observations:[{fieldKey:'fare.'+kind,value:{amount,currency},scope:{schemaVersion:'1.0',segment:{kind:'city_pair',originCityId:publicCities[0],destinationCityId:publicCities[1]},passengerCategory:kind==='paid'?'child':'adult',ticketBasis:kind==='paid'?'return':'one_way',...(kind==='paid'?{serviceDate:fareDay}:{quotationDate:fareDay})}}],actualContext:{knowledgeBasis:kind==='paid'?'travelled':'observed_sign'}};
   const response=await fetch('http://127.0.0.1:5000/api/v2/actual-journeys',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[1],'X-Mabhazi-Account':users[1]},body:JSON.stringify(input)});assert.equal(response.status,200);return await response.json();
  }
  const paidFare=await seedDatedFare('paid','42','USD'),quotedFare=await seedDatedFare('quoted','100','ZAR');
  await admin.query("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE state='pending' AND NOT(subject_id=ANY($1::uuid[]))",[[publicC.subjectId,paidFare.subjectId,quotedFare.subjectId]]);
  await admin.query('SELECT v2_worker_drain_normalise(20)');await admin.query('SELECT v2_worker_drain_associate(20)');assert.equal((await admin.query('SELECT v2_worker_drain_assess(20) r')).rows[0].r.failedAttempts,0);
  {
   const s=await session(null,false,'search');await publicSearch(s);await openPublic(s,'Road Wolf','07:00');await s.page.getByText('USD 42',{exact:true}).waitFor();await s.page.getByText('ZAR 100',{exact:true}).waitFor();await s.page.getByText('Child · Return',{exact:true}).waitFor();await s.page.getByText('Adult · One way',{exact:true}).waitFor();
   const [year,month,day]=fareDay.split('-').map(Number),displayDate=day+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month-1]+' '+year;await s.page.getByText('Paid · '+displayDate,{exact:true}).waitFor();await s.page.getByText('Quoted · '+displayDate,{exact:true}).waitFor();
   assert.equal(await s.page.getByRole('button',{name:'Report this fare',exact:true}).count(),0);await publicShot(s,'dated-fare-reports.png');await s.page.getByRole('button',{name:'Fare details · USD 42',exact:true}).click();await s.page.getByText('Travelled',{exact:true}).waitFor();await s.page.getByText('A dated report; the fare for your journey may differ.',{exact:true}).waitFor();await publicShot(s,'dated-fare-details.png');assert.equal(s.posts(),0);results.push('guests see real assessed paid/quoted dates, currency and child/return conditions in the existing route modal; private evidence remains collapsed and no current price is invented');await s.context.close();
  }
  {
   const s=await session(null,false,'search');let fail=true;await s.context.route(/\/api\/v2\/subjects\/[^/]+\/fares(?:\?|$)/,async route=>{if(fail)await route.fulfill({status:503,contentType:'application/json',body:'{}'});else await route.fallback();});await publicSearch(s);await openPublic(s,'Road Wolf','07:00');await s.page.getByText('Fare reports could not load.',{exact:true}).waitFor();assert.equal(await s.page.getByText('No fare reports yet.',{exact:true}).count(),0);await s.page.getByRole('button',{name:'Sign in to contribute',exact:true}).waitFor();fail=false;await s.page.getByRole('button',{name:'Try fare reports again',exact:true}).click();await s.page.getByText('USD 42',{exact:true}).waitFor();results.push('fare read failure stays separate from empty evidence and route actions remain usable; explicit retry restores the actual fare');await s.context.close();
  }
  {
   const s=await session(2,false,'search');await publicSearch(s);await openPublic(s,'Road Wolf','07:00');await s.page.getByRole('button',{name:'Fare details · USD 42',exact:true}).click();await s.page.getByRole('button',{name:'Report this fare',exact:true}).click();await s.page.getByRole('radio',{name:'Fare report reason: Incorrect details',exact:true}).click();await s.page.getByRole('button',{name:'Send fare report',exact:true}).click();await s.page.getByText('Fare report received.',{exact:true}).waitFor();await s.page.getByRole('button',{name:'Hide this fare contributor',exact:true}).click();await s.page.getByText('Some reports are hidden by your settings.',{exact:true}).waitFor();assert.equal(await s.page.getByText('USD 42',{exact:true}).count(),0);assert.equal(await s.page.getByText('ZAR 100',{exact:true}).count(),0);await s.page.getByRole('heading',{name:'Route report',exact:true}).locator('..').locator('..').getByText('Road Wolf',{exact:true}).waitFor();await s.page.getByRole('button',{name:'Add fare',exact:true}).waitFor();await publicShot(s,'dated-fare-hidden.png');assert.equal(s.posts(),0);await s.context.close();
   const profile=await session(2,false,'profile');await profile.page.getByText('Manage blocked contributors',{exact:true}).click();await profile.page.getByRole('button',{name:'Account contributor blocks',exact:true}).click();await profile.page.getByRole('heading',{name:'Hidden contributors',exact:true}).waitFor();await profile.page.getByRole('button',{name:'Unblock contributor 1',exact:true}).click();await profile.page.getByText('No contributors hidden.',{exact:true}).waitFor();await profile.context.close();
   const restored=await session(2,false,'search');await publicSearch(restored);await openPublic(restored,'Road Wolf','07:00');await restored.page.getByText('USD 42',{exact:true}).waitFor();results.push('fare report/hide works without contribution Terms, hides the fare author rather than the different route author, and private account unblock restores both fares');await restored.context.close();
  }
  {
   const s=await session(1,false,'search');await publicSearch(s);await openPublic(s,'Road Wolf','07:00');await s.page.getByRole('button',{name:'Fare details · USD 42',exact:true}).click();assert.equal(await s.page.getByRole('button',{name:'Hide this fare contributor',exact:true}).count(),0);await s.context.close();
   await admin.query('UPDATE v2_subjects SET input_generation=input_generation+1 WHERE id=ANY($1::uuid[])',[[paidFare.subjectId,quotedFare.subjectId]]);
   const pending=await session(null,false,'search');await publicSearch(pending);await openPublic(pending,'Road Wolf','07:00');await pending.page.getByText('Some reports are still being checked.',{exact:true}).waitFor();assert.equal(await pending.page.getByText('USD 42',{exact:true}).count(),0);assert.equal(await pending.page.getByText('No fare reports yet.',{exact:true}).count(),0);await publicShot(pending,'dated-fare-pending.png');results.push('own fare has no self-block action; changed evidence withholds cached amounts and shows checking rather than a false empty result');await pending.context.close();
  }


  // Direct endpoint knowledge: no actual journey, route or inferred trip context.
  await admin.query("UPDATE users SET terms_accepted_version='2026-09-12',terms_accepted_at=now() WHERE id=ANY($1::varchar[])",[users]);
  const locationA=await seedPublic('Location knowledge coach','08:45'),locationB=await seedPublic('Other location coach','13:15');
  async function openLocations(s,name='Location knowledge coach',time='08:45'){await openPublic(s,name,time);await s.page.getByRole('button',{name:'Add pickup / drop-off',exact:true}).click();await s.page.getByRole('heading',{name:'Pickup or drop-off',exact:true}).waitFor();}
  {
    const s=await session(2,true,'search');await publicSearch(s);await openLocations(s);await s.page.getByLabel('Pickup place name',{exact:true}).waitFor();
    await publicShot(s,'locations-blank.png');await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await s.page.getByText('Name the station, rank or landmark.',{exact:true}).waitFor();assert.equal(s.posts(),0);
    await s.page.getByLabel('Pickup place name',{exact:true}).fill('Central bus rank');await s.page.getByRole('checkbox',{name:'Drop-off location',exact:true}).click();await s.page.getByLabel('Drop-off place name',{exact:true}).fill('Market stop');
    await s.page.getByRole('button',{name:'Add directions or date',exact:true}).click();await s.page.getByLabel('pickup directions',{exact:true}).fill('Use the south entrance');await s.page.getByLabel('pickup observation date',{exact:true}).fill('2026-02-30');await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await s.page.getByText('Enter a valid date as YYYY-MM-DD, or leave it blank.',{exact:true}).waitFor();assert.equal(s.posts(),0);
    await s.page.getByLabel('pickup observation date',{exact:true}).fill('2026-10-25');await s.page.getByRole('radio',{name:'Pickup knowledge: I saw a sign',exact:true}).click();await s.page.getByRole('button',{name:'Hide optional details',exact:true}).click();await publicShot(s,'locations-filled.png');
    await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await s.page.setViewportSize({width:390,height:450});await publicShot(s,'locations-compact-review.png');const save=await s.page.getByRole('button',{name:'Save locations',exact:true}).boundingBox();assert.ok(save&&save.y>=0&&save.y+save.height<=450,'Location Save stays visible in short frame');
    const actualBefore=(await admin.query('SELECT count(*) FROM v2_actual_journeys')).rows[0].count;
    await s.page.getByRole('button',{name:'Save locations',exact:true}).click();await s.page.getByText('Save not confirmed.',{exact:false}).waitFor();await publicShot(s,'locations-save-uncertain.png');await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await s.page.setViewportSize({width:390,height:844});await openLocations(s);await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();await s.page.getByRole('button',{name:'Check and retry',exact:true}).click();await s.page.getByRole('heading',{name:'Locations saved',exact:true}).waitFor();assert.equal(s.posts(),1);await publicShot(s,'locations-saved.png');
    const input=s.requests()[0];assert.equal(input.target.existing.subjectId,locationA.subjectId);assert.equal(input.observations.length,2);assert.deepEqual(input.observations.map(o=>o.value.cityId),publicCities);assert.equal(input.observations[0].observedDate,'2026-10-25');assert.equal(input.observations[0].knowledgeBasis,'observed_sign');assert.ok(!('observedDate' in input.observations[1]));assert.ok(!('knowledgeBasis' in input.observations[1]));assert.equal((await admin.query('SELECT count(*) FROM v2_actual_journeys')).rows[0].count,actualBefore);assert.equal((await admin.query('SELECT count(*) FROM v2_contributions WHERE user_id=$1 AND client_submission_id=$2',[users[2],input.clientSubmissionId])).rows[0].count,'1');await s.context.close();results.push('direct pickup/drop-off: required names and real dates, own endpoint cities, optional evidence, compact controls and lost-response close/resume recover one receipt without creating travel');
  }
  {
    const s=await session(2,false,'search');await publicSearch(s);await openLocations(s);await s.page.getByLabel('Pickup place name',{exact:true}).fill('Original rank');await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await openLocations(s,'Other location coach','13:15');await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();assert.equal(await s.page.getByLabel('Pickup place name',{exact:true}).inputValue(),'Original rank');await s.page.getByText('Location knowledge coach · 08:45',{exact:true}).waitFor();await publicShot(s,'locations-resumed-original-route.png');await admin.query('UPDATE v2_subjects SET revision=revision+1 WHERE id=$1',[locationA.subjectId]);await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await s.page.getByRole('button',{name:'Save locations',exact:true}).click();await s.page.getByRole('heading',{name:'Locations saved',exact:true}).waitFor();assert.equal(s.requests()[0].target.existing.subjectId,locationA.subjectId);const receipt=(await admin.query('SELECT initial_response FROM v2_receipts WHERE user_id=$1 AND client_submission_id=$2',[users[2],s.requests()[0].clientSubmissionId])).rows[0].initial_response;assert.equal(receipt.targetAdvanced,true);await s.context.close();results.push('an existing location draft keeps its original route over a new entry target; compatible revision advance saves the same independent knowledge');
  }
  {
    const s=await session(0,false,'home');await s.page.getByRole('button',{name:'My routes',exact:true}).click();await s.page.getByText('Location knowledge coach · 08:45',{exact:true}).locator('..').getByRole('button',{name:'Add pickup / drop-off',exact:true}).click();await s.page.getByLabel('Pickup place name',{exact:true}).fill('Retained rank');await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await admin.query("UPDATE v2_leads SET operator_name='Changed location coach' WHERE subject_id=$1",[locationA.subjectId]);await s.page.getByRole('button',{name:'Save locations',exact:true}).click();await s.page.getByRole('button',{name:'Check changed route',exact:true}).waitFor();await publicShot(s,'locations-changed-route.png');await s.page.getByRole('button',{name:'Check changed route',exact:true}).click();await s.page.getByText('Changed location coach · 08:45',{exact:true}).waitFor();assert.equal(await s.page.getByLabel('Pickup place name',{exact:true}).inputValue(),'Retained rank');assert.equal(s.posts(),1);await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await s.page.getByRole('button',{name:'Save locations',exact:true}).click();await s.page.getByRole('heading',{name:'Locations saved',exact:true}).waitFor();assert.equal(s.posts(),2);assert.notEqual(s.requests()[0].clientSubmissionId,s.requests()[1].clientSubmissionId);assert.notEqual(s.requests()[0].target.existing.identityKey,s.requests()[1].target.existing.identityKey);await s.context.close();results.push('changed structural route identity preserves location answers and requires receipt-checked explicit context refresh, review and a new save key');
  }
  {
    const s=await session(0,false,'home');await s.page.getByRole('button',{name:'My routes',exact:true}).click();const row=s.page.getByText('Other location coach · 13:15',{exact:true}).locator('..');await row.getByRole('button',{name:'Add pickup / drop-off',exact:true}).click();await s.page.getByLabel('Pickup place name',{exact:true}).fill('Owned route rank');await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await s.page.getByRole('button',{name:'Continue location draft',exact:true}).click();await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();assert.equal(await s.page.getByLabel('Pickup place name',{exact:true}).inputValue(),'Owned route rank');await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await s.page.getByRole('button',{name:'Save locations',exact:true}).click();await s.page.getByRole('heading',{name:'Locations saved',exact:true}).waitFor();assert.equal(s.requests()[0].entrySurface,'own_contribution');assert.equal(s.requests()[0].target.existing.subjectId,locationB.subjectId);await s.context.close();results.push('My routes opens endpoint capture and Contribute resumes the account draft with its original own-route target and entry surface');
  }
  {
    const s=await session(2,false,'search');await s.context.route('**/api/v2/capabilities',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schemaVersion:'1.0',minimumLeadEnabled:true,actualJourneyEnabled:true,fareReportsEnabled:true})}));await publicSearch(s);await openPublic(s,'Other location coach','13:15');assert.equal(await s.page.getByRole('button',{name:'Add pickup / drop-off',exact:true}).count(),0);assert.equal(await s.page.getByRole('button',{name:'Add fare',exact:true}).isEnabled(),true);assert.equal(s.posts(),0);await s.context.close();results.push('an older backend without the optional location capability retains existing route/fare actions and offers no unavailable location entry');
  }

  // Typed readers: separate original private saves from assessed public reports.
  const readerLead=await seedPublic('Location display coach','10:15');
  async function seedPlace(owner,kind,name,instructions){
    const headers={'Content-Type':'application/json',Authorization:'Bearer '+tokens[owner],'X-Mabhazi-Account':users[owner]};
    const c=await fetch('http://127.0.0.1:5000/api/v2/subjects/'+readerLead.subjectId+'/contribution-context',{headers});assert.equal(c.status,200);const value=await c.json();
    const r=await fetch('http://127.0.0.1:5000/api/v2/route-observations',{method:'POST',headers,body:JSON.stringify({schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'route_detail',target:{existing:{subjectId:readerLead.subjectId,expectedRevision:value.revision,identityKey:value.identityKey}},observations:[{fieldKey:kind==='pickup'?'boarding.pickup':'alighting.dropoff',value:{cityId:publicCities[kind==='pickup'?0:1],name,...(instructions?{instructions}:{})},scope:{}}]})});assert.equal(r.status,200);return await r.json();
  }
  await seedPlace(0,'pickup','City depot','Use the south gate');await seedPlace(1,'dropoff','Market exit');
  {
    const s=await session(null,false,'search');await publicSearch(s);await openPublic(s,'Location display coach','10:15');await s.page.getByText('Some locations are still being checked.',{exact:true}).waitFor();assert.equal(await s.page.getByText('City depot',{exact:true}).count(),0);await publicShot(s,'place-reports-pending.png');await s.context.close();results.push('new endpoint reports stay Checking without leaking unassessed names or declaring a false empty result');
  }
  {
    const s=await session(0,false,'home');await s.page.getByRole('button',{name:'My routes',exact:true}).click();const row=s.page.getByText('Location display coach · 10:15',{exact:true}).locator('..');await row.getByRole('button',{name:'Your saved locations',exact:true}).click();await row.getByText('City depot',{exact:true}).waitFor();assert.equal(await row.getByText('Market exit',{exact:true}).count(),0);await row.getByRole('button',{name:'Location details · Pickup · City depot',exact:true}).click();await row.getByText('Date unknown',{exact:true}).waitFor();await publicShot(s,'place-reports-own.png');assert.equal(s.posts(),0);await s.context.close();results.push('My routes shows only this account’s saved endpoint reports before assessment, with unknown dates retained and no other contributor data');
  }
  await admin.query("UPDATE v2_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE state='pending' AND subject_id<>$1",[readerLead.subjectId]);
  for(let i=0;i<6;i++){await admin.query('SELECT v2_worker_drain_normalise(20)');await admin.query('SELECT v2_worker_drain_associate(20)');assert.equal((await admin.query('SELECT v2_worker_drain_assess(20) r')).rows[0].r.failedAttempts,0);}
  {
    const s=await session(null,false,'search');await publicSearch(s);await openPublic(s,'Location display coach','10:15');await s.page.getByText('City depot',{exact:true}).waitFor();await s.page.getByText('Market exit',{exact:true}).waitFor();await s.page.getByText('Pickup · Bulawayo',{exact:true}).waitFor();await s.page.getByText('Drop-off · Gweru',{exact:true}).waitFor();await publicShot(s,'place-reports-public.png');await s.page.getByRole('button',{name:'Location details · Pickup · City depot',exact:true}).click();await s.page.getByText('Not provided',{exact:true}).waitFor();assert.equal(await s.page.getByRole('button',{name:'Report this location',exact:true}).count(),0);await publicShot(s,'place-reports-evidence.png');await s.page.setViewportSize({width:390,height:560});await publicShot(s,'place-reports-compact.png');assert.equal(await s.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(s.posts(),0);await s.context.close();results.push('guest route detail shows assessed pickup/drop-off with exact endpoint cities and explicit directions; date/source remain expandable unknowns in narrow and compact layouts');
  }
  {
    await admin.query('UPDATE users SET terms_accepted_version=NULL,terms_accepted_at=NULL WHERE id=$1',[users[2]]);
    const s=await session(2,false,'search');await publicSearch(s);await openPublic(s,'Location display coach','10:15');await s.page.getByRole('button',{name:'Location details · Drop-off · Market exit',exact:true}).click();await s.page.getByRole('button',{name:'Report this location',exact:true}).click();await s.page.getByRole('radio',{name:'Location report reason: Incorrect details',exact:true}).click();await s.page.getByRole('button',{name:'Send location report',exact:true}).click();await s.page.getByText('Location report received.',{exact:true}).waitFor();await s.page.getByRole('button',{name:'Hide this location contributor',exact:true}).click();await s.page.getByText('Some locations are hidden by your settings.',{exact:true}).waitFor();await s.page.getByText('City depot',{exact:true}).waitFor();assert.equal(await s.page.getByText('Market exit',{exact:true}).count(),0);await publicShot(s,'place-reports-hidden.png');assert.equal(s.posts(),0);await s.context.close();results.push('location reporting and contributor hiding work without Terms, suppress only the matching author and keep the different route/pickup author visible');
  }
  {
    const s=await session(null,false,'search');let failPlaceRead=true;await s.context.route('**/api/v2/subjects/*/places',route=>failPlaceRead?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'TEMPORARILY_UNAVAILABLE',error:'Synthetic location outage'})}):route.fallback());await publicSearch(s);await openPublic(s,'Location display coach','10:15');await s.page.getByText('Location reports could not load.',{exact:true}).waitFor();assert.equal(await s.page.getByText('No location reports available.',{exact:true}).count(),0);failPlaceRead=false;await s.page.getByRole('button',{name:'Try location reports again',exact:true}).click();await s.page.getByText('City depot',{exact:true}).waitFor();assert.equal(s.posts(),0);await s.context.close();
    const old=await session(0,false,'search');await old.context.route('**/api/v2/capabilities',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schemaVersion:'1.0',minimumLeadEnabled:true,actualJourneyEnabled:true,fareReportsEnabled:true,routeObservationsEnabled:true})}));await publicSearch(old);await openPublic(old,'Location display coach','10:15');assert.equal(await old.page.getByRole('heading',{name:'Pickup & drop-off',exact:true}).count(),0);assert.equal(await old.page.getByRole('button',{name:'Add pickup / drop-off',exact:true}).isEnabled(),true);assert.equal(await old.page.getByRole('button',{name:'Help with pickup',exact:true}).count(),0);await old.context.close();results.push('a reader outage has an explicit retry without false empty data; an older backend omits only the new report display and keeps location capture');
  }

  // Supported manual questions: real app, generated client, authenticated API,
  // restricted PostgreSQL and synthetic accounts; never real hosted records.
  async function questionFixture(name,time,task=true){const saved=await seedPublic(name,time);if(task)await admin.query("SELECT v2_prompt_put_task($1,'boarding.pickup','{}','pickup_place',(SELECT input_generation FROM v2_subjects WHERE id=$1))",[saved.subjectId]);return saved;}
  async function openQuestion(s,name,time){await openPublic(s,name,time);await s.page.getByRole('button',{name:'Help with pickup',exact:true}).click();await s.page.getByRole('radio',{name:'Your connection to this route: I know this route',exact:true}).or(s.page.getByRole('button',{name:'Resume draft',exact:true})).waitFor();}
  async function declareQuestion(s){await s.page.getByRole('radio',{name:'Your connection to this route: I know this route',exact:true}).click();await s.page.getByRole('button',{name:'Continue',exact:true}).click();await s.page.getByText('Where does this bus pick up in Bulawayo?',{exact:true}).waitFor();}
  async function startPickup(s){await s.page.getByRole('button',{name:'Add pickup',exact:true}).click();await s.page.getByLabel('Pickup place name',{exact:true}).waitFor();}
  {
    const f=await questionFixture('Question newcomer coach','11:20'),id=randomUUID(),token=randomBytes(32).toString('hex');
    await admin.query('INSERT INTO users(id) VALUES($1)',[id]);await admin.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 day')",[token,{user:{id},access_token:'ci-new-question-account',expires_at:Math.floor(Date.now()/1000)+3600}]);users.push(id);tokens.push(token);
    const s=await session(users.length-1,false,'search');await publicSearch(s);await openQuestion(s,'Question newcomer coach','11:20');await publicShot(s,'pickup-question-declaration.png');
    assert.equal((await admin.query('SELECT count(*) FROM v2_prompt_invitations WHERE user_id=$1',[id])).rows[0].count,'0');await declareQuestion(s);await publicShot(s,'pickup-question-offered.png');await s.page.getByRole('button',{name:'I don’t know',exact:true}).click();await s.page.getByText('Question closed.',{exact:true}).waitFor();
    assert.equal(s.posts(),0);assert.equal((await admin.query('SELECT count(*) FROM v2_contributions WHERE user_id=$1',[id])).rows[0].count,'0');assert.equal((await admin.query('SELECT outcome FROM v2_prompt_events WHERE user_id=$1 ORDER BY received_at DESC LIMIT 1',[id])).rows[0].outcome,'unknown');assert.deepEqual((await admin.query('SELECT outcome FROM v2_prompt_events WHERE user_id=$1 ORDER BY received_at',[id])).rows.map(r=>r.outcome),['shown','unknown']);await publicShot(s,'pickup-question-unknown.png');await s.page.getByRole('button',{name:'Done',exact:true}).click();await openQuestion(s,'Question newcomer coach','11:20');assert.equal(await s.page.getByRole('button',{name:'Resume draft',exact:true}).count(),0);await s.context.close();results.push('a new public account volunteers route knowledge; viewing does not reserve, shown follows display and unknown works without Terms or any route fact');
  }
  {
    const f=await questionFixture('Question answer coach','11:25');const s=await session(1,true,'search');await publicSearch(s);await openQuestion(s,'Question answer coach','11:25');await declareQuestion(s);await startPickup(s);
    await s.page.getByLabel('Pickup place name',{exact:true}).fill('Question central rank');await publicShot(s,'pickup-question-answer.png');await s.page.setViewportSize({width:390,height:450});await publicShot(s,'pickup-question-compact-form.png');for(const title of ['Close form and keep draft','Review pickup']){const control=await s.page.getByRole('button',{name:title,exact:true}).boundingBox();assert.ok(control&&control.y>=0&&control.y+control.height<=450);}await s.page.setViewportSize({width:390,height:844});await s.page.getByRole('button',{name:'Review pickup',exact:true}).click();await s.page.setViewportSize({width:390,height:450});await publicShot(s,'pickup-question-compact-review.png');const box=await s.page.getByRole('button',{name:'Save pickup',exact:true}).boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=450);await s.page.getByRole('button',{name:'Save pickup',exact:true}).click();await s.page.getByText('Save not confirmed.',{exact:false}).waitFor();
    await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await s.page.setViewportSize({width:390,height:844});await openQuestion(s,'Question answer coach','11:25');await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();await s.page.getByRole('button',{name:'Check and retry',exact:true}).click();await s.page.getByRole('heading',{name:'Locations saved',exact:true}).waitFor();assert.equal(s.posts(),1);
    const request=s.requests()[0];assert.equal(request.target.existing.subjectId,f.subjectId);assert.equal(request.observations[0].knowledgeBasis,undefined);assert.equal(request.observations[0].observedDate,undefined);assert.equal('invitationId' in request,false);assert.equal((await admin.query('SELECT count(*) FROM v2_pickup_answer_requests WHERE user_id=$1 AND client_submission_id=$2',[users[1],request.clientSubmissionId])).rows[0].count,'1');await publicShot(s,'pickup-question-saved.png');await s.context.close();results.push('pickup question answer commits its matching report and binding; lost response resumes the frozen invitation/body and receipt-first retry performs one POST with compact safe footer');
  }
  {
    const f=await questionFixture('Question reserve recovery','11:30');const s=await session(1,false,'search');let lose=true;const sent=[];await s.context.route('**/api/v2/pickup-questions',async route=>{sent.push(route.request().postDataJSON());const response=await route.fetch({url:'http://127.0.0.1:5000/api/v2/pickup-questions'});if(lose){lose=false;await route.abort('failed');}else await route.fulfill({response});});await publicSearch(s);await openQuestion(s,'Question reserve recovery','11:30');await s.page.getByRole('radio',{name:'Your connection to this route: I know this route',exact:true}).click();await s.page.getByRole('button',{name:'Continue',exact:true}).click();await s.page.getByText('This step could not be confirmed.',{exact:false}).waitFor();await publicShot(s,'pickup-question-reservation-uncertain.png');await s.page.getByRole('button',{name:'Check pickup question',exact:true}).click();await s.page.getByText('Where does this bus pick up in Bulawayo?',{exact:true}).waitFor();assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal((await admin.query('SELECT count(*) FROM v2_prompt_invitations i JOIN v2_question_tasks t ON t.id=i.task_id WHERE i.user_id=$1 AND t.subject_id=$2',[users[1],f.subjectId])).rows[0].count,'1');await s.context.close();results.push('lost reservation acknowledgement retries the persisted exact request and creates one invitation');
  }
  {
    const f=await questionFixture('Question feedback recovery','11:35');const s=await session(1,false,'search');const sent=[];let lose=true;await s.context.route('**/api/v2/pickup-questions/*/events',async route=>{const body=route.request().postDataJSON();if(body.outcome!=='unknown'){await route.fallback();return;}sent.push(body);const url=new URL(route.request().url());const response=await route.fetch({url:'http://127.0.0.1:5000'+url.pathname});if(lose){lose=false;await route.abort('failed');}else await route.fulfill({response});});await publicSearch(s);await openQuestion(s,'Question feedback recovery','11:35');await declareQuestion(s);await startPickup(s);await s.page.getByLabel('Pickup place name',{exact:true}).fill('Keep my unsent location');await s.page.getByRole('button',{name:'I don’t know',exact:true}).click();await s.page.getByRole('button',{name:'Retry question step',exact:true}).click();await s.page.getByText('Question closed.',{exact:true}).waitFor();assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal(s.posts(),0);await s.page.getByRole('button',{name:'Add a location instead',exact:true}).click();assert.equal(await s.page.getByLabel('Pickup place name',{exact:true}).inputValue(),'Keep my unsent location');await publicShot(s,'pickup-question-independent-recovery.png');await s.context.close();results.push('lost unknown feedback keeps one event key and no fact; explicit independent reporting retains typed answers after question closure');
  }
  {
    const f=await questionFixture('Question original draft','11:40'),other=await questionFixture('Question new entry','11:45');const s=await session(1,false,'search');await publicSearch(s);await openQuestion(s,'Question original draft','11:40');await declareQuestion(s);await startPickup(s);await s.page.getByLabel('Pickup place name',{exact:true}).fill('Original question stop');await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await openQuestion(s,'Question new entry','11:45');await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();await s.page.getByText('Question original draft · 11:40',{exact:true}).waitFor();assert.equal(await s.page.getByLabel('Pickup place name',{exact:true}).inputValue(),'Original question stop');await admin.query('UPDATE v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=$1',[f.subjectId]);await s.page.getByRole('button',{name:'Review pickup',exact:true}).click();await s.page.getByRole('button',{name:'Save pickup',exact:true}).click();await s.page.getByRole('heading',{name:'Locations saved',exact:true}).waitFor();assert.equal(s.requests()[0].target.existing.subjectId,f.subjectId);await s.context.close();results.push('resuming a question from another route preserves original invitation, answers and target; compatible revision change accepts the independent late pickup');
  }
  {
    const f=await questionFixture('Question no task','11:50',false);const s=await session(1,false,'search');await publicSearch(s);await openQuestion(s,'Question no task','11:50');await s.page.getByRole('radio',{name:'Your connection to this route: I know this route',exact:true}).click();await s.page.getByRole('button',{name:'Continue',exact:true}).click();await s.page.getByText('No pickup question right now.',{exact:true}).waitFor();await publicShot(s,'pickup-question-no-task.png');await s.page.getByRole('button',{name:'Add a location instead',exact:true}).click();await s.page.getByLabel('Pickup place name',{exact:true}).fill('Independent no task rank');await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await s.page.getByRole('button',{name:'Save locations',exact:true}).click();await s.page.getByRole('heading',{name:'Locations saved',exact:true}).waitFor();assert.equal(s.posts(),1);assert.equal((await admin.query('SELECT count(*) FROM v2_prompt_invitations i JOIN v2_question_tasks t ON t.id=i.task_id WHERE i.user_id=$1 AND t.subject_id=$2',[users[1],f.subjectId])).rows[0].count,'0');await s.context.close();results.push('a stable no-question result keeps ordinary location reporting available and never fabricates an invitation');
  }
  {
    const f=await questionFixture('Question owner change','11:55');const s=await session(0,false,'home');await s.page.getByRole('button',{name:'My routes',exact:true}).click();await s.page.getByText('Question owner change · 11:55',{exact:true}).locator('..').getByRole('button',{name:'Help with pickup',exact:true}).click();await declareQuestion(s);await startPickup(s);await s.page.getByLabel('Pickup place name',{exact:true}).fill('Retained question pickup');await s.page.getByRole('button',{name:'Review pickup',exact:true}).click();await admin.query("UPDATE v2_leads SET operator_name='Question changed owner coach' WHERE subject_id=$1",[f.subjectId]);await s.page.getByRole('button',{name:'Save pickup',exact:true}).click();await s.page.getByRole('button',{name:'Check changed route',exact:true}).click();await s.page.getByText('Question changed owner coach · 11:55',{exact:true}).waitFor();assert.equal(await s.page.getByLabel('Pickup place name',{exact:true}).inputValue(),'Retained question pickup');await s.page.getByRole('button',{name:'Review locations',exact:true}).click();await s.page.getByRole('button',{name:'Save locations',exact:true}).click();await s.page.getByRole('heading',{name:'Locations saved',exact:true}).waitFor();assert.equal(s.posts(),2);assert.notEqual(s.requests()[0].clientSubmissionId,s.requests()[1].clientSubmissionId);assert.equal((await admin.query('SELECT count(*) FROM v2_pickup_answer_requests WHERE user_id=$1 AND client_submission_id=$2',[users[0],s.requests()[1].clientSubmissionId])).rows[0].count,'0');await s.context.close();results.push('My routes structural change rolls back a question answer, then receipt-checked explicit refresh keeps facts and saves an independent report with a new key');
  }

  // Search city modal: fixed input/Close, typed choices and real retry.
  {
    const s=await session(null,false,'search');
    for(const [label,title,name,shot] of [['From city','Departure City','Bulawayo','search-from-city-compact.png'],['To city','Destination City','Gweru','search-to-city-compact.png']]){
      await s.page.getByText(label,{exact:true}).click();await s.page.getByRole('heading',{name:title,exact:true}).waitFor();const input=s.page.getByPlaceholder('Type a city name…',{exact:true});await input.fill(name);await s.page.getByText(name,{exact:true}).waitFor();await s.page.setViewportSize({width:390,height:450});
      for(const locator of [s.page.getByRole('button',{name:'Close city search',exact:true}),input,s.page.getByRole('button',{name:name+', city',exact:true})]){const b=await locator.boundingBox();assert.ok(b&&b.y>=0&&b.y+b.height<=450,'Search control fits compact visible area: '+JSON.stringify(b));}
      await takeShot(s.page,shot);await s.page.getByText(name,{exact:true}).click();await s.page.getByRole('button',{name:'From city: Bulawayo',exact:true}).waitFor();await s.page.setViewportSize({width:390,height:844});
    }
    const response=s.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v2/search');await s.page.getByText('Search Routes',{exact:true}).click();const r=await response,u=new URL(r.url());assert.equal(u.searchParams.get('originCityId'),String(publicCities[0]));assert.equal(u.searchParams.get('destinationCityId'),String(publicCities[1]));assert.equal(s.posts(),0);await s.context.close();results.push('both Search From/To city dialogs keep input/Close/chosen city in compact bounds and preserve exact city IDs/opposite selection into the real route search');
  }
  {
    for(let i=0;i<12;i++)await admin.query("INSERT INTO cities(name,place_type) VALUES($1,'city')",['Keyboard city fixture '+String(i).padStart(2,'0')]);
    const s=await session(null,false,'search');await s.page.getByText('From city',{exact:true}).click();const input=s.page.getByPlaceholder('Type a city name…',{exact:true});await input.fill('Keyboard city fixture');await s.page.getByRole('button',{name:'From city: Keyboard city fixture 11',exact:true}).waitFor();await s.page.setViewportSize({width:390,height:360});const before=await input.boundingBox();const last=s.page.getByRole('button',{name:'Keyboard city fixture 11, city',exact:true});await last.scrollIntoViewIfNeeded();const after=await input.boundingBox();assert.ok(before&&after&&Math.abs(before.y-after.y)<1,'Results scroll without moving the pinned city input');for(const locator of [input,last,s.page.getByRole('button',{name:'Close city search',exact:true})]){const b=await locator.boundingBox();assert.ok(b&&b.y>=0&&b.y+b.height<=360,'Short city dialog remains reachable: '+JSON.stringify(b));}await takeShot(s.page,'search-city-scrolled-compact.png');await last.click();await s.page.setViewportSize({width:390,height:844});await s.page.getByRole('button',{name:'From city: Keyboard city fixture 11',exact:true}).waitFor();await s.page.getByText('To city',{exact:true}).click();assert.equal(await s.page.getByPlaceholder('Type a city name…',{exact:true}).inputValue(),'');await s.page.getByRole('button',{name:'Close city search',exact:true}).click();await s.page.getByRole('button',{name:'From city: Keyboard city fixture 11',exact:true}).waitFor();assert.equal(s.posts(),0);await s.context.close();results.push('long Search city results scroll independently at390x360 while search input and Close stay pinned; select/close/reopen preserves the other endpoint and resets only the picker query');
  }
  {
    const s=await session(null,false,'search');let fail=true;await s.context.route('**/api/v2/cities*',route=>fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'TEMPORARILY_UNAVAILABLE',error:'Synthetic city outage'})}):route.fallback());await s.page.getByText('From city',{exact:true}).click();const input=s.page.getByPlaceholder('Type a city name…',{exact:true});await input.fill('Bulawayo');await s.page.getByText('City search could not load.',{exact:true}).waitFor();assert.equal(await input.inputValue(),'Bulawayo');assert.equal(await s.page.getByText('No cities found for "Bulawayo"',{exact:true}).count(),0);assert.equal(await s.page.getByRole('button',{name:'Use "Bulawayo"',exact:true}).count(),0);await takeShot(s.page,'search-city-error.png');fail=false;await s.page.getByRole('button',{name:'Try city search again',exact:true}).click();await s.page.getByRole('button',{name:'Bulawayo, city',exact:true}).click();await s.page.getByText('Bulawayo',{exact:true}).waitFor();assert.equal(s.posts(),0);await s.context.close();results.push('city query failure retains typed text and explicit retry, never becomes a missing-city/custom suggestion, and recovered typed selection reaches the original Search form');
  }

  // Input consistency and one visible-route source for city choices/board rows.
  {
    const s=await session();await s.fill();await s.page.getByRole('button',{name:'Choose departure city',exact:true}).click();await s.page.getByLabel('Search cities',{exact:true}).fill('Flow Origin fixture');await s.page.getByRole('button',{name:'Flow Origin fixture, city',exact:true}).waitFor();await takeShot(s.page,'input-city-normal.png');await s.page.setViewportSize({width:390,height:450});await takeShot(s.page,'input-city-compact.png');
    for(const locator of [s.page.getByRole('button',{name:'Close city search',exact:true}),s.page.getByLabel('Search cities',{exact:true})]){const b=await locator.boundingBox();assert.ok(b&&b.y>=0&&b.y+b.height<=450);}
    await s.page.getByRole('button',{name:'Flow Origin fixture, city',exact:true}).click();assert.equal(await s.page.getByLabel('Bus operator name',{exact:true}).inputValue(),'Browser fixture bus');assert.equal(await s.page.getByLabel('Departure time in 24-hour format',{exact:true}).inputValue(),'08:30');await s.page.getByLabel('Bus operator name',{exact:true}).focus();await takeShot(s.page,'input-route-compact.png');const review=await s.page.getByRole('button',{name:'Review route',exact:true}).boundingBox();assert.ok(review&&review.y>=0&&review.y+review.height<=450);await s.page.getByRole('button',{name:'Close form and keep draft',exact:true}).click();await s.page.setViewportSize({width:390,height:844});await s.page.getByRole('button',{name:'Continue route draft',exact:true}).click();await s.page.getByRole('button',{name:'Resume draft',exact:true}).click();assert.equal(await s.page.getByLabel('Bus operator name',{exact:true}).inputValue(),'Browser fixture bus');assert.equal(s.posts(),0);await s.context.close();results.push('shared city dialog and route form keep focused inputs/Close/review reachable at compact size; nested picker returns original answers and close/resume keeps the parent draft');
  }
  const boardOrigin=(await admin.query("INSERT INTO cities(name,place_type) VALUES('Board report origin','city'),('Unconnected board reference','city') RETURNING id,name")).rows;
  const boardSave=await fetch('http://127.0.0.1:5000/api/v2/contributions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[0],'X-Mabhazi-Account':users[0]},body:JSON.stringify({schemaVersion:'1.0',clientSubmissionId:randomUUID(),entrySurface:'contribute_tab',target:{newLead:{originCityId:boardOrigin[0].id,destinationCityId:publicCities[1],departureTime:'06:45',operator:{name:'Board report coach'}}},observations:[]})});assert.equal(boardSave.status,200);const boardReceipt=await boardSave.json();
  {
    const s=await session(null,false,'departures');await s.page.getByRole('button',{name:'Choose departure city',exact:true}).click();assert.equal(await s.page.getByRole('button',{name:'Departures from Unconnected board reference',exact:true}).count(),0);await s.page.getByLabel('Search available departure cities',{exact:true}).fill('Board report');await takeShot(s.page,'board-origin-picker.png');await s.page.getByRole('button',{name:'Departures from Board report origin',exact:true}).click();await s.page.getByText('Board report coach',{exact:true}).waitFor();await s.page.getByText('Reported times',{exact:true}).waitFor();await s.page.getByText('06:45',{exact:true}).waitFor();assert.equal(await s.page.getByText('tmrw',{exact:true}).count(),0);assert.equal(await s.page.getByText('Now',{exact:true}).count(),0);await takeShot(s.page,'board-community-reports.png');await s.page.getByRole('button',{name:'Open departure report Board report coach 06:45',exact:true}).click();await s.page.getByRole('heading',{name:'Route report',exact:true}).waitFor();await s.page.getByText('Board report coach',{exact:true}).waitFor();assert.equal(s.posts(),0);await s.context.close();results.push('departure origins come from available routes, exclude unconnected reference cities and show unapproved community times honestly; the exact reported service opens its existing detail');
  }
  {
    const s=await session(null,false,'departures');await s.page.getByRole('button',{name:'Choose departure city',exact:true}).click();await s.page.getByRole('button',{name:'Departures from Board report origin',exact:true}).click();await s.page.getByText('Board report coach',{exact:true}).waitFor();await admin.query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[boardReceipt.subjectId]);await s.page.getByRole('button',{name:'Refresh departure board',exact:true}).click();await s.page.getByText("This city's routes are no longer available.",{exact:true}).waitFor();assert.equal(await s.page.getByText('Board report coach',{exact:true}).count(),0);await takeShot(s.page,'board-selection-unavailable.png');await s.page.getByRole('button',{name:'Choose another city',exact:true}).click();assert.equal(await s.page.getByRole('button',{name:'Departures from Board report origin',exact:true}).count(),0);assert.ok(await s.page.getByRole('button',{name:'Departures from Harare',exact:true}).count());await s.context.close();results.push('withdrawal refresh removes the selected city and report without silently switching to a different origin; remaining city choices use the same current board snapshot');
  }
  {
    const s=await session(null,false,'departures');let fail=true;await s.context.route('**/api/v2/departure-board*',route=>fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'TEMPORARILY_UNAVAILABLE',error:'Synthetic board outage'})}):route.fallback());await s.page.getByRole('button',{name:'Refresh departure board',exact:true}).click();await s.page.getByText('The departure board could not load.',{exact:true}).waitFor();assert.equal(await s.page.getByText('No routes available yet.',{exact:true}).count(),0);assert.equal(await s.page.getByRole('button',{name:'Add a route',exact:true}).count(),0);await takeShot(s.page,'board-error.png');fail=false;await s.page.getByRole('button',{name:'Try departure board again',exact:true}).click();await s.page.getByRole('button',{name:'Choose departure city',exact:true}).click();await s.page.getByRole('button',{name:'Departures from Harare',exact:true}).click();await s.page.getByText('UI fixture bus',{exact:true}).waitFor();await s.context.close();
    const hidden=await session(null,false,'departures');await hidden.context.route('**/api/v2/departure-board*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({origins:[],selectedOriginKey:null,selectionUnavailable:false,hasHiddenRoutes:true,entries:[]})}));await hidden.page.getByRole('button',{name:'Refresh departure board',exact:true}).click();await hidden.page.getByText('Routes are hidden by your settings.',{exact:true}).waitFor();assert.equal(await hidden.page.getByRole('button',{name:'Add a route',exact:true}).count(),0);await takeShot(hidden.page,'board-hidden.png');await hidden.context.close();results.push('departure read errors and privacy-filtered emptiness stay distinct from missing routes, with explicit retry and no duplicate-intake invitation');
  }

  // Owned public web pages: actual local backend HTML with the same real
  // CSS, without signing in, sending mail or changing administrative records.
  {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5000'?route.continue():route.abort());
    const page=await context.newPage();page.on('pageerror',e=>consoleErrors.push(e.message));
    for(const [url,name] of [['/','website'],['/api/privacy','web-privacy'],['/api/terms','web-terms'],['/api/support','web-support'],['/api/delete-account','web-delete-account'],['/api/admin','admin-sign-in']]){
      await page.goto('http://127.0.0.1:5000'+url);await page.getByRole('heading',{level:1}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow on '+name);
      await takeShot(page,name+'.png');
    }
    await context.close();results.push('owned website, privacy, Terms, support, account deletion and admin sign-in render at phone width without external requests or mutations');
  }
  for(const name of fs.readdirSync(output).filter(n=>n.endsWith('.png'))) console.log('MABHAZI_BROWSER_IMAGE '+JSON.stringify({name,base64:fs.readFileSync(path.join(output,name)).toString('base64')}));
  assert.ok(legacy>0);assert.deepEqual(consoleErrors,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({head:process.env.GITHUB_SHA,cases:results,consoleErrors,environment:'CI disposable Postgres, synthetic sessions, actual Expo web export at390x844; no native/device claim'},null,2));
  console.log('MABHAZI_BROWSER_CASES '+JSON.stringify(results));
} catch(error) {
  fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack ?? error));
  for(const name of fs.readdirSync(output).filter(n=>n.endsWith('.png'))) console.log('MABHAZI_BROWSER_IMAGE '+JSON.stringify({name,base64:fs.readFileSync(path.join(output,name)).toString('base64')}));
  throw error;
} finally {
  await browser?.close();
  for(const server of [webServer,apiServer]) if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
  await admin.end();
}
