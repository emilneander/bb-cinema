'use client';
import { useEffect, useState } from 'react';
import type { User } from '../../../packages/shared/types';
import { api } from './api';

export function Pair({ onPaired }: { onPaired: () => Promise<unknown> }) {
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const match = location.hash.match(/^#invite=([A-Za-z0-9_-]{43})$/);
    if (match) {
      setCode(match[1]);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, []);
  return (
    <main className="profile-entry">
      <span className="profile-brand">bb cinema</span>
      <form
        className="profile-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api('/auth/redeem', {
              method: 'POST',
              body: JSON.stringify({ code: code.trim() }),
            });
            await onPaired();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not sign in.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Sign in</h1>
        <label htmlFor="invite">Invitation code</label>
        <input
          id="invite"
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <button className="button primary" disabled={busy || !code.trim()}>
          {busy ? 'Signing in…' : 'Continue'}
        </button>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
export function Profiles({
  identity,
  onSelected,
}: {
  identity: { users: User[]; csrf: string };
  onSelected: () => Promise<unknown>;
}) {
  const profiles = identity.users.filter((u) => u.named);
  const [adding, setAdding] = useState(profiles.length === 0),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function select(body: { name: string } | { profileId: string }) {
    setBusy(true);
    setError('');
    try {
      await api('/profiles/select', { method: 'POST', body: JSON.stringify(body) }, identity.csrf);
      await onSelected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not select profile.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="profile-entry">
      <span className="profile-brand">bb cinema</span>
      <section className="profile-picker">
        <h1>{adding ? 'Your name' : 'Select profile'}</h1>
        {adding ? (
          <form
            className="profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              void select({ name: name.trim() });
            }}
          >
            <label className="sr-only" htmlFor="profile-name">
              Name
            </label>
            <input
              id="profile-name"
              autoComplete="given-name"
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <button className="button primary" disabled={busy || !name.trim()}>
              Continue
            </button>
            {profiles.length > 0 && (
              <button className="text-button" type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            )}
          </form>
        ) : (
          <div className="profile-options">
            {profiles.map((u) => (
              <button
                key={u.id}
                className="profile-option"
                disabled={busy}
                onClick={() => void select({ profileId: u.id })}
              >
                <span className="profile-avatar" aria-hidden="true">
                  {u.name.slice(0, 1)}
                </span>
                <span>{u.name}</span>
              </button>
            ))}
            {profiles.length < 2 && (
              <button className="profile-option" disabled={busy} onClick={() => setAdding(true)}>
                <span className="profile-avatar add" aria-hidden="true">
                  +
                </span>
                <span>Add profile</span>
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
