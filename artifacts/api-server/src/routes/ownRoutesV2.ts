import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { GetV2OwnRouteParams, GetV2OwnRouteResponse, ListV2OwnRoutesQueryParams, ListV2OwnRoutesResponse } from '@workspace/api-zod';

const router: IRouter = Router();
// These are the account's initial submissions, never a public route catalog or
// raw evidence endpoint. All joins retain both members of the receipt namespace.
const owned = `FROM public.v2_receipts r
  JOIN public.v2_contributions c ON c.id=r.contribution_id AND c.user_id=r.user_id AND c.client_submission_id=r.client_submission_id
  JOIN public.v2_leads l ON l.initial_contribution_id=c.id AND l.subject_id=c.original_subject_id
  JOIN public.v2_subjects s ON s.id=l.subject_id
  JOIN public.cities origin ON origin.id=(c.payload#>>'{target,newLead,originCityId}')::integer
  JOIN public.cities destination ON destination.id=(c.payload#>>'{target,newLead,destinationCityId}')::integer
  LEFT JOIN public.v2_operators reported_operator ON reported_operator.subject_id=(c.payload#>>'{target,newLead,operator,id}')::uuid
  WHERE c.user_id=$1 AND l.intake_kind='community' AND NOT l.attribution_erased`;
const selected = `SELECT r.client_submission_id AS "clientSubmissionId", l.subject_id AS "subjectId", r.created_at AS "submittedAt",
  jsonb_build_object('id',origin.id,'name',origin.name,'placeType',origin.place_type) AS origin,
  jsonb_build_object('id',destination.id,'name',destination.name,'placeType',destination.place_type) AS destination,
  COALESCE(c.payload#>>'{target,newLead,operator,name}',reported_operator.display_name) AS operator,
  c.payload#>>'{target,newLead,departureTime}' AS "departureTime", s.lifecycle, s.revision `;
function record(row: Record<string, unknown>) {
  const { lifecycle, revision, ...context } = row;
  const current = Number(revision);
  return { ...context, availability: lifecycle === 'active' ? 'active' : 'unavailable',
    ...(lifecycle === 'active' && Number.isSafeInteger(current) && current > 0 ? { currentLeadRevision: current } : {}) };
}
router.use((req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Sign in to see your routes.' }); return; }
  if (req.get('X-Mabhazi-Account') !== req.user.id) { res.status(409).json({ code: 'ACCOUNT_CHANGED', error: 'The active account changed. Reopen your routes.' }); return; }
  next();
});
router.get('/', async (req, res) => {
  if (!req.isAuthenticated()) return;
  const parsed = ListV2OwnRoutesQueryParams.strict().safeParse(req.query);
  if (!parsed.success || req.query.cursor !== undefined && typeof req.query.cursor !== 'string') { res.status(400).json({ code: 'INVALID_QUERY', error: 'Refresh your routes and try again.' }); return; }
  try {
    const ids = parsed.data.cursor?.toLowerCase().split('.');
    let bounds = '', values: unknown[] = [req.user.id];
    if (ids) {
      // PostgreSQL returns the precise timestamp as text; never round it through
      // JavaScript Date for keyset boundaries. Both anchors must still be owned.
      const anchors = await pool.query(`SELECT r.client_submission_id id,r.created_at::text time ${owned}
        AND r.client_submission_id=ANY($2::uuid[])`, [req.user.id, ids]);
      const first = anchors.rows.find(row => row.id === ids[0]), last = anchors.rows.find(row => row.id === ids[1]);
      if (!first || !last) { res.status(400).json({ code: 'INVALID_CURSOR', error: 'Your route list changed. Refresh to continue.' }); return; }
      values = [req.user.id, first.time, first.id, last.time, last.id];
      bounds = ' AND (r.created_at,r.client_submission_id)<=($2::timestamptz,$3::uuid) AND (r.created_at,r.client_submission_id)<($4::timestamptz,$5::uuid)';
    }
    const result = await pool.query(`${selected} ${owned}${bounds} ORDER BY r.created_at DESC,r.client_submission_id DESC LIMIT 21`, values);
    const page = result.rows.slice(0, 20);
    const nextCursor = result.rows.length > 20 ? (ids?.[0] ?? page[0].clientSubmissionId) + '.' + page[page.length - 1].clientSubmissionId : undefined;
    res.json(ListV2OwnRoutesResponse.parse({ routes: page.map(record), ...(nextCursor ? { nextCursor } : {}) }));
  } catch { res.status(503).json({ code: 'TEMPORARILY_UNAVAILABLE', error: 'Your routes could not be loaded. Try again.' }); }
});
router.get('/:clientSubmissionId', async (req, res) => {
  if (!req.isAuthenticated()) return;
  const parsed = GetV2OwnRouteParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ code: 'INVALID_REQUEST_ID', error: 'The route reference is invalid.' }); return; }
  if (Object.keys(req.query).length) { res.status(400).json({ code: 'INVALID_QUERY', error: 'Reopen your route and try again.' }); return; }
  try {
    const result = await pool.query(`${selected} ${owned} AND r.client_submission_id=$2`, [req.user.id, parsed.data.clientSubmissionId]);
    if (!result.rows[0]) { res.status(404).json({ code: 'ROUTE_UNAVAILABLE', error: 'This submitted route is unavailable.' }); return; }
    res.json(GetV2OwnRouteResponse.parse({ route: record(result.rows[0]) }));
  } catch { res.status(503).json({ code: 'TEMPORARILY_UNAVAILABLE', error: 'Your route could not be checked. Try again.' }); }
});
export default router;
