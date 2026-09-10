/** Require a contiguous cushion after a stall, including a short final segment. */
export function hasRecoveryBuffer(
  buffered: Pick<TimeRanges, 'length' | 'start' | 'end'>,
  position: number,
  duration: number,
): boolean {
  const remaining = Number.isFinite(duration) ? Math.max(0, duration - position) : Infinity;
  const required = Math.min(6, remaining);
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= position && buffered.end(i) - position >= required - 0.05) return true;
  }
  return false;
}
