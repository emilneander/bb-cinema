CREATE TABLE library_catalog (
  item_id TEXT PRIMARY KEY REFERENCES library(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
  metadata TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL
);
CREATE INDEX library_catalog_external ON library_catalog(media_type,tmdb_id);
