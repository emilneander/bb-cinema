import { getConfig } from '../apps/server/config';

// Check is read-only. Only the explicit start command enables public access.
const action = process.argv[2] ?? 'check';
const binary = Bun.which('tailscale');
async function cli(args: string[]) {
  if (!binary) throw new Error('Install Tailscale on this Mac and sign in first.');
  const interactive = args.includes('--bg');
  const child = Bun.spawn([binary, ...args], {
    stdout: interactive ? 'inherit' : 'pipe',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  const output = interactive ? '' : await new Response(child.stdout).text();
  if (await child.exited)
    throw new Error('Tailscale command failed. Check the local Tailscale app.');
  return output;
}
async function check() {
  const config = getConfig();
  const status = JSON.parse(await cli(['status', '--json']));
  if (status.BackendState !== 'Running')
    throw new Error('Sign in and connect Tailscale on this Mac.');
  const dns = status.Self?.DNSName?.replace(/\.$/, '');
  if (!dns || !/^[a-z0-9.-]+\.ts\.net$/i.test(dns)) throw new Error('No Tailscale DNS name found.');
  const expected = `https://${dns}`;
  if (config.APP_ORIGIN !== expected)
    throw new Error(
      `Before enabling Funnel, set APP_ORIGIN=${expected} and restart with bun run start. This changes the browser address; pair again there.`,
    );
  const local = `http://127.0.0.1:${config.PORT}`;
  for (const path of ['/api/me', '/api/library', '/api/diagnostics', '/api/bitrate']) {
    const response = await fetch(local + path, {
      headers: { Host: dns },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 401)
      throw new Error(
        `Preflight failed: ${path} must reject unauthenticated requests (received ${response.status}).`,
      );
  }
  const wrongHost = await fetch(local + '/api/me', {
    headers: { Host: 'invalid.example' },
    signal: AbortSignal.timeout(5000),
  });
  if (wrongHost.status !== 403)
    throw new Error('Preflight failed: unexpected Host is not rejected.');
  console.log(
    'Local access checks passed. Public reachability and streaming speed are not tested.',
  );
  console.log(`Browser address: ${expected}`);
  return config;
}
try {
  if (action === 'check') await check();
  else if (action === 'status') console.log(await cli(['funnel', 'status']));
  else if (action === 'stop') {
    console.log(await cli(['funnel', '--bg', '--https=443', 'off']));
    console.log(await cli(['funnel', 'status']));
  } else if (action === 'start') {
    if (!process.argv.includes('--allow-public'))
      throw new Error(
        'Public access is disabled. After approving exposure, use bun run funnel:start --allow-public.',
      );
    const config = await check();
    console.log(await cli(['funnel', '--bg', '--https=443', `http://127.0.0.1:${config.PORT}`]));
    console.log(await cli(['funnel', 'status']));
  } else throw new Error('Use check, status, start or stop.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Funnel preparation failed.');
  process.exitCode = 1;
}
