const assert = require('node:assert/strict');
const { test } = require('node:test');
const configure = require('../app.config');
const base = require('../app.json').expo;
function config(env, body) {
  const keys=['EXPO_PUBLIC_APP_VARIANT','EXPO_PUBLIC_API_BASE_URL','MABHAZI_PREVIEW_VERSION_CODE'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try { for(const key of keys)if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];return body(); }
  finally { for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]; }
}
test('preview native config: production package, version3, scheme, project and metadata remain unchanged',()=>{
  config({},()=>assert.deepEqual(configure({config:base}),base));
  assert.equal(base.android.package,'com.mabhazicom.app');assert.equal(base.android.versionCode,3);assert.equal(base.scheme,'mabhazicom');
});
test('preview native config: distinct install and callback retain project/icon/signing metadata',()=>{
  const original=JSON.stringify(base);
  config({EXPO_PUBLIC_APP_VARIANT:'preview',EXPO_PUBLIC_API_BASE_URL:'https://mabhazi-preview-api.onrender.com'},()=>{
    const value=configure({config:base});assert.equal(value.android.package,'com.mabhazicom.preview');assert.equal(value.android.versionCode,1);assert.equal(value.scheme,'mabhazipreview');assert.equal(value.name,'Mabhazi Preview');
    assert.deepEqual(value.extra.eas,base.extra.eas);assert.equal(value.icon,base.icon);assert.deepEqual(value.android.blockedPermissions,base.android.blockedPermissions);
    assert.equal(JSON.stringify(base),original);
  });
});
test('preview native config: missing/insecure/production/Replit origins and invalid versions reject',()=>{
  for(const api of ['', 'http://preview.invalid','https://api.mabhazi.com','https://mabhazi.com','https://someone.replit.app','https://preview.invalid/path','https://user:secret@preview.invalid','https://preview.invalid?token=secret'])config({EXPO_PUBLIC_APP_VARIANT:'preview',EXPO_PUBLIC_API_BASE_URL:api},()=>assert.throws(()=>configure({config:base})));
  config({EXPO_PUBLIC_APP_VARIANT:'preview',EXPO_PUBLIC_API_BASE_URL:'https://mabhazi-preview-api.onrender.com',MABHAZI_PREVIEW_VERSION_CODE:'0'},()=>assert.throws(()=>configure({config:base})));
});
test('preview EAS profile: internal APK and separate environment; production pipeline unchanged',()=>{
  const eas=require('../eas.json');assert.equal(eas.build.preview.distribution,'internal');assert.equal(eas.build.preview.android.buildType,'apk');assert.equal(eas.build.preview.environment,'preview');assert.equal(eas.build.preview.env.EXPO_PUBLIC_APP_VARIANT,'preview');
  assert.equal(eas.build.production.android.buildType,'app-bundle');assert.equal(eas.build.production.credentialsSource,'remote');assert.equal(eas.build.production.env.EXPO_PUBLIC_API_BASE_URL,'https://api.mabhazi.com');
});
