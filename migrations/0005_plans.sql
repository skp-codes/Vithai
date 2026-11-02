-- A saved plan per person per month: which funds/baskets to buy and how much.
-- data = { lines: [{ id, slot, assetId, assetName, amount }], note }
CREATE TABLE IF NOT EXISTS plans (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,               -- YYYY-MM
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, month)
);
