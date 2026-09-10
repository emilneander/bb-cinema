// Test-only service doubles. Never imported by production entry points.
import { mkdirSync } from 'node:fs';
import { startServer } from '../apps/server';
import { getConfig } from '../apps/server/config';
import { createInvite } from '../apps/server/auth';
import { movieSchema } from '../apps/server/tmdb';
mkdirSync('test-results', { recursive: true });
const clip = '/tmp/our-cinema-synthetic.mp4',
  hlsDir = '/tmp/our-cinema-hls';
mkdirSync(hlsDir, { recursive: true });
if (!(await Bun.file(clip).exists())) {
  const ffmpeg = Bun.spawn(
    [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=24',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '90',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '48',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-y',
      clip,
    ],
    { stderr: 'inherit' },
  );
  if ((await ffmpeg.exited) !== 0)
    throw new Error('FFmpeg is required for the synthetic browser-test clip.');
}
const hls = Bun.spawn(
  [
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    clip,
    '-c',
    'copy',
    '-hls_time',
    '4',
    '-hls_playlist_type',
    'vod',
    '-hls_segment_filename',
    `${hlsDir}/segment%d.ts`,
    '-y',
    `${hlsDir}/master.m3u8`,
  ],
  { stderr: 'inherit' },
);
if ((await hls.exited) !== 0) throw new Error('Could not generate HLS test fixture.');
const id = 'a'.repeat(32),
  sourceId = 'b'.repeat(32);
