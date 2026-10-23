-- Minimum route intake from a successful empty search; old tab clients remain valid.
-- Replaces only the existing restricted facade, preserving its privileges and all other guards.
CREATE OR REPLACE FUNCTION public.v2_api_submit_minimum_lead(actor varchar, required_terms text, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT COALESCE(request->>'entrySurface' IN ('contribute_tab','search_empty'),false)
   OR request->'observations' IS DISTINCT FROM '[]'::jsonb
   OR NOT COALESCE(jsonb_typeof(request->'target'->'newLead'->'operator')='object'
     AND (request->'target'->'newLead'->'operator') ? 'name'
     AND ((request->'target'->'newLead'->'operator')-'name')='{}'::jsonb,false)
   OR request ? 'leadContext' THEN
  RAISE EXCEPTION 'v2_minimum_capability_only' USING ERRCODE='23514';
 END IF;
 RETURN public.v2_submit_lead(actor,required_terms,request);
END; $$;
