-- Run this before the first application of 20261106230000_separate_staff_identity.
-- It detects legacy staff emails that would collide after trim + lowercase
-- normalization, including blank normalized addresses. It does not modify data.

DO $$
DECLARE
  conflicts TEXT;
BEGIN
  SELECT string_agg(
    format('%s => %s', normalized_email, legacy_rows),
    '; ' ORDER BY normalized_email
  )
  INTO conflicts
  FROM (
    SELECT
      lower(regexp_replace(u."email", '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS normalized_email,
      string_agg(format('%s [%s]', u."email", u."id"), ', ' ORDER BY u."id") AS legacy_rows,
      COUNT(*) AS matching_users
    FROM "users" u
    WHERE EXISTS (
      SELECT 1
      FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."roleId"
      WHERE ur."userId" = u."id"
        AND r."name" <> 'CUSTOMER'
    )
    GROUP BY lower(regexp_replace(u."email", '^[[:space:]]+|[[:space:]]+$', '', 'g'))
    HAVING lower(regexp_replace(u."email", '^[[:space:]]+|[[:space:]]+$', '', 'g')) = ''
       OR COUNT(*) > 1
  ) duplicates;

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION
      'Staff identity migration blocked: legacy staff emails collide or normalize to blank. Resolve these records manually before migrating: %',
      conflicts;
  END IF;

  RAISE NOTICE 'Staff identity email preflight passed: no normalized email collisions or blank staff emails found.';
END
$$;
