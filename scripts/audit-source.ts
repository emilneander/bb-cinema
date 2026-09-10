import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Inspect the exact Git index, not a working directory containing runtime data.
const git = (...args: string[]) => execFileSync('git', args);
const entries = git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean);
if (!entries.length) throw new Error('Stage the reviewed source files before auditing.');
const manifest = JSON.parse(git('show', ':release-files.json').toString()) as string[];
const allowed = new Set(manifest);
const temporary = mkdtempSync(join(tmpdir(), 'cinema-source-audit-'));
let failed = false;
const stagedPaths = new Set(entries.map((entry) => entry.split('\t')[1]));
for (const path of allowed) {
  if (!stagedPaths.has(path)) {
    console.error(`Missing allowlisted file: ${path}`);
    failed = true;
  }
}
try {
  for (const entry of entries) {
    const [header, path] = entry.split('\t');
    const [mode, oid, stage] = header.split(' ');
    if (!path || !allowed.has(path) || stage !== '0' || !['100644', '100755'].includes(mode)) {
      console.error(`Unreviewed path or file mode: ${path || '(invalid entry)'}`);
      failed = true;
      continue;
    }
    if (
      /(^|\/)(?:node_modules|\.next|data|backups|test-results|playwright-report)(\/|$)|\.(?:sqlite.*|db|log|pem|key|p12|pfx|dmg|mp4|mkv|mov|plist)$/.test(
        path,
      ) ||
      (/(^|\/)\.env(?:\..*)?$/.test(path) && path !== '.env.example')
    ) {
      console.error(`Runtime/private file forbidden: ${path}`);
      failed = true;
      continue;
    }
    const body = git('cat-file', 'blob', oid);
    if (body.includes(0)) {
      console.error(`Binary file requires separate review: ${path}`);
      failed = true;
      continue;
    }
    const text = body.toString();
    if (
      /\/Users\/(?!AuthenticateByName\b)[A-Za-z][\w.-]*\//.test(text) ||
      /\b[\w-]+\.tail[0-9a-f]+\.ts\.net\b/i.test(text)
    ) {
      console.error(`Personal path or tailnet hostname: ${path}`);
      failed = true;
    }
    const target = join(temporary, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  if (failed) process.exitCode = 1;
  else {
    const result = spawnSync('gitleaks', ['dir', temporary, '--redact=100', '--no-banner'], {
      stdio: 'inherit',
    });
    if (result.error || result.status !== 0) {
      console.error('Source audit failed or Gitleaks is unavailable. Install Gitleaks and rerun.');
      process.exitCode = 1;
    } else {
      console.log(
        `Passed: ${entries.length} staged text files match the reviewed allowlist and secret scan.`,
      );
      if (spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' }).status === 0) {
        const history = spawnSync(
          'gitleaks',
          ['git', '.', '--log-opts=--all', '--redact=100', '--no-banner'],
          { stdio: 'inherit' },
        );
        if (history.error || history.status !== 0) process.exitCode = 1;
      } else console.log('No commits exist: no prior history to expose.');
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
