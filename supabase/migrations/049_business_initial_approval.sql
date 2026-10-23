-- New businesses cannot bypass location review by supplying ACTIVE during registration.
BEGIN;
CREATE OR REPLACE FUNCTION guard_business_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE admin boolean:=EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR auth.role()='service_role';
BEGIN
 IF TG_OP='INSERT' THEN
 IF NEW.lat IS NULL OR NEW.lng IS NULL OR NOT(NEW.lat BETWEEN 14 AND 33.5) OR NOT(NEW.lng BETWEEN -119 AND -86) OR length(trim(coalesce(NEW.address,'')))<8 THEN RAISE EXCEPTION 'Confirma la dirección y el pin del negocio en México';END IF;
 NEW.status='PENDING';NEW.is_open=false;
 NEW.location_verified_at=NULL;NEW.location_verified_by=NULL;
 ELSE
 IF NOT admin AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Solo PideYa puede aprobar o suspender negocios';END IF;
 IF NOT admin AND (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng OR NEW.address IS DISTINCT FROM OLD.address OR NEW.location_verified_at IS DISTINCT FROM OLD.location_verified_at OR NEW.location_verified_by IS DISTINCT FROM OLD.location_verified_by) THEN RAISE EXCEPTION 'Solicita la verificación del nuevo domicilio a PideYa antes de cambiarlo';END IF;
 IF NEW.status='ACTIVE' AND OLD.status<>'ACTIVE' AND NEW.location_verified_at IS NULL THEN RAISE EXCEPTION 'Verifica primero la ubicación en Mapa en vivo';END IF;
 END IF;RETURN NEW;
END $$;
COMMIT;
