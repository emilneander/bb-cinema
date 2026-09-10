export function recommendedQuality(mbps: number) {
  return mbps >= 9 ? '1080-6' : mbps >= 4.5 ? '720-3' : mbps >= 2.25 ? '720-1.5' : '480-1';
}
/** A bounded sample through the same authenticated route as playback. */
export async function detectQuality(signal: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 5000);
  const started = performance.now();
  let bytes = 0;
  try {
    const response = await fetch('/api/bitrate', { cache: 'no-store', signal: controller.signal });
    if (!response.ok || !response.body) return '480-1';
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (performance.now() - started >= 3000) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch {
    // A partial slow sample is useful; no data falls back conservatively.
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
  return recommendedQuality((bytes * 8) / Math.max(1, performance.now() - started) / 1000);
}
