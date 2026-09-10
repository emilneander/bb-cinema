import { z } from 'zod';
import type { Config } from './config';
import type { Database } from 'bun:sqlite';
import type { UserId } from '../../packages/sync/protocol';
const nullableString = z.string().nullable().optional();
export const mediaStream = z.object({
  Index: z.number(),
  Type: z.string(),
  DisplayTitle: nullableString,
  Language: nullableString,
  Codec: nullableString,
  IsExternal: z.boolean().optional(),
});
export const sourceSchema = z.object({
  Id: z.string(),
  Container: nullableString,
  SupportsDirectPlay: z.boolean().optional(),
  SupportsDirectStream: z.boolean().optional(),
  TranscodingUrl: nullableString,
  TranscodingSubProtocol: nullableString,
  Bitrate: z.number().nullable().optional(),
  MediaStreams: z.array(mediaStream).optional(),
  DefaultAudioStreamIndex: z.number().nullable().optional(),
  DefaultSubtitleStreamIndex: z.number().nullable().optional(),
  TranscodeReasons: z.array(z.string()).nullable().optional(),
});
export function stableVersion(version: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [a, b, c] = version.split('.').map(Number);
  return a > 10 || (a === 10 && (b > 11 || (b === 11 && c >= 10)));
}
type Credentials = { token: string; userId: string };
export class Jellyfin {
  private credentials = new Map<UserId, Promise<Credentials>>();
  constructor(readonly config: Config) {}
  resetCredentials() {
    this.credentials.clear();
  }
  configured(id: UserId) {
    return !!this.config[id === 'owner' ? 'JELLYFIN_OWNER_USERNAME' : 'JELLYFIN_PARTNER_USERNAME'];
  }
  private authorization(id: UserId, token?: string) {
    return `MediaBrowser Client="Our Cinema", Device="Private cinema", DeviceId="our-cinema-${id}", Version="0.1.0"${token ? `, Token="${token}"` : ''}`;
  }
  async health() {
    const r = await fetch(`${this.config.JELLYFIN_URL}/System/Info/Public`, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!r.ok) throw new Error('Jellyfin is not responding.');
    const data = z.object({ Version: z.string() }).parse(await r.json());
    if (!stableVersion(data.Version))
      throw new Error('Jellyfin must be a stable release at least 10.11.10.');
    if (data.Version !== this.config.JELLYFIN_VERSION)
      throw new Error(
        `Jellyfin ${data.Version} differs from the configured API pin ${this.config.JELLYFIN_VERSION}. Review the upgrade and update .env.`,
      );
    return data.Version;
  }
  async login(id: UserId): Promise<Credentials> {
    let promise = this.credentials.get(id);
    if (!promise) {
      promise = (async () => {
        if (!this.configured(id))
          throw new Error(`Configure the ${id} Jellyfin playback account in .env.`);
        await this.health();
        const r = await fetch(`${this.config.JELLYFIN_URL}/Users/AuthenticateByName`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: this.authorization(id) },
          body: JSON.stringify({
            Username:
              this.config[id === 'owner' ? 'JELLYFIN_OWNER_USERNAME' : 'JELLYFIN_PARTNER_USERNAME'],
            Pw: this.config[
              id === 'owner' ? 'JELLYFIN_OWNER_PASSWORD' : 'JELLYFIN_PARTNER_PASSWORD'
            ],
          }),
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
        if (!r.ok)
          throw new Error('Jellyfin sign-in failed. Check the restricted account credentials.');
        const data = z
          .object({
            AccessToken: z.string(),
            User: z.object({
              Id: z.string(),
              Policy: z.object({
                IsAdministrator: z.boolean(),
                EnableContentDeletion: z.boolean().optional(),
                EnableSubtitleManagement: z.boolean().optional(),
                EnableAllFolders: z.boolean().optional(),
              }),
            }),
          })
          .parse(await r.json());
        if (
          data.User.Policy.IsAdministrator ||
          data.User.Policy.EnableContentDeletion ||
          data.User.Policy.EnableSubtitleManagement
        )
          throw new Error(
            'Jellyfin accounts must not be administrators or permit deletion/subtitle management.',
          );
        return { token: data.AccessToken, userId: data.User.Id };
      })();
      this.credentials.set(id, promise);
    }
    try {
      return await promise;
    } catch (e) {
      this.credentials.delete(id);
      throw e;
    }
  }
  async request(id: UserId, path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const auth = await this.login(id);
    const url = new URL(path, this.config.JELLYFIN_URL);
    if (url.origin !== this.config.JELLYFIN_URL) throw new Error('Invalid Jellyfin resource.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', this.authorization(id, auth.token));
    const r = await fetch(url, {
      ...init,
      headers,
      redirect: 'error',
      signal: init.signal || AbortSignal.timeout(20000),
    });
    if (r.status === 401 && retry) {
      this.credentials.delete(id);
      await r.body?.cancel();
      return this.request(id, path, init, false);
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new Error(`Jellyfin request failed (${r.status}).`);
    }
    return r;
  }
  async sync(db: Database) {
    const auth = await this.login('owner');
    const items: {
      Id: string;
      Name: string;
      ProviderIds?: Record<string, string> | null;
      RunTimeTicks?: number | null;
      DateCreated?: string | null;
      SeriesName?: string | null;
      SeriesId?: string | null;
      ParentIndexNumber?: number | null;
      IndexNumber?: number | null;
      ProductionYear?: number | null;
      ImageTags?: Record<string, string> | null;
      BackdropImageTags?: string[] | null;
      ParentBackdropItemId?: string | null;
      SeriesPrimaryImageTag?: string | null;
    }[] = [];
    for (let start = 0; ; start += 200) {
      const r = await this.request(
        'owner',
        `/Users/${auth.userId}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Fields=ProviderIds,DateCreated&Limit=200&StartIndex=${start}`,
      );
      const page = z
        .object({
          Items: z.array(
            z.object({
              Id: z.string().transform((v) => v.replaceAll('-', '')),
              Name: z.string(),
              ProviderIds: z.record(z.string(), z.string()).nullable().optional(),
              RunTimeTicks: z.number().nullable().optional(),
              DateCreated: nullableString,
              SeriesName: nullableString,
              SeriesId: nullableString,
              ParentIndexNumber: z.number().nullable().optional(),
              IndexNumber: z.number().nullable().optional(),
              ProductionYear: z.number().nullable().optional(),
              ImageTags: z.record(z.string(), z.string()).nullable().optional(),
              BackdropImageTags: z.array(z.string()).nullable().optional(),
              ParentBackdropItemId: nullableString,
              SeriesPrimaryImageTag: nullableString,
            }),
          ),
          TotalRecordCount: z.number(),
        })
        .parse(await r.json());
      items.push(...page.Items);
      if (items.length >= page.TotalRecordCount || !page.Items.length) break;
    }
    db.transaction(() => {
      db.query('UPDATE library SET available=0').run();
      const insert = db.query(
        'INSERT INTO library(id,title,tmdb_id,duration_ms,scanned_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,tmdb_id=excluded.tmdb_id,duration_ms=excluded.duration_ms,available=1,scanned_at=excluded.scanned_at',
      );
      for (const i of items) {
        const provider = Object.entries(i.ProviderIds || {}).find(
          ([k]) => k.toLowerCase() === 'tmdb',
        )?.[1];
        insert.run(
          i.Id,
          i.Name,
          Number(provider) || null,
          Math.round((i.RunTimeTicks || 0) / 10000),
          Date.now(),
        );
        db.query('INSERT OR IGNORE INTO library_added VALUES(?,?)').run(
          i.Id,
          Date.parse(i.DateCreated || '') || Date.now(),
        );
        if (i.DateCreated && Number.isFinite(Date.parse(i.DateCreated)))
          db.query('UPDATE library_added SET added_at=? WHERE item_id=?').run(
            Date.parse(i.DateCreated),
            i.Id,
          );
        const filenameEpisode =
          i.Name.match(/^(.+?)[. _-]+s(\d{1,2})e(\d{1,3})(?:\b|[. _-])/i) ||
          i.Name.match(/^(.+?)[. _-]+s(\d{1,2})e(\d{1,3})$/i);
        const seriesName =
          i.SeriesName ||
          (filenameEpisode ? filenameEpisode[1].replaceAll('.', ' ').trim() : undefined);
        db.query('INSERT OR REPLACE INTO library_details VALUES(?,?)').run(
          i.Id,
          JSON.stringify({
            seriesName,
            seriesId: i.SeriesId || (seriesName ? `name:${seriesName.toLowerCase()}` : undefined),
            season:
              i.ParentIndexNumber ?? (filenameEpisode ? Number(filenameEpisode[2]) : undefined),
            episode: i.IndexNumber ?? (filenameEpisode ? Number(filenameEpisode[3]) : undefined),
            year: i.ProductionYear ?? undefined,
            imageId:
              i.SeriesPrimaryImageTag && i.SeriesId
                ? i.SeriesId
                : i.ImageTags?.Primary
                  ? i.Id
                  : undefined,
            backdropId: i.BackdropImageTags?.length ? i.Id : i.ParentBackdropItemId || undefined,
          }),
        );
      }
    })();
    return items.length;
  }
  async playback(
    id: UserId,
    item: string,
    choice: string,
    hevc: boolean,
    audio?: number,
    subtitle = -1,
  ) {
    const auth = await this.login(id);
    // 10.11 applies audio/subtitle indices only when MediaSourceId is explicit.
    // Discover a source first, then negotiate that exact source for this viewer.
    const available = z
      .object({ MediaSources: z.array(z.object({ Id: z.string() })) })
      .parse(
        await (await this.request(id, `/Items/${item}/PlaybackInfo?userId=${auth.userId}`)).json(),
      );
    const mediaSourceId = available.MediaSources[0]?.Id;
    if (!mediaSourceId) throw new Error('Jellyfin could not find a playable media source.');
    const bitrate =
      (
        {
          auto: 6_000_000,
          '1080-10': 10_000_000,
          '1080-6': 6_000_000,
          '1080-4': 4_000_000,
          '720-3': 3_000_000,
          '720-1.5': 1_500_000,
          '480-1': 1_000_000,
        } as Record<string, number>
      )[choice] || 6_000_000;
    const height = choice === '480-1' ? 480 : choice.startsWith('720-') ? 720 : 1080;
    const profile = {
      Name: 'Our Cinema',
      MaxStreamingBitrate: bitrate,
      MaxStaticBitrate: bitrate,
      DirectPlayProfiles: [
        {
          Container: 'mp4,m4v',
          Type: 'Video',
          VideoCodec: hevc ? 'h264,hevc' : 'h264',
          AudioCodec: 'aac,mp3',
        },
      ],
      TranscodingProfiles: [
        {
          Container: 'ts',
          Type: 'Video',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          Protocol: 'hls',
          Context: 'Streaming',
          MaxAudioChannels: '2',
          MinSegments: 2,
          SegmentLength: 4,
          BreakOnNonKeyFrames: false,
        },
      ],
      CodecProfiles: [
        {
          Type: 'Video',
          Codec: 'h264,hevc',
          Conditions: [
            {
              Condition: 'LessThanEqual',
              Property: 'Height',
              Value: String(height),
              IsRequired: true,
            },
          ],
        },
      ],
      SubtitleProfiles: [
        { Format: 'vtt', Method: 'External' },
        { Format: 'srt', Method: 'External' },
        { Format: 'ass', Method: 'Encode' },
        { Format: 'ssa', Method: 'Encode' },
        { Format: 'pgssub', Method: 'Encode' },
        { Format: 'dvdsub', Method: 'Encode' },
      ],
    };
    const response = await this.request(id, `/Items/${item}/PlaybackInfo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        UserId: auth.userId,
        MediaSourceId: mediaSourceId,
        DeviceProfile: profile,
        MaxStreamingBitrate: bitrate,
        StartTimeTicks: 0,
        AudioStreamIndex: audio,
        SubtitleStreamIndex: subtitle,
        // Safari cannot reliably switch embedded MP4 audio tracks. Let Jellyfin
        // remux an explicit audio choice rather than silently playing track one.
        EnableDirectPlay: audio === undefined,
        EnableDirectStream: true,
        EnableTranscoding: true,
        AutoOpenLiveStream: false,
      }),
    });
    const data = z
      .object({
        MediaSources: z.array(sourceSchema),
        PlaySessionId: z.string(),
        ErrorCode: nullableString,
      })
      .parse(await response.json());
    const source = data.MediaSources[0];
    if (!source || data.ErrorCode)
      throw new Error('Jellyfin could not prepare this movie for your device.');
    const audioChanged = audio !== undefined && audio !== source.DefaultAudioStreamIndex;
    const selectedSub = source.MediaStreams?.find(
      (s) => s.Index === subtitle && s.Type === 'Subtitle',
    );
    const externalSub =
      selectedSub && ['srt', 'subrip', 'vtt', 'webvtt'].includes(selectedSub.Codec || '');
    const direct = source.SupportsDirectPlay && !audioChanged && (!selectedSub || externalSub);
    const stream = direct
      ? `/Videos/${item}/stream.${source.Container || 'mp4'}?Static=true&MediaSourceId=${encodeURIComponent(source.Id)}`
      : source.TranscodingUrl;
    if (!stream)
      throw new Error(
        'No compatible stream. Enable remuxing and transcoding for this Jellyfin user.',
      );
    const subtitleUrl = externalSub
      ? `/Videos/${item}/${source.Id}/Subtitles/${subtitle}/0/Stream.vtt`
      : undefined;
    const mode = direct
      ? 'direct'
      : source.TranscodeReasons?.some((x) =>
            /VideoCodec|VideoBitrate|VideoResolution|VideoProfile|VideoLevel|VideoRange|SubtitleCodec/i.test(
              x,
            ),
          )
        ? 'transcode'
        : source.SupportsDirectStream
          ? 'remux'
          : 'transcode';
    return {
      stream,
      subtitleUrl,
      source,
      playSessionId: data.PlaySessionId,
      mode,
      bitrate,
      hls: !direct,
    };
  }
}
