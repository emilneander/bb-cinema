ALTER TABLE users ADD COLUMN named INTEGER NOT NULL DEFAULT 0 CHECK(named IN (0,1));
-- Preserve explicitly configured names when upgrading an existing database.
UPDATE users SET named=1 WHERE length(trim(name)) > 0;
