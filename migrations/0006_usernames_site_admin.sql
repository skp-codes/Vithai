-- Sign in with a username or email (email optional), and site-admin approval of new households.
-- Email stays NOT NULL in the table: accounts without an email store a placeholder 'nomail:<id>',
-- which the app treats as "no email". (Rebuilding the users table would cascade-delete data.)

ALTER TABLE users ADD COLUMN username TEXT;
UPDATE users SET username = lower(substr(email, 1, instr(email, '@') - 1)) WHERE instr(email, '@') > 1;
UPDATE users SET username = 'user-' || substr(id, 1, 6) WHERE username IS NULL OR length(username) < 3;
UPDATE users SET username = username || '-' || substr(id, 1, 4)
  WHERE rowid NOT IN (SELECT min(rowid) FROM users GROUP BY username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Existing households stay active; new ones start 'pending' until the site admin approves them
ALTER TABLE households ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
