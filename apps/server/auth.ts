import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { Session } from '../../packages/database';
import type { UserId } from '../../packages/sync/protocol';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export function same(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function sessionFor(db: Database, req: Request): Session | null {
  const value = req.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)cinema_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
  if (!value) return null;
  return db
    .query<Session, [string, number]>(
      'SELECT u.*,s.hash,s.csrf,s.expires_at,s.can_manage FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?',
    )
    .get(hash(value), Date.now());
}
export function createInvite(db: Database, id: UserId, canManage = false) {
  const code = secret();
  db.transaction(() => {
    db.query('DELETE FROM invites WHERE user_id=? AND can_manage=?').run(id, Number(canManage));
    db.query('INSERT INTO invites(hash,user_id,expires_at,can_manage) VALUES(?,?,?,?)').run(
      hash(code),
      id,
      Date.now() + (canManage ? 600000 : 86400000),
      Number(canManage),
    );
  })();
  return code;
}
export function redeem(db: Database, code: string) {
  return db.transaction(() => {
    const invite = db
      .query<{ user_id: UserId; can_manage: number }, [string, number]>(
        'DELETE FROM invites WHERE hash=? AND expires_at>? RETURNING user_id,can_manage',
      )
      .get(hash(code), Date.now());
    if (!invite) return null;
    const token = secret(),
      csrf = secret(),
      expires = Date.now() + 30 * 86400000;
    // Invitations authorize devices. The paired device selects a named profile.
    db.query('INSERT INTO sessions(hash,user_id,csrf,expires_at,can_manage) VALUES(?,?,?,?,?)').run(
      hash(token),
      invite.user_id,
      csrf,
      expires,
      invite.can_manage,
    );
    return { token, csrf };
  })();
}
