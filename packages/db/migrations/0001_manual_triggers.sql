-- Hand-written migration, run after the drizzle-kit-generated baseline.
-- Encodes two invariants from the plan that the declarative schema can't
-- express: maker-checker (§5.2) and ledger balance (§5.4).

-- A sales rep can never approve their own origination, and a credit officer
-- cannot approve an application they authored — enforced by the database,
-- not by policy.
CREATE OR REPLACE FUNCTION enforce_maker_checker() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM applications
    WHERE id = NEW.application_id
      AND owner_staff_id = NEW.decided_by
  ) THEN
    RAISE EXCEPTION 'maker-checker violation: decided_by cannot equal owner_staff_id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER application_decisions_maker_checker
  BEFORE INSERT ON application_decisions
  FOR EACH ROW EXECUTE FUNCTION enforce_maker_checker();

-- `app_user` is the role the API connects as in every environment; it must
-- exist before this migration runs (created once per database, not per
-- migration run — DO block makes this idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END
$$;

REVOKE UPDATE, DELETE ON application_decisions FROM app_user;
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;
REVOKE UPDATE, DELETE ON ledger_entries FROM app_user;
REVOKE UPDATE, DELETE ON application_events FROM app_user;

-- Every transaction_id group must balance: debits equal credits.
-- Deferred so both legs of a transfer can be inserted before it fires.
CREATE OR REPLACE FUNCTION enforce_ledger_balance() RETURNS trigger AS $$
DECLARE
  imbalance bigint;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN direction = 'D' THEN amount_kobo ELSE -amount_kobo END), 0)
  INTO imbalance
  FROM ledger_entries
  WHERE transaction_id = NEW.transaction_id;

  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'ledger imbalance for transaction %: % kobo', NEW.transaction_id, imbalance;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_must_balance
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_ledger_balance();
