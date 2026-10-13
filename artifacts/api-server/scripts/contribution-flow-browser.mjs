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
  async function session(account = 0, loseResponse = false) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await context.addInitScript(token => localStorage.setItem('mabhazi_session_v2', token), tokens[account]);
    let postCount = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:4173') { await route.continue(); return; }
      // Fail closed: no request reaches real Mabhazi, Google, Render or Supabase.
      if (url.origin !== 'https://preview.mabhazi.invalid') { await route.abort(); return; }
      const response = await route.fetch({url:'http://127.0.0.1:5000'+url.pathname+url.search});
      if (url.pathname === '/api/v2/contributions' && request.method() === 'POST') {
        postCount++;
        if (loseResponse) { loseResponse = false; await route.abort('failed'); return; }
      }
      await route.fulfill({response});
    });
    const page = await context.newPage();
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.goto('http://127.0.0.1:4173/contribute');
    await page.getByRole('heading',{name:'Add a bus route',exact:true}).waitFor();
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
    await s.page.screenshot({path:path.join(output,'minimum-form.png'),fullPage:true});
    await s.fill();
    await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    assert.equal(s.posts(),1);
    const row=(await admin.query('SELECT payload FROM v2_contributions WHERE user_id=$1',[users[0]])).rows[0];
    assert.equal(row.payload.target.newLead.originCityId,cities[0]);assert.equal(row.payload.target.newLead.destinationCityId,cities[1]);assert.equal('price' in row.payload.target.newLead,false);
    await s.page.screenshot({path:path.join(output,'saved-result.png'),fullPage:true});
    results.push('four answers render and save through real API/PostgreSQL; no price/calendar/default clock');
    await s.context.close();
  }
  {
    const s=await session(0,true), before=(await admin.query('SELECT count(*) FROM v2_contributions WHERE user_id=$1',[users[0]])).rows[0].count;
    await s.fill();await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByText('Save not confirmed.',{exact:false}).waitFor();
    assert.equal(await s.page.getByLabel('Bus operator name').isEditable(),false);
    await s.page.screenshot({path:path.join(output,'retry-result.png'),fullPage:true});
    await s.page.getByRole('button',{name:'Check and retry',exact:true}).click();
    await s.page.getByRole('heading',{name:'Contribution saved',exact:true}).waitFor();
    assert.equal(s.posts(),1);assert.equal(Number((await admin.query('SELECT count(*) FROM v2_contributions WHERE user_id=$1',[users[0]])).rows[0].count),Number(before)+1);
    results.push('lost acknowledgement recovers committed receipt without second POST or duplicate contribution');
    await s.context.close();
  }
  {
    const s=await session(1);await s.fill();
    await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByText('Accept the current Terms, then tap Save.',{exact:false}).waitFor();
    assert.equal(s.posts(),0);assert.equal(await s.page.getByLabel('Bus operator name').inputValue(),'Browser fixture bus');
    await s.page.screenshot({path:path.join(output,'terms-preserved.png'),fullPage:true});
    results.push('Terms gate retains all entered answers without automatic submission');
    await s.context.close();
  }
  {
    const s=await session();await s.fill();
    await s.page.getByLabel('Departure time in 24-hour format').fill('24:00');
    await s.page.getByRole('button',{name:'Save contribution',exact:true}).click();
    await s.page.getByText('Enter a departure time in 24-hour format, for example 08:30.',{exact:true}).waitFor();
    assert.equal(s.posts(),0);assert.equal(await s.page.getByLabel('Departure time in 24-hour format').inputValue(),'24:00');
    results.push('invalid clock shows inline explanation and retains answers without submitting');
    await s.context.close();
  }
  assert.deepEqual(consoleErrors,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({head:process.env.GITHUB_SHA,cases:results,consoleErrors,environment:'CI disposable Postgres, synthetic sessions, actual Expo web export at390x844; no native/device claim'},null,2));
  console.log('MABHAZI_BROWSER_CASES '+JSON.stringify(results));
  for(const name of ['minimum-form.png','saved-result.png','retry-result.png','terms-preserved.png']) console.log('MABHAZI_BROWSER_IMAGE '+JSON.stringify({name,base64:fs.readFileSync(path.join(output,name)).toString('base64')}));
} catch(error) {
  fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack ?? error));
  throw error;
} finally {
  await browser?.close();
  for(const server of [webServer,apiServer]) if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
  await admin.end();
}
