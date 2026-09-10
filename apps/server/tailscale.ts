import { z } from 'zod';
// Fixed command, no browser-provided arguments. Return only non-sensitive health
// facts; do not expose the tailnet's peers, addresses, accounts or full JSON.
export async function tailscaleHealth() {
  const executable =
    Bun.which('tailscale') ||
    ((await Bun.file('/Applications/Tailscale.app/Contents/MacOS/Tailscale').exists())
      ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
      : null);
  if (!executable)
    return { ok: false, status: 'Tailscale is not installed or its CLI is unavailable.' };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const child = Bun.spawn([executable, 'status', '--json'], { stdout: 'pipe', stderr: 'ignore' });
    timeout = setTimeout(() => child.kill(), 5000);
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0)
      return {
        ok: false,
        status: 'Tailscale is not responding. Open the Mac app and check sign-in.',
      };
    const data = z
      .object({
        BackendState: z.string(),
        Self: z.object({ Online: z.boolean().optional() }).optional(),
      })
      .parse(JSON.parse(output));
    const ok = data.BackendState === 'Running' && data.Self?.Online !== false;
    return {
      ok,
      status: ok
        ? 'Mac connected to Tailscale. Verify the viewing device’s route with the connection test.'
        : 'Tailscale is not connected. Open the Mac app.',
    };
  } catch {
    return {
      ok: false,
      status: 'Unable to read Tailscale status. Run bun run tailscale:check on the Mac.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
