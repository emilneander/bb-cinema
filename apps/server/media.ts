import type { Jellyfin } from './jellyfin';
import type { UserId } from '../../packages/sync/protocol';
type Resource = {
  url: string;
  item: string;
  session: string;
  userId: UserId;
  expires: number;
  group: string;
};
export function safeMediaUrl(value: string, base: string, item: string, origin: string) {
  const url = new URL(value, base);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    !/^\/videos\/[a-f0-9-]+\//i.test(url.pathname) ||
    url.pathname.split('/')[2]?.replaceAll('-', '').toLowerCase() !==
      item.replaceAll('-', '').toLowerCase() ||
    /%2f|%5c|%2e|\\/i.test(url.pathname)
  )
    throw new Error('Unsafe media resource from Jellyfin.');
  url.hash = '';
  return url.toString();
}
export function rewriteManifest(text: string, register: (path: string) => string) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#'))
        return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${register(uri)}"`);
      return register(trimmed);
    })
    .join('\n');
}
export class MediaProxy {
  private resources = new Map<string, Resource>();
  private byUrl = new Map<string, string>();
  constructor(private jf: Jellyfin) {}
  register(
    url: string,
    item: string,
    session: string,
    userId: UserId,
    group: string = crypto.randomUUID(),
  ) {
    const safe = safeMediaUrl(url, this.jf.config.JELLYFIN_URL, item, this.jf.config.JELLYFIN_URL);
    const key = `${session}:${group}:${safe}`;
    const old = this.byUrl.get(key);
    if (old && this.resources.has(old)) return `/api/media/${old}`;
    if (this.resources.size > 50000) this.prune();
    if (this.resources.size > 50000)
      throw new Error('Too many stream resources. Restart the movie session.');
    const ticket = crypto.randomUUID();
    this.resources.set(ticket, {
      url: safe,
      item,
      session,
      userId,
      expires: Date.now() + 12 * 3600000,
      group,
    });
    this.byUrl.set(key, ticket);
    return `/api/media/${ticket}`;
  }
  revoke(session: string, group?: string) {
    for (const [key, r] of this.resources)
      if (r.session === session && (group === undefined || r.group === group))
        this.resources.delete(key);
    for (const [key, ticket] of this.byUrl) if (!this.resources.has(ticket)) this.byUrl.delete(key);
  }
  prune() {
    for (const [key, r] of this.resources) if (r.expires < Date.now()) this.resources.delete(key);
    for (const [key, id] of this.byUrl) if (!this.resources.has(id)) this.byUrl.delete(key);
  }
  async serve(ticket: string, session: string, req: Request) {
    const r = this.resources.get(ticket);
    if (!r || r.session !== session || r.expires < Date.now())
      return new Response('Stream expired. Reopen the lobby.', { status: 404 });
    const headers = new Headers();
    const range = req.headers.get('range');
    if (range) {
      if (!/^bytes=\d*-\d*$/.test(range)) return new Response('Invalid range', { status: 416 });
      headers.set('Range', range);
    }
    // A progressive movie response can stay open for hours. Only abort it when
    // the downstream viewer disconnects; an absolute timeout would cut playback.
    const upstream = await this.jf.request(r.userId, r.url, {
      headers,
      method: req.method,
      signal: req.signal,
    });
    const type = upstream.headers.get('content-type') || '';
    const output = new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (/mpegurl/i.test(type) || new URL(r.url).pathname.endsWith('.m3u8')) {
      output.set('Content-Type', 'application/vnd.apple.mpegurl');
      if (req.method === 'HEAD') return new Response(null, { headers: output });
      const manifest = rewriteManifest(await upstream.text(), (path) =>
        this.register(
          safeMediaUrl(path, r.url, r.item, this.jf.config.JELLYFIN_URL),
          r.item,
          r.session,
          r.userId,
          r.group,
        ),
      );
      return new Response(manifest, { headers: output });
    }
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(key);
      if (value) output.set(key, value);
    }
    return new Response(req.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: output,
    });
  }
}
