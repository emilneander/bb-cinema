import { test, expect } from 'bun:test';
import { openDatabase } from '../packages/database';
import { createInvite } from '../apps/server/auth';
import { getConfig } from '../apps/server/config';
import { Jellyfin } from '../apps/server/jellyfin';
import { TMDB } from '../apps/server/tmdb';
import { MediaProxy } from '../apps/server/media';
import { Room } from '../packages/sync/room';
import { makeApp, type Runtime } from '../apps/server/app';
test('HTTP boundary: paired identities, CSRF, wishlist, owner-only management, logout', async () => {
  const db = openDatabase(':memory:'),
    config = getConfig(),
    jf = new Jellyfin(config),
    tmdb = new TMDB(db, 'fixture');
  tmdb.movie = async (id, _language, mediaType = 'movie') => ({
    id,
    mediaType,
    title: mediaType === 'tv' ? 'Test Series' : 'Test Movie',
    runtime: 90,
  });
  const rt: Runtime = {
    db,
    config,
    jellyfin: jf,
    tmdb,
    media: new MediaProxy(jf),
    room: new Room(),
    errors: [],
    streams: new Map(),
    broadcast: () => {},
  };
  const { app } = makeApp(rt);
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    cookie = '',
    csrf = '',
    origin = config.APP_ORIGIN,
  ) =>
    app.request(path, {
      method,
      headers: { cookie, origin, 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: body ? JSON.stringify(body) : undefined,
    });
  expect((await call('/api/wishlist')).status).toBe(401);
  const invite = createInvite(db, 'partner');
  expect(
    (await call('/api/auth/redeem', 'POST', { code: invite }, '', '', 'http://evil.test')).status,
  ).toBe(403);
  const paired = await call('/api/auth/redeem', 'POST', { code: invite });
  expect(paired.status).toBe(200);
  expect(paired.headers.get('set-cookie')).toContain('HttpOnly');
  expect(paired.headers.get('set-cookie')).toContain('SameSite=Strict');
  const cookie = paired.headers.get('set-cookie')!.split(';')[0],
    me = (await (await call('/api/me', 'GET', undefined, cookie)).json()) as {
      csrf: string;
      users: unknown[];
    };
  expect(me.users).toHaveLength(2);
  expect((await call('/api/wishlist', 'POST', { tmdbId: 76 }, cookie)).status).toBe(403);
  expect((await call('/api/wishlist', 'POST', { tmdbId: '../../x' }, cookie, me.csrf)).status).toBe(
    400,
  );
  expect((await call('/api/wishlist', 'POST', { tmdbId: 76 }, cookie, me.csrf)).status).toBe(200);
  expect(
    ((await (await call('/api/wishlist', 'GET', undefined, cookie)).json()) as { items: unknown[] })
      .items,
  ).toHaveLength(1);
  expect(
    (
      await call(
        '/api/library/match',
        'POST',
        { jellyfinItemId: 'a'.repeat(32), tmdbId: 76 },
        cookie,
        me.csrf,
      )
    ).status,
  ).toBe(403);
  expect(
    (await call('/api/wishlist', 'POST', { tmdbId: 76, mediaType: 'tv' }, cookie, me.csrf)).status,
  ).toBe(200);
  expect(
    ((await (await call('/api/wishlist', 'GET', undefined, cookie)).json()) as { items: unknown[] })
      .items,
  ).toHaveLength(2);
  expect((await call('/api/search?page=0', 'GET', undefined, cookie)).status).toBe(400);
  expect((await call('/api/search?mediaType=person', 'GET', undefined, cookie)).status).toBe(400);
  expect((await call('/api/wishlist/76', 'DELETE', undefined, cookie, me.csrf)).status).toBe(200);
  const remaining = (
    (await (await call('/api/wishlist', 'GET', undefined, cookie)).json()) as {
      items: { mediaType: string }[];
    }
  ).items;
  expect(remaining).toHaveLength(1);
  expect(remaining[0]?.mediaType).toBe('tv');
  expect(
    (await call('/api/wishlist/76?mediaType=tv', 'DELETE', undefined, cookie, me.csrf)).status,
  ).toBe(200);

  expect((await call('/api/logout', 'POST', undefined, cookie, me.csrf)).status).toBe(200);
  expect((await call('/api/me', 'GET', undefined, cookie)).status).toBe(401);
  db.close();
});
test('real localhost media proxy preserves ranges and requires the owning session', async () => {
  const id = 'a'.repeat(32);
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      if (req.headers.get('range') === 'bytes=2-4')
        return new Response('234', {
          status: 206,
          headers: {
            'Content-Range': 'bytes 2-4/10',
            'Content-Length': '3',
            'Content-Type': 'video/mp4',
          },
        });
      return new Response('#EXTM3U\nchunk.ts?api_key=private', {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      });
    },
  });
  try {
    const jf = new Jellyfin({ ...getConfig(), JELLYFIN_URL: `http://127.0.0.1:${upstream.port}` });
    jf.login = async () => ({ token: 'test-secret', userId: 'fixture' });
    const proxy = new MediaProxy(jf);
    const route = proxy.register(`/Videos/${id}/stream.mp4`, id, 'owner-session', 'owner'),
      ticket = route.split('/').pop()!;
    expect(
      (await proxy.serve(ticket, 'partner-session', new Request('http://localhost'))).status,
    ).toBe(404);
    const response = await proxy.serve(
      ticket,
      'owner-session',
      new Request('http://localhost', { headers: { range: 'bytes=2-4' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await response.text()).toBe('234');
    const master = proxy
      .register(`/Videos/${id}/master.m3u8`, id, 'owner-session', 'owner')
      .split('/')
      .pop()!;
    const text = await (
      await proxy.serve(master, 'owner-session', new Request('http://localhost'))
    ).text();
    expect(text).toContain('/api/media/');
    expect(text).not.toContain('private');
  } finally {
    upstream.stop(true);
  }
});

test('paired devices create two named profiles, select them later, and rotate CSRF on switch', async () => {
  const db = openDatabase(':memory:'),
    config = getConfig(),
    jf = new Jellyfin(config);
  const rt: Runtime = {
    db,
    config,
    jellyfin: jf,
    tmdb: new TMDB(db, ''),
    media: new MediaProxy(jf),
    room: new Room(),
    errors: [],
    streams: new Map(),
    broadcast: () => {},
  };
  const { app } = makeApp(rt);
  const paired = await app.request('/api/auth/redeem', {
    method: 'POST',
    headers: { origin: config.APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ code: createInvite(db, 'owner') }),
  });
  const cookie = paired.headers.get('set-cookie')!.split(';')[0];
  const me = async () =>
    (await (await app.request('/api/me', { headers: { cookie } })).json()) as {
      csrf: string;
      user: { id: string; name: string };
      users: { id: string; name: string; named: number }[];
    };
  const select = async (body: unknown, csrf?: string) =>
    app.request('/api/profiles/select', {
      method: 'POST',
      headers: {
        cookie,
        origin: config.APP_ORIGIN,
        'content-type': 'application/json',
        'x-csrf-token': csrf ?? (await me()).csrf,
      },
      body: JSON.stringify(body),
    });
  expect((await me()).users.filter((u) => u.named)).toHaveLength(0);
  const oldCsrf = (await me()).csrf;
  expect((await select({ name: 'Alex' })).status).toBe(200);
  expect((await me()).user.name).toBe('Alex');
  expect((await select({ name: 'Sam' }, oldCsrf)).status).toBe(403);
  expect((await select({ name: 'Alex' })).status).toBe(409);
  expect((await select({ name: 'Sam' })).status).toBe(200);
  expect((await me()).users.filter((u) => u.named)).toHaveLength(2);
  expect((await select({ name: 'Third' })).status).toBe(409);
  expect((await select({ profileId: 'owner' })).status).toBe(200);
  expect((await me()).user.name).toBe('Alex');
  expect((await select({ profileId: 'third' })).status).toBe(400);
  db.close();
});