const fixtureMovie = movieSchema.parse({
  id: 76,
  title: 'Before Sunrise',
  original_title: 'Before Sunrise',
  release_date: '1995-01-27',
  overview: 'Two travelers meet on a train and spend an evening exploring Vienna.',
  runtime: 101,
  vote_average: 8.0,
  genres: [{ id: 18, name: 'Drama' }],
  credits: {
    cast: [
      { id: 1, name: 'Ethan Hawke' },
      { id: 2, name: 'Julie Delpy' },
    ],
  },
});
let app: ReturnType<typeof startServer>;
const fakeJellyfin = Bun.serve({
  hostname: '127.0.0.1',
  port: 3412,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/fixtures/setup') {
      app.rt.config.JELLYFIN_OWNER_USERNAME = '';
      app.rt.config.JELLYFIN_PARTNER_USERNAME = '';
      app.rt.jellyfin.resetCredentials();
      app.rt.db.query('DELETE FROM sessions').run();
      app.rt.db.query('DELETE FROM installation').run();
      app.rt.db.query("UPDATE users SET name='',named=0").run();
      app.rt.streams.clear();
      app.rt.room.apply('owner', { type: 'pause' });
      return Response.json({ code: createInvite(app.rt.db, 'owner', true) });
    }
    if (path === '/fixtures/episodes') {
      for (const [index, key] of [id, 'e'.repeat(32), 'f'.repeat(32)].entries()) {
        app.rt.db
          .query('INSERT OR REPLACE INTO library VALUES(?,?,NULL,90000,NULL,1,?)')
          .run(key, `Episode ${index + 1}`, Date.now());
        app.rt.db.query('INSERT OR REPLACE INTO library_details VALUES(?,?)').run(
          key,
          JSON.stringify({
            seriesId: 'fixture-series',
            seriesName: 'Test series',
            season: 1,
            episode: index + 1,
          }),
        );
      }
      app.rt.room.select(id, 90000);
      app.rt.broadcast();
      return Response.json({ ok: true });
    }
    if (path === '/fixtures/near-end') {
      app.rt.room.apply('owner', { type: 'seek', positionMs: 89000 });
      app.rt.broadcast();
      return Response.json({ ok: true });
    }
    if (path === '/fixtures/invites') {
      app.rt.config.JELLYFIN_OWNER_USERNAME = 'owner';
      app.rt.config.JELLYFIN_PARTNER_USERNAME = 'partner';
      app.rt.jellyfin.resetCredentials();
      await app.rt.jellyfin.sync(app.rt.db);
      app.rt.db.query('DELETE FROM wishlist').run();
      app.rt.db.query('DELETE FROM watch_progress').run();
      app.rt.db.query("UPDATE users SET name='',named=0").run();
      app.rt.room.select(id, 90000);
      return Response.json({
        owner: createInvite(app.rt.db, 'owner', true),
        partner: createInvite(app.rt.db, 'partner'),
      });
    }
    if (path === '/System/Info/Public') return Response.json({ Version: '12.0.0' });
    if (path === '/Users/AuthenticateByName') {
      const body = (await req.json()) as { Username: string };
      return Response.json({
        AccessToken: `secret-${body.Username}`,
        User: {
          Id: body.Username === 'owner' ? '1'.repeat(32) : '2'.repeat(32),
          Policy: {
            IsAdministrator: false,
            EnableContentDeletion: false,
            EnableSubtitleManagement: false,
          },
        },
      });
    }
    if (path.endsWith('/PlaybackInfo')) {
      if (req.method === 'GET') return Response.json({ MediaSources: [{ Id: sourceId }] });
      const b = (await req.json()) as {
        MaxStreamingBitrate: number;
        MediaSourceId: string;
        EnableDirectPlay: boolean;
      };
      if (b.MediaSourceId !== sourceId)
        return new Response('Explicit source required', { status: 400 });
      const direct = b.MaxStreamingBitrate !== 4000000 && b.EnableDirectPlay;
      return Response.json({
        PlaySessionId: crypto.randomUUID().replaceAll('-', ''),
        MediaSources: [
          {
            Id: sourceId,
            Container: 'mp4',
            SupportsDirectPlay: direct,
            SupportsDirectStream: !direct,
            TranscodingUrl: `/Videos/${path.split('/')[2]}/master.m3u8?api_key=fixture-secret`,
            TranscodeReasons: [],
            MediaStreams: [
              { Index: 0, Type: 'Video', Codec: 'h264', DisplayTitle: 'H.264' },
              { Index: 1, Type: 'Audio', Codec: 'aac', DisplayTitle: 'English AAC' },
              { Index: 2, Type: 'Subtitle', Codec: 'subrip', DisplayTitle: 'English' },
              { Index: 3, Type: 'Subtitle', Codec: 'webvtt', DisplayTitle: 'Swedish' },
            ],
            DefaultAudioStreamIndex: 1,
          },
        ],
      });
    }
    if (
      path.endsWith('/Items') &&
      new URL(req.url).searchParams.get('Fields') !== 'ProviderIds,DateCreated'
    )
      return new Response('Unknown ItemFields', { status: 400 });
    if (path.endsWith('/Items'))
      return Response.json({
        Items: [
          { Id: id, Name: 'Before Sunrise', ProviderIds: { Tmdb: '76' }, RunTimeTicks: 900000000 },
        ],
        TotalRecordCount: 1,
      });
    if (path.startsWith('/Videos/') && path.endsWith('/Stream.vtt'))
      return new Response('WEBVTT\n\n00:00:00.000 --> 00:01:30.000\nSubtitle fixture\n', {
        headers: { 'Content-Type': 'text/vtt' },
      });
    if (path.startsWith('/Videos/') && (path.endsWith('.m3u8') || path.endsWith('.ts'))) {
      const filename = path.split('/').pop()!;
      if (!/^(master\.m3u8|segment\d+\.ts)$/.test(filename))
        return new Response(null, { status: 404 });
      return new Response(Bun.file(`${hlsDir}/${filename}`), {
        headers: {
          'Content-Type': filename.endsWith('m3u8')
            ? 'application/vnd.apple.mpegurl'
            : 'video/mp2t',
        },
      });
    }
    if (path.endsWith('/stream.mp4')) {
      const file = Bun.file(clip),
        range = req.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${file.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Type': 'video/mp4',
            'Content-Length': String(end - start + 1),
          },
        });
      }
      return new Response(file, {
        headers: { 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' },
      });
    }
    if (path.startsWith('/Sessions/Playing') || path === '/Videos/ActiveEncodings')
      return new Response(null, { status: 204 });
    return new Response('Fixture not found', { status: 404 });
  },
});
const next = Bun.spawn(['bun', 'run', '--cwd', 'apps/web', 'start', '--port', '3411'], {
  stdout: 'inherit',
  stderr: 'inherit',
});
app = startServer({
  ...getConfig(),
  PORT: 3410,
  WEB_PORT: 3411,
  APP_ORIGIN: 'http://localhost:3410',
  DATABASE_PATH: `/tmp/our-cinema-e2e-${process.pid}.sqlite`,
  JELLYFIN_URL: 'http://127.0.0.1:3412',
  JELLYFIN_VERSION: '12.0.0',
  JELLYFIN_OWNER_USERNAME: 'owner',
  JELLYFIN_OWNER_PASSWORD: 'test',
  JELLYFIN_PARTNER_USERNAME: 'partner',
  JELLYFIN_PARTNER_PASSWORD: 'test',
  TMDB_TOKEN: 'fixture',
});
app.rt.tmdb.movie = async (id) =>
  id === 99999 ? { ...fixtureMovie, id, title: 'Similar fixture' } : fixtureMovie;
app.rt.tmdb.similar = async () => [{ ...fixtureMovie, id: 99999, title: 'Similar fixture' }];
app.rt.tmdb.browse = async ({ q, page, mediaType }) => ({
  results: q && !/before|sunrise/i.test(q) ? [] : [{ ...fixtureMovie, mediaType }],
  page,
  totalPages: 1,
});
app.rt.tmdb.genres = async () => [{ id: 18, name: 'Drama' }];
app.rt.tmdb.get = async () => ({});
function stop() {
  app.stop();
  fakeJellyfin.stop(true);
  next.kill();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
