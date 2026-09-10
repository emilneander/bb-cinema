import { test, expect } from 'bun:test';
import { openDatabase, saveMovie, decorate, wishlist } from '../packages/database';
import { createInvite, redeem, sessionFor } from '../apps/server/auth';
import { safeMediaUrl, rewriteManifest } from '../apps/server/media';
import { stableVersion } from '../apps/server/jellyfin';
test('single-use invites authorize independent devices with expiring sessions', () => {
  const db = openDatabase(':memory:');
  const invite = createInvite(db, 'owner');
  const first = redeem(db, invite)!;
  expect(redeem(db, invite)).toBe(null);
  const request = (token: string) =>
    new Request('http://localhost', { headers: { cookie: `cinema_session=${token}` } });
  expect(sessionFor(db, request(first.token))?.id).toBe('owner');
  expect(db.query('SELECT hash FROM sessions WHERE hash=?').get(first.token)).toBe(null);
  const second = redeem(db, createInvite(db, 'owner'))!;
  expect(sessionFor(db, request(first.token))?.id).toBe('owner');
  expect(sessionFor(db, request(second.token))?.id).toBe('owner');
  db.query('UPDATE sessions SET expires_at=0').run();
  expect(sessionFor(db, request(second.token))).toBe(null);
  db.close();
});
test('normalized wishlist matches provider IDs, preserves manual mapping, and distinguishes watched', () => {
  const db = openDatabase(':memory:');
  saveMovie(db, { id: 76, title: 'Before Sunrise' });
  db.query('INSERT INTO wishlist(tmdb_id,added_by,added_at) VALUES(?,?,?)').run(
    76,
    'owner',
    Date.now(),
  );
  expect(wishlist(db)[0].status).toBe('wanted');
  db.query('INSERT INTO library(id,title,tmdb_id,duration_ms,scanned_at) VALUES(?,?,?,?,?)').run(
    'a'.repeat(32),
    'Before Sunrise',
    76,
    600000,
    Date.now(),
  );
  expect(wishlist(db)[0].jellyfinItemId).toBe('a'.repeat(32));
  db.query('UPDATE library SET manual_tmdb_id=77').run();
  expect(wishlist(db)[0].status).toBe('wanted');
  db.query('UPDATE library SET manual_tmdb_id=NULL').run();
  db.query('INSERT INTO watch_sessions VALUES(?,?,?,?,?)').run(
    'session',
    76,
    'a'.repeat(32),
    Date.now(),
    Date.now(),
  );
  expect(decorate(db, { id: 76, title: 'Before Sunrise' }).status).toBe('watched');
  expect(() => db.query('INSERT INTO users(id,name) VALUES(?,?)').run('third', 'Third')).toThrow();
  db.close();
});
test('media path policy rejects cross-origin and traversal URLs', () => {
  const id = 'a'.repeat(32),
    origin = 'http://127.0.0.1:8096',
    base = `${origin}/Videos/${id}/master.m3u8`;
  expect(safeMediaUrl('main.m3u8', base, id, origin)).toBe(`${origin}/Videos/${id}/main.m3u8`);
  for (const path of [
    'https://evil.test/steal',
    '//evil.test/a',
    '../../System/Info',
    '/etc/passwd',
    `/Videos/${id}/%2fetc`,
    `/Videos/${id}/%2e%2e/secret`,
  ])
    expect(() => safeMediaUrl(path, base, id, origin)).toThrow();
});
test('HLS rewrites nested playlists, encryption keys, maps and segments without exposing source URLs', () => {
  const paths: string[] = [];
  const output = rewriteManifest(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key?api_key=secret"\n#EXT-X-MAP:URI="init.mp4"\nchild.m3u8\nsegment.ts?api_key=secret\n',
    (p) => {
      paths.push(p);
      return `/api/media/resource-${paths.length}`;
    },
  );
  expect(paths).toHaveLength(4);
  expect(output).not.toContain('secret');
  expect(output).not.toContain('child.m3u8');
  expect(output).toContain('URI="/api/media/resource-1"');
});
test('only safe stable Jellyfin releases pass the floor', () => {
  for (const v of ['10.11.9', '10.10.99', '10.11.11-rc1']) expect(stableVersion(v)).toBe(false);
  for (const v of ['10.11.10', '10.11.11', '11.0.0']) expect(stableVersion(v)).toBe(true);
});

test('media URLs accept Jellyfin hyphenated IDs only for the selected item', () => {
  const origin = 'http://127.0.0.1:8096';
  const id = '1234567890abcdef1234567890abcdef';
  expect(
    safeMediaUrl('/videos/12345678-90ab-cdef-1234-567890abcdef/master.m3u8', origin, id, origin),
  ).toContain('master.m3u8');
  expect(() =>
    safeMediaUrl('/videos/22345678-90ab-cdef-1234-567890abcdef/master.m3u8', origin, id, origin),
  ).toThrow();
});
