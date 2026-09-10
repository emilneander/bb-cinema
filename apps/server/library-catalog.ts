import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import type { Movie } from '../../packages/shared/types';
import { saveMovie } from '../../packages/database';
import type { TMDB } from './tmdb';
const normalized = (title: string) =>
  title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export function uniqueSeriesMatch(title: string, candidates: Movie[]) {
  const matches = candidates.filter((m) =>
    [m.title, m.original_title].some((t) => t && normalized(t) === normalized(title)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
const episodeSchema = z.object({
  episode_number: z.number().int(),
  name: z.string(),
  overview: z.string().optional(),
  still_path: z.string().nullable().optional(),
});
// Enrich only explicit series/season/episode groups, never put TV IDs in the movie ID column.
export async function syncLibraryCatalog(db: Database, tmdb: TMDB) {
  const rows = db
    .query<{ id: string; metadata: string }, []>(
      'SELECT l.id,d.metadata FROM library l JOIN library_details d ON d.item_id=l.id WHERE l.available=1',
    )
    .all();
  const groups = new Map<string, { id: string; season: number; episode: number; name: string }[]>();
  for (const row of rows) {
    const m = JSON.parse(row.metadata);
    if (!m.seriesName || !Number.isInteger(m.season) || !Number.isInteger(m.episode)) continue;
    const key = m.seriesId || normalized(m.seriesName);
    groups.set(key, [
      ...(groups.get(key) || []),
      { id: row.id, name: m.seriesName, season: m.season, episode: m.episode },
    ]);
  }
  let linked = 0,
    unresolved = 0,
    failed = 0;
  for (const items of groups.values()) {
    try {
      const results = await tmdb.browse(
        { q: items[0]!.name, mediaType: 'tv', sort: 'popular', page: 1 },
        'en-US',
      );
      const match = uniqueSeriesMatch(items[0]!.name, results.results);
      if (!match) {
        unresolved++;
        continue;
      }
      const series = await tmdb.movie(match.id, 'en-US', 'tv');
      const seasons = new Map<number, z.infer<typeof episodeSchema>[]>();
      for (const season of new Set(items.map((i) => i.season))) {
        const data = z
          .object({ episodes: z.array(episodeSchema) })
          .parse(await tmdb.get(`tv/${series.id}/season/${season}`, { language: 'en-US' }));
        seasons.set(season, data.episodes);
      }
      db.transaction(() => {
        saveMovie(db, series);
        for (const item of items) {
          const episode = seasons.get(item.season)?.find((e) => e.episode_number === item.episode);
          if (!episode) continue;
          db.query('INSERT OR REPLACE INTO library_catalog VALUES(?,?,?,?,?)').run(
            item.id,
            series.id,
            'tv',
            JSON.stringify({
              seriesName: series.title,
              seriesOverview: series.overview,
              seriesGenres: series.genres?.map((g) => g.name),
              catalogTmdbId: series.id,
              catalogMediaType: 'tv',
              episodeTitle: episode.name,
              episodeOverview: episode.overview,
              stillPath: episode.still_path,
              posterPath: series.poster_path,
              backdropPath: series.backdrop_path,
              year: Number(series.release_date?.slice(0, 4)) || undefined,
            }),
            Date.now(),
          );
          linked++;
        }
      })();
    } catch {
      // Catalogue outages must not hide playable files or remove prior matches.
      failed++;
    }
  }
  return { linked, unresolved, failed };
}
