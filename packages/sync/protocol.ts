import { z } from 'zod';
export const userId = z.enum(['owner', 'partner']);
export type UserId = z.infer<typeof userId>;
export const language = z.enum(['en-US', 'sv-SE', 'zh-CN']);
export const quality = z.enum([
  'auto',
  '1080-10',
  '1080-6',
  '1080-4',
  '720-3',
  '720-1.5',
  '480-1',
  '480-0.6',
]);
export const itemId = z.string().regex(/^[a-fA-F0-9]{32}$/);
const position = z.number().finite().min(0).max(86_400_000);
export const command = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('player-error'),
    stage: z.enum(['prepare', 'media', 'hls', 'startup']),
    code: z.number().int().min(1).max(4).optional(),
  }),
  z.object({ type: z.literal('join') }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('state-request') }),
  z.object({ type: z.literal('select-media'), jellyfinItemId: itemId }),
  z.object({ type: z.literal('ended'), jellyfinItemId: itemId }),
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('unready') }),
  z.object({ type: z.literal('watch-together') }),
  z.object({ type: z.literal('leave-player') }),
  z.object({ type: z.literal('play'), override: z.boolean().optional() }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('seek'), positionMs: position }),
  z.object({ type: z.literal('buffering-started') }),
  z.object({ type: z.literal('buffering-ended') }),
  z.object({
    type: z.literal('heartbeat'),
    sentAt: z.number().finite(),
    positionMs: position.optional(),
    latencyMs: z.number().min(0).max(60000).optional(),
    driftMs: z.number().min(-86400000).max(86400000).optional(),
  }),
]);
export type Command = z.infer<typeof command>;
export const participantSchema = z.object({
  userId,
  connected: z.boolean(),
  ready: z.boolean(),
  buffering: z.boolean(),
  latencyMs: z.number(),
  driftMs: z.number(),
  lastSeen: z.number(),
});
export const roomSchema = z.object({
  roomId: z.literal('our-cinema'),
  jellyfinItemId: itemId.optional(),
  soloUserId: userId.optional(),
  playing: z.boolean(),
  autoStart: z.boolean().optional(),
  positionMs: z.number(),
  changedAtServerMs: z.number(),
  version: z.number(),
  durationMs: z.number(),
  bufferingEvents: z.number(),
  participants: z.array(participantSchema),
});
export type RoomState = z.infer<typeof roomSchema>;
export const serverMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: roomSchema }),
  z.object({ type: z.literal('pong'), sentAt: z.number(), serverMs: z.number() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export function expectedPosition(s: RoomState, now: number) {
  return Math.max(
    0,
    Math.min(
      s.durationMs || 86400000,
      s.positionMs + (s.playing ? Math.max(0, now - s.changedAtServerMs) : 0),
    ),
  );
}
export function correction(actual: number, expected: number): { seek?: number; rate: number } {
  const drift = expected - actual;
  return Math.abs(drift) >= 500
    ? { seek: expected, rate: 1 }
    : { rate: Math.abs(drift) < 80 ? 1 : drift > 0 ? 1.02 : 0.98 };
}
