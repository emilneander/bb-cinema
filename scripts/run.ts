import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getConfig } from '../apps/server/config';
import { supervise } from '../packages/runtime/supervisor';
const config = getConfig();
const mode = process.argv[2] === 'start' ? 'start' : 'dev';
process.env.NODE_ENV = mode === 'start' ? 'production' : 'development';
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());
const lock = join(dirname(resolve(config.DATABASE_PATH)), 'application.lock');
mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
let ownsLock = false;
try {
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    const pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error(
        'Invalid startup lock. Check that cinema is stopped before removing data/application.lock.',
      );
    let active = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') active = false;
    }
    if (active)
      throw new Error('Cinema is already running. Stop that instance before starting another.');
    rmSync(lock, { recursive: true });
    mkdirSync(lock, { mode: 0o700 });
  }
  ownsLock = true;
  writeFileSync(join(lock, 'pid'), String(process.pid), { mode: 0o600 });
  for (const port of [config.PORT, config.WEB_PORT])
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () =>
        reject(
          new Error(`Port ${port} is in use. Stop the other service or choose different ports.`),
        ),
      );
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
    });
  if (config.PORT === config.WEB_PORT) throw new Error('PORT and WEB_PORT must be different.');
  process.exitCode = await supervise(
    [
      [process.execPath, 'run', '--cwd', 'apps/web', mode, '--port', String(config.WEB_PORT)],
      [process.execPath, ...(mode === 'dev' ? ['--watch'] : []), 'apps/server/index.ts'],
    ],
    controller.signal,
    {
      restart: mode === 'start',
      onRestart: () =>
        console.error(JSON.stringify({ level: 'warn', event: 'application_restarting' })),
    },
  );
  if (process.exitCode)
    console.error(
      'Cinema stopped after repeated startup failures. Check local logs before restarting.',
    );
} catch (error) {
  console.error(
    error instanceof Error && /^(Cinema|Port |PORT|Invalid startup)/.test(error.message)
      ? error.message
      : 'Cinema could not start. Check the local data directory and permissions.',
  );
  process.exitCode = 1;
} finally {
  if (ownsLock) rmSync(lock, { recursive: true, force: true });
}
