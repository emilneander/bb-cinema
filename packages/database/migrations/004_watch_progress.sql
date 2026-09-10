CREATE TABLE watch_progress (item_id TEXT PRIMARY KEY REFERENCES library(id), position_ms INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE library_added (item_id TEXT PRIMARY KEY REFERENCES library(id), added_at INTEGER NOT NULL);
INSERT INTO library_added SELECT id,scanned_at FROM library;
