import { z } from 'zod';
import type { Database } from 'bun:sqlite';
export const movieSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  mediaType: z.enum(['movie', 'tv']).optional(),
  original_title: z.string().optional(),
  release_date: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  overview: z.string().optional(),
  runtime: z.number().nullable().optional(),
  vote_average: z.number().optional(),
  genres: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
  credits: z
    .object({
      cast: z.array(
        z.object({ id: z.number(), name: z.string(), character: z.string().optional() }),
      ),
    })
    .optional(),
});
export class TMDB {
  constructor(
    private db: Database,
    private token: string,
  ) {}
  setToken(token: string) {
    this.token = token;
  }
  async get(path: string, params: Record<string, string> = {}, fresh = false) {
    if (!this.token)
      throw new Error('Add a TMDB token in connection settings to use the catalogue.');
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const key = url.toString();
    const cached = this.db
      .query<{ body: string }, [string, number]>(
        'SELECT body FROM metadata_cache WHERE key=? AND expires_at>?',
      )
      .get(key, Date.now());
    if (cached && !fresh) return JSON.parse(cached.body) as unknown;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
    if (!res.ok)
      throw new Error(
        `Movie catalogue unavailable (${res.status}). Check the TMDB token or connection.`,
      );
    const body = await res.text();
    const data: unknown = JSON.parse(body);
    const control = res.headers.get('cache-control') || '';
    const seconds = Number(control.match(/(?:s-maxage|max-age)=(\d+)/)?.[1] || 0);
    if (!/no-store|no-cache/.test(control) && seconds > 0) {
      this.db.query('DELETE FROM metadata_cache WHERE expires_at<?').run(Date.now());
      this.db
        .query('INSERT OR REPLACE INTO metadata_cache VALUES(?,?,?)')
        .run(key, body, Date.now() + seconds * 1000);
    }
    return data;
  }
  async genres(mediaType: 'movie' | 'tv', language: string) {
    return z
      .object({ genres: z.array(z.object({ id: z.number().int(), name: z.string() })) })
      .parse(await this.get(`genre/${mediaType}/list`, { language })).genres;
  }
  async browse(
    options: {
      q: string;
      mediaType: 'movie' | 'tv';
      genre?: number;
      year?: number;
      sort: 'popular' | 'rated' | 'recent';
      page: number;
    },
    language: string,
  ) {
    const { q, mediaType, genre, year, sort, page } = options;
    const params: Record<string, string> = { language, include_adult: 'false', page: String(page) };
    if (q) {
      params.query = q;
      if (year)
        params[mediaType === 'movie' ? 'primary_release_year' : 'first_air_date_year'] =
          String(year);
    } else {
      params.sort_by =
        sort === 'rated'
          ? 'vote_average.desc'
          : sort === 'recent'
            ? mediaType === 'movie'
              ? 'primary_release_date.desc'
              : 'first_air_date.desc'
            : 'popularity.desc';
      if (genre) params.with_genres = String(genre);
      if (year)
        params[mediaType === 'movie' ? 'primary_release_year' : 'first_air_date_year'] =
          String(year);
      if (sort !== 'popular') params['vote_count.gte'] = sort === 'rated' ? '200' : '20';
      params[mediaType === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = new Date()
        .toISOString()
        .slice(0, 10);
    }
    const data = z
      .object({
        results: z.array(z.record(z.string(), z.unknown())),
        total_pages: z.number().int(),
      })
      .parse(await this.get(`${q ? 'search' : 'discover'}/${mediaType}`, params));
    return {
      results: data.results.map((m) => this.normalize(m, mediaType)),
      page,
      totalPages: Math.min(data.total_pages, 500),
    };
  }
  private normalize(m: Record<string, unknown>, mediaType: 'movie' | 'tv') {
    return movieSchema.parse({
      ...m,
      mediaType,
      title: m.title ?? m.name,
      original_title: m.original_title ?? m.original_name,
      release_date: m.release_date ?? m.first_air_date,
    });
  }
  async search(query: string, language: string) {
    return (await this.browse({ q: query, mediaType: 'movie', sort: 'popular', page: 1 }, language))
      .results;
  }
  async similar(id: number, language: string, mediaType: 'movie' | 'tv' = 'movie') {
    const data = z
      .object({ results: z.array(z.record(z.string(), z.unknown())) })
      .parse(await this.get(`${mediaType}/${id}/similar`, { language, page: '1' }));
    const seen = new Set<number>([id]);
    return data.results
      .filter((m) => m.adult !== true)
      .map((m) => this.normalize(m, mediaType))
      .filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .slice(0, 12);
  }
  async movie(id: number, language: string, mediaType: 'movie' | 'tv' = 'movie') {
    const data = z.record(z.string(), z.unknown()).parse(
      await this.get(`${mediaType}/${id}`, {
        language,
        append_to_response: 'credits,external_ids,alternative_titles',
      }),
    );
    return this.normalize(data, mediaType);
  }
}
