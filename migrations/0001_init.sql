-- Vithai schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  role TEXT NOT NULL DEFAULT 'member',        -- 'admin' | 'member'
  status TEXT NOT NULL DEFAULT 'pending',      -- 'active' | 'pending' | 'rejected'
  share_dashboard INTEGER NOT NULL DEFAULT 0,  -- 1 = household members can see my portfolio
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_household ON users(household_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One row per user: the Setup page (monthly total, allocation %, exclusions, ranking criteria, pinned funds)
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Purchases the user records (mutual fund / ETF units or Nifty 50 shares)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_date TEXT NOT NULL,          -- YYYY-MM-DD
  month TEXT NOT NULL,               -- YYYY-MM the purchase counts towards
  slot TEXT NOT NULL,                -- largecap | midsmall | debt | international | gold | nifty50
  asset_id TEXT NOT NULL,            -- AMFI scheme code, or NSE symbol for nifty50
  asset_name TEXT NOT NULL,
  units REAL NOT NULL,
  price REAL NOT NULL,               -- NAV / price per unit paid
  amount REAL NOT NULL,              -- units * price (+ charges if any)
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, month);

-- Fund universe + NAV-derived metrics, refreshed daily by the GitHub Action
CREATE TABLE IF NOT EXISTS schemes (
  code TEXT PRIMARY KEY,             -- AMFI scheme code
  name TEXT NOT NULL,
  amc TEXT NOT NULL,
  category TEXT NOT NULL,            -- AMFI category text
  slot TEXT NOT NULL,
  nav REAL,
  nav_date TEXT,
  metrics TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_schemes_slot ON schemes(slot);

-- Facts that can't be derived from NAVs: expense ratio, AUM, exit load, subscription status.
-- Monthly Tickertape uploads live in meta('tickertape'); priority is seed < tickertape < manual.
CREATE TABLE IF NOT EXISTS fund_facts (
  code TEXT NOT NULL,
  source TEXT NOT NULL,              -- 'seed' (researched) | 'manual' (typed in the app)
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (code, source)
);

-- Nifty 50 constituents: weight (%) and last price, shared by everyone
CREATE TABLE IF NOT EXISTS nifty50 (
  symbol TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  ltp REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
