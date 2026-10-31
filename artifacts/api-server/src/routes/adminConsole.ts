import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { renderAdminConsole, renderConsoleAccess, type ConsoleRoute } from './adminConsoleView';
import {readAdminClaims,parseAdminSelection,adminDigest,validAdminId} from '../lib/adminEvidence';
import {getOrigin} from '../lib/auth';

const router: IRouter = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// This is a server-rendered private reader, not another public/native API.
// Existing named review roles are checked afresh on every navigation. The
// legacy shared-secret session never supplies authority to this namespace.
router.get('/admin-console', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Cookie'); res.vary('Authorization');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.type('html');
  if (!req.isAuthenticated()) {
    res.status(401).send(renderConsoleAccess('Sign in to administration', 'Use your Mabhazi Google account. Administrative access is checked separately.', true)); return;
  }
  try {
    const actor = req.user.id;
    // No role/email/account/actor from query parameters, headers or form fields.
    const authority = await pool.query(`SELECT 1 FROM public.v2_review_roles r
      JOIN public.users u ON u.id=r.user_id
      WHERE r.user_id=$1 AND r.role='administrator' AND r.revoked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id)`, [actor]);
    if (!authority.rows.length) {
      res.status(403).send(renderConsoleAccess('Administrative access required', 'This account can use the public app. It has no active administrative access.', false)); return;
    }
    if (Object.keys(req.query).some(k => !['q','cursor','record'].includes(k)) ||
        Object.values(req.query).some(v => typeof v !== 'string')) {
      res.status(400).send(renderConsoleAccess('Check the route search', 'Use a city, operator or a record link from the catalogue.', false)); return;
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const record = typeof req.query.record === 'string' ? req.query.record : null;
    if (q.length > 120 || cursor !== null && !uuid.test(cursor) || record !== null && !uuid.test(record) || record !== null && cursor !== null) {
      res.status(400).send(renderConsoleAccess('Check the route search', 'Use a city, operator or a record link from the catalogue.', false)); return;
    }
    const result = await pool.query(`SELECT l.subject_id AS id,s.revision::text AS revision,s.lifecycle,
      origin.name AS origin,destination.name AS destination,
      COALESCE(l.operator_name,op.display_name) AS operator,
      CASE WHEN l.reported_departure_seconds IS NOT NULL THEN
        lpad((l.reported_departure_seconds/3600)::text,2,'0')||':'||lpad(((l.reported_departure_seconds%3600)/60)::text,2,'0') END AS departure,
      EXISTS(SELECT 1 FROM public.v2_public_lead_reports p WHERE p.subject_id=l.subject_id) AS visible
      FROM public.v2_leads l JOIN public.v2_subjects s ON s.id=l.subject_id AND s.kind='lead'
      LEFT JOIN public.v2_corridors c ON c.id=l.corridor_id
      LEFT JOIN public.cities origin ON origin.id=c.origin_city_id
      LEFT JOIN public.cities destination ON destination.id=c.destination_city_id
      LEFT JOIN public.v2_operators op ON op.subject_id=l.operator_subject_id
      WHERE l.intake_kind='community' AND NOT l.attribution_erased
      AND ($1::text='' OR strpos(lower(concat_ws(' ',origin.name,destination.name,COALESCE(l.operator_name,op.display_name),l.subject_id::text)),lower($1))>0)
      AND ($2::uuid IS NULL OR l.subject_id>$2) AND ($3::uuid IS NULL OR l.subject_id=$3)
      AND EXISTS(SELECT 1 FROM public.v2_review_roles r JOIN public.users u ON u.id=r.user_id
        WHERE r.user_id=$4 AND r.role='administrator' AND r.revoked_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id))
      ORDER BY l.subject_id LIMIT 21`, [record ? '' : q, cursor, record, actor]);
    // Rechecking in the data statement closes the guard/read gap. If revoked
    // while the statement began, no private rows are read; the next read denies.
    if (record && !result.rows.length) {
      res.status(404).send(renderConsoleAccess('Route unavailable', 'Return to the catalogue and choose a current record.', false)); return;
    }
    const rows = result.rows.slice(0,20) as ConsoleRoute[];
    const name = req.user.displayName || [req.user.firstName,req.user.lastName].filter(Boolean).join(' ') || 'Administrator';
    res.send(renderAdminConsole({ name, q, rows, record, nextCursor: result.rows.length > 20 ? rows.at(-1)!.id : null }));
  } catch {
    // A failed authority/database check must never fall back to public or
    // shared-secret administration, nor expose database error details.
    res.status(503).send(renderConsoleAccess('Administration is unavailable', 'Your records have not changed. Try opening the workspace again.', false));
  }
});

