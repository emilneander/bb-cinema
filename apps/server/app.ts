import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Database } from 'bun:sqlite';
import { getConfig, type Config } from './config';
import { serviceSettings } from './installation';
import { createInvite, redeem, same, sessionFor, secret } from './auth';
import {
  decorate,
  saveMovie,
  wishlist,
  type LibraryItem,
  type Session,
  type User,
} from '../../packages/database';
import { itemId, language, quality } from '../../packages/sync/protocol';
import type { Room } from '../../packages/sync/room';
import { Jellyfin } from './jellyfin';
import { TMDB } from './tmdb';
import { MediaProxy } from './media';
import { syncLibraryCatalog } from './library-catalog';
import { tailscaleHealth } from './tailscale';
export type Runtime = {
  db: Database;
  config: Config;
  room: Room;
  jellyfin: Jellyfin;
  tmdb: TMDB;
  media: MediaProxy;
  errors: { at: number; message: string }[];
  streams: Map<
    string,
    {
      mode: string;
      bitrate: number;
      item: string;
      playSessionId: string;
      mediaSourceId: string;
      streamId: string;
      sessionHash: string;
    }
  >;
  broadcast: () => void;
  disconnectSession?: (hash: string) => void;
};
export function makeApp(rt: Runtime) {
  const { db, config, jellyfin, tmdb, media, room } = rt;
  const app = new Hono<{ Variables: { session: Session } }>();
  // Global budget for a private two-person service; do not trust forwarded IPs.
  const attempts: number[] = [];
  let configurationBusy = false;
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Cache-Control', 'no-store');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    await next();
  });
  app.use(
    '*',
    bodyLimit({ maxSize: 16384, onError: (c) => c.json({ error: 'Request too large.' }, 413) }),
  );
  app.use('*', async (c, next) => {
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
    if (mutation && c.req.header('origin') !== config.APP_ORIGIN)
      return c.json({ error: 'Request origin not allowed.' }, 403);
    if (c.req.path === '/api/auth/redeem') return next();
    const session = sessionFor(db, c.req.raw);
    if (!session) return c.json({ error: 'Pair this device to enter bb cinema.' }, 401);
    if (mutation && !same(c.req.header('x-csrf-token') || '', session.csrf))
      return c.json({ error: 'Session verification failed. Reload and try again.' }, 403);
    c.set('session', session);
    return next();
  });
  app.onError((err, c) => {
    if (err instanceof z.ZodError || err instanceof SyntaxError)
      return c.json({ error: 'Invalid request.' }, 400);
    // Never log exception objects, request headers, upstream URLs or response bodies.
    const message =
      /^(Add TMDB|Configure the|Jellyfin |Movie catalogue|No compatible|Both people|Choose a movie|Waiting for)/.test(
        err.message,
      ) && !/token=|api_key=|https?:\/\//i.test(err.message)
        ? err.message
        : 'The request could not be completed. Check local diagnostics and try again.';
    rt.errors.unshift({ at: Date.now(), message });
    rt.errors.splice(20);
    console.error(
      JSON.stringify({ level: 'error', event: 'request_failed', at: Date.now(), message }),
    );
    return c.json({ error: message }, 502);
  });
  app.post('/api/auth/redeem', async (c) => {
    const now = Date.now();
    while (attempts.length && attempts[0] < now - 60000) attempts.shift();
    if (attempts.length >= 8) return c.json({ error: 'Too many attempts. Wait a minute.' }, 429);
    attempts.push(now);
    const { code } = z.object({ code: z.string().min(20).max(100) }).parse(await c.req.json());
    const result = redeem(db, code.trim());
    if (!result)
      return c.json({ error: 'This invitation is invalid, expired or already used.' }, 401);
    c.header(
      'Set-Cookie',
      `cinema_session=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${config.APP_ORIGIN.startsWith('https:') ? '; Secure' : ''}`,
    );
    return c.json({ ok: true });
  });
  app.get('/api/me', (c) => {
    const s = c.get('session');
    return c.json({
      user: { id: s.id, name: s.name, language: s.language, named: s.named },
      csrf: s.csrf,
      canManage: Boolean(s.can_manage),
      needsSetup: !jellyfin.configured('owner') || !jellyfin.configured('partner'),
      users: db.query<User, []>('SELECT * FROM users ORDER BY id').all(),
    });
  });
  app.get('/api/profiles', (c) =>
    c.json({ users: db.query<User, []>('SELECT * FROM users ORDER BY id').all() }),
  );
  app.post('/api/profiles/select', async (c) => {
    const input = z
      .union([
        z.object({ profileId: z.enum(['owner', 'partner']) }),
        z.object({ name: z.string().trim().min(1).max(40) }),
      ])
      .parse(await c.req.json());
    const session = c.get('session');
    const result = db.transaction(() => {
      let profile: User | null;
      if ('profileId' in input) {
        profile = db
          .query<User, [string]>('SELECT * FROM users WHERE id=? AND named=1')
          .get(input.profileId);
      } else {
        if (db.query('SELECT id FROM users WHERE named=1 AND lower(name)=lower(?)').get(input.name))
          return null;
        profile = db.query<User, []>('SELECT * FROM users WHERE named=0 ORDER BY id LIMIT 1').get();
        if (profile)
          db.query('UPDATE users SET name=?,named=1 WHERE id=?').run(input.name, profile.id);
      }
      if (!profile) return null;
      db.query('UPDATE sessions SET user_id=?,csrf=? WHERE hash=?').run(
        profile.id,
        secret(),
        session.hash,
      );
      return profile.id;
    })();
    if (!result)
      return c.json(
        {
          error: 'Select an existing profile or use a different name. Two profiles are supported.',
        },
        409,
      );
    media.revoke(session.hash);
    rt.disconnectSession?.(session.hash);
    rt.broadcast();
    return c.json({ ok: true });
  });
  app.post('/api/logout', (c) => {
    const s = c.get('session');
    db.query('DELETE FROM sessions WHERE hash=?').run(s.hash);
    media.revoke(s.hash);
    rt.disconnectSession?.(s.hash);
    rt.broadcast();
    c.header('Set-Cookie', 'cinema_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return c.json({ ok: true });
  });
  app.patch('/api/settings', async (c) => {
    const b = z
      .object({ language, name: z.string().trim().min(1).max(40) })
      .parse(await c.req.json());
    db.query('UPDATE users SET language=?,name=?,named=1 WHERE id=?').run(
      b.language,
      b.name,
      c.get('session').id,
    );
    return c.json({ ok: true });
  });
  app.get('/api/genres', async (c) => {
    const type = z.enum(['movie', 'tv']).parse(c.req.query('mediaType') || 'movie');
    return c.json({ genres: await tmdb.genres(type, c.get('session').language) });
  });
  app.get('/api/search', async (c) => {
    const options = z
      .object({
        q: z.string().trim().max(150).default(''),
        mediaType: z.enum(['movie', 'tv']).default('movie'),
        genre: z.coerce.number().int().positive().optional(),
        year: z.coerce.number().int().min(1800).max(2100).optional(),
        sort: z.enum(['popular', 'rated', 'recent']).default('popular'),
        page: z.coerce.number().int().min(1).max(500).default(1),
      })
      .parse(c.req.query());
    const result = await tmdb.browse(options, c.get('session').language);
    return c.json({ ...result, results: result.results.map((m) => decorate(db, m)) });
  });
  app.get('/api/movies/:id/similar', async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param('id'));
    const type = z.enum(['movie', 'tv']).parse(c.req.query('mediaType') || 'movie');
    const results = await tmdb.similar(id, c.get('session').language, type);
    return c.json({ results: results.map((m) => decorate(db, m)) });
  });
  app.get('/api/movies/:id', async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param('id'));
    return c.json(
      decorate(
        db,
        await tmdb.movie(
          id,
          c.get('session').language,
          z.enum(['movie', 'tv']).parse(c.req.query('mediaType') || 'movie'),
        ),
      ),
    );
  });
  app.get('/api/wishlist', (c) => c.json({ items: wishlist(db) }));
  app.post('/api/wishlist', async (c) => {
    const { tmdbId, mediaType } = z
      .object({
        tmdbId: z.number().int().positive(),
        mediaType: z.enum(['movie', 'tv']).default('movie'),
      })
      .parse(await c.req.json());
    const m = await tmdb.movie(tmdbId, c.get('session').language, mediaType);
    db.transaction(() => {
      saveMovie(db, { ...m, mediaType });
      db.query(
        'INSERT OR IGNORE INTO wishlist(tmdb_id,media_type,added_by,added_at) VALUES(?,?,?,?)',
      ).run(tmdbId, mediaType, c.get('session').id, Date.now());
    })();
    return c.json(decorate(db, m));
  });
  app.delete('/api/wishlist/:id', (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param('id'));
    db.query('DELETE FROM preferences WHERE tmdb_id=? AND media_type=?').run(
      id,
      z.enum(['movie', 'tv']).parse(c.req.query('mediaType') || 'movie'),
    );
    db.query('DELETE FROM wishlist WHERE tmdb_id=? AND media_type=?').run(
      id,
      z.enum(['movie', 'tv']).parse(c.req.query('mediaType') || 'movie'),
    );
    return c.json({ ok: true });
  });
  app.post('/api/preferences', async (c) => {
    const b = z
      .object({ tmdbId: z.number().int().positive(), vote: z.enum(['love', 'maybe', 'no']) })
      .parse(await c.req.json());
    if (
      !db.query("SELECT tmdb_id FROM wishlist WHERE tmdb_id=? AND media_type='movie'").get(b.tmdbId)
    )
      return c.json({ error: 'Add this movie to your wishlist first.' }, 400);
    db.query(
      'INSERT INTO preferences(user_id,tmdb_id,vote) VALUES(?,?,?) ON CONFLICT(user_id,tmdb_id,media_type) DO UPDATE SET vote=excluded.vote',
    ).run(c.get('session').id, b.tmdbId, b.vote);
    return c.json({ ok: true });
  });
  app.get('/api/library', (c) =>
    c.json({
      items: db
        .query<LibraryItem & { metadata: string | null; catalog_metadata: string | null }, []>(
          'SELECT l.*,d.metadata,c.metadata AS catalog_metadata,p.position_ms,p.updated_at AS progress_updated_at,a.added_at FROM library l LEFT JOIN library_details d ON d.item_id=l.id LEFT JOIN library_catalog c ON c.item_id=l.id LEFT JOIN watch_progress p ON p.item_id=l.id LEFT JOIN library_added a ON a.item_id=l.id WHERE available=1 ORDER BY title',
        )
        .all()
        .map(({ metadata, catalog_metadata, ...item }) => ({
          ...item,
          ...(metadata ? JSON.parse(metadata) : {}),
          ...(catalog_metadata ? JSON.parse(catalog_metadata) : {}),
        })),
    }),
  );
  app.get('/api/library/:id/image', async (c) => {
    const id = z
      .string()
      .regex(/^[a-f0-9]{32}$/i)
      .parse(c.req.param('id'));
    const kind = z.enum(['Primary', 'Backdrop']).parse(c.req.query('kind') || 'Primary');
    const entries = db
      .query<{ id: string; metadata: string | null }, []>(
        'SELECT l.id,d.metadata FROM library l LEFT JOIN library_details d ON d.item_id=l.id WHERE available=1',
      )
      .all();
    if (
      !entries.some(
        (item) =>
          item.id === id ||
          (item.metadata &&
            [JSON.parse(item.metadata).imageId, JSON.parse(item.metadata).backdropId].includes(id)),
      )
    )
      return c.notFound();
    const result = await jellyfin.request(
      c.get('session').id,
      `/Items/${id}/Images/${kind}?maxWidth=${kind === 'Backdrop' ? 1280 : 500}&quality=85`,
    );
    return new Response(result.body, {
      headers: {
        'Content-Type': result.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });
  let syncInFlight: Promise<number> | undefined;
  const sync = () =>
    (syncInFlight ||= jellyfin
      .sync(db)
      .then(async (count) => {
        if (config.TMDB_TOKEN) {
          const result = await syncLibraryCatalog(db, tmdb);
          if (result.failed)
            console.error(
              JSON.stringify({
                level: 'warn',
                event: 'library_catalog_incomplete',
                groups: result.failed,
              }),
            );
        }
        return count;
      })
      .finally(() => {
        syncInFlight = undefined;
      }));
  app.use('/api/host/*', async (c, next) => {
    if (!c.get('session').can_manage) return c.json({ error: 'A host device is required.' }, 403);
    return next();
  });
  app.get('/api/host/config', (c) =>
    c.json({
      url: config.JELLYFIN_URL,
      version: config.JELLYFIN_VERSION,
      ownerUsername: config.JELLYFIN_OWNER_USERNAME,
      partnerUsername: config.JELLYFIN_PARTNER_USERNAME,
      tmdbConfigured: Boolean(config.TMDB_TOKEN),
    }),
  );
  app.post('/api/host/config', async (c) => {
    if (configurationBusy || room.state.playing)
      return c.json({ error: 'Pause playback before changing connections.' }, 409);
    const input = z
      .object({
        services: serviceSettings.extend({
          JELLYFIN_OWNER_PASSWORD: serviceSettings.shape.JELLYFIN_OWNER_PASSWORD.optional(),
          JELLYFIN_PARTNER_PASSWORD: serviceSettings.shape.JELLYFIN_PARTNER_PASSWORD.optional(),
          TMDB_TOKEN: z.string().max(2000).optional(),
        }),
        names: z.tuple([z.string().trim().min(1).max(40), z.string().trim().min(1).max(40)]),
      })
      .strict()
      .parse(await c.req.json());
    if (input.names[0].toLowerCase() === input.names[1].toLowerCase())
      return c.json({ error: 'Use two different profile names.' }, 400);
    configurationBusy = true;
    try {
      const services = serviceSettings.parse(
        Object.fromEntries(
          Object.keys(serviceSettings.shape).map((key) => [
            key,
            input.services[key as keyof typeof input.services] ??
              config[key as keyof typeof config],
          ]),
        ),
      );
      const next = getConfig({ ...config, ...services });
      const candidate = new Jellyfin(next);
      await candidate.health();
      const accounts = await Promise.all([candidate.login('owner'), candidate.login('partner')]);
      if (accounts[0].userId === accounts[1].userId)
        return c.json({ error: 'Use two different restricted Jellyfin accounts.' }, 400);
      if (next.TMDB_TOKEN) await new TMDB(db, next.TMDB_TOKEN).get('configuration', {}, true);
      if (syncInFlight) await syncInFlight.catch(() => {});
      if (room.state.playing)
        return c.json({ error: 'Pause playback before changing connections.' }, 409);
      // Cancel stale preparations before stopping streams tied to the old credentials.
      for (const [id, version] of preparations) preparations.set(id, version + 1);
      for (const [id, stream] of rt.streams)
        await stopStream(id as 'owner' | 'partner', stream).catch(() => {});
      for (const row of db.query<{ hash: string }, []>('SELECT hash FROM sessions').all())
        media.revoke(row.hash);
      rt.streams.clear();
      db.transaction(() => {
        db.query('INSERT OR REPLACE INTO installation VALUES(1,?)').run(JSON.stringify(services));
        input.names.forEach((name, i) =>
          db
            .query('UPDATE users SET name=?,named=1 WHERE id=?')
            .run(name, i === 0 ? 'owner' : 'partner'),
        );
      })();
      Object.assign(config, next);
      jellyfin.resetCredentials();
      tmdb.setToken(next.TMDB_TOKEN);
      room.apply('owner', { type: 'unready' });
      room.apply('partner', { type: 'unready' });
      rt.broadcast();
      return c.json({ ok: true });
    } finally {
      configurationBusy = false;
    }
  });
  app.post('/api/host/invites', (c) =>
    c.json({ code: createInvite(db, 'partner'), expiresInSeconds: 86400 }),
  );
  app.get('/api/host/devices', (c) =>
    c.json({
      devices: db
        .query(
          'SELECT s.hash AS id,u.name,s.can_manage AS canManage,s.expires_at AS expiresAt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>?',
        )
        .all(Date.now())
        .map((row) => ({
          ...(row as object),
          current: (row as { id: string }).id === c.get('session').hash,
        })),
    }),
  );
  app.delete('/api/host/devices/:id', (c) => {
    const id = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(c.req.param('id'));
    if (id === c.get('session').hash)
      return c.json({ error: 'Use Sign out to remove this device.' }, 400);
    db.query('DELETE FROM sessions WHERE hash=?').run(id);
    media.revoke(id);
    rt.disconnectSession?.(id);
    rt.broadcast();
    return c.json({ ok: true });
  });
  app.post('/api/library/sync', async (c) => {
    if (!c.get('session').can_manage)
      return c.json({ error: 'Only a host device can refresh the library.' }, 403);
    return c.json({ count: await sync() });
  });
  app.post('/api/library/match', async (c) => {
    if (!c.get('session').can_manage)
      return c.json({ error: 'Only a host device can match files.' }, 403);
    const b = z
      .object({ jellyfinItemId: itemId, tmdbId: z.number().int().positive().nullable() })
      .parse(await c.req.json());
    const result = db
      .query('UPDATE library SET manual_tmdb_id=? WHERE id=? AND available=1')
      .run(b.tmdbId, b.jellyfinItemId);
    return c.json({ ok: result.changes > 0 });
  });
  app.post('/api/library/:id/progress', async (c) => {
    const id = itemId.parse(c.req.param('id'));
    const { action } = z.object({ action: z.enum(['watched', 'reset']) }).parse(await c.req.json());
    const item = db
      .query<{ duration_ms: number }, [string]>(
        'SELECT duration_ms FROM library WHERE id=? AND available=1',
      )
      .get(id);
    if (!item) return c.json({ error: 'Movie or episode not found.' }, 404);
    if (action === 'watched' && item.duration_ms <= 0)
      return c.json({ error: 'Duration is unavailable.' }, 409);
    const position = action === 'watched' ? item.duration_ms : 0;
    db.query('INSERT OR REPLACE INTO watch_progress VALUES(?,?,?)').run(id, position, Date.now());
    if (room.state.jellyfinItemId === id) {
      room.apply(c.get('session').id, { type: 'pause' });
      room.apply(c.get('session').id, { type: 'seek', positionMs: position });
      rt.broadcast();
    }
    return c.json({ ok: true });
  });
  app.get('/api/room', (c) => c.json(room.snapshot()));
  const preparations = new Map<string, number>();
  app.post('/api/playback', async (c) => {
    if (configurationBusy)
      return c.json({ error: 'Connections are being updated. Try again shortly.' }, 409);
    const s = c.get('session');
    const b = z
      .object({
        jellyfinItemId: itemId,
        quality,
        hevc: z.boolean(),
        audio: z.number().int().min(0).max(100).optional(),
        subtitle: z.number().int().min(-1).max(100).default(-1),
      })
      .parse(await c.req.json());
    if (
      room.state.jellyfinItemId !== b.jellyfinItemId ||
      !db.query('SELECT id FROM library WHERE id=? AND available=1').get(b.jellyfinItemId)
    )
      return c.json({ error: 'Select an available movie in the room first.' }, 409);
    const generation = (preparations.get(s.id) || 0) + 1;
    preparations.set(s.id, generation);
    const p = await jellyfin.playback(
      s.id,
      b.jellyfinItemId,
      b.quality,
      b.hevc,
      b.audio,
      b.subtitle,
    );
    const stale = () =>
      preparations.get(s.id) !== generation ||
      c.req.raw.signal.aborted ||
      room.state.jellyfinItemId !== b.jellyfinItemId;
    if (stale()) {
      await stopStream(s.id, {
        item: b.jellyfinItemId,
        playSessionId: p.playSessionId,
        mediaSourceId: p.source.Id,
      }).catch(() => {});
      return c.json({ error: 'Playback selection changed. Preparing the latest selection.' }, 409);
    }
    const old = rt.streams.get(s.id);
    if (old) await stopStream(s.id, old).catch(() => {});
    if (stale()) {
      await stopStream(s.id, {
        item: b.jellyfinItemId,
        playSessionId: p.playSessionId,
        mediaSourceId: p.source.Id,
      }).catch(() => {});
      return c.json({ error: 'Playback selection changed.' }, 409);
    }
    if (old) media.revoke(old.sessionHash, old.streamId);
    const group = crypto.randomUUID();
    const url = media.register(p.stream, b.jellyfinItemId, s.hash, s.id, group);
    const subtitleUrl = p.subtitleUrl
      ? media.register(p.subtitleUrl, b.jellyfinItemId, s.hash, s.id, group)
      : undefined;
    rt.streams.set(s.id, {
      streamId: group,
      sessionHash: s.hash,
      mode: p.mode,
      bitrate: p.bitrate,
      item: b.jellyfinItemId,
      playSessionId: p.playSessionId,
      mediaSourceId: p.source.Id,
    });
    return c.json({
      streamId: group,
      url,
      subtitleUrl,
      mode: p.mode,
      bitrate: p.bitrate,
      hls: p.hls,
      tracks: (p.source.MediaStreams || []).map((track) => ({
        ...track,
        subtitleUrl:
          track.Type === 'Subtitle' &&
          ['srt', 'subrip', 'vtt', 'webvtt'].includes(track.Codec?.toLowerCase() || '')
            ? media.register(
                `/Videos/${b.jellyfinItemId}/${encodeURIComponent(p.source.Id)}/Subtitles/${track.Index}/0/Stream.vtt`,
                b.jellyfinItemId,
                s.hash,
                s.id,
                group,
              )
            : undefined,
      })),
    });
  });
  async function stopStream(
    id: 'owner' | 'partner',
    s: { item: string; playSessionId: string; mediaSourceId: string },
  ) {
    try {
      await jellyfin.request(id, '/Sessions/Playing/Stopped', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ItemId: s.item,
          PlaySessionId: s.playSessionId,
          MediaSourceId: s.mediaSourceId,
          PositionTicks: Math.round(room.state.positionMs * 10000),
        }),
      });
    } finally {
      await jellyfin.request(
        id,
        `/Videos/ActiveEncodings?DeviceId=our-cinema-${id}&PlaySessionId=${encodeURIComponent(s.playSessionId)}`,
        { method: 'DELETE' },
      );
    }
  }
  app.post('/api/playback/report', async (c) => {
    const b = z
      .object({
        streamId: z.uuid(),
        event: z.enum(['start', 'progress', 'stop']),
        positionMs: z.number().finite().min(0).max(86400000),
        paused: z.boolean(),
      })
      .parse(await c.req.json());
    const s = rt.streams.get(c.get('session').id);
    if (!s || s.streamId !== b.streamId || s.sessionHash !== c.get('session').hash)
      return c.json({ ok: true });
    if (b.event === 'stop') {
      // Detach before awaiting Jellyfin so an old stop cannot remove a replacement.
      rt.streams.delete(c.get('session').id);
      media.revoke(s.sessionHash, s.streamId);
      await stopStream(c.get('session').id, s);
    } else
      await jellyfin.request(
        c.get('session').id,
        b.event === 'start' ? '/Sessions/Playing' : '/Sessions/Playing/Progress',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ItemId: s.item,
            PlaySessionId: s.playSessionId,
            MediaSourceId: s.mediaSourceId,
            PositionTicks: Math.round(b.positionMs * 10000),
            IsPaused: b.paused,
            CanSeek: true,
            PlayMethod:
              s.mode === 'direct'
                ? 'DirectPlay'
                : s.mode === 'remux'
                  ? 'DirectStream'
                  : 'Transcode',
          }),
        },
      );
    return c.json({ ok: true });
  });
  app.on(['GET', 'HEAD'], '/api/media/:ticket', (c) =>
    media.serve(z.uuid().parse(c.req.param('ticket')), c.get('session').hash, c.req.raw),
  );
  app.get('/api/art/:size/:file', async (c) => {
    const size = z.enum(['w300', 'w342', 'w780', 'w1280']).parse(c.req.param('size'));
    const file = z
      .string()
      .regex(/^[a-zA-Z0-9]+\.(jpg|png)$/)
      .parse(c.req.param('file'));
    const r = await fetch(`https://image.tmdb.org/t/p/${size}/${file}`, {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) return c.body(null, 404);
    return new Response(r.body, {
      headers: {
        'Content-Type': r.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': r.headers.get('cache-control') || 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
  app.get(
    '/api/bitrate',
    () =>
      new Response(bitratePayload(), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Length': '8388608',
        },
      }),
  );
  app.get('/api/history', (c) =>
    c.json({
      items: db
        .query(
          "SELECT w.*,c.title FROM watch_sessions w LEFT JOIN catalog c ON c.tmdb_id=w.tmdb_id AND c.media_type='movie' ORDER BY started_at DESC LIMIT 50",
        )
        .all(),
    }),
  );
  app.get('/api/diagnostics', async (c) => {
    const [jf, tm, ts] = await Promise.allSettled([
      jellyfin.health(),
      tmdb.get('configuration'),
      tailscaleHealth(),
    ]);
    return c.json({
      jellyfin: {
        ok: jf.status === 'fulfilled',
        version: jf.status === 'fulfilled' ? jf.value : undefined,
        message:
          jf.status === 'rejected'
            ? 'Unavailable or version mismatch. Check .env and the native server.'
            : undefined,
      },
      tmdb: { ok: tm.status === 'fulfilled' },
      tailscale: {
        ...(ts.status === 'fulfilled'
          ? ts.value
          : { ok: false, status: 'Tailscale status unavailable.' }),
        https: config.APP_ORIGIN.startsWith('https:'),
      },
      room: room.snapshot(),
      streams: [...rt.streams].map(([userId, s]) => ({ userId, mode: s.mode, bitrate: s.bitrate })),
      errors: rt.errors,
    });
  });
  app.notFound((c) => c.json({ error: 'Not found.' }, 404));
  return { app, sync };
}
let payload: Uint8Array<ArrayBuffer> | undefined;
function bitratePayload() {
  if (!payload) {
    payload = new Uint8Array(8 * 1024 * 1024);
    for (let i = 0; i < payload.length; i += 65536)
      crypto.getRandomValues(payload.subarray(i, i + 65536));
  }
  return payload;
}
