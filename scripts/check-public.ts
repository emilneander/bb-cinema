import { getConfig } from '../apps/server/config';
import { isIP, BlockList } from 'node:net';

// Bypass the Mac's MagicDNS: test the addresses published by public DNS.
const origin = new URL(getConfig().APP_ORIGIN);
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
try {
  if (origin.protocol !== 'https:') throw new Error('Configure the HTTPS origin first.');
  const response = await fetch(
    `https://dns.google/resolve?name=${encodeURIComponent(origin.hostname)}&type=A`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw new Error('Public DNS lookup failed.');
  const dns = (await response.json()) as { Answer?: { type: number; data: string }[] };
  const addresses = dns.Answer?.filter((a) => a.type === 1).map((a) => a.data) ?? [];
  if (!addresses.length)
    throw new Error(
      'No public IPv4 DNS record yet. Funnel DNS can take up to 10 minutes to appear; a local HTTPS success does not prove public access.',
    );
  for (const address of addresses) {
    if (isIP(address) !== 4 || blocked.check(address, 'ipv4'))
      throw new Error('DNS returned a non-public address.');
    for (const [path, expected] of [
      ['/', '200'],
      ['/api/library', '401'],
      ['/api/bitrate', '401'],
    ] as const) {
      const child = Bun.spawn(
        [
          'curl',
          '--noproxy',
          '*',
          '--max-time',
          '15',
          '--silent',
          '--show-error',
          '--resolve',
          `${origin.hostname}:${origin.port || '443'}:${address}`,
          '--output',
          '/dev/null',
          '--write-out',
          '%{http_code}',
          new URL(path, origin).href,
        ],
        { stdout: 'pipe', stderr: 'inherit' },
      );
      const code = await new Response(child.stdout).text();
      if ((await child.exited) || code !== expected)
        throw new Error(`Public route ${path} failed: expected ${expected}, received ${code}.`);
      console.log(`Public relay ${address}: ${path} → ${code}`);
    }
  }
  console.log(
    'Public relay checks passed from this Mac. Phone/China reachability and sustained playback still need testing.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Public check failed.');
  process.exitCode = 1;
}
