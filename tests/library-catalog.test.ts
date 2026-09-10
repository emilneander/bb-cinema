import { test, expect } from 'bun:test';
import { openDatabase, decorate } from '../packages/database';
import { TMDB } from '../apps/server/tmdb';
import { syncLibraryCatalog, uniqueSeriesMatch } from '../apps/server/library-catalog';
test('series matching refuses ambiguous and partial titles', () => {
  expect(
    uniqueSeriesMatch('Friends', [
      { id: 1, title: 'Friends' },
      { id: 2, title: 'Friends' },
    ]),
  ).toBeUndefined();
  expect(uniqueSeriesMatch('Friends', [{ id: 1, title: 'Friends Reunion' }])).toBeUndefined();
  expect(
    uniqueSeriesMatch('Moonflower.Murders', [{ id: 1, title: 'Moonflower Murders' }])?.id,
  ).toBe(1);
});
test('series enrichment maps episode numbers, preserves files and separates TV from movie IDs', async () => {
  const db = openDatabase(':memory:');
  try {
    for (const [id, episode] of [
      ['a', 2],
      ['b', 1],
    ] as const) {
      db.query(
        'INSERT INTO library(id,title,tmdb_id,duration_ms,scanned_at) VALUES(?,?,?,?,?)',
      ).run(id, 'Show.s01e0' + episode, 42, 100000, Date.now());
      db.query('INSERT INTO library_details VALUES(?,?)').run(
        id,
        JSON.stringify({ seriesName: 'Show', seriesId: 'show', season: 1, episode }),
      );
    }
    const tmdb = new TMDB(db, 'fixture');
    tmdb.browse = async () => ({
      results: [{ id: 42, title: 'Show', mediaType: 'tv' as const }],
      page: 1,
      totalPages: 1,
      total_results: 1,
    });
    tmdb.movie = async () => ({
      id: 42,
      title: 'Show',
      mediaType: 'tv',
      poster_path: '/poster.jpg',
    });
    tmdb.get = async () => ({
      episodes: [
        { episode_number: 1, name: 'Pilot', still_path: '/pilot.jpg' },
        { episode_number: 2, name: 'Second' },
      ],
    });
    expect((await syncLibraryCatalog(db, tmdb)).linked).toBe(2);
    expect(
      JSON.parse(
        (
          db.query('SELECT metadata FROM library_catalog WHERE item_id=?').get('b') as {
            metadata: string;
          }
        ).metadata,
      ).episodeTitle,
    ).toBe('Pilot');
    expect(decorate(db, { id: 42, title: 'Show', mediaType: 'tv' }).jellyfinItemId).toBe('b');
    expect(decorate(db, { id: 42, title: 'Unrelated film', mediaType: 'movie' }).status).toBe(
      'wanted',
    );
    expect(
      (db.query('SELECT title FROM library WHERE id=?').get('b') as { title: string }).title,
    ).toBe('Show.s01e01');
    tmdb.browse = async () => {
      throw Error('Offline');
    };
    expect((await syncLibraryCatalog(db, tmdb)).failed).toBe(1);
    expect(decorate(db, { id: 42, title: 'Show', mediaType: 'tv' }).status).toBe('available');
  } finally {
    db.close();
  }
});
