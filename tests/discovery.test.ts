import { test, expect } from 'bun:test';
import { TMDB } from '../apps/server/tmdb';
import { openDatabase, saveMovie, wishlist } from '../packages/database';

test('discovery sends filters upstream and normalizes series without mixing identifiers', async () => {
  const db = openDatabase(':memory:');
  try {
    const tmdb = new TMDB(db, 'fixture');
    const calls: { path: string; params: Record<string, string> }[] = [];
    tmdb.get = async (path, params = {}) => {
      calls.push({ path, params });
      return {
        results: [
          { id: 76, name: 'A series', original_name: 'Original', first_air_date: '2020-01-01' },
        ],
        total_pages: 900,
      };
    };
    const result = await tmdb.browse(
      { q: '', mediaType: 'tv', genre: 18, year: 2020, sort: 'rated', page: 2 },
      'sv-SE',
    );
    expect(calls[0]).toMatchObject({
      path: 'discover/tv',
      params: {
        with_genres: '18',
        first_air_date_year: '2020',
        sort_by: 'vote_average.desc',
        'vote_count.gte': '200',
        page: '2',
        language: 'sv-SE',
        include_adult: 'false',
      },
    });
    expect(result.totalPages).toBe(500);
    expect(result.results[0]).toMatchObject({
      id: 76,
      title: 'A series',
      mediaType: 'tv',
      release_date: '2020-01-01',
    });
    await tmdb.browse(
      { q: 'Original', mediaType: 'tv', genre: 18, year: 2020, sort: 'rated', page: 1 },
      'zh-CN',
    );
    expect(calls[1]?.path).toBe('search/tv');
    expect(calls[1]?.params.with_genres).toBeUndefined();
    saveMovie(db, { id: 76, title: 'A movie' });
    saveMovie(db, result.results[0]!);
    db.query("INSERT INTO wishlist VALUES(76,'movie','owner',1),(76,'tv','partner',2)").run();
    db.query("INSERT INTO library VALUES('local','A movie',76,1000,NULL,1,1)").run();
    const items = wishlist(db);
    expect(items).toHaveLength(2);
    expect(items.find((m) => m.mediaType === 'tv')?.jellyfinItemId).toBeUndefined();
    expect(items.find((m) => m.mediaType === 'movie')?.jellyfinItemId).toBe('local');
  } finally {
    db.close();
  }
});

test('similar titles exclude self, duplicates and adult results and preserve series type', async () => {
  const db = openDatabase(':memory:');
  try {
    const tmdb = new TMDB(db, 'fixture');
    tmdb.get = async (path, params) => {
      expect(path).toBe('tv/12/similar');
      expect(params?.language).toBe('zh-CN');
      return {
        results: [
          { id: 12, name: 'Self' },
          { id: 13, name: 'Related' },
          { id: 13, name: 'Duplicate' },
          { id: 14, name: 'Excluded', adult: true },
        ],
      };
    };
    expect(await tmdb.similar(12, 'zh-CN', 'tv')).toEqual([
      { id: 13, title: 'Related', mediaType: 'tv' },
    ]);
    tmdb.get = async () => ({ results: [] });
    expect(await tmdb.similar(12, 'en-US')).toEqual([]);
  } finally {
    db.close();
  }
});
