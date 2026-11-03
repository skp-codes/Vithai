-- Deletes every account, household and personal record, keeping the fund list, metrics and Nifty 50 seed.
-- Run with: npx wrangler d1 execute vithai --remote --file scripts/reset-accounts.sql
DELETE FROM sessions;
DELETE FROM transactions;
DELETE FROM plans;
DELETE FROM settings;
DELETE FROM household_nifty50;
DELETE FROM fund_facts WHERE source LIKE 'manual:%';
DELETE FROM meta WHERE key LIKE 'colmap:%' OR key LIKE 'tickertape:%' OR key LIKE 'tickertapeUploadedAt:%';
DELETE FROM users;
DELETE FROM households;