test('public HTTPS trial rejects anonymous data, forged origins and login bursts', async () => {
  const db = openDatabase(':memory:');
  const config = { ...getConfig(), APP_ORIGIN: 'https://cinema.example.ts.net' };
  const jf = new Jellyfin(config);
  const { app } = makeApp({
    db,
    config,
    jellyfin: jf,
    tmdb: new TMDB(db, ''),
    media: new MediaProxy(jf),
    room: new Room(),
    errors: [],
    streams: new Map(),
    broadcast() {},
  });
  try {
    for (const path of [
      '/api/me',
      '/api/library',
      '/api/diagnostics',
      '/api/bitrate',
      '/api/media/unknown',
    ])
      expect((await app.request(path)).status).toBe(401);
    const pair = (code: string, origin = config.APP_ORIGIN) =>
      app.request('/api/auth/redeem', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    const code = createInvite(db, 'owner');
    expect((await pair(code, 'https://evil.example')).status).toBe(403);
    const response = await pair(code);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('; Secure');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('cache-control')).toBe('no-store');
    for (let i = 0; i < 7; i++) expect((await pair('x'.repeat(43))).status).toBe(401);
    expect((await pair('x'.repeat(43))).status).toBe(429);
  } finally {
    db.close();
  }
});

test('shared progress edits require CSRF, persist completion/reset and update the current room', async () => {
  const db = openDatabase(':memory:'),
    config = getConfig(),
    jf = new Jellyfin(config),
    room = new Room();
  const id = 'a'.repeat(32);
  db.query('INSERT INTO library(id,title,duration_ms,scanned_at) VALUES(?,?,?,?)').run(
    id,
    'Film',
    60000,
    Date.now(),
  );
  room.select(id, 60000);
  const { app } = makeApp({
    db,
    config,
    jellyfin: jf,
    tmdb: new TMDB(db, ''),
    media: new MediaProxy(jf),
    room,
    errors: [],
    streams: new Map(),
    broadcast() {},
  });
  try {
    const paired = await app.request('/api/auth/redeem', {
      method: 'POST',
      headers: { origin: config.APP_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ code: createInvite(db, 'partner') }),
    });
    const cookie = paired.headers.get('set-cookie')!.split(';')[0];
    const me = (await (await app.request('/api/me', { headers: { cookie } })).json()) as {
      csrf: string;
    };
    const update = (action: string, csrf = me.csrf, item = id) =>
      app.request(`/api/library/${item}/progress`, {
        method: 'POST',
        headers: {
          cookie,
          origin: config.APP_ORIGIN,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });
    expect((await update('watched', '')).status).toBe(403);
    expect((await update('delete')).status).toBe(400);
    expect((await update('reset', me.csrf, 'b'.repeat(32))).status).toBe(404);
    expect((await update('watched')).status).toBe(200);
    expect(room.state.positionMs).toBe(60000);
    expect(room.state.playing).toBe(false);
    expect(
      (
        db.query('SELECT position_ms FROM watch_progress WHERE item_id=?').get(id) as {
          position_ms: number;
        }
      ).position_ms,
    ).toBe(60000);
    expect((await update('reset')).status).toBe(200);
    expect(room.state.positionMs).toBe(0);
    expect(
      (
        db.query('SELECT position_ms FROM watch_progress WHERE item_id=?').get(id) as {
          position_ms: number;
        }
      ).position_ms,
    ).toBe(0);
    expect(db.query('SELECT id FROM library WHERE id=?').get(id)).not.toBeNull();
  } finally {
    db.close();
  }
});

