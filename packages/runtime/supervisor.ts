export async function supervise(
  commands: string[][],
  signal: AbortSignal,
  options: {
    restart?: boolean;
    minDelayMs?: number;
    maxCrashes?: number;
    windowMs?: number;
    onRestart?: () => void;
  } = {},
) {
  let failures: number[] = [];
  while (!signal.aborted) {
    const children: ReturnType<typeof Bun.spawn>[] = [];
    const stop = () => {
      for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    };
    signal.addEventListener('abort', stop, { once: true });
    const started = Date.now();
    let exit = 1;
    try {
      for (const command of commands)
        children.push(Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' }));
      if (signal.aborted) stop();
      exit = await Promise.race(children.map((child) => child.exited));
    } finally {
      stop();
      const force = setTimeout(() => {
        for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
      }, 3000);
      await Promise.allSettled(children.map((child) => child.exited));
      clearTimeout(force);
      signal.removeEventListener('abort', stop);
    }
    if (signal.aborted) return 0;
    if (options.restart === false) return exit;
    const windowMs = options.windowMs ?? 60000;
    failures = failures.filter((at) => at > Date.now() - windowMs);
    if (Date.now() - started >= windowMs) failures = [];
    failures.push(Date.now());
    if (failures.length >= (options.maxCrashes ?? 6)) return 1;
    options.onRestart?.();
    const delay = Math.min(30000, (options.minDelayMs ?? 1000) * 2 ** (failures.length - 1));
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, delay);
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
  return 0;
}
