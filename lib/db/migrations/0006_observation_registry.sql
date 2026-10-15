-- Typed observation registry. Storage only: no canonical writer or public API enabled.
-- Previously validated migrations remain unchanged.
CREATE FUNCTION public.v2_initial_observation_valid(field text, value jsonb, scope jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE amount text; segment jsonb; date_value text;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(scope) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF field = 'operator.reported' THEN
    RETURN scope='{}'::jsonb AND CASE
      WHEN value ? 'name' AND value - 'name' = '{}'::jsonb THEN
        jsonb_typeof(value->'name')='string' AND public.v2_valid_operator_name(value->>'name')
      WHEN value ? 'id' AND value - 'id' = '{}'::jsonb THEN
        jsonb_typeof(value->'id')='string' AND (value->>'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      ELSE false END;
  ELSIF field = 'departure.reported' THEN
    RETURN COALESCE(scope='{}'::jsonb AND value ?& ARRAY['time','basis']
      AND value - ARRAY['time','basis'] = '{}'::jsonb
      AND jsonb_typeof(value->'time')='string' AND length(value->>'time')=5
      AND (value->>'time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND value->>'basis' IN ('unspecified','scheduled','actual'),false);
  ELSIF field IN ('boarding.pickup','alighting.dropoff') THEN
    RETURN COALESCE(scope='{}'::jsonb AND value ?& ARRAY['cityId','name']
      AND value - ARRAY['cityId','name','instructions'] = '{}'::jsonb
      AND jsonb_typeof(value->'cityId')='number' AND value->>'cityId' ~ '^[1-9][0-9]{0,8}$'
      AND jsonb_typeof(value->'name')='string' AND length(btrim(value->>'name')) BETWEEN 1 AND 200
      AND (NOT value ? 'instructions' OR (jsonb_typeof(value->'instructions')='string' AND length(value->>'instructions')<=500)),false);
  ELSIF field IN ('fare.paid','fare.quoted','fare.advertised') THEN
    IF NOT COALESCE(value ?& ARRAY['amount','currency'] AND value - ARRAY['amount','currency']='{}'::jsonb
      AND jsonb_typeof(value->'amount')='string' AND jsonb_typeof(value->'currency')='string'
      AND value->>'currency' ~ '^[A-Z]{3}$',false) THEN RETURN false; END IF;
    amount := value->>'amount';
    IF length(amount)>13 OR amount !~ '^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$' THEN RETURN false; END IF;
    IF NOT COALESCE(scope ?& ARRAY['schemaVersion','segment','passengerCategory','ticketBasis']
      AND scope->>'schemaVersion'='1.0'
      AND scope - ARRAY['schemaVersion','segment','serviceDate','effectiveFrom','effectiveTo','passengerCategory','passengerLabel','ticketBasis','ticketLabel','paymentMethod','luggageIncluded','timeBasis']='{}'::jsonb
      AND scope->>'passengerCategory' IN ('adult','child','concession','other','unknown')
      AND scope->>'ticketBasis' IN ('one_way','return','other','unknown'),false) THEN RETURN false; END IF;
    segment:=scope->'segment';
    -- Stop-pair fares await the stop subtype migration; never store dangling IDs.
    IF NOT COALESCE(jsonb_typeof(segment)='object' AND segment->>'kind'='city_pair'
      AND segment ?& ARRAY['kind','originCityId','destinationCityId']
      AND segment - ARRAY['kind','originCityId','destinationCityId']='{}'::jsonb
      AND jsonb_typeof(segment->'originCityId')='number' AND jsonb_typeof(segment->'destinationCityId')='number'
      AND segment->>'originCityId' ~ '^[1-9][0-9]{0,8}$' AND segment->>'destinationCityId' ~ '^[1-9][0-9]{0,8}$'
      AND segment->>'originCityId' <> segment->>'destinationCityId',false) THEN RETURN false; END IF;
    IF field='fare.paid' AND (NOT scope ? 'serviceDate' OR scope->'serviceDate'='null'::jsonb) THEN RETURN false; END IF;
    FOREACH date_value IN ARRAY ARRAY['serviceDate','effectiveFrom','effectiveTo'] LOOP
      IF scope ? date_value AND scope->date_value <> 'null'::jsonb THEN
        IF jsonb_typeof(scope->date_value)<>'string' OR length(scope->>date_value)<>10
           OR scope->>date_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
        PERFORM (scope->>date_value)::date;
      END IF;
    END LOOP;
    IF (scope->>'effectiveFrom')::date > (scope->>'effectiveTo')::date THEN RETURN false; END IF;
    IF scope->>'passengerCategory'='other' AND NOT COALESCE(jsonb_typeof(scope->'passengerLabel')='string' AND length(btrim(scope->>'passengerLabel')) BETWEEN 1 AND 120,false) THEN RETURN false; END IF;
    IF scope->>'ticketBasis'='other' AND NOT COALESCE(jsonb_typeof(scope->'ticketLabel')='string' AND length(btrim(scope->>'ticketLabel')) BETWEEN 1 AND 120,false) THEN RETURN false; END IF;
    IF scope ? 'luggageIncluded' AND jsonb_typeof(scope->'luggageIncluded') NOT IN ('boolean','null') THEN RETURN false; END IF;
    IF scope ? 'paymentMethod' AND jsonb_typeof(scope->'paymentMethod') NOT IN ('string','null') THEN RETURN false; END IF;
    FOREACH date_value IN ARRAY ARRAY['passengerLabel','ticketLabel','paymentMethod'] LOOP
      IF scope ? date_value AND scope->date_value <> 'null'::jsonb AND
         NOT COALESCE(jsonb_typeof(scope->date_value)='string' AND length(btrim(scope->>date_value)) BETWEEN 1 AND 120,false) THEN RETURN false; END IF;
    END LOOP;
    IF scope ? 'timeBasis' AND scope->'timeBasis' <> 'null'::jsonb AND
       NOT COALESCE(scope->>'timeBasis' IN ('unspecified','scheduled','actual'),false) THEN RETURN false; END IF;
    RETURN true;
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RETURN false;
END;
$$;


-- SIX List One 2026-09-17; source and digest: reference/iso4217-2026-10-09.json.
CREATE FUNCTION public.v2_currency_minor_units(code text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT ('{"AED":2,"AFN":2,"ALL":2,"AMD":2,"AOA":2,"ARS":2,"AUD":2,"AWG":2,"AZN":2,"BAM":2,"BBD":2,"BDT":2,"BHD":3,"BIF":0,"BMD":2,"BND":2,"BOB":2,"BRL":2,"BSD":2,"BTN":2,"BWP":2,"BYN":2,"BZD":2,"CAD":2,"CDF":2,"CHF":2,"CLP":0,"CNY":2,"COP":2,"CRC":2,"CUP":2,"CVE":2,"CZK":2,"DJF":0,"DKK":2,"DOP":2,"DZD":2,"EGP":2,"ERN":2,"ETB":2,"EUR":2,"FJD":2,"FKP":2,"GBP":2,"GEL":2,"GHS":2,"GIP":2,"GMD":2,"GNF":0,"GTQ":2,"GYD":2,"HKD":2,"HNL":2,"HTG":2,"HUF":2,"IDR":2,"ILS":2,"INR":2,"IQD":3,"IRR":2,"ISK":0,"JMD":2,"JOD":3,"JPY":0,"KES":2,"KGS":2,"KHR":2,"KMF":0,"KPW":2,"KRW":0,"KWD":3,"KYD":2,"KZT":2,"LAK":2,"LBP":2,"LKR":2,"LRD":2,"LSL":2,"LYD":3,"MAD":2,"MDL":2,"MGA":2,"MKD":2,"MMK":2,"MNT":2,"MOP":2,"MRU":2,"MUR":2,"MVR":2,"MWK":2,"MXN":2,"MYR":2,"MZN":2,"NAD":2,"NGN":2,"NIO":2,"NOK":2,"NPR":2,"NZD":2,"OMR":3,"PAB":2,"PEN":2,"PGK":2,"PHP":2,"PKR":2,"PLN":2,"PYG":0,"QAR":2,"RON":2,"RSD":2,"RUB":2,"RWF":0,"SAR":2,"SBD":2,"SCR":2,"SDG":2,"SEK":2,"SGD":2,"SHP":2,"SLE":2,"SOS":2,"SRD":2,"SSP":2,"STN":2,"SVC":2,"SYP":2,"SZL":2,"THB":2,"TJS":2,"TMT":2,"TND":3,"TOP":2,"TRY":2,"TTD":2,"TWD":2,"TZS":2,"UAH":2,"UGX":0,"USD":2,"UYU":2,"UZS":2,"VED":2,"VES":2,"VND":0,"VUV":0,"WST":2,"XAF":0,"XCD":2,"XCG":2,"XOF":0,"XPF":0,"YER":2,"ZAR":2,"ZMW":2,"ZWG":2}'::jsonb->>code)::integer;
$$;

CREATE FUNCTION public.v2_json_uuid(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(v)='string' AND length(v#>>'{}')=36 AND v#>>'{}' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false);
$$;
CREATE FUNCTION public.v2_json_date(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF NOT COALESCE(jsonb_typeof(v)='string' AND length(v#>>'{}')=10 AND v#>>'{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false) THEN RETURN false; END IF;
 RETURN (v#>>'{}')::date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31';
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RETURN false;
END; $$;
CREATE FUNCTION public.v2_json_text(v jsonb, max_length integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(v)='string' AND length(btrim(v#>>'{}')) BETWEEN 1 AND max_length,false);
$$;
CREATE FUNCTION public.v2_place_valid(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(v)='object' AND (
   (v-'stopId'='{}'::jsonb AND public.v2_json_uuid(v->'stopId')) OR
   (v-ARRAY['cityId','name']='{}'::jsonb AND jsonb_typeof(v->'cityId')='number'
     AND v->>'cityId' ~ '^[1-9][0-9]{0,8}$' AND public.v2_json_text(v->'name',200))),false);
$$;
CREATE FUNCTION public.v2_temporal_scope_valid(s jsonb, actual boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; offset_text text;
BEGIN
 IF NOT COALESCE(jsonb_typeof(s)='object' AND jsonb_typeof(s->'schemaVersion')='string' AND s->>'schemaVersion'='1.0'
   AND s-ARRAY['schemaVersion','serviceDate','effectiveFrom','effectiveTo','timezone','calendarId','utcOffset']='{}'::jsonb,false) THEN RETURN false; END IF;
 IF actual AND (s ?| ARRAY['calendarId','effectiveFrom','effectiveTo']) THEN RETURN false; END IF;
 IF NOT actual AND s ? 'utcOffset' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['serviceDate','effectiveFrom','effectiveTo'] LOOP
   IF s ? k AND s->k<>'null'::jsonb AND NOT public.v2_json_date(s->k) THEN RETURN false; END IF;
 END LOOP;
 IF s->>'effectiveFrom'>s->>'effectiveTo' THEN RETURN false; END IF;
 IF s->>'serviceDate'<s->>'effectiveFrom' OR s->>'serviceDate'>s->>'effectiveTo' THEN RETURN false; END IF;
 IF s ? 'calendarId' AND s->'calendarId'<>'null'::jsonb AND NOT public.v2_json_uuid(s->'calendarId') THEN RETURN false; END IF;
 IF s ? 'timezone' AND s->'timezone'<>'null'::jsonb AND NOT public.v2_json_text(s->'timezone',100) THEN RETURN false; END IF;
 IF s ? 'utcOffset' AND s->'utcOffset'<>'null'::jsonb THEN
   offset_text:=s->>'utcOffset';
   IF jsonb_typeof(s->'utcOffset')<>'string' OR offset_text !~ '^[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$'
     OR s->>'timezone' IS NOT NULL THEN RETURN false; END IF;
 END IF;
 RETURN true;
END; $$;
CREATE FUNCTION public.v2_calendar_observation_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; previous text; k text; known boolean:=false;
BEGIN
 IF NOT COALESCE(jsonb_typeof(v)='object' AND v-ARRAY['weekdays','startDate','endDate','dates','exceptions','timezone']='{}'::jsonb,false) THEN RETURN false; END IF;
 IF v->>'timezone' IS NOT NULL AND NOT public.v2_json_text(v->'timezone',100) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['startDate','endDate'] LOOP
   IF v ? k AND v->k<>'null'::jsonb THEN
     IF NOT public.v2_json_date(v->k) THEN RETURN false; END IF; known:=true;
   END IF;
 END LOOP;
 IF v->>'startDate'>v->>'endDate' THEN RETURN false; END IF;
 IF v->>'weekdays' IS NOT NULL THEN
   IF jsonb_typeof(v->'weekdays')<>'array' OR jsonb_array_length(v->'weekdays') NOT BETWEEN 1 AND 7
     OR v->>'dates' IS NOT NULL THEN RETURN false; END IF;
   previous:=NULL;
   FOR item IN SELECT value FROM jsonb_array_elements(v->'weekdays') LOOP
     IF jsonb_typeof(item)<>'number' OR item#>>'{}' !~ '^[1-7]$' OR item#>>'{}'<=previous THEN RETURN false; END IF;
     previous:=item#>>'{}';
   END LOOP; known:=true;
 END IF;
 IF v->>'dates' IS NOT NULL THEN
   IF jsonb_typeof(v->'dates')<>'array' OR jsonb_array_length(v->'dates') NOT BETWEEN 1 AND 366 THEN RETURN false; END IF;
   previous:=NULL;
   FOR item IN SELECT value FROM jsonb_array_elements(v->'dates') LOOP
     IF NOT public.v2_json_date(item) OR item#>>'{}'<=previous
       OR item#>>'{}'<v->>'startDate' OR item#>>'{}'>v->>'endDate' THEN RETURN false; END IF;
     previous:=item#>>'{}';
   END LOOP; known:=true;
 END IF;
 IF v ? 'exceptions' AND v->'exceptions'<>'null'::jsonb THEN
   IF jsonb_typeof(v->'exceptions')<>'array' OR jsonb_array_length(v->'exceptions')>366 THEN RETURN false; END IF;
   previous:=NULL;
   FOR item IN SELECT value FROM jsonb_array_elements(v->'exceptions') LOOP
     IF NOT COALESCE(jsonb_typeof(item)='object' AND item-ARRAY['date','action']='{}'::jsonb
       AND public.v2_json_date(item->'date') AND item->>'action' IN ('add','remove'),false)
       OR item->>'date'<=previous THEN RETURN false; END IF;
     previous:=item->>'date'; known:=true;
   END LOOP;
 END IF;
 RETURN known;
END; $$;

CREATE OR REPLACE FUNCTION public.v2_intake_observation_valid(field text, value jsonb, scope jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; segment jsonb; adjusted jsonb; units integer; n integer; date_key text;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR jsonb_typeof(scope) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF field IN ('operator.reported','departure.reported') THEN RETURN public.v2_initial_observation_valid(field,value,scope);
 ELSIF field='operator.identity' THEN RETURN scope='{}'::jsonb AND value-'id'='{}'::jsonb AND public.v2_json_uuid(value->'id');
 ELSIF field='service.mode' THEN
   RETURN COALESCE(scope='{}'::jsonb AND value-'mode'='{}'::jsonb AND value->>'mode' IN ('fixed_time','frequency','when_full','on_demand','unknown'),false);
 ELSIF field='service.calendar' THEN RETURN scope='{}'::jsonb AND public.v2_calendar_observation_valid(value);
 ELSIF field IN ('departure.scheduled','arrival.scheduled') THEN
   RETURN COALESCE(value-'seconds'='{}'::jsonb AND jsonb_typeof(value->'seconds')='number'
     AND value->>'seconds' ~ '^[0-9]{1,6}$' AND (value->>'seconds')::integer BETWEEN 0 AND 172799
     AND public.v2_temporal_scope_valid(scope),false);
 ELSIF field IN ('departure.actual','arrival.actual') THEN
   RETURN COALESCE(value-'time'='{}'::jsonb AND jsonb_typeof(value->'time')='string'
     AND length(value->>'time')=5 AND value->>'time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND public.v2_temporal_scope_valid(scope,true),false);
 ELSIF field IN ('boarding.pickup','alighting.dropoff') THEN
   RETURN scope='{}'::jsonb AND public.v2_place_valid(value-'instructions')
     AND (NOT value ? 'instructions' OR (jsonb_typeof(value->'instructions')='string' AND length(value->>'instructions')<=500));
 ELSIF field='pattern.stops' THEN
   IF NOT COALESCE(scope='{}'::jsonb AND value-ARRAY['stops','stopsComplete']='{}'::jsonb
     AND jsonb_typeof(value->'stops')='array' AND jsonb_typeof(value->'stopsComplete')='boolean',false) THEN RETURN false; END IF;
   n:=jsonb_array_length(value->'stops');
   IF n NOT BETWEEN 1 AND 500 OR (value->>'stopsComplete')::boolean AND n<2 THEN RETURN false; END IF;
   FOR item IN SELECT elements.value FROM jsonb_array_elements(value->'stops') AS elements(value) LOOP
     IF NOT COALESCE(jsonb_typeof(item)='object' AND item-ARRAY['place','pickup','dropoff']='{}'::jsonb
       AND public.v2_place_valid(item->'place') AND item->>'pickup' IN ('allowed','forbidden','request','unknown')
       AND item->>'dropoff' IN ('allowed','forbidden','request','unknown'),false) THEN RETURN false; END IF;
   END LOOP; RETURN true;
 ELSIF field='stop.location' THEN
   IF NOT COALESCE(scope='{}'::jsonb AND value-ARRAY['cityId','name','latitude','longitude','precision']='{}'::jsonb
     AND public.v2_place_valid(value-ARRAY['latitude','longitude','precision'])
     AND value->>'precision' IN ('named_place','approximate'),false) THEN RETURN false; END IF;
   IF (value->>'latitude' IS NULL)<>(value->>'longitude' IS NULL) THEN RETURN false; END IF;
   IF value->>'latitude' IS NOT NULL THEN
     RETURN COALESCE(jsonb_typeof(value->'latitude')='number' AND jsonb_typeof(value->'longitude')='number'
       AND (value->>'latitude')::numeric BETWEEN -90 AND 90 AND (value->>'longitude')::numeric BETWEEN -180 AND 180,false);
   END IF;
   RETURN value->>'precision'='named_place';
 ELSIF field IN ('fare.paid','fare.quoted','fare.advertised') THEN
   units:=public.v2_currency_minor_units(value->>'currency');
   IF units IS NULL OR length(split_part(value->>'amount','.',2))>least(units,2) THEN RETURN false; END IF;
   segment:=scope->'segment'; adjusted:=scope-ARRAY['quotationDate','sourceDate'];
   FOREACH date_key IN ARRAY ARRAY['quotationDate','sourceDate'] LOOP
     IF scope ? date_key AND scope->date_key<>'null'::jsonb AND NOT public.v2_json_date(scope->date_key) THEN RETURN false; END IF;
   END LOOP;
   IF segment->>'kind'='stop_pair' THEN
     IF NOT COALESCE(segment-ARRAY['kind','fromStopId','toStopId']='{}'::jsonb
       AND public.v2_json_uuid(segment->'fromStopId') AND public.v2_json_uuid(segment->'toStopId')
       AND (segment->>'fromStopId')::uuid<>(segment->>'toStopId')::uuid,false) THEN RETURN false; END IF;
     adjusted:=jsonb_set(adjusted,'{segment}','{"kind":"city_pair","originCityId":1,"destinationCityId":2}'::jsonb);
   END IF;
   RETURN public.v2_initial_observation_valid(field,value,adjusted);
 ELSIF field='service.operating_status' THEN
   RETURN COALESCE(value-ARRAY['status','basis']='{}'::jsonb AND value->>'status' IN ('operating','not_operating','temporarily_suspended')
     AND value->>'basis' IN ('travelled','saw_operating','observed_sign','operator_statement','heard_from_other')
     AND scope-ARRAY['schemaVersion','serviceDate','effectiveFrom','effectiveTo','timezone']='{}'::jsonb
     AND public.v2_temporal_scope_valid(scope)
     AND (scope->>'serviceDate' IS NOT NULL OR (scope->>'effectiveFrom' IS NOT NULL AND scope->>'effectiveTo' IS NOT NULL)),false);
 ELSIF field='timetable.sign_presence' THEN
   RETURN COALESCE(value-ARRAY['status','place']='{}'::jsonb AND value->>'status' IN ('seen','not_seen')
     AND public.v2_place_valid(value->'place') AND scope-ARRAY['schemaVersion','serviceDate','timezone']='{}'::jsonb
     AND public.v2_temporal_scope_valid(scope),false);
 END IF;
 RETURN false;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN false;
END; $$;

CREATE FUNCTION public.v2_observation_kind_valid(field text, kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(CASE field
 WHEN 'operator.reported' THEN kind IN ('lead','actual_journey')
 WHEN 'departure.reported' THEN kind='lead'
 WHEN 'operator.identity' THEN kind IN ('route','lead','actual_journey')
 WHEN 'service.mode' THEN kind IN ('lead','service_plan')
 WHEN 'service.calendar' THEN kind IN ('lead','service_plan')
 WHEN 'departure.scheduled' THEN kind IN ('lead','run')
 WHEN 'arrival.scheduled' THEN kind IN ('lead','run')
 WHEN 'departure.actual' THEN kind='actual_journey'
 WHEN 'arrival.actual' THEN kind='actual_journey'
 WHEN 'boarding.pickup' THEN kind IN ('lead','pattern','actual_journey')
 WHEN 'alighting.dropoff' THEN kind IN ('lead','pattern','actual_journey')
 WHEN 'pattern.stops' THEN kind IN ('lead','pattern')
 WHEN 'stop.location' THEN kind='stop'
 WHEN 'fare.paid' THEN kind IN ('lead','pattern','run','actual_journey')
 WHEN 'fare.quoted' THEN kind IN ('lead','pattern','run','actual_journey')
 WHEN 'fare.advertised' THEN kind IN ('lead','pattern','run','actual_journey')
 WHEN 'service.operating_status' THEN kind IN ('lead','service_plan','run')
 WHEN 'timetable.sign_presence' THEN kind IN ('stop','lead')
 ELSE false END,false);
$$;

ALTER TABLE public.v2_observations DROP CONSTRAINT v2_observations_original_subject_id_fkey;
ALTER TABLE public.v2_observations ADD CONSTRAINT v2_observations_original_subject_id_fkey
 FOREIGN KEY(original_subject_id) REFERENCES public.v2_subjects(id);
ALTER TABLE public.v2_field_decisions DROP CONSTRAINT v2_field_decisions_subject_id_fkey;
ALTER TABLE public.v2_field_decisions DROP CONSTRAINT v2_field_decisions_field_key_check;
ALTER TABLE public.v2_field_decisions ADD CONSTRAINT v2_field_decisions_subject_id_fkey
 FOREIGN KEY(subject_id) REFERENCES public.v2_subjects(id);
CREATE FUNCTION public.v2_check_observation_kind() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target uuid; target_kind text;
BEGIN
 IF TG_TABLE_NAME='v2_observations' THEN target:=NEW.original_subject_id; ELSE target:=NEW.subject_id; END IF;
 SELECT kind INTO target_kind FROM public.v2_subjects WHERE id=target;
 IF NOT public.v2_observation_kind_valid(NEW.field_key,target_kind) THEN
   RAISE EXCEPTION 'v2_observation_field_target_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_observation_kind BEFORE INSERT ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_check_observation_kind();
CREATE TRIGGER v2_field_kind BEFORE INSERT ON public.v2_field_decisions FOR EACH ROW EXECUTE FUNCTION public.v2_check_observation_kind();

-- Every nested ID is projected into an actual FK. Ordinal paths preserve repeated
-- stop visits. These rows are generated, never a second editable source of facts.
CREATE TABLE public.v2_observation_refs (
 observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 path text NOT NULL,
 operator_id uuid REFERENCES public.v2_operators(subject_id),
 stop_id uuid REFERENCES public.v2_stops(subject_id),
 city_id integer REFERENCES public.cities(id),
 calendar_id uuid REFERENCES public.v2_calendars(id),
 timezone text REFERENCES public.v2_timezones(name),
 PRIMARY KEY(observation_id,path),
 CHECK(num_nonnulls(operator_id,stop_id,city_id,calendar_id,timezone)=1 OR
   (num_nonnulls(operator_id,stop_id,city_id)=0 AND calendar_id IS NOT NULL AND timezone IS NOT NULL)),
 FOREIGN KEY(calendar_id,timezone) REFERENCES public.v2_calendars(id,timezone)
);
CREATE INDEX v2_observation_refs_operator_idx ON public.v2_observation_refs(operator_id);
CREATE INDEX v2_observation_refs_stop_idx ON public.v2_observation_refs(stop_id);
CREATE INDEX v2_observation_refs_city_idx ON public.v2_observation_refs(city_id);
CREATE INDEX v2_observation_refs_calendar_idx ON public.v2_observation_refs(calendar_id);
CREATE INDEX v2_observation_refs_timezone_idx ON public.v2_observation_refs(timezone);

CREATE FUNCTION public.v2_observation_reference_rows(field text, v jsonb, s jsonb)
RETURNS TABLE(path text,operator_id uuid,stop_id uuid,city_id integer,calendar_id uuid,timezone text)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH places AS (
   SELECT 'value'::text p,v place WHERE field IN ('boarding.pickup','alighting.dropoff','stop.location')
   UNION ALL SELECT 'value.place',v->'place' WHERE field='timetable.sign_presence'
   UNION ALL SELECT 'value.stops.'|| (ordinality-1)::text ||'.place',e->'place'
     FROM jsonb_array_elements(CASE WHEN field='pattern.stops' THEN v->'stops' ELSE '[]'::jsonb END) WITH ORDINALITY AS a(e,ordinality)
 ), refs AS (
   SELECT p||'.stopId' path,NULL::uuid operator_id,(place->>'stopId')::uuid stop_id,NULL::integer city_id,NULL::uuid calendar_id,NULL::text timezone FROM places WHERE place->>'stopId' IS NOT NULL
   UNION ALL SELECT p||'.cityId',NULL,NULL,(place->>'cityId')::integer,NULL,NULL FROM places WHERE place->>'cityId' IS NOT NULL
   UNION ALL SELECT 'value.id',(v->>'id')::uuid,NULL,NULL,NULL,NULL WHERE field IN ('operator.reported','operator.identity') AND v->>'id' IS NOT NULL
   UNION ALL SELECT 'scope.segment.fromStopId',NULL,(s->'segment'->>'fromStopId')::uuid,NULL,NULL,NULL WHERE field LIKE 'fare.%' AND s->'segment'->>'fromStopId' IS NOT NULL
   UNION ALL SELECT 'scope.segment.toStopId',NULL,(s->'segment'->>'toStopId')::uuid,NULL,NULL,NULL WHERE field LIKE 'fare.%' AND s->'segment'->>'toStopId' IS NOT NULL
   UNION ALL SELECT 'scope.segment.originCityId',NULL,NULL,(s->'segment'->>'originCityId')::integer,NULL,NULL WHERE field LIKE 'fare.%' AND s->'segment'->>'originCityId' IS NOT NULL
   UNION ALL SELECT 'scope.segment.destinationCityId',NULL,NULL,(s->'segment'->>'destinationCityId')::integer,NULL,NULL WHERE field LIKE 'fare.%' AND s->'segment'->>'destinationCityId' IS NOT NULL
   UNION ALL SELECT 'scope.calendarId',NULL,NULL,NULL,(s->>'calendarId')::uuid,s->>'timezone' WHERE s->>'calendarId' IS NOT NULL
   UNION ALL SELECT 'scope.timezone',NULL,NULL,NULL,NULL,s->>'timezone' WHERE s->>'timezone' IS NOT NULL
   UNION ALL SELECT 'value.timezone',NULL,NULL,NULL,NULL,v->>'timezone' WHERE field='service.calendar' AND v->>'timezone' IS NOT NULL
 ) SELECT * FROM refs;
$$;
CREATE FUNCTION public.v2_fill_observation_refs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.v2_observation_refs SELECT NEW.id,r.* FROM public.v2_observation_reference_rows(NEW.field_key,NEW.value,NEW.scope) r;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_observation_refs_fill AFTER INSERT ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_fill_observation_refs();
CREATE FUNCTION public.v2_check_observation_refs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE obs uuid; o public.v2_observations;
BEGIN
 IF TG_TABLE_NAME='v2_observations' THEN obs:=NEW.id; ELSE obs:=COALESCE(NEW.observation_id,OLD.observation_id); END IF;
 SELECT * INTO o FROM public.v2_observations WHERE id=obs;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF EXISTS((SELECT * FROM public.v2_observation_reference_rows(o.field_key,o.value,o.scope)
   EXCEPT SELECT path,operator_id,stop_id,city_id,calendar_id,timezone FROM public.v2_observation_refs WHERE observation_id=obs)
   UNION ALL (SELECT path,operator_id,stop_id,city_id,calendar_id,timezone FROM public.v2_observation_refs WHERE observation_id=obs
   EXCEPT SELECT * FROM public.v2_observation_reference_rows(o.field_key,o.value,o.scope))) THEN
   RAISE EXCEPTION 'v2_observation_reference_projection_mismatch' USING ERRCODE='23514'; END IF;
 IF o.scope->>'calendarId' IS NOT NULL AND o.scope->>'timezone' IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.v2_calendars WHERE id=(o.scope->>'calendarId')::uuid AND timezone=o.scope->>'timezone') THEN
   RAISE EXCEPTION 'v2_observation_calendar_timezone_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER v2_observation_refs_valid AFTER INSERT ON public.v2_observations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_check_observation_refs();
CREATE CONSTRAINT TRIGGER v2_observation_refs_valid AFTER INSERT OR UPDATE OR DELETE ON public.v2_observation_refs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_check_observation_refs();
CREATE TRIGGER v2_observation_refs_immutable BEFORE UPDATE ON public.v2_observation_refs
 FOR EACH ROW EXECUTE FUNCTION public.v2_private_record_immutable();

-- Existing content is checked, never silently rewritten to fit a new contract.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_subjects s ON s.id=o.original_subject_id
   WHERE public.v2_intake_observation_valid(o.field_key,o.value,o.scope) IS NOT TRUE OR NOT public.v2_observation_kind_valid(o.field_key,s.kind))
   OR EXISTS(SELECT 1 FROM public.v2_field_decisions d JOIN public.v2_subjects s ON s.id=d.subject_id
     WHERE NOT public.v2_observation_kind_valid(d.field_key,s.kind) OR (d.selected_value IS NOT NULL AND public.v2_intake_observation_valid(d.field_key,d.selected_value,d.scope) IS NOT TRUE)) THEN
   RAISE EXCEPTION 'v2_observation_registry_upgrade_requires_inventory' USING ERRCODE='23514'; END IF;
END; $$;


ALTER TABLE public.v2_observation_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_observation_refs FROM PUBLIC,mabhazi_api;
GRANT SELECT ON public.v2_observation_refs TO mabhazi_api;
CREATE POLICY api_server_access ON public.v2_observation_refs FOR SELECT TO mabhazi_api USING(true);
DO $$ DECLARE role_name text; f record; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.v2_observation_refs FROM %I',role_name); END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
   'v2_initial_observation_valid','v2_currency_minor_units','v2_json_uuid','v2_json_date','v2_json_text','v2_place_valid',
   'v2_temporal_scope_valid','v2_calendar_observation_valid','v2_intake_observation_valid','v2_observation_kind_valid',
   'v2_check_observation_kind','v2_observation_reference_rows','v2_fill_observation_refs','v2_check_observation_refs') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name); END IF;
   END LOOP;
   IF f.proname NOT IN ('v2_fill_observation_refs','v2_check_observation_refs','v2_observation_reference_rows') THEN
     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f.signature); END IF;
 END LOOP;
END; $$;

-- Backfill only after all DDL; deferred integrity events must not precede ALTER TABLE.
INSERT INTO public.v2_observation_refs SELECT o.id,r.* FROM public.v2_observations o
 CROSS JOIN LATERAL public.v2_observation_reference_rows(o.field_key,o.value,o.scope) r;
