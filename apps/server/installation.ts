import { z } from 'zod';
import type { Database } from 'bun:sqlite';
import { getConfig, type Config } from './config';
export const serviceSettings = z
  .object({
    JELLYFIN_URL: z.string().url(),
    JELLYFIN_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
    JELLYFIN_OWNER_USERNAME: z.string().trim().min(1).max(100),
    JELLYFIN_OWNER_PASSWORD: z.string().min(1).max(1000),
    JELLYFIN_PARTNER_USERNAME: z.string().trim().min(1).max(100),
    JELLYFIN_PARTNER_PASSWORD: z.string().min(1).max(1000),
    TMDB_TOKEN: z.string().max(2000).default(''),
  })
  .strict();
export function installationConfig(db: Database, base: Config) {
  const saved = db
    .query<{ settings: string }, []>('SELECT settings FROM installation WHERE id=1')
    .get();
  return saved
    ? getConfig({ ...base, ...serviceSettings.parse(JSON.parse(saved.settings)) })
    : base;
}
