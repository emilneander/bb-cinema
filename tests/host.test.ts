import { test, expect } from 'bun:test';
import { openDatabase } from '../packages/database';
import { createInvite, hash } from '../apps/server/auth';
import { getConfig } from '../apps/server/config';
import { installationConfig } from '../apps/server/installation';
import { makeApp, type Runtime } from '../apps/server/app';
import { Jellyfin } from '../apps/server/jellyfin';
import { TMDB } from '../apps/server/tmdb';
import { MediaProxy } from '../apps/server/media';
import { Room } from '../packages/sync/room';

function fixture() {
  const db = openDatabase(':memory:'),
    config = getConfig({}),
    jellyfin = new Jellyfin(config);
  const removed: string[] = [];
  const rt: Runtime = {
    db,
    config,
    jellyfin,
    tmdb: new TMDB(db, ''),
    media: new MediaProxy(jellyfin),
    room: new Room(),
    streams: new Map(),
    errors: [],
    broadcast: () => {},
    disconnectSession: (id) => removed.push(id),
  };
  const { app } = makeApp(rt);
  const call = (path: string, method = 'GET', body?: unknown, cookie = '', csrf = '') =>
    app.request('/api' + path, {
      method,
      headers: {
        cookie,
        origin: config.APP_ORIGIN,
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function pair(host: boolean) {
    const r = await call('/auth/redeem', 'POST', { code: createInvite(db, 'owner', host) });
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    const me = await (await call('/me', 'GET', undefined, cookie)).json();
    return { cookie, csrf: me.csrf as string };
  }
  return { db, config, rt, removed, call, pair };
}
test('host privilege survives profile switching; guest cannot acquire it by selecting owner', async () => {
  const f = fixture();
  try {
    f.db.query('UPDATE users SET name=id,named=1').run();
    const host = await f.pair(true),
      guest = await f.pair(false);
    expect((await f.call('/host/config', 'GET', undefined, guest.cookie)).status).toBe(403);
    expect((await f.call('/host/invites', 'POST', {}, host.cookie)).status).toBe(403);
    expect(
      (await f.call('/profiles/select', 'POST', { profileId: 'partner' }, host.cookie, host.csrf))
        .status,
    ).toBe(200);
    const hostMe = await (await f.call('/me', 'GET', undefined, host.cookie)).json();
    expect(hostMe.canManage).toBe(true);
    host.csrf = hostMe.csrf;
    expect(
      (await f.call('/profiles/select', 'POST', { profileId: 'owner' }, guest.cookie, guest.csrf))
        .status,
    ).toBe(200);
    const guestMe = await (await f.call('/me', 'GET', undefined, guest.cookie)).json();
    expect(guestMe.canManage).toBe(false);
    guest.csrf = guestMe.csrf;
    for (const route of ['/host/config', '/host/devices'])
      expect((await f.call(route, 'GET', undefined, guest.cookie)).status).toBe(403);
    expect(
      (
        await f.call(
          '/library/match',
          'POST',
          { jellyfinItemId: 'a'.repeat(32), tmdbId: null },
          guest.cookie,
          guest.csrf,
        )
      ).status,
    ).toBe(403);
    expect((await f.call('/host/config', 'GET', undefined, host.cookie)).status).toBe(200);
    const invite = await (
      await f.call('/host/invites', 'POST', { canManage: true }, host.cookie, host.csrf)
    ).json();
    expect(
      f.db.query('SELECT can_manage FROM invites WHERE hash=?').get(hash(invite.code)),
    ).toEqual({ can_manage: 0 });
    const guestId = hash(guest.cookie.split('=')[1]);
    expect(
      (await f.call('/host/devices/' + guestId, 'DELETE', undefined, host.cookie, host.csrf))
        .status,
    ).toBe(200);
    expect((await f.call('/me', 'GET', undefined, guest.cookie)).status).toBe(401);
    expect(f.removed).toContain(guestId);
  } finally {
    f.db.close();
  }
});
test('setup validates restricted accounts, persists configuration, and never returns secrets', async () => {
  const f = fixture();
  let admin = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith('https://api.themoviedb.org/'))
      return Response.json(
        {},
        {
          status:
            new Headers(init?.headers).get('Authorization') === 'Bearer fixture-invalid'
              ? 401
              : 200,
        },
      );
    return originalFetch(input, init);
  }) as typeof fetch;
  const jf = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === '/System/Info/Public')
        return Response.json({ Version: '12.0.0' });
      const b = (await req.json()) as { Username: string };
      return Response.json({
        AccessToken: 'fixture-token-not-for-use',
        User: {
          Id: b.Username,
          Policy: {
            IsAdministrator: admin,
            EnableContentDeletion: false,
            EnableSubtitleManagement: false,
          },
        },
      });
    },
  });
  try {
    const host = await f.pair(true);
    const body = {
      names: ['Alex', 'Sam'],
      services: {
        JELLYFIN_URL: `http://127.0.0.1:${jf.port}`,
        JELLYFIN_VERSION: '12.0.0',
        JELLYFIN_OWNER_USERNAME: 'first',
        JELLYFIN_OWNER_PASSWORD: 'fixture-first-password',
        JELLYFIN_PARTNER_USERNAME: 'second',
        JELLYFIN_PARTNER_PASSWORD: 'fixture-second-password',
        TMDB_TOKEN: '',
      },
    };
    expect((await f.call('/host/config', 'POST', body, host.cookie, host.csrf)).status).toBe(502);
    expect(f.db.query('SELECT * FROM installation').all()).toHaveLength(0);
    admin = false;
    expect((await f.call('/host/config', 'POST', body, host.cookie, host.csrf)).status).toBe(200);
    expect(installationConfig(f.db, getConfig({})).JELLYFIN_OWNER_PASSWORD).toBe(
      body.services.JELLYFIN_OWNER_PASSWORD,
    );
    const update = {
      ...body,
      services: {
        ...body.services,
        JELLYFIN_OWNER_PASSWORD: undefined,
        JELLYFIN_PARTNER_PASSWORD: undefined,
        TMDB_TOKEN: 'fixture-catalog-token' as string | undefined,
      },
    };
    expect((await f.call('/host/config', 'POST', update, host.cookie, host.csrf)).status).toBe(200);
    update.services.TMDB_TOKEN = undefined;
    expect((await f.call('/host/config', 'POST', update, host.cookie, host.csrf)).status).toBe(200);
    const kept = installationConfig(f.db, getConfig({}));
    expect(kept.JELLYFIN_OWNER_PASSWORD).toBe(body.services.JELLYFIN_OWNER_PASSWORD);
    expect(kept.JELLYFIN_PARTNER_PASSWORD).toBe(body.services.JELLYFIN_PARTNER_PASSWORD);
    expect(kept.TMDB_TOKEN).toBe('fixture-catalog-token');
    update.services.TMDB_TOKEN = 'fixture-invalid';
    expect((await f.call('/host/config', 'POST', update, host.cookie, host.csrf)).status).toBe(502);
    expect(installationConfig(f.db, getConfig({})).TMDB_TOKEN).toBe('fixture-catalog-token');
    update.services.TMDB_TOKEN = '';
    expect((await f.call('/host/config', 'POST', update, host.cookie, host.csrf)).status).toBe(200);
    expect(installationConfig(f.db, getConfig({})).TMDB_TOKEN).toBe('');
    const publicConfig = await (await f.call('/host/config', 'GET', undefined, host.cookie)).text();
    expect(publicConfig).not.toContain('password');
    expect(publicConfig).not.toContain('fixture-token');
    const me = await (await f.call('/me', 'GET', undefined, host.cookie)).json();
    expect(me.needsSetup).toBe(false);
    expect(me.users.map((u: { name: string }) => u.name)).toEqual(['Alex', 'Sam']);
  } finally {
    globalThis.fetch = originalFetch;
    jf.stop(true);
    f.db.close();
  }
});
