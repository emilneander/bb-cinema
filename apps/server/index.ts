import type { ServerWebSocket } from 'bun';
import { getConfig } from './config';
import { installationConfig } from './installation';
import { openDatabase, type LibraryItem } from '../../packages/database';
import { command, roomSchema, expectedPosition, type UserId } from '../../packages/sync/protocol';
import { Room } from '../../packages/sync/room';
import { sessionFor, same } from './auth';
import { Jellyfin } from './jellyfin';
import { TMDB } from './tmdb';
import { MediaProxy } from './media';
import { makeApp, type Runtime } from './app';
export function startServer(config = getConfig()) {
  const db = openDatabase(config.DATABASE_PATH);
  config = installationConfig(db, config);
  const saved = db.query<{ snapshot: string }, []>('SELECT snapshot FROM room WHERE id=1').get();
  const room = new Room(saved ? roomSchema.parse(JSON.parse(saved.snapshot)) : undefined);
  const jellyfin = new Jellyfin(config);
  type SocketData = { userId: UserId; hash: string; count: number; window: number };
  const sockets = new Map<UserId, ServerWebSocket<SocketData>>();
  let stopping = false;
  const persist = () => {
    const snapshot = room.durable();
    db.query('INSERT OR REPLACE INTO room VALUES(1,?)').run(JSON.stringify(snapshot));
    if (snapshot.jellyfinItemId && snapshot.positionMs > 0) {
      const previous = db
        .query<{ position_ms: number }, [string]>(
          'SELECT position_ms FROM watch_progress WHERE item_id=?',
        )
        .get(snapshot.jellyfinItemId);
      if (!previous || Math.abs(previous.position_ms - snapshot.positionMs) > 100)
        db.query('INSERT OR REPLACE INTO watch_progress VALUES(?,?,?)').run(
          snapshot.jellyfinItemId,
          Math.round(snapshot.positionMs),
          Date.now(),
        );
    }
  };
  const broadcast = () => {
    if (stopping) return;
    const msg = JSON.stringify({ type: 'state', state: room.snapshot() });
    for (const ws of sockets.values()) ws.send(msg);
    persist();
  };
  const rt: Runtime = {
    db,
    config,
    room,
    jellyfin,
    tmdb: new TMDB(db, config.TMDB_TOKEN),
    media: new MediaProxy(jellyfin),
    errors: [],
    streams: new Map(),
    broadcast,
    disconnectSession: (hash) => {
      for (const ws of sockets.values())
        if (ws.data.hash === hash) ws.close(4003, 'Profile changed');
    },
  };
  const { app, sync } = makeApp(rt);
  function finishEpisode(finishedItem: string, viewer: UserId) {
    const next = db
      .query<LibraryItem, [string]>(
        `
              SELECT n.* FROM library n JOIN library_details nd ON nd.item_id=n.id
              JOIN library_details cd ON cd.item_id=?
              WHERE n.available=1
                AND json_extract(nd.metadata,'$.seriesId')=json_extract(cd.metadata,'$.seriesId')
                AND json_extract(nd.metadata,'$.season')=json_extract(cd.metadata,'$.season')
                AND json_extract(nd.metadata,'$.episode')>json_extract(cd.metadata,'$.episode')
              ORDER BY json_extract(nd.metadata,'$.episode') LIMIT 1
            `,
      )
      .get(finishedItem);
    const solo = room.state.soloUserId;
    room.apply(viewer, { type: 'seek', positionMs: room.state.durationMs });
    room.apply(viewer, { type: 'pause' });
    persist();
    db.query(
      'UPDATE watch_sessions SET completed_at=? WHERE jellyfin_item_id=? AND completed_at IS NULL',
    ).run(Date.now(), finishedItem);
    if (next) {
      room.select(next.id, next.duration_ms, true);
      room.state.soloUserId = solo;
    }
  }
  const server = Bun.serve<SocketData>({
    hostname: '127.0.0.1',
    port: config.PORT,
    idleTimeout: 120,
    maxRequestBodySize: 16384,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (req.headers.get('host') !== new URL(config.APP_ORIGIN).host)
        return new Response('Host not allowed', { status: 403 });
      if (url.pathname === '/ws') {
        const session = sessionFor(db, req),
          protocols =
            req.headers
              .get('sec-websocket-protocol')
              ?.split(',')
              .map((s) => s.trim()) || [];
        if (
          !session ||
          req.headers.get('origin') !== config.APP_ORIGIN ||
          protocols[0] !== 'cinema' ||
          !same(protocols[1] || '', session.csrf)
        )
          return new Response('Unauthorized', { status: 403 });
        if (
          server.upgrade(req, {
            data: { userId: session.id, hash: session.hash, count: 0, window: Date.now() },
            headers: { 'Sec-WebSocket-Protocol': 'cinema' },
          })
        )
          return;
        return new Response('Upgrade failed', { status: 400 });
      }
      if (url.pathname.startsWith('/api/')) return app.fetch(req);
      if (!['GET', 'HEAD'].includes(req.method))
        return new Response('Method not allowed', { status: 405 });
      // This front door is also the only URL exposed by Tailscale Serve.
      const target = new URL(url.pathname + url.search, `http://127.0.0.1:${config.WEB_PORT}`);
      const headers = new Headers(req.headers);
      headers.set('host', target.host);
      headers.set('accept-encoding', 'identity');
      headers.delete('cookie');
      headers.delete('authorization');
      try {
        const response = await fetch(target, {
          headers,
          method: req.method,
          signal: req.signal,
          redirect: 'manual',
        });
        const out = new Headers(response.headers);
        // Bun fetch decodes compressed bodies; never forward stale encoding/size.
        if (req.method !== 'HEAD') {
          out.delete('content-encoding');
          out.delete('content-length');
        }
        out.delete('transfer-encoding');
        out.set('Referrer-Policy', 'no-referrer');
        out.set('X-Frame-Options', 'DENY');
        out.set('X-Content-Type-Options', 'nosniff');
        out.set(
          'Content-Security-Policy',
          `default-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
        );
        return new Response(response.body, { status: response.status, headers: out });
      } catch {
        return new Response('bb cinema is starting. Try again in a moment.', { status: 503 });
      }
    },
    websocket: {
      maxPayloadLength: 4096,
      idleTimeout: 30,
      sendPings: true,
      open(ws) {
        const old = sockets.get(ws.data.userId);
        sockets.set(ws.data.userId, ws);
        old?.close(4001, 'Another tab is now controlling this seat.');
        room.connect(ws.data.userId);
        broadcast();
      },
      message(ws, raw) {
        if (sockets.get(ws.data.userId) !== ws) return;
        if (
          !db
            .query('SELECT hash FROM sessions WHERE hash=? AND expires_at>? AND user_id=?')
            .get(ws.data.hash, Date.now(), ws.data.userId)
        ) {
          ws.close(4003, 'Session expired');
          return;
        }
        if (Date.now() - ws.data.window > 1000) {
          ws.data.count = 0;
          ws.data.window = Date.now();
        }
        if (++ws.data.count > 30) {
          ws.close(4008, 'Too many messages');
          return;
        }
        try {
          const event = command.parse(JSON.parse(typeof raw === 'string' ? raw : raw.toString()));
          if (event.type === 'player-error') {
            rt.errors.unshift({
              at: Date.now(),
              message: `Player ${ws.data.userId}: ${event.stage}${event.code ? ` (code ${event.code})` : ''}`,
            });
            rt.errors.splice(20);
            return;
          }
          if (event.type === 'heartbeat') {
            room.apply(ws.data.userId, event);
            ws.send(JSON.stringify({ type: 'pong', sentAt: event.sentAt, serverMs: Date.now() }));
            return;
          }
          if (event.type === 'ended') {
            if (
              event.jellyfinItemId !== room.state.jellyfinItemId ||
              !room.state.playing ||
              !room.participant(ws.data.userId).ready ||
              (room.state.soloUserId && room.state.soloUserId !== ws.data.userId) ||
              expectedPosition(room.state, Date.now()) < room.state.durationMs - 2000
            )
              return;
            finishEpisode(event.jellyfinItemId, ws.data.userId);
            broadcast();
            return;
          }
          if (event.type === 'select-media') {
            const item = db
              .query<LibraryItem, [string]>('SELECT * FROM library WHERE id=? AND available=1')
              .get(event.jellyfinItemId);
            if (!item) throw new Error('Choose an available movie from the library.');
            persist();
            room.select(item.id, item.duration_ms);
            const progress = db
              .query<{ position_ms: number }, [string]>(
                'SELECT position_ms FROM watch_progress WHERE item_id=?',
              )
              .get(item.id);
            if (progress && progress.position_ms < item.duration_ms)
              room.apply(ws.data.userId, { type: 'seek', positionMs: progress.position_ms });
          } else if (event.type === 'leave') {
            ws.close(1000, 'Left the room');
            return;
          } else room.apply(ws.data.userId, event);
          if (event.type === 'play' || (event.type === 'ready' && room.state.playing)) {
            const item = db
              .query<LibraryItem, [string]>('SELECT * FROM library WHERE id=?')
              .get(room.state.jellyfinItemId!);
            if (
              !db
                .query(
                  'SELECT id FROM watch_sessions WHERE jellyfin_item_id=? AND completed_at IS NULL',
                )
                .get(item!.id)
            )
              db.query(
                'INSERT INTO watch_sessions(id,tmdb_id,jellyfin_item_id,started_at) VALUES(?,?,?,?)',
              ).run(
                crypto.randomUUID(),
                item!.manual_tmdb_id || item!.tmdb_id,
                item!.id,
                Date.now(),
              );
          }
          broadcast();
        } catch (e) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message:
                e instanceof Error && /^(Choose|Both|Waiting)/.test(e.message)
                  ? e.message
                  : 'Invalid room command.',
            }),
          );
        }
      },
      close(ws) {
        if (stopping) return;
        if (sockets.get(ws.data.userId) === ws) {
          sockets.delete(ws.data.userId);
          room.disconnect(ws.data.userId);
          broadcast();
        }
      },
    },
    error() {
      return new Response('Service unavailable', { status: 503 });
    },
  });
  const tick = setInterval(() => {
    for (const ws of sockets.values())
      if (
        !db
          .query('SELECT hash FROM sessions WHERE hash=? AND expires_at>? AND user_id=?')
          .get(ws.data.hash, Date.now(), ws.data.userId)
      )
        ws.close(4003, 'Session expired');
    const version = room.state.version;
    const wasPlaying = room.state.playing;
    room.tick();
    if (
      wasPlaying &&
      !room.state.playing &&
      room.state.jellyfinItemId &&
      room.state.durationMs > 0 &&
      room.state.positionMs >= room.state.durationMs
    ) {
      finishEpisode(room.state.jellyfinItemId, room.state.soloUserId || 'owner');
    }
    for (const [id, ws] of sockets)
      if (!room.participant(id).connected) ws.close(4000, 'Heartbeat timed out');
    if (
      room.state.durationMs &&
      room.state.positionMs >= room.state.durationMs &&
      room.state.jellyfinItemId
    )
      db.query(
        'UPDATE watch_sessions SET completed_at=? WHERE jellyfin_item_id=? AND completed_at IS NULL',
      ).run(Date.now(), room.state.jellyfinItemId);
    if (version !== room.state.version) broadcast();
  }, 250);
  const checkpoints = setInterval(() => {
    persist();
    rt.media.prune();
    db.query('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    db.query('DELETE FROM invites WHERE expires_at<?').run(Date.now());
  }, 5000);
  const refresh = () => {
    if (jellyfin.configured('owner'))
      void sync().catch(() => {
        rt.errors.unshift({
          at: Date.now(),
          message: 'Library refresh failed. Check the Jellyfin connection.',
        });
        rt.errors.splice(20);
      });
  };
  const libraryTimer = setInterval(refresh, 60000);
  refresh();
  console.log(
    JSON.stringify({ level: 'info', event: 'listening', host: '127.0.0.1', port: config.PORT }),
  );
  return {
    server,
    rt,
    stop: () => {
      if (stopping) return;
      stopping = true;
      clearInterval(tick);
      clearInterval(checkpoints);
      clearInterval(libraryTimer);
      persist();
      server.stop(true);
      db.close();
    },
  };
}
if (import.meta.main) {
  const instance = startServer();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      instance.stop();
      process.exit(0);
    });
}
