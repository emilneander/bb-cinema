import { openDatabase } from '../packages/database';
import { createInvite } from '../apps/server/auth';
import { getConfig } from '../apps/server/config';
import { installationConfig } from '../apps/server/installation';
import { userId } from '../packages/sync/protocol';
import { Jellyfin } from '../apps/server/jellyfin';
import { TMDB } from '../apps/server/tmdb';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
const base = getConfig(),
  db = openDatabase(base.DATABASE_PATH),
  config = installationConfig(db, base),
  task = process.argv[2];
try {
  switch (task) {
    case 'setup': {
      const code = createInvite(db, 'owner', true);
      console.log(
        `Private host setup link (single-use, expires in 10 minutes):\n${config.APP_ORIGIN}/#invite=${code}\nKeep this link on the host device. It grants administration access.`,
      );
      break;
    }
    case 'migrate':
      console.log('Database migrations applied.');
      break;
    case 'invite': {
      const id = userId.parse(process.argv[3]);
      const code = createInvite(db, id);
      console.log(
        `Single-use device invitation (expires in 24 hours):\n\n${code}\n\nShare this code privately. The device can then create or select a named profile.`,
      );
      break;
    }
    case 'backup': {
      mkdirSync('backups', { recursive: true, mode: 0o700 });
      const path = resolve(
        'backups',
        `cinema-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
      );
      db.query('VACUUM INTO ?').run(path);
      chmodSync(path, 0o600);
      console.log(`Consistent SQLite backup created: ${path}`);
      break;
    }
    case 'jellyfin': {
      const jf = new Jellyfin(config);
      console.log(`Jellyfin stable ${await jf.health()}`);
      await jf.login('owner');
      await jf.login('partner');
      console.log('Both restricted playback accounts verified.');
      break;
    }
    case 'tmdb':
      await new TMDB(db, config.TMDB_TOKEN).get('configuration');
      console.log('TMDB connection verified.');
      break;
    default:
      throw new Error('Use setup, migrate, invite owner|partner, backup, jellyfin or tmdb.');
  }
} catch (e) {
  console.error(
    e instanceof Error && !/https?:|api_key=|Token=/.test(e.message)
      ? e.message
      : 'Operation failed. Check configuration.',
  );
  process.exitCode = 1;
} finally {
  db.close();
}
