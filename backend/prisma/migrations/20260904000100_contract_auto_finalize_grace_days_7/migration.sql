-- Data patch: every branch's contract auto-finalize grace period becomes 7 days
-- (operator decision 2026-09-03). Additive: only the graceDays key is rewritten.
UPDATE system_setting
SET value = jsonb_set(value::jsonb, '{graceDays}', '7', true)::text,
    updated_at = now()
WHERE key LIKE 'branch:%:contract_automation:auto_finalize';
