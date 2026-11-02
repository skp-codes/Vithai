-- Each household keeps its own copy of Nifty 50 weights and prices (seeded from the nifty50 defaults).
-- Tickertape datasets, column mappings and fund-fact edits are also stored per household
-- (KV keys hh:<household>:dataset:<kind>, meta keys tickertape:<household>, colmap:<household>:<kind>,
-- fund_facts source 'manual:<household>').
CREATE TABLE IF NOT EXISTS household_nifty50 (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT,
  weight REAL NOT NULL,
  ltp REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (household_id, symbol)
);
