import { execFileSync } from 'node:child_process';
import { mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
execFileSync(process.execPath, ['run', 'audit:source'], { stdio: 'inherit' });
const output = resolve(process.argv[2] || 'data/export/bb-cinema-source.tar');
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
// Write a tree from the reviewed index without creating author metadata or a commit.
const tree = execFileSync('git', ['write-tree']).toString().trim();
execFileSync('git', [
  '-c',
  'tar.umask=0022',
  'archive',
  '--format=tar',
  '--mtime=1970-01-01T00:00:00Z',
  '--prefix=bb-cinema/',
  '--output=' + output,
  tree,
]);
chmodSync(output, 0o600);
const digest = createHash('sha256')
  .update(Buffer.from(await Bun.file(output).arrayBuffer()))
  .digest('hex');
writeFileSync(output + '.sha256', digest + '\n', { mode: 0o600 });
console.log('Audited source archive created locally; nothing uploaded. SHA-256: ' + digest);
