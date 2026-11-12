-- Reviewed custom guards not expressible as Drizzle table constraints.
-- Append-only records preserve original replay data for the pilot.
CREATE FUNCTION reject_record_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Committed request outcomes and payment events are immutable'
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gate_outcome_immutable BEFORE UPDATE OR DELETE ON gate_request_outcomes
FOR EACH ROW EXECUTE FUNCTION reject_record_rewrite();
--> statement-breakpoint
CREATE TRIGGER payment_event_immutable BEFORE UPDATE OR DELETE ON payment_events
FOR EACH ROW EXECUTE FUNCTION reject_record_rewrite();
--> statement-breakpoint
CREATE FUNCTION protect_session_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.building_id, NEW.space_id, NEW.normalized_plate, NEW.vehicle_type, NEW.is_resident, NEW.check_in_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.building_id, OLD.space_id, OLD.normalized_plate, OLD.vehicle_type, OLD.is_resident, OLD.check_in_at) THEN
    RAISE EXCEPTION 'Session identity and check-in facts are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.state <> 'PARKED' AND ROW(NEW.checkout_at, NEW.duration_minutes, NEW.charge_cents)
    IS DISTINCT FROM ROW(OLD.checkout_at, OLD.duration_minutes, OLD.charge_cents) THEN
    RAISE EXCEPTION 'Checkout result is frozen' USING ERRCODE = '23514';
  END IF;
  IF (OLD.state = 'COMPLETED' AND ROW(NEW.state, NEW.completed_at) IS DISTINCT FROM ROW(OLD.state, OLD.completed_at))
    OR (OLD.state = 'AWAITING_PAYMENT' AND NEW.state = 'PARKED') THEN
    RAISE EXCEPTION 'Session lifecycle cannot move backwards' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_history_immutable BEFORE UPDATE ON parking_sessions
FOR EACH ROW EXECUTE FUNCTION protect_session_history();
--> statement-breakpoint
-- Deferred validation permits completion and its settlement in either write order
-- inside ONE transaction, but rejects an inconsistent final committed state.
CREATE FUNCTION assert_session_payments(session_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s parking_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM parking_sessions WHERE id = session_uuid;
  IF NOT FOUND THEN RETURN; END IF;
  IF s.state = 'PARKED' AND EXISTS (SELECT 1 FROM payment_events WHERE session_id = s.id) THEN
    RAISE EXCEPTION 'Accepted payment events require checkout' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_events WHERE session_id = s.id
    AND disposition = 'RECONCILIATION_REQUIRED' AND s.state <> 'COMPLETED') THEN
    RAISE EXCEPTION 'Reconciliation events require completed session' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_events WHERE session_id = s.id AND disposition = 'SETTLED'
    AND (s.state <> 'COMPLETED' OR currency <> 'EUR' OR amount_cents <> s.charge_cents)) THEN
    RAISE EXCEPTION 'Applied settlement must match completed checkout' USING ERRCODE = '23514';
  END IF;
  IF s.state = 'COMPLETED' AND s.charge_cents > 0
    AND NOT EXISTS (SELECT 1 FROM payment_events WHERE session_id = s.id AND disposition = 'SETTLED') THEN
    RAISE EXCEPTION 'Positive-charge completion requires applied settlement' USING ERRCODE = '23514';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION validate_session_payments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'parking_sessions' THEN
    PERFORM assert_session_payments(NEW.id);
  ELSE
    PERFORM assert_session_payments(NEW.session_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER session_settlement_consistency AFTER INSERT OR UPDATE ON parking_sessions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_session_payments();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_session_consistency AFTER INSERT ON payment_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_session_payments();