test('late playback reports cannot stop a replacement or another device stream', async () => {
  const db = openDatabase(':memory:');
  const config = getConfig();
  const jf = new Jellyfin(config);
  const rt: Runtime = {
    db,
    config,
    jellyfin: jf,
    tmdb: new TMDB(db, ''),
    media: new MediaProxy(jf),
    room: new Room(),
    errors: [],
    streams: new Map(),
    broadcast: () => {},
  };
  const { app } = makeApp(rt);
  const paired = await app.request('/api/auth/redeem', {
    method: 'POST',
    headers: { origin: config.APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ code: createInvite(db, 'owner') }),
  });
  const cookie = paired.headers.get('set-cookie')!.split(';')[0];
  const me = (await (await app.request('/api/me', { headers: { cookie } })).json()) as {
    csrf: string;
  };
  const session = db.query('SELECT hash FROM sessions').get() as { hash: string };
  const stream = {
    mode: 'direct',
    bitrate: 1000000,
    item: 'a'.repeat(32),
    playSessionId: 'old',
    mediaSourceId: 'source',
    streamId: crypto.randomUUID(),
    sessionHash: session.hash,
  };
  const replacement = { ...stream, streamId: crypto.randomUUID(), playSessionId: 'new' };
  const report = (streamId: string) =>
    app.request('/api/playback/report', {
      method: 'POST',
      headers: {
        cookie,
        origin: config.APP_ORIGIN,
        'x-csrf-token': me.csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ streamId, event: 'stop', positionMs: 0, paused: true }),
    });
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  jf.request = async () => {
    calls++;
    await pending;
    return new Response(null, { status: 204 });
  };
  rt.streams.set('owner', replacement);
  expect((await report(stream.streamId)).status).toBe(200);
  expect(calls).toBe(0);
  rt.streams.set('owner', { ...replacement, sessionHash: 'different-device' });
  expect((await report(replacement.streamId)).status).toBe(200);
  expect(calls).toBe(0);
  rt.streams.set('owner', stream);
  const stopping = report(stream.streamId);
  for (let i = 0; i < 100 && !calls; i++) await Bun.sleep(1);
  expect(calls).toBe(1);
  rt.streams.set('owner', replacement);
  const url = rt.media.register(
    `/Videos/${stream.item}/stream.mp4`,
    stream.item,
    session.hash,
    'owner',
    replacement.streamId,
  );
  release();
  expect((await stopping).status).toBe(200);
  expect(rt.streams.get('owner')).toBe(replacement);
  expect(
    (await rt.media.serve(url.split('/').pop()!, session.hash, new Request('http://localhost')))
      .status,
  ).toBe(204);
  db.close();
});
