export async function api<T>(path: string, options: RequestInit = {}, csrf?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
  return body as T;
}
export const art = (path?: string | null, size = 'w342') =>
  path ? `/api/art/${size}/${path.replace(/^\//, '')}` : undefined;

// Only playback preparation is safe to repeat after an interrupted response.
export async function preparePlayback<T>(options: RequestInit, csrf: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30000);
    const signal = controller.signal;
    try {
      return await api<T>('/playback', { ...options, signal }, csrf);
    } catch (error) {
      options.signal?.throwIfAborted();
      const network = error instanceof TypeError || timedOut;
      if (!network) throw error;
      if (attempt === 2)
        throw new Error('The connection timed out while loading the player. Try reconnecting.');
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(options.signal?.reason);
        };
        const timer = setTimeout(
          () => {
            options.signal?.removeEventListener('abort', abort);
            resolve();
          },
          500 * (attempt + 1),
        );
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }
}
