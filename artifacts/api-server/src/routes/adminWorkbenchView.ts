import {escape,renderAdminConsole} from './adminConsoleView';
import {adminWorkbenchStyles} from './adminWorkbenchStyles';

export function renderAdminWorkbench(name:string,account:string){
 // Reuse the original brand image already carried by the private catalogue.
 const brand=renderAdminConsole({name:'',q:'',record:null,nextCursor:null,rows:[]}).match(/<img alt="" src="data:image\/png;base64,[^"]+"[^>]*>/)?.[0]??'';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<meta name="robots" content="noindex,nofollow,noarchive"><title>Mabhazi Administration</title><style>'+adminWorkbenchStyles+
  '#mabhazi-admin-design .ad-account a{color:#c8d4e2;display:inline-flex;align-items:center;min-height:44px;text-underline-offset:3px}body{margin:0}#mabhazi-admin-design .ad-shell{border-radius:0;min-height:100vh}#mabhazi-admin-design .br-error{color:var(--ad-red);margin:12px 0}'+
  '#mabhazi-admin-design .br-recovery{padding:16px;border:1px solid var(--ad-line);border-radius:10px;margin-bottom:20px}'+
  '#mabhazi-admin-design .br-loading{padding:24px 0}#mabhazi-admin-design .br-live-scope{margin-top:8px;color:var(--ad-muted)}'+
  '</style></head><body><div id="mabhazi-admin-design" data-account="'+escape(account)+'"><div class="ad-shell"><div class="ad-layout">'+
  '<aside class="ad-sidebar"><div class="ad-brand">'+brand+'<div><strong>Mabhazi</strong><span>Administration</span></div></div>'+
  '<nav class="ad-nav" aria-label="Administration"><button type="button" data-do="queue" aria-current="page">Review</button><button type="button" data-do="history">History</button></nav>'+
  '<div class="ad-account"><div><strong>'+escape(name)+'</strong><small>Administrator</small><a href="/api/logout?returnTo=/api/admin-console">Sign out</a></div></div></aside>'+
  '<main class="ad-main"><header class="ad-topbar"><span id="workbench-breadcrumb">Review / Routes</span><span class="ad-private">Private workspace</span></header>'+
  '<div class="ad-content"><div id="workbench-recovery" aria-live="polite"></div><div id="workbench-notice" role="status"></div><div id="workbench-screen" aria-live="polite"><p class="br-loading">Loading routes…</p></div>'+
  '<noscript>Enable JavaScript to review records in this workspace.</noscript></div></main></div></div></div>'+
  '<script src="/api/admin-console/ui.js" defer></script></body></html>';
}
