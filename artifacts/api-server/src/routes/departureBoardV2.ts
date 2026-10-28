import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { GetV2DepartureBoardQueryParams, GetV2DepartureBoardResponse } from '@workspace/api-zod';
import { parseBlockedIds } from './routeSafetyV2';

const router: IRouter = Router();
// Origins and rows share one statement/snapshot and the same visibility rules.
// A unique exact reference-city lookup is navigation, never service association.
const boardSql = `WITH candidates AS (
 SELECT 'community:'||p.subject_id::text entry_key,'community'::text kind,
 p.subject_id::text subject_id,NULL::integer journey_id,p.origin_city_id city_id,
 p.origin->>'name' origin_name,p.destination->>'name' destination,
 p.operator_report->>'value' operator,p.reported_time->>'value' reported_time,
 NULL::text scheduled_days,NULL::text legacy_city,p.author_user_id author_id
 FROM public.v2_public_lead_reports p WHERE $3::boolean
 UNION ALL
 SELECT 'legacy:'||j.id::text,'legacy',NULL,j.id,c.id,
 coalesce(c.name,btrim(j.from_city)),btrim(j.to_city),nullif(btrim(j.bus_company),''),
 j.departure_time,nullif(btrim(j.travel_date),''),btrim(j.from_city),j.contributed_by
 FROM public.journeys j
 LEFT JOIN LATERAL (SELECT min(r.id) id FROM public.cities r
   WHERE lower(btrim(r.name))=lower(btrim(j.from_city)) HAVING count(*)=1) ref_match ON true
 LEFT JOIN public.cities c ON c.id=ref_match.id
 WHERE j.moderation_status='visible' AND j.data_status<>'inactive'
 AND btrim(j.from_city)<>'' AND btrim(j.to_city)<>''
), visible AS (
 SELECT *,CASE WHEN city_id IS NULL THEN 'legacy:'||encode(sha256(convert_to(lower(origin_name),'UTF8')),'hex')
 ELSE 'city:'||city_id::text END origin_key,
 CASE WHEN reported_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
 THEN left(reported_time,5) ELSE NULL END clock
 FROM candidates p WHERE NOT(coalesce(p.author_id,'')=ANY($1::varchar[]))
 AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b
   WHERE b.blocker_id=$2 AND b.blocked_user_id=p.author_id)
), origins AS (
 SELECT origin_key,min(origin_name) name,min(city_id) city_id,
 bool_or(kind='community') has_community,bool_or(kind='legacy') has_legacy
 FROM visible GROUP BY origin_key
), chosen AS (
 SELECT * FROM origins WHERE $4::text IS NULL OR origin_key=$4
 ORDER BY lower(name),name,origin_key LIMIT 1
)
SELECT jsonb_build_object(
 'origins',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'key',origin_key,'name',name,'cityId',city_id,
   'hasCommunityReports',has_community,'hasLegacyRoutes',has_legacy)
   ORDER BY lower(name),name,origin_key) FROM origins),'[]'::jsonb),
 'selectedOriginKey',(SELECT origin_key FROM chosen),
 'selectionUnavailable',$4::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chosen),
 'hasHiddenRoutes',EXISTS(SELECT 1 FROM candidates p WHERE
   coalesce(p.author_id,'')=ANY($1::varchar[]) OR EXISTS(
     SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$2 AND b.blocked_user_id=p.author_id)),
 'entries',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
   'key',v.entry_key,'kind',v.kind,'originKey',v.origin_key,
   'subjectId',v.subject_id,'journeyId',v.journey_id,
   'destination',v.destination,'operator',v.operator,'reportedTime',v.clock,
   'scheduledDays',v.scheduled_days,'timedDepartureEligible',false))
   ORDER BY coalesce(v.clock,'99:99'),lower(v.destination),lower(v.operator),v.entry_key)
   FROM visible v JOIN chosen c ON c.origin_key=v.origin_key),'[]'::jsonb)
) board`;

router.get('/departure-board', async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  res.vary('Authorization'); res.vary('Cookie'); res.vary('X-Mabhazi-Blocked-Contributors');
  const expected=req.get('X-Mabhazi-Account');
  if(expected!==undefined&&(!req.isAuthenticated()||req.user.id!==expected)) {
    res.status(req.isAuthenticated()?409:401).json({code:req.isAuthenticated()?'ACCOUNT_CHANGED':'AUTH_REQUIRED',error:'Reopen Departures with your current account.'}); return;
  }
  const blocked=parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'));
  if(!blocked){res.status(400).json({code:'INVALID_SAFETY_CONTEXT',error:'Your hidden contributor settings could not be checked.'});return;}
  const query=GetV2DepartureBoardQueryParams.strict().safeParse(req.query);
  if(!query.success||req.query.originKey!==undefined&&typeof req.query.originKey!=='string'){res.status(400).json({code:'INVALID_QUERY',error:'Choose a departure city again.'});return;}
  try {
    const {rows}=await pool.query(boardSql,[blocked,req.isAuthenticated()?req.user.id:null,
      process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED==='true',query.data.originKey??null]);
    res.json(GetV2DepartureBoardResponse.parse(rows[0]?.board));
  }catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'The departure board could not load. Try again.'});}
});
export default router;
