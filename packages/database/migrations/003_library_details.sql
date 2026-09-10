CREATE TABLE library_details (item_id TEXT PRIMARY KEY REFERENCES library(id) ON DELETE CASCADE, metadata TEXT NOT NULL);
