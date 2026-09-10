import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export type { User, Session, LibraryItem, Movie } from '../shared/types';
import type { Movie } from '../shared/types';
export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  if (!db.query('SELECT id FROM migrations WHERE id=1').get())
    db.transaction(() => {
      db.exec(readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8'));
      db.query('INSERT INTO migrations VALUES(1,?)').run(Date.now());
    })();
  if (!db.query('SELECT id FROM migrations WHERE id=2').get())
    db.transaction(() => {
      db.exec(readFileSync(new URL('./migrations/002_profiles.sql', import.meta.url), 'utf8'));
      db.query('INSERT INTO migrations VALUES(2,?)').run(Date.now());
    })();
  if (!db.query('SELECT id FROM migrations WHERE id=3').get())
    db.transaction(() => {
      db.exec(
        readFileSync(new URL('./migrations/003_library_details.sql', import.meta.url), 'utf8'),
      );
      db.query('INSERT INTO migrations VALUES(3,?)').run(Date.now());
    })();
  if (!db.query('SELECT id FROM migrations WHERE id=4').get())
    db.transaction(() => {
      db.exec(
        readFileSync(new URL('./migrations/004_watch_progress.sql', import.meta.url), 'utf8'),
      );
      db.query('INSERT INTO migrations VALUES(4,?)').run(Date.now());
    })();
  if (!db.query('SELECT id FROM migrations WHERE id=5').get())
    db.transaction(() => {
      db.exec(
        readFileSync(new URL('./migrations/005_library_catalog.sql', import.meta.url), 'utf8'),
      );
      db.query('INSERT INTO migrations VALUES(5,?)').run(Date.now());
    })();
  if (!db.query('SELECT id FROM migrations WHERE id=6').get())
    db.transaction(() => {
      db.exec(
        readFileSync(new URL('./migrations/006_device_permissions.sql', import.meta.url), 'utf8'),
      );
      db.query('INSERT INTO migrations VALUES(6,?)').run(Date.now());
    })();
  db.query('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)').run('owner', '');
  db.query('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)').run('partner', '');
  return db;
}
export function saveMovie(db: Database, m: Movie) {
  db.query(
    `INSERT INTO catalog(tmdb_id,media_type,title,original_title,release_year,poster_path,backdrop_path,runtime_minutes,refreshed_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tmdb_id,media_type) DO UPDATE SET title=excluded.title,original_title=excluded.original_title,release_year=excluded.release_year,poster_path=excluded.poster_path,backdrop_path=excluded.backdrop_path,runtime_minutes=excluded.runtime_minutes,refreshed_at=excluded.refreshed_at`,
  ).run(
    m.id,
    m.mediaType || 'movie',
    m.title,
    m.original_title || null,
    Number(m.release_date?.slice(0, 4)) || null,
    m.poster_path || null,
    m.backdrop_path || null,
    m.runtime || null,
    Date.now(),
  );
}
export function decorate(db: Database, m: Movie): Movie {
  const type = m.mediaType || 'movie';
  const local =
    type === 'tv'
      ? db
          .query<{ id: string }, [number]>(
            "SELECT l.id FROM library l JOIN library_catalog c ON c.item_id=l.id JOIN library_details d ON d.item_id=l.id WHERE l.available=1 AND c.media_type='tv' AND c.tmdb_id=? ORDER BY json_extract(d.metadata,'$.season'),json_extract(d.metadata,'$.episode') LIMIT 1",
          )
          .get(m.id)
      : db
          .query<{ id: string }, [number]>(
            "SELECT l.id FROM library l LEFT JOIN library_details d ON d.item_id=l.id WHERE available=1 AND COALESCE(manual_tmdb_id,tmdb_id)=? AND json_extract(COALESCE(d.metadata,'{}'),'$.seriesName') IS NULL ORDER BY l.id LIMIT 1",
          )
          .get(m.id);
  const wish = db
    .query<{ added_by: string }, [number, string]>(
      'SELECT added_by FROM wishlist WHERE tmdb_id=? AND media_type=?',
    )
    .get(m.id, type);
  const watched =
    type === 'tv'
      ? null
      : db
          .query(
            'SELECT id FROM watch_sessions WHERE tmdb_id=? AND completed_at IS NOT NULL LIMIT 1',
          )
          .get(m.id);
  const votes =
    type === 'tv'
      ? []
      : db
          .query<{ user_id: string; vote: string }, [number]>(
            "SELECT user_id,vote FROM preferences WHERE tmdb_id=? AND media_type='movie'",
          )
          .all(m.id);
  return {
    ...m,
    jellyfinItemId: local?.id,
    addedBy: wish?.added_by,
    status: watched ? 'watched' : local ? 'available' : 'wanted',
    votes: Object.fromEntries(votes.map((v) => [v.user_id, v.vote])),
  };
}
export function wishlist(db: Database): Movie[] {
  return db
    .query<
      {
        id: number;
        mediaType: 'movie' | 'tv';
        title: string;
        original_title: string;
        release_date: string;
        poster_path: string;
        backdrop_path: string;
        runtime: number;
      },
      []
    >(
      `SELECT c.tmdb_id AS id,c.media_type AS mediaType,c.title,c.original_title,CAST(c.release_year AS TEXT) AS release_date,c.poster_path,c.backdrop_path,c.runtime_minutes AS runtime FROM wishlist w JOIN catalog c USING(tmdb_id,media_type) ORDER BY w.added_at DESC`,
    )
    .all()
    .map((m) => decorate(db, m));
}