// Private JSON reads/previews are deliberately outside the public native API.
// They share named authority, not the legacy shared-secret admin session.
router.use('/admin-console',async(req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');res.vary('Cookie');res.vary('Authorization');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(!req.isAuthenticated()){res.status(401).json({code:'AUTH_REQUIRED',error:'Sign in to administration.'});return;}
  try{
    const {rows}=await pool.query(`SELECT 1 FROM public.v2_review_roles r JOIN public.users u ON u.id=r.user_id
      WHERE r.user_id=$1 AND r.role='administrator' AND r.revoked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id)`,[req.user.id]);
    if(!rows.length){res.status(403).json({code:'ADMIN_REQUIRED',error:'Administrative access is required.'});return;}
    next();
  }catch{res.status(503).json({code:'ADMIN_UNAVAILABLE',error:'Administration is temporarily unavailable.'});}
});
router.get('/admin-console/evidence',async(req,res)=>{
  if(!req.isAuthenticated())return;
  if(Object.keys(req.query).join(',')!=='record'||!validAdminId(req.query.record)){
    res.status(400).json({code:'INVALID_RECORD',error:'Choose a route from the catalogue.'});return;
  }
  try{
    const data=await readAdminClaims(req.user.id,[req.query.record]);
    if(!data.routes.length){res.status(404).json({code:'RECORD_UNAVAILABLE',error:'This route is unavailable.'});return;}
    res.json(data);
  }catch{res.status(503).json({code:'ADMIN_UNAVAILABLE',error:'Evidence could not be checked.'});}
});
router.post('/admin-console/preview',async(req,res)=>{
  if(!req.isAuthenticated())return;
  if(req.get('X-Mabhazi-Account')!==req.user.id){res.status(409).json({code:'ACCOUNT_CHANGED',error:'Reopen the dashboard with your current account.'});return;}
  if(!req.is('application/json')){res.status(415).json({code:'JSON_REQUIRED',error:'Submit the selection as JSON.'});return;}
  if(req.headers.origin!==getOrigin(req)){res.status(403).json({code:'ORIGIN_REJECTED',error:'Reopen the private workspace.'});return;}
  const input=parseAdminSelection(req.body);
  if(!input||Object.keys(req.query).length){res.status(422).json({code:'INVALID_SELECTION',error:'Choose up to 100 routes and the properties to review.'});return;}
  try{
    const data=await readAdminClaims(req.user.id,input.routeIds);
    if(data.routes.length!==input.routeIds.length){res.status(409).json({code:'SELECTION_CHANGED',error:'Some selected reports changed or are unavailable. Refresh the selection.'});return;}
    const claims=data.claims.filter(c=>input.fields.includes(c.field as typeof input.fields[number]));
    const missing=input.routeIds.flatMap(id=>input.fields.filter(f=>!claims.some(c=>c.routeId===id&&c.field===f)).map(field=>({routeId:id,field})));
    res.json({selection:input,claims,missing,digest:adminDigest({actor:req.user.id,selection:input,claims:claims.map(c=>c.digest)}),
      ready:claims.filter(c=>c.review==='pending'&&!c.attention).length,
      held:claims.filter(c=>c.review==='pending'&&c.attention).length,
      reviewed:claims.filter(c=>c.review!=='pending').length,
      writable:false});
  }catch(error){const large=(error as Error).message==='admin_selection_too_large';res.status(large?422:503).json({code:large?'SELECTION_TOO_LARGE':'ADMIN_UNAVAILABLE',error:large?'Choose fewer reports for this batch.':'The review preview could not load.'});}
});

export default router;
