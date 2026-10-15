-- Server-only minimum-lead facade. Public clients never receive database access.
-- Applying this migration does not enable HTTP intake; its flag defaults off.
CREATE FUNCTION public.v2_api_submit_minimum_lead(actor varchar, required_terms text, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF request->>'entrySurface' IS DISTINCT FROM 'contribute_tab'
   OR request->'observations' IS DISTINCT FROM '[]'::jsonb
   OR NOT COALESCE(jsonb_typeof(request->'target'->'newLead'->'operator')='object'
     AND (request->'target'->'newLead'->'operator') ? 'name'
     AND ((request->'target'->'newLead'->'operator')-'name')='{}'::jsonb,false)
   OR request ? 'leadContext' THEN
  RAISE EXCEPTION 'v2_minimum_capability_only' USING ERRCODE='23514';
 END IF;
 RETURN public.v2_submit_lead(actor,required_terms,request);
END; $$;
REVOKE ALL ON FUNCTION public.v2_api_submit_minimum_lead(varchar,text,jsonb) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.v2_api_submit_minimum_lead(varchar,text,jsonb) FROM %I',r);
  END IF;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_api_submit_minimum_lead(varchar,text,jsonb) TO mabhazi_api;
