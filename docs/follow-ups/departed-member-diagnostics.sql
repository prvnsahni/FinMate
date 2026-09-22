-- FinMate departed-member diagnostics
-- Source of truth for sign/tolerance:
-- - Settlements sign in balance engine: backend/src/app/settlements/settlements.service.ts
--   fromId += amount, toId -= amount.
-- - Money tolerance used by debt simplifier: shared/data-models/src/lib/ledger-debt-simplifier.ts
--   considers |balance| < 0.01 as settled.
-- - App money rounding pattern is cent-based: Math.round((n + Number.EPSILON) * 100).
--   This SQL mirrors current backend behavior with integer cents (x100), not ISO exponent-per-currency.

-- Q1) Departed members with non-zero net (all-time), using the SAME settlement sign
--     and cent-level tolerance as current backend logic.
-- Non-empty result means identity-change preconditions should block those members.
WITH expense_paid AS (
  -- Authoritative payer rows when expense_payments exist
  SELECT
    e.group_id,
    ep.paid_by_group_member_id AS group_member_id,
    e.currency,
    SUM(
      CASE
        WHEN e.transaction_type = 'refund' THEN -ep.amount
        ELSE ep.amount
      END
    ) AS delta
  FROM expense_payments ep
  JOIN expenses e ON e.id = ep.expense_id
  WHERE ep.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND e.status = 'posted'
    AND ep.paid_by_group_member_id IS NOT NULL
  GROUP BY e.group_id, ep.paid_by_group_member_id, e.currency

  UNION ALL

  -- Legacy/single-payer fallback when no active payment rows exist
  SELECT
    e.group_id,
    e.paid_by_group_member_id AS group_member_id,
    e.currency,
    SUM(
      CASE
        WHEN e.transaction_type = 'refund' THEN -e.amount_total
        ELSE e.amount_total
      END
    ) AS delta
  FROM expenses e
  WHERE e.deleted_at IS NULL
    AND e.status = 'posted'
    AND e.paid_by_group_member_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM expense_payments ep
      WHERE ep.expense_id = e.id
        AND ep.deleted_at IS NULL
    )
  GROUP BY e.group_id, e.paid_by_group_member_id, e.currency
),
split_owed AS (
  SELECT
    e.group_id,
    es.participant_group_member_id AS group_member_id,
    e.currency,
    SUM(
      CASE
        WHEN e.transaction_type = 'refund' THEN es.amount_owed
        ELSE -es.amount_owed
      END
    ) AS delta
  FROM expense_splits es
  JOIN expenses e ON e.id = es.expense_id
  WHERE es.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND e.status = 'posted'
    AND es.participant_group_member_id IS NOT NULL
  GROUP BY e.group_id, es.participant_group_member_id, e.currency
),
settlement_delta AS (
  -- from_group_member_id INCREASES net balance
  SELECT
    s.group_id,
    s.from_group_member_id AS group_member_id,
    s.currency,
    SUM(s.amount) AS delta
  FROM settlements s
  WHERE s.status = 'confirmed'
    AND s.from_group_member_id IS NOT NULL
  GROUP BY s.group_id, s.from_group_member_id, s.currency

  UNION ALL

  -- to_group_member_id DECREASES net balance
  SELECT
    s.group_id,
    s.to_group_member_id AS group_member_id,
    s.currency,
    SUM(-s.amount) AS delta
  FROM settlements s
  WHERE s.status = 'confirmed'
    AND s.to_group_member_id IS NOT NULL
  GROUP BY s.group_id, s.to_group_member_id, s.currency
),
member_currency_net AS (
  SELECT group_id, group_member_id, currency, SUM(delta) AS net
  FROM (
    SELECT * FROM expense_paid
    UNION ALL
    SELECT * FROM split_owed
    UNION ALL
    SELECT * FROM settlement_delta
  ) u
  GROUP BY group_id, group_member_id, currency
)
SELECT
  n.group_id,
  gm.id AS group_member_id,
  gm.join_status,
  n.currency,
  n.net AS net_balance,
  ROUND(n.net * 100)::bigint AS net_cents
FROM member_currency_net n
JOIN group_members gm ON gm.id = n.group_member_id
WHERE gm.join_status IN ('left', 'removed')
  AND ROUND(n.net * 100)::bigint <> 0
ORDER BY n.group_id, gm.id, n.currency;

-- Q2) Departed members referenced by ACTIVE recurring templates (payer OR split participant).
-- Non-empty result means recurring templates still reference departed identities and should be paused/fixed.
SELECT
  re.group_id,
  re.id AS recurring_expense_id,
  ref.ref_type,
  ref.group_member_id,
  gm.join_status
FROM recurring_expenses re
JOIN (
  SELECT id AS recurring_expense_id, 'payer'::text AS ref_type, paid_by_group_member_id AS group_member_id
  FROM recurring_expenses
  WHERE paid_by_group_member_id IS NOT NULL

  UNION ALL

  SELECT recurring_expense_id, 'split_participant'::text AS ref_type, participant_group_member_id AS group_member_id
  FROM recurring_expense_splits
  WHERE participant_group_member_id IS NOT NULL
) ref ON ref.recurring_expense_id = re.id
JOIN group_members gm ON gm.id = ref.group_member_id
WHERE re.status = 'active'
  AND gm.join_status IN ('left', 'removed')
ORDER BY re.group_id, re.id, ref.ref_type, ref.group_member_id;

-- Q3) Departed members referenced by DRAFT expenses, emitted separately for payer and split participants.
-- Non-empty result means draft artifacts still reference departed identities and should be edited/deleted.
SELECT
  d.group_id,
  d.expense_id,
  d.expense_status,
  d.reference_type,
  d.referenced_group_member_id,
  gm.join_status
FROM (
  SELECT
    e.group_id,
    e.id AS expense_id,
    e.status AS expense_status,
    'payer'::text AS reference_type,
    e.paid_by_group_member_id AS referenced_group_member_id
  FROM expenses e
  WHERE e.status = 'draft'
    AND e.paid_by_group_member_id IS NOT NULL

  UNION ALL

  SELECT
    e.group_id,
    e.id AS expense_id,
    e.status AS expense_status,
    'split_participant'::text AS reference_type,
    es.participant_group_member_id AS referenced_group_member_id
  FROM expenses e
  JOIN expense_splits es ON es.expense_id = e.id
  WHERE e.status = 'draft'
    AND es.deleted_at IS NULL
    AND es.participant_group_member_id IS NOT NULL
) d
JOIN group_members gm ON gm.id = d.referenced_group_member_id
WHERE gm.join_status IN ('left', 'removed')
ORDER BY d.group_id, d.expense_id, d.reference_type, d.referenced_group_member_id;

-- Q4) Proposed settlements involving departed members.
-- Non-empty result means proposed settlement records still involve members no longer active/invited.
SELECT
  s.group_id,
  s.id AS settlement_id,
  s.status,
  s.from_group_member_id,
  s.to_group_member_id,
  gm_from.join_status AS from_status,
  gm_to.join_status AS to_status
FROM settlements s
LEFT JOIN group_members gm_from ON gm_from.id = s.from_group_member_id
LEFT JOIN group_members gm_to ON gm_to.id = s.to_group_member_id
WHERE s.status = 'proposed'
  AND (
    gm_from.join_status IN ('left', 'removed')
    OR gm_to.join_status IN ('left', 'removed')
  )
ORDER BY s.group_id, s.id;
