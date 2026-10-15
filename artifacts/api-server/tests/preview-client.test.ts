import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { resolveApiBaseUrl, mobileAuthRedirectUri }=require('../../mobile/lib/api-base.ts') as typeof import('../../mobile/lib/api-base');
test('preview client: no missing/invalid/production fallback and no token/path origin',()=>{
  for(const api of ['', 'http://preview.invalid','https://api.mabhazi.com','https://mabhazi.com','https://someone.repl.co','https://preview.invalid/path','https://user:secret@preview.invalid','https://preview.invalid?token=secret'])assert.throws(()=>resolveApiBaseUrl(api,'preview'));
  assert.equal(resolveApiBaseUrl('https://mabhazi-preview-api.onrender.com','preview'),'https://mabhazi-preview-api.onrender.com');
  assert.equal(resolveApiBaseUrl('','production'),'https://api.mabhazi.com');
});
test('preview client: callback scheme isolates apps; production scheme is preserved',()=>{
  assert.equal(mobileAuthRedirectUri('preview'),'mabhazipreview://auth/callback');assert.equal(mobileAuthRedirectUri('production'),'mabhazicom://auth/callback');assert.throws(()=>mobileAuthRedirectUri('typo'));
});
