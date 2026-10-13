import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mobileAuthRedirect, validateDeploymentTarget } from './deploymentTarget';
const ref = 'ocwlqhlfavvuncfmzuqh';
const preview = {MABHAZI_DEPLOYMENT:'preview',MABHAZI_PREVIEW_SUPABASE_REF:ref,SUPABASE_URL:`https://${ref}.supabase.co`,PUBLIC_ORIGIN:'https://mabhazi-preview-api.onrender.com',DATABASE_URL:`postgresql://mabhazi_api.${ref}:synthetic-password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`};
test('preview target: production callback and default behaviour are unchanged',()=>{
  assert.equal(mobileAuthRedirect({}),'mabhazicom://auth/callback');assert.doesNotThrow(()=>validateDeploymentTarget({}));
  assert.equal(mobileAuthRedirect(preview),'mabhazipreview://auth/callback');assert.throws(()=>mobileAuthRedirect({MABHAZI_DEPLOYMENT:'typo'}));
});
test('preview target: own restricted direct or session-pooled database is accepted',()=>{
  assert.doesNotThrow(()=>validateDeploymentTarget(preview));
  assert.doesNotThrow(()=>validateDeploymentTarget({...preview,DATABASE_URL:`postgresql://mabhazi_api:synthetic-password@db.${ref}.supabase.co:5432/postgres`}));
});
test('preview target: production identity/data, wrong roles and origins fail without secret echo',()=>{
  for(const override of [
    {MABHAZI_PREVIEW_SUPABASE_REF:'zmlpmsrnocyqxoncmzgh'}, {SUPABASE_URL:'https://zmlpmsrnocyqxoncmzgh.supabase.co'},
    {PUBLIC_ORIGIN:'https://api.mabhazi.com'}, {PUBLIC_ORIGIN:'http://localhost:5000'},
    {DATABASE_URL:'postgresql://mabhazi_api.zmlpmsrnocyqxoncmzgh:private-fixture@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'},
    {DATABASE_URL:`postgresql://postgres.${ref}:private-fixture@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`},
    {DATABASE_URL:'postgresql://mabhazi_api:private-fixture@unknown.invalid/postgres'},
  ])assert.throws(()=>validateDeploymentTarget({...preview,...override}),error=>!(error as Error).message.includes('private-fixture') && (error as Error).message.includes('Preview requires'));
});
