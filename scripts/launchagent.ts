import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd(),
  bun = process.execPath;
const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
mkdirSync('config', { recursive: true });
mkdirSync('data/logs', { recursive: true, mode: 0o700 });
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>local.our-cinema</string>
<key>ProgramArguments</key><array><string>${xml(bun)}</string><string>scripts/run.ts</string><string>start</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(resolve(bun, '..'))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>NODE_ENV</key><string>production</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(root)}/data/logs/application.log</string>
<key>StandardErrorPath</key><string>${xml(root)}/data/logs/errors.log</string>
</dict></plist>`;
await Bun.write('config/local.our-cinema.plist', plist);
console.log(
  'Generated config/local.our-cinema.plist. This does not install or start the LaunchAgent. Follow docs/DEPLOYMENT.md.',
);
