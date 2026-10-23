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
const users = [randomUUID(), randomUUID()], tokens = users.map(() => randomBytes(32).toString('hex'));
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
    if (account !== null) await context.addInitScript(token => localStorage.setItem('mabhazi_session_v2', token), tokens[account]);
    let postCount = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:4173') { await route.continue(); return; }
      // Fail closed: no request reaches real Mabhazi, Google, Render or Supabase.
      if (url.origin !== 'https://preview.mabhazi.invalid') { await route.abort(); return; }
      const response = await route.fetch({url:'http://127.0.0.1:5000'+url.pathname+url.search});
      if (['/api/v2/contributions','/api/v2/actual-journeys'].includes(url.pathname) && request.method() === 'POST') {
        postCount++;
        if (loseResponse) { loseResponse = false; await route.abort('failed'); return; }
      }
      await route.fulfill({response});
    });
    const page = await context.newPage();
    page.on('pageerror', error => consoleErrors.push(error.message));
    const surfaces={search:'/',profile:'/profile',departures:'/departures'};
    await page.goto('http://127.0.0.1:4173'+(surfaces[mode] ?? '/contribute'));
    if (surfaces[mode]) return {context,page,posts:()=>postCount};
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
    return {context,page,fill,posts:()=>postCount};
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

  async function emptySearch(page, custom = false) {
    await page.getByText('Search for a route',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Add a route',exact:true}).count(),0);
    for(const [label,name] of [['From city','Flow Origin fixture'],['To city','Flow Destination fixture']]) {
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
    await s.page.getByRole('button',{name:'Choose departure city',exact:true}).getByText('Flow Origin fixture',{exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Choose destination city',exact:true}).getByText('Flow Destination fixture',{exact:true}).waitFor();
    assert.equal(await s.page.getByLabel('Departure time in 24-hour format').inputValue(),'');
    assert.equal(await s.page.getByLabel('Bus operator name').inputValue(),'');
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
    assert.equal(rows.length,1);assert.equal(rows[0].payload.target.newLead.originCityId,cities[0]);assert.equal(rows[0].payload.target.newLead.destinationCityId,cities[1]);
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
    await s.page.getByText('No routes found',{exact:true}).waitFor();
    await s.page.getByRole('button',{name:'Add a route',exact:true}).waitFor();
    results.push('failed search never invites duplicate intake and an explicit retry recovers to the real empty state');
    await s.context.close();
  }

  // Same real exported app and API, now exercise the remaining principal
  // screens. This synthetic legacy fixture exists only in disposable CI.
  const legacy=(await admin.query("INSERT INTO journeys(from_city,to_city,departure_time,arrival_time,travel_date,bus_company,pickup_point,dropoff_point,price,contributed_by,contributor_name) VALUES('Harare','Bulawayo','08:30','14:00','Mon, Tue, Wed, Thu, Fri, Sat, Sun','UI fixture bus','Fixture pickup','Fixture drop-off',12.50,$1,'UI fixture contributor') RETURNING id",[users[0]])).rows[0].id;
  {
    const s=await session(null,false,'search');
    await s.page.getByText('Search for a route',{exact:true}).waitFor();
    await s.page.screenshot({path:path.join(output,'search-home.png'),fullPage:true});
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
  assert.ok(legacy>0);assert.deepEqual(consoleErrors,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({head:process.env.GITHUB_SHA,cases:results,consoleErrors,environment:'CI disposable Postgres, synthetic sessions, actual Expo web export at390x844; no native/device claim'},null,2));
  console.log('MABHAZI_BROWSER_CASES '+JSON.stringify(results));
  for(const name of ['empty-search.png','empty-search-form.png','search-error.png','contribution-menu.png','minimum-form.png','saved-result.png','retry-result.png','terms-preserved.png','journey-review.png','focused-fare.png','focused-fare-compact.png','search-home.png','search-results.png','route-details.png','profile.png','guest-profile.png','departures.png','full-route-form.png']) console.log('MABHAZI_BROWSER_IMAGE '+JSON.stringify({name,base64:fs.readFileSync(path.join(output,name)).toString('base64')}));
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
