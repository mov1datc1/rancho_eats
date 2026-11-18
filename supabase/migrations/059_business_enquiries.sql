BEGIN;
CREATE TABLE public.business_enquiries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,lead_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 business_name text NOT NULL,contact_name text NOT NULL,email text NOT NULL,phone text NOT NULL,city text NOT NULL,
 category text NOT NULL CHECK(category IN('restaurant','pizza','burgers','cafe','retail','other')),
 delivery text NOT NULL CHECK(delivery IN('own_team','need_help','pickup_only','undecided')),
 message text NOT NULL DEFAULT '',state text NOT NULL DEFAULT 'NEW' CHECK(state IN('NEW','CONTACTED','CONVERTED','CLOSED')),
 admin_note text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,
 consent_at timestamptz NOT NULL DEFAULT clock_timestamp(),privacy_version text NOT NULL DEFAULT '2026-10-29',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX business_enquiries_period ON public.business_enquiries(created_at DESC,id);
CREATE INDEX business_enquiries_state_period ON public.business_enquiries(state,created_at DESC);
CREATE INDEX business_enquiries_email_period ON public.business_enquiries(email,created_at DESC);
CREATE INDEX business_enquiries_phone_period ON public.business_enquiries(phone,created_at DESC);
CREATE TABLE public.business_enquiry_updates(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,enquiry_id uuid NOT NULL REFERENCES public.business_enquiries(id),actor uuid REFERENCES auth.users(id),old_state text NOT NULL,new_state text NOT NULL,note text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.business_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_enquiry_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read_business_enquiries ON public.business_enquiries FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.admin_profiles WHERE id=auth.uid()));
CREATE POLICY admin_read_business_enquiry_updates ON public.business_enquiry_updates FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.admin_profiles WHERE id=auth.uid()));
REVOKE ALL ON public.business_enquiries,public.business_enquiry_updates FROM anon,authenticated;
GRANT SELECT ON public.business_enquiries,public.business_enquiry_updates TO authenticated;
CREATE FUNCTION public.submit_business_enquiry(p_payload jsonb,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b text;c text;e text;p text;city text;cat text;delivery text;message text;existing business_enquiries;number bigint;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>6000 OR p_request IS NULL THEN RAISE EXCEPTION 'invalid_request';END IF;
 -- Honeypot submissions receive a neutral response without creating contacts.
 IF length(trim(coalesce(p_payload->>'website','')))>0 THEN RETURN jsonb_build_object('received',true);END IF;
 b:=trim(p_payload->>'business_name');c:=trim(p_payload->>'contact_name');e:=lower(trim(p_payload->>'email'));p:=regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9]','','g');city:=trim(p_payload->>'city');cat:=p_payload->>'category';delivery:=p_payload->>'delivery';message:=trim(coalesce(p_payload->>'message',''));
 IF length(p)=12 AND left(p,2)='52' THEN p:=right(p,10);END IF;
 IF b IS NULL OR length(b) NOT BETWEEN 2 AND 160 OR c IS NULL OR length(c) NOT BETWEEN 2 AND 100 OR city IS NULL OR length(city) NOT BETWEEN 2 AND 100 OR e IS NULL OR length(e)>254 OR e!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p!~'^[0-9]{10}$' OR cat IS NULL OR cat NOT IN('restaurant','pizza','burgers','cafe','retail','other') OR delivery IS NULL OR delivery NOT IN('own_team','need_help','pickup_only','undecided') OR length(message)>1500 OR p_payload->>'consent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'invalid_contact_details';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('enquiry-email:'||e,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('enquiry-phone:'||p,0));
 SELECT * INTO existing FROM business_enquiries WHERE request_id=p_request;
 IF FOUND THEN
  IF existing.business_name IS DISTINCT FROM b OR existing.contact_name IS DISTINCT FROM c OR existing.email IS DISTINCT FROM e OR existing.phone IS DISTINCT FROM p OR existing.city IS DISTINCT FROM city OR existing.category IS DISTINCT FROM cat OR existing.delivery IS DISTINCT FROM delivery OR existing.message IS DISTINCT FROM message THEN RAISE EXCEPTION 'request_changed';END IF;
  RETURN jsonb_build_object('received',true,'reference','PY-NEG-'||lpad(existing.lead_number::text,greatest(6,length(existing.lead_number::text)),'0'));
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('business-enquiry-global-budget',0));
 IF(SELECT count(*) FROM business_enquiries WHERE created_at>now()-interval '1 hour')>=100 THEN RAISE EXCEPTION 'request_limit_reached';END IF;
 IF(SELECT count(*) FROM business_enquiries WHERE created_at>now()-interval '24 hours' AND(email=e OR phone=p))>=3 THEN RAISE EXCEPTION 'contact_limit_reached';END IF;
 INSERT INTO business_enquiries(request_id,business_name,contact_name,email,phone,city,category,delivery,message)VALUES(p_request,b,c,e,p,city,cat,delivery,message) RETURNING lead_number INTO number;
 RETURN jsonb_build_object('received',true,'reference','PY-NEG-'||lpad(number::text,greatest(6,length(number::text)),'0'));
END $$;
CREATE FUNCTION public.admin_business_enquiries(p_from date,p_to date,p_state text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>366 OR p_page IS NULL OR p_page<0 OR p_page>100000 OR p_state IS NULL OR p_state NOT IN('','NEW','CONTACTED','CONVERTED','CLOSED') THEN RAISE EXCEPTION 'invalid_filter';END IF;
 RETURN jsonb_build_object('count',(SELECT count(*) FROM business_enquiries WHERE created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City' AND(p_state='' OR state=p_state)),
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(r)-'request_id') FROM(SELECT * FROM business_enquiries WHERE created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City' AND(p_state='' OR state=p_state) ORDER BY created_at DESC,id LIMIT 25 OFFSET p_page*25)r),'[]'::jsonb));
END $$;
CREATE FUNCTION public.admin_update_business_enquiry(p_id uuid,p_version integer,p_state text,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item business_enquiries;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_state IS NULL OR p_state NOT IN('NEW','CONTACTED','CONVERTED','CLOSED') OR p_note IS NULL OR length(p_note)>1500 THEN RAISE EXCEPTION 'invalid_update';END IF;
 SELECT * INTO item FROM business_enquiries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR item.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'request_changed_refresh';END IF;
 UPDATE business_enquiries SET state=p_state,admin_note=trim(p_note),version=version+1,updated_at=clock_timestamp() WHERE id=p_id;
 INSERT INTO business_enquiry_updates(enquiry_id,actor,old_state,new_state,note)VALUES(p_id,auth.uid(),item.state,p_state,trim(p_note));
END $$;
REVOKE ALL ON FUNCTION public.submit_business_enquiry(jsonb,uuid),public.admin_business_enquiries(date,date,text,integer),public.admin_update_business_enquiry(uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_business_enquiry(jsonb,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_business_enquiries(date,date,text,integer),public.admin_update_business_enquiry(uuid,integer,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
