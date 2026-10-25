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
const users = [randomUUID(), randomUUID(), randomUUID()], tokens = users.map(() => randomBytes(32).toString('hex'));
let cities;
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
    // Drain intercepted background discovery before closing the test context.
    const closeContext=context.close.bind(context);context.close=async options=>{await context.unrouteAll({behavior:'wait'});await closeContext(options);};
    if (account !== null) await context.addInitScript(token => localStorage.setItem('mabhazi_session_v2', token), tokens[account]);
    let postCount = 0; const sent=[];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:4173') { await route.continue(); return; }
      // Fail closed: no request reaches real Mabhazi, Google, Render or Supabase.
      if (url.origin !== 'https://preview.mabhazi.invalid') { await route.abort(); return; }
      const response = await route.fetch({url:'http://127.0.0.1:5000'+url.pathname+url.search});
      if (['/api/v2/contributions','/api/v2/actual-journeys'].includes(url.pathname) && request.method() === 'POST') {
        postCount++; sent.push(request.postDataJSON());
        if (loseResponse) { loseResponse = false; await route.abort('failed'); return; }
      }
      await route.fulfill({response});
    });
    const page = await context.newPage();
    page.on('pageerror', error => consoleErrors.push(error.message));
    const surfaces={search:'/',profile:'/profile',departures:'/departures',home:'/contribute'};
    await page.goto('http://127.0.0.1:4173'+(surfaces[mode] ?? '/contribute'));
    if (surfaces[mode]) return {context,page,posts:()=>postCount,requests:()=>sent,loseNext:()=>{loseResponse=true;}};
    await page.getByRole('heading',{name:'Contribute',exact:true}).waitFor();
    if (!results.length) {
      await page.screenshot({path:path.join(output,'contribution-menu.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'minimum-form.png'),fullPage:true});
    assert.ok(saveBox && saveBox.y>=0&&saveBox.y+saveBox.height<=832,`Review should fit inside the modal safe footer: ${JSON.stringify(saveBox)}`);
    await s.fill();
    await s.page.getByRole('button',{name:'Review route',exact:true}).click();
    await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    assert.equal(s.posts(),1);
    const row=(await admin.query('SELECT payload FROM v2_contributions WHERE user_id=$1',[users[0]])).rows[0];
    assert.equal(row.payload.target.newLead.originCityId,cities[0]);assert.equal(row.payload.target.newLead.destinationCityId,cities[1]);assert.equal('price' in row.payload.target.newLead,false);
    await s.page.screenshot({path:path.join(output,'saved-result.png'),fullPage:true});
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
    await s.page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));});
    await s.page.screenshot({path:path.join(output,'own-route-followup.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'retry-result.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'terms-preserved.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'journey-review.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'focused-fare.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'focused-fare-compact.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'empty-search.png'),fullPage:true});
    await s.page.getByRole('button',{name:'Add a route',exact:true}).click();
    await s.page.getByRole('heading',{name:'Add a bus route',exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Choose departure city',exact:true}).getByText('Empty Origin fixture',{exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Choose destination city',exact:true}).getByText('Empty Destination fixture',{exact:true}).waitFor();
    assert.equal(await s.page.getByLabel('Departure time in 24-hour format').inputValue(),'');
    assert.equal(await s.page.getByLabel('Bus operator name').inputValue(),'');
    // Wait for finite dialog transitions so the proof is the settled UI, not a fade frame.
    await s.page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))); });
    await s.page.screenshot({path:path.join(output,'empty-search-form.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'search-error.png'),fullPage:true});
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
    await s.page.screenshot({path:path.join(output,'search-home.png'),fullPage:true});
    await s.page.setViewportSize({width:320,height:568});
    await s.page.evaluate(()=>{for(const el of document.querySelectorAll('div[dir="auto"],input')){const computed=getComputedStyle(el);if(computed.fontSize){el.dataset.originalUiFont=el.style.fontSize;el.style.fontSize=(parseFloat(computed.fontSize)*1.4)+'px';}}});
    await s.page.getByText('Search Routes',{exact:true}).scrollIntoViewIfNeeded();
    const searchBounds=await s.page.getByText('Search Routes',{exact:true}).boundingBox();assert(searchBounds&&searchBounds.y>=0&&searchBounds.y+searchBounds.height<568,'Search action remains reachable with larger text');
    assert.equal(await s.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal page overflow on narrow Search');
    await s.page.screenshot({path:path.join(output,'search-small-large-text.png'),fullPage:true});
    await s.page.evaluate(()=>{for(const el of document.querySelectorAll('[data-original-ui-font]')){el.style.fontSize=el.dataset.originalUiFont;delete el.dataset.originalUiFont;}});
    await s.page.setViewportSize({width:390,height:844});
    await s.page.getByText('Search Routes',{exact:true}).click();
    const card=s.page.getByRole('button',{name:'View route: Harare to Bulawayo, UI fixture bus',exact:true});await card.waitFor();
    await s.page.screenshot({path:path.join(output,'search-results.png'),fullPage:true});
    await card.click();await s.page.getByText('Route confidence',{exact:true}).waitFor();
    await s.page.getByText('Manage blocked contributors',{exact:true}).waitFor();
    await s.page.screenshot({path:path.join(output,'route-details.png'),fullPage:true});
    await s.page.getByText('Manage blocked contributors',{exact:true}).click();
    await s.page.getByText('Routes and comments are hidden on this device. Unblock anytime.',{exact:true}).waitFor();
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
    await s.page.screenshot({path:path.join(output,'profile.png'),fullPage:true});
    await s.page.getByRole('button',{name:'Edit display name',exact:true}).click();
    await s.page.getByLabel('Display name',{exact:true}).fill('Unsaved UI name');
    await s.page.getByText('You can change your name once every 30 days.',{exact:true}).waitFor();
    await s.page.getByText('Cancel',{exact:true}).click();
    await s.page.getByText('Delete my account',{exact:true}).click();
    await s.page.getByText('Type DELETE MY ACCOUNT to confirm',{exact:true}).waitFor();
    await s.page.getByText('This permanently deletes your Mabhazi account,',{exact:false}).waitFor();
    assert.equal(await s.page.getByText('Delete permanently',{exact:true}).isVisible(),true);
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
    await s.page.screenshot({path:path.join(output,'guest-profile.png'),fullPage:true});
    assert.equal(s.posts(),0);results.push('guest profile keeps sign-in, safety and legal/help links without the repeated feature list');await s.context.close();
  }
  {
    const s=await session(null,false,'departures');
    await s.page.getByText('UI fixture bus',{exact:true}).waitFor();
    await s.page.screenshot({path:path.join(output,'departures.png'),fullPage:true});
    assert.equal(s.posts(),0);results.push('departures renders operator and schedule data after copy cleanup');await s.context.close();
  }
  {
    const s=await session();
    await s.page.getByRole('button',{name:'More route details',exact:true}).click();
    await s.page.getByText('Contribute a Route',{exact:true}).waitFor();
    const monday=s.page.getByRole('checkbox',{name:'Operating day Mon',exact:true});
    assert.equal(await monday.getAttribute('aria-checked'),'false');await monday.click();assert.equal(await monday.getAttribute('aria-checked'),'true');
    await s.page.getByText('Add a stop',{exact:true}).click();
    await s.page.screenshot({path:path.join(output,'full-route-form.png'),fullPage:true});
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
    await h.page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));});
    await h.page.screenshot({path:path.join(output,'my-routes.png'),fullPage:true});
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
  async function publicShot(s,name){await s.page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));});await s.page.screenshot({path:path.join(output,name),fullPage:true});}
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
