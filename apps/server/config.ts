import { z } from 'zod';
const schema = z.object({
  APP_ORIGIN: z.url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  WEB_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  DATABASE_PATH: z.string().default('./data/cinema.sqlite'),
  JELLYFIN_URL: z.url().default('http://127.0.0.1:8096'),
  JELLYFIN_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('12.0.0'),
  TMDB_TOKEN: z.string().default(''),
  JELLYFIN_OWNER_USERNAME: z.string().default(''),
  JELLYFIN_OWNER_PASSWORD: z.string().default(''),
  JELLYFIN_PARTNER_USERNAME: z.string().default(''),
  JELLYFIN_PARTNER_PASSWORD: z.string().default(''),
});
export type Config = z.infer<typeof schema>;
export function getConfig(env: Record<string, unknown> = process.env): Config {
  const c = schema.parse(env);
  const origin = new URL(c.APP_ORIGIN),
    jf = new URL(c.JELLYFIN_URL);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path.');
  if (
    origin.protocol === 'http:' &&
    !['localhost', '127.0.0.1'].includes(origin.hostname) &&
    !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(origin.hostname) &&
    !origin.hostname.endsWith('.ts.net')
  )
    throw new Error('Plain HTTP must use localhost or a tailnet address.');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(jf.hostname) ||
    !['http:', 'https:'].includes(jf.protocol) ||
    jf.username ||
    jf.password ||
    jf.pathname !== '/' ||
    jf.search ||
    jf.hash
  )
    throw new Error('Native Jellyfin must use a localhost origin.');
  c.APP_ORIGIN = origin.origin;
  c.JELLYFIN_URL = jf.origin;
  return c;
}
