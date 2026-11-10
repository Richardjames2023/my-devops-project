-- Canonicalize staff email addresses and enforce the same rule at the database boundary.
-- Fail safely if existing records would collide after normalization.

DO $$
DECLARE
  conflicts TEXT;
BEGIN
  SELECT string_agg(
    format('%s => staff IDs %s', normalized_email, staff_ids),
    '; ' ORDER BY normalized_email
  )
  INTO conflicts
  FROM (
    SELECT
      lower(regexp_replace("email", '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS normalized_email,
      string_agg("id"::text, ', ' ORDER BY "id") AS staff_ids,
      COUNT(*) AS matching_accounts
    FROM "staff_accounts"
    GROUP BY lower(regexp_replace("email", '^[[:space:]]+|[[:space:]]+$', '', 'g'))
    HAVING lower(regexp_replace("email", '^[[:space:]]+|[[:space:]]+$', '', 'g')) = ''
       OR COUNT(*) > 1
  ) duplicates;

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION
      'Staff email normalization blocked: existing staff accounts collide or normalize to blank. Resolve these records manually, then retry: %',
      conflicts;
  END IF;
END
$$;

UPDATE "staff_accounts"
SET "email" = lower(regexp_replace("email", '^[[:space:]]+|[[:space:]]+$', '', 'g'))
WHERE "email" IS DISTINCT FROM
  lower(regexp_replace("email", '^[[:space:]]+|[[:space:]]+$', '', 'g'));

-- Prisma models the unique constraint; this SQL CHECK additionally ensures
-- all writes, including direct SQL writes, store canonical email addresses.
ALTER TABLE "staff_accounts"
  ADD CONSTRAINT "staff_accounts_email_normalized_check"
  CHECK (
    "email" = lower(regexp_replace("email", '^[[:space:]]+|[[:space:]]+$', '', 'g'))
    AND "email" <> ''
  );
