import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type pg from 'pg';
import { renderAdminConsole } from './adminConsoleView';

type Context = {admin: pg.Client; base: string; accounts: string[]; tokens: string[]; leadBody: () => Record<string,unknown>};
export function registerAdminConsoleTests(context: () => Context) {
  const owner = randomUUID(), token = randomBytes(32).toString('hex'), prefix = 'Console '+randomUUID();
  let subject: string;
  const query = (text: string, values: unknown[] = []) => context().admin.query(text,values);
  async function page(queryString = '', sid: string | null = token, headers: Record<string,string> = {}) {
    const response = await fetch(context().base+'/admin-console'+queryString,{headers:{...(sid?{Authorization:'Bearer '+sid}:{}),...headers}});
    return {status:response.status,html:await response.text(),headers:response.headers};
  }
  test('named console: guests and legacy shared-secret sessions cannot open private records',async()=>{
    for (const headers of [{},{'X-Admin-Secret':process.env.ADMIN_SECRET!}]) {
      const result=await page('',null,headers);assert.equal(result.status,401);
      assert.ok(result.html.includes('Continue with Google'));assert.ok(!result.html.includes('<table>'));
      assert.equal(result.headers.get('cache-control'),'private, no-store');
      assert.ok(result.headers.get('content-security-policy')!.includes("frame-ancestors 'none'"));
    }
  });
  test('named console: a public user cannot supply their own administrator identity or role',async()=>{
    for (const suffix of ['', '?role=administrator', '?actor='+owner]) {
      assert.equal((await page(suffix,context().tokens[0],{'X-Admin-Secret':process.env.ADMIN_SECRET!})).status,403);
    }
  });
  test('named console: a named administrator uses the existing public identity session, without a second secret',async()=>{
    await query('INSERT INTO users(id,display_name) VALUES($1,$2)',[owner,'Console Owner']);
    await query('INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval \'1 day\')',[token,{user:{id:owner},access_token:'synthetic-test-token',expires_at:Math.floor(Date.now()/1000)+3600}]);
    await query("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_bootstrap')",[owner]);
    const result=await page();assert.equal(result.status,200);assert.ok(result.html.includes('Console Owner'));
    assert.ok(!result.html.includes(token));assert.ok(!result.html.includes(process.env.ADMIN_SECRET!));
    assert.ok(result.html.includes('Read-only catalogue'));assert.ok(!result.html.includes('Apply correction'));
  });
  test('named console: reviewer-only access does not imply owner console authority',async()=>{
    await query("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','test_scope')",[context().accounts[2]]);
    assert.equal((await page('',context().tokens[2])).status,403);
  });
  test('named console: catalogue reads current community records with literal search and bounded pages',async()=>{
    for (let i=0;i<22;i++) {
      const input=context().leadBody() as {target:{newLead:{operator:{name:string}}}};
      input.target.newLead.operator.name=prefix+' '+i;
      const saved=await fetch(context().base+'/v2/contributions',{method:'POST',headers:{Authorization:'Bearer '+context().tokens[0],'Content-Type':'application/json'},body:JSON.stringify(input)});
      assert.equal(saved.status,200);const value=await saved.json() as {subjectId:string};if(i===0)subject=value.subjectId;
    }
    const result=await page('?q='+encodeURIComponent(prefix));assert.equal(result.status,200);
    assert.equal((result.html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g)||[]).length,20);
    const next=result.html.match(/href="([^\"]+)">Next records/);assert.ok(next);
    const url=new URL(next[1].replaceAll('&amp;','&'),'https://console.invalid');
    const tail=await page(url.search);assert.equal(tail.status,200);
    assert.equal((tail.html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g)||[]).length,2);
    assert.equal((await page('?q='+encodeURIComponent(prefix+'%'))).html.includes('No matching community reports.'),true);
  });
  test('named console: stable typed record links inspect original values and never claim approval or a timetable',async()=>{
    const result=await page('?record='+subject);assert.equal(result.status,200);
    assert.ok(result.html.includes('Original route report'));assert.ok(result.html.includes(subject));
    assert.ok(result.html.includes('Public visibility is separate from review approval'));
    assert.ok(result.html.includes('does not establish operating days'));
    assert.equal((await page('?record=1')).status,400);
    assert.equal((await page('?record='+randomUUID())).status,404);
  });
  test('named console: invalid structured, overlong and combined queries fail without raw database errors',async()=>{
    for (const q of ['?q[]=x','?q='+'a'.repeat(121),'?cursor=1','?record='+subject+'&cursor='+subject,'?role=administrator']) {
      const result=await page(q);assert.equal(result.status,400);assert.ok(!result.html.includes('SELECT'));
    }
  });
  test('named console: HTML cannot turn operator, account or query content into executable markup',()=>{
    const html=renderAdminConsole({name:'<script>owner</script>',q:'"><img src=x onerror=alert(1)>',record:null,nextCursor:null,rows:[{id:randomUUID(),revision:'1',lifecycle:'active',origin:'<script>city</script>',destination:'B',operator:'<svg onload=alert(1)>',departure:null,visible:false}]});
    assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<svg'));
    assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&quot;&gt;&lt;img'));
  });
  test('named console: hidden or retired reports remain inspectable without falsely labelling them Removed or Approved',async()=>{
    await query("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[subject]);
    const result=await page('?record='+subject);assert.equal(result.status,200);
    assert.ok(result.html.includes('Not public'));assert.ok(!result.html.includes('>Approved<'));
  });
  test('named console: role revocation takes effect on the next browser request',async()=>{
    await query("UPDATE v2_review_roles SET revoked_at=now(),revoked_by_user_id=$2 WHERE user_id=$1 AND role='administrator' AND revoked_at IS NULL",[owner,context().accounts[0]]);
    const result=await page();assert.equal(result.status,403);assert.ok(!result.html.includes('<table>'));
    await query("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','test_regrant')",[owner]);
    assert.equal((await page()).status,200);
  });
  test('named console: deleted accounts cannot reuse an old identity session',async()=>{
    await query('DELETE FROM users WHERE id=$1',[owner]);
    assert.equal((await page()).status,401);
    await query('DELETE FROM sessions WHERE sid=$1',[token]);
  });
}
