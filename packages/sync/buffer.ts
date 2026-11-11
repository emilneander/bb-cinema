/** Seconds of contiguous media buffered from `position` onwards. */
export function bufferedAhead(
  buffered: Pick<TimeRanges, 'length' | 'start' | 'end'>,
  position: number,
): number {
  for (let i = 0; i < buffered.length; i++) {
    // Tolerate the small gaps players leave at segment boundaries.
    if (buffered.start(i) <= position + 0.25 && buffered.end(i) > position)
      return buffered.end(i) - position;
  }
  return 0;
}
/** Require a contiguous cushion after a stall, including a short final segment. */
export function hasRecoveryBuffer(
  buffered: Pick<TimeRanges, 'length' | 'start' | 'end'>,
  position: number,
  duration: number,
  seconds = 6,
): boolean {
  const remaining = Number.isFinite(duration) ? Math.max(0, duration - position) : Infinity;
  const required = Math.min(seconds, remaining);
  // HLS buffers often begin a few hundredths after the playhead (e.g. 0.02 at
  // the start); bufferedAhead tolerates that, a strict start <= position never would.
  const ahead = bufferedAhead(buffered, position);
  return ahead > 0 && ahead >= required - 0.05;
}
/**
 * How far ahead the HLS.js player may download. A long cushion lets a slow or
 * unstable long-distance link catch up between stalls; the byte budget keeps
 * high bitrates within what Safari/iPad media buffers accept.
 */
export function forwardBufferSeconds(bitrate: number): number {
  const budgetBits = 150_000_000 * 8;
  return Math.round(Math.max(60, Math.min(600, budgetBits / Math.max(1, bitrate))));
}
/**
 * Cushion required before (re)starting playback. Players that decide their own
 * read-ahead (native Safari HLS, progressive files) keep the short default; with
 * a deep HLS.js buffer each repeated stall waits longer, so a link that cannot
 * keep up pauses rarely instead of every few seconds.
 */
export function playbackCushion(stalls: number, forwardSeconds?: number): number {
  if (!forwardSeconds) return 6;
  const wanted = stalls <= 1 ? 30 : stalls === 2 ? 60 : 120;
  return Math.min(wanted, Math.floor(forwardSeconds * 0.8));
}
