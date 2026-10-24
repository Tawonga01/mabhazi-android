import { Router, type IRouter, type Response } from 'express';
import { pool } from '@workspace/db';
import { SubmitV2LeadBody, SubmitV2LeadResponse, GetV2LeadReceiptParams, ListV2CitiesQueryParams } from '@workspace/api-zod';
import { isAllowedOrigin } from '../lib/origins';
import { CURRENT_TERMS_VERSION } from '../lib/terms';
import { requireCurrentTerms } from '../middlewares/termsMiddleware';
import { saveMinimumLead } from '../lib/minimumLead';
import { parseActualJourney, saveActualJourney } from '../lib/actualJourney';
import ownRoutes from './ownRoutesV2';

const router: IRouter = Router();
// Orval validates values but currently emits stripping objects and number() for
// integer schemas. Preserve its generated rules and add the specified strictness.
const coreSchema = SubmitV2LeadBody.shape.target.shape.newLead;
const bodySchema = SubmitV2LeadBody.extend({
  target: SubmitV2LeadBody.shape.target.extend({ newLead: coreSchema.extend({
    originCityId: coreSchema.shape.originCityId.int(),
    destinationCityId: coreSchema.shape.destinationCityId.int(),
    operator: coreSchema.shape.operator.extend({ name: coreSchema.shape.operator.shape.name.refine(value =>
      value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !['unknown','n/a','-'].includes(value.toLowerCase())) }).strict(),
  }).strict() }).strict(),
}).strict();
function failure(res: Response, status: number, code: string, error: string) {
  return res.status(status).json({ error, code });
}
async function enabled() {
  if (process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED !== 'true') return false;
  const { rows } = await pool.query(`SELECT CASE WHEN to_regprocedure('public.v2_api_submit_minimum_lead(character varying,text,jsonb)') IS NULL
    THEN false ELSE has_function_privilege(current_user,'public.v2_api_submit_minimum_lead(character varying,text,jsonb)','EXECUTE') END enabled`);
  return rows[0]?.enabled === true;
}
async function actualEnabled() {
  if (process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED !== 'true') return false;
  const { rows }=await pool.query(`SELECT CASE WHEN to_regprocedure('public.v2_api_submit_actual_journey(character varying,text,jsonb)') IS NULL
    THEN false ELSE has_function_privilege(current_user,'public.v2_api_submit_actual_journey(character varying,text,jsonb)','EXECUTE') END enabled`);
  return rows[0]?.enabled===true;
}
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.get('/capabilities', async (_req, res) => {
  let ready = false, actualReady=false;
  try { ready = await enabled(); actualReady=ready && await actualEnabled(); } catch { /* Fail closed during unavailable schema/database. */ }
  res.json({ schemaVersion: '1.0', minimumLeadEnabled: ready, actualJourneyEnabled:actualReady });
});
// History and receipt recovery remain readable when new intake is paused.
router.use('/my-routes', ownRoutes);
router.use(async (req, res, next) => {
  // Pausing new intake must not prevent an account checking a committed receipt.
  if (req.method === 'GET' && req.path.startsWith('/receipts/')) { next(); return; }
  try {
    if (!await enabled()) { failure(res, 503, 'CAPABILITY_UNAVAILABLE', 'The new contribution form is not available yet.'); return; }
    next();
  } catch { failure(res, 503, 'TEMPORARILY_UNAVAILABLE', 'Please try again when the connection is available.'); }
});
router.get('/cities', async (req, res) => {
  const parsed = ListV2CitiesQueryParams.strict().safeParse(req.query);
  if (req.query.q !== undefined && typeof req.query.q !== 'string') { failure(res, 400, 'INVALID_QUERY', 'Enter one city search.'); return; }
  if (!parsed.success) { failure(res, 400, 'INVALID_QUERY', 'City search must be at most 80 characters.'); return; }
  const search = (parsed.data.q ?? '').trim();
  try {
    const { rows } = await pool.query(`SELECT id,name,place_type AS "placeType" FROM public.cities
      WHERE strpos(lower(name),lower($1))>0 ORDER BY lower(name),id LIMIT 20`, [search]);
    res.json({ cities: rows });
  } catch { failure(res, 503, 'TEMPORARILY_UNAVAILABLE', 'City search is temporarily unavailable.'); }
});
router.get('/receipts/:clientSubmissionId', async (req, res) => {
  if (!req.isAuthenticated()) { failure(res, 401, 'AUTH_REQUIRED', 'Sign in to check your contribution.'); return; }
  if (req.get('X-Mabhazi-Account') !== req.user.id) { failure(res, 409, 'ACCOUNT_CHANGED', 'The active account changed. Reopen your own draft.'); return; }
  const parsed = GetV2LeadReceiptParams.safeParse(req.params);
  if (!parsed.success) { failure(res, 400, 'INVALID_REQUEST_ID', 'The contribution reference is invalid.'); return; }
  try {
    // Both namespace members are mandatory, even with server-wide database RLS.
    const { rows } = await pool.query(`SELECT initial_response FROM public.v2_receipts
      WHERE user_id=$1 AND client_submission_id=$2`, [req.user.id, parsed.data.clientSubmissionId]);
    if (!rows[0]) { res.json({ found: false }); return; }
    const receipt = SubmitV2LeadResponse.parse({ ...(rows[0].initial_response as Record<string, unknown>), replayed: true });
    // A live selection revision is separate from the immutable initial receipt.
    // Only the account's active, attributable initial community lead is eligible.
    const selected = await pool.query(`SELECT s.revision FROM public.v2_leads l
      JOIN public.v2_subjects s ON s.id=l.subject_id
      JOIN public.v2_contributions c ON c.id=l.initial_contribution_id
      WHERE l.subject_id=$1 AND c.id=$2 AND c.user_id=$3
        AND l.intake_kind='community' AND NOT l.attribution_erased AND s.lifecycle='active'`,
      [receipt.subjectId, receipt.contributionId, req.user.id]);
    const revision = Number(selected.rows[0]?.revision);
    res.json({ found: true, initialReceipt: receipt,
      ...(Number.isSafeInteger(revision) && revision > 0 ? { currentLeadRevision: revision } : {}) });
  } catch { failure(res, 503, 'TEMPORARILY_UNAVAILABLE', 'The saved receipt could not be checked. Keep this draft and try again.'); }
});
router.post('/actual-journeys', (req,res,next) => {
  if (!req.isAuthenticated()) { failure(res,401,'AUTH_REQUIRED','Sign in before submitting.');return; }
  if (req.get('X-Mabhazi-Account')!==req.user.id) { failure(res,409,'ACCOUNT_CHANGED','The active account changed. Reopen your own draft.');return; }
  next();
}, requireCurrentTerms, async (req,res) => {
  if (!req.isAuthenticated()) return;
  if (!req.is('application/json')) { failure(res,415,'JSON_REQUIRED','Submit the contribution as JSON.');return; }
  if (req.headers.origin && !isAllowedOrigin(req.headers.origin) || !req.headers.authorization?.startsWith('Bearer ') && !req.headers.origin) {
    failure(res,403,'ORIGIN_REJECTED','The sign-in origin is not allowed.');return;
  }
  try { if (!await actualEnabled()) { failure(res,503,'CAPABILITY_UNAVAILABLE','Journey reports are not available yet.');return; } }
  catch { failure(res,503,'TEMPORARILY_UNAVAILABLE','Journey reports are temporarily unavailable.');return; }
  const parsed=parseActualJourney(req.body);
  if (!parsed.success) { res.status(422).json({error:'Check the journey details.',code:'INVALID_CONTRIBUTION',fieldErrors:parsed.fieldErrors});return; }
  try { res.json(await saveActualJourney(req.user.id,parsed.data)); }
  catch (error) {
    const {code,message}=error as {code?:string;message?:string};
    if (message==='v2_intake_idempotency_conflict') { failure(res,409,'IDEMPOTENCY_CONFLICT','This reference was already used for different answers. Check its receipt.');return; }
    if (message==='v2_intake_terms_required') { res.status(428).json({error:'Accept the current Terms before submitting.',code:'TERMS_ACCEPTANCE_REQUIRED',currentVersion:CURRENT_TERMS_VERSION});return; }
    if (message==='v2_intake_account_missing') { failure(res,401,'AUTH_REQUIRED','Sign in again before submitting.');return; }
    if (message==='v2_actual_target_unavailable') { failure(res,404,'TARGET_NOT_FOUND','The selected service is not available. Keep your report and choose again.');return; }
    if (message==='v2_actual_intended_revision_conflict') { failure(res,409,'TARGET_IDENTITY_CHANGED','The selected service changed. Review your selection before submitting again.');return; }
    if (message==='v2_intake_source_forbidden') { failure(res,403,'FORBIDDEN','One of the selected sources is not available to this account.');return; }
    if (['23514','23503','22007','22008','22P02'].includes(code??'')) { failure(res,422,'INVALID_CONTRIBUTION','Check the journey dates, places, amounts and currency.');return; }
    failure(res,503,'SAVE_UNCONFIRMED','The save could not be confirmed. Keep this report and check its receipt before retrying.');
  }
});
router.post('/contributions', (req, res, next) => {
  if (!req.isAuthenticated()) { failure(res, 401, 'AUTH_REQUIRED', 'Sign in before submitting.'); return; }
  if (req.get('X-Mabhazi-Account') !== req.user.id) { failure(res, 409, 'ACCOUNT_CHANGED', 'The active account changed. Reopen your own draft.'); return; }
  next();
}, requireCurrentTerms, async (req, res) => {
  if (!req.isAuthenticated()) return;
  // JSON-only writes plus an explicit browser-origin check protect cookie sessions.
  if (!req.is('application/json')) { failure(res, 415, 'JSON_REQUIRED', 'Submit the contribution as JSON.'); return; }
  if (req.headers.origin && !isAllowedOrigin(req.headers.origin) ||
      !req.headers.authorization?.startsWith('Bearer ') && !req.headers.origin) {
    failure(res, 403, 'ORIGIN_REJECTED', 'The sign-in origin is not allowed.'); return;
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'Check the four required answers.', code: 'INVALID_CONTRIBUTION',
      fieldErrors: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: 'Check this answer.' })).slice(0, 8) });
    return;
  }
  const core = parsed.data.target.newLead;
  if (core.originCityId === core.destinationCityId) {
    res.status(422).json({ error: 'Choose different departure and destination cities.', code: 'INVALID_DIRECTION',
      fieldErrors: [{ field: 'target.newLead.destinationCityId', message: 'Choose a different destination.' }] }); return;
  }
  try { res.json(await saveMinimumLead(req.user.id, parsed.data)); }
  catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    if (message === 'v2_intake_idempotency_conflict') { failure(res, 409, 'IDEMPOTENCY_CONFLICT', 'This reference was already used for different answers. Check the saved receipt.'); return; }
    if (message === 'v2_intake_terms_required') { res.status(428).json({ error: 'Accept the current Terms before submitting.', code: 'TERMS_ACCEPTANCE_REQUIRED', currentVersion: CURRENT_TERMS_VERSION }); return; }
    if (message === 'v2_intake_account_missing') { failure(res, 401, 'AUTH_REQUIRED', 'Sign in again before submitting.'); return; }
    if (code === '23514' || code === '23503' || code === '22007' || code === '22P02') {
      failure(res, 422, 'INVALID_CONTRIBUTION', 'Check the selected cities, clock time and bus operator.'); return;
    }
    failure(res, 503, 'SAVE_UNCONFIRMED', 'The save could not be confirmed. Keep this draft and check its receipt before retrying.');
  }
});
export default router;
