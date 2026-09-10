'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { User } from '../../../packages/shared/types';

export function HostSetup({
  csrf,
  users,
  done,
  cancel,
  editing = false,
}: {
  csrf: string;
  users: User[];
  done: () => Promise<unknown>;
  cancel?: () => void;
  editing?: boolean;
}) {
  const [url, setUrl] = useState('http://127.0.0.1:8096');
  const [version, setVersion] = useState('12.0.0');
  const [names, setNames] = useState([
    users.find((u) => u.id === 'owner')?.name || '',
    users.find((u) => u.id === 'partner')?.name || '',
  ]);
  const [accounts, setAccounts] = useState(['', '']);
  const [passwords, setPasswords] = useState(['', '']);
  const [token, setToken] = useState('');
  const [tokenAction, setTokenAction] = useState('keep');
  const [saved, setSaved] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void api<{
      url: string;
      version: string;
      ownerUsername: string;
      partnerUsername: string;
      tmdbConfigured: boolean;
    }>('/host/config')
      .then((c) => {
        setUrl(c.url);
        setVersion(c.version);
        setAccounts([c.ownerUsername, c.partnerUsername]);
        setConfigured(c.tmdbConfigured);
        setLoaded(true);
      })
      .catch(() => setError('Could not load connection settings.'));
  }, []);
  return (
    <section className={`profile-entry connection-entry${editing ? ' is-editing' : ''}`}>
      {!editing && <span className="profile-brand">bb cinema</span>}
      {editing && (
        <button type="button" className="text-button" disabled={busy} onClick={cancel}>
          ← Settings
        </button>
      )}
      <form
        className="profile-form host-setup"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api(
              '/host/config',
              {
                method: 'POST',
                body: JSON.stringify({
                  names,
                  services: {
                    JELLYFIN_URL: url,
                    JELLYFIN_VERSION: version,
                    JELLYFIN_OWNER_USERNAME: accounts[0],
                    JELLYFIN_OWNER_PASSWORD: editing && !passwords[0] ? undefined : passwords[0],
                    JELLYFIN_PARTNER_USERNAME: accounts[1],
                    JELLYFIN_PARTNER_PASSWORD: editing && !passwords[1] ? undefined : passwords[1],
                    TMDB_TOKEN:
                      !editing || tokenAction === 'replace'
                        ? token.trim()
                        : tokenAction === 'remove'
                          ? ''
                          : undefined,
                  },
                }),
              },
              csrf,
            );
            setSaved(true);
            setPasswords(['', '']);
            setToken('');
            try {
              await api('/library/sync', { method: 'POST' }, csrf);
            } catch {
              setError('Settings saved. Library refresh failed. You can retry from Library.');
              return;
            }
            await done();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Setup could not be saved.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>{editing ? 'Connection settings' : 'Set up cinema'}</h1>
        <p className="muted">
          Connect your local Jellyfin server and two restricted playback accounts.
        </p>
        <label>
          Jellyfin address
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label>
          Installed Jellyfin version
          <input required value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        <div className="connection-accounts">
          {[0, 1].map((i) => (
            <fieldset key={i}>
              <legend>Profile {i + 1}</legend>
              <label>
                Name
                <input
                  required
                  maxLength={40}
                  value={names[i]}
                  onChange={(e) => setNames((v) => v.map((x, n) => (n === i ? e.target.value : x)))}
                />
              </label>
              <label>
                Jellyfin username
                <input
                  required
                  autoComplete="off"
                  value={accounts[i]}
                  onChange={(e) =>
                    setAccounts((v) => v.map((x, n) => (n === i ? e.target.value : x)))
                  }
                />
              </label>
              <label>
                Jellyfin password
                <input
                  type="password"
                  required={!editing}
                  placeholder={editing ? 'Unchanged' : undefined}
                  autoComplete="new-password"
                  value={passwords[i]}
                  onChange={(e) =>
                    setPasswords((v) => v.map((x, n) => (n === i ? e.target.value : x)))
                  }
                />
              </label>
            </fieldset>
          ))}
        </div>
        {editing && (
          <label>
            TMDB token
            <select value={tokenAction} onChange={(e) => setTokenAction(e.target.value)}>
              <option value="keep">{configured ? 'Keep current token' : 'Not configured'}</option>
              <option value="replace">Set a new token</option>
              <option value="remove">Remove token</option>
            </select>
          </label>
        )}
        {(!editing || tokenAction === 'replace') && (
          <label>
            {editing ? 'New TMDB read access token' : 'TMDB read access token (optional)'}
            <input
              type="password"
              autoComplete="new-password"
              required={editing && tokenAction === 'replace'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
        )}
        <p className="muted small">
          {editing
            ? 'Blank passwords keep the current credentials.'
            : 'Leave blank for library-only use. Connections are checked before saving.'}
        </p>
        <button className="button primary" disabled={busy || !loaded || saved}>
          {busy ? 'Checking connections…' : 'Check and save'}
        </button>
        {saved && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void done()}
          >
            Continue
          </button>
        )}
        {cancel && (
          <button type="button" className="text-button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

type Device = { id: string; name: string; current: boolean; canManage: number; expiresAt: number };
export function HostDevices({ csrf }: { csrf: string }) {
  const [devices, setDevices] = useState<Device[]>([]),
    [link, setLink] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setDevices((await api<{ devices: Device[] }>('/host/devices')).devices);
  }
  useEffect(() => {
    void refresh().catch(() => setError('Could not load devices.'));
  }, []);
  return (
    <details className="settings-section advanced-settings">
      <summary>Invitations & devices</summary>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const result = await api<{ code: string }>('/host/invites', { method: 'POST' }, csrf);
            setLink(`${location.origin}/#invite=${result.code}`);
          } catch {
            setError('Could not create invitation.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Create invitation
      </button>
      {link && (
        <div className="invite-result">
          <label>
            Invitation link
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <p className="muted small">One use, valid for 24 hours. Gives viewing access only.</p>
          <button
            className="text-button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(link)
                .catch(() => setError('Select and copy the link above.'));
            }}
          >
            Copy link
          </button>
        </div>
      )}
      {devices.map((device) => (
        <div className="host-device" key={device.id}>
          <span>
            {device.name || 'Unnamed profile'} ·{' '}
            {device.current ? 'This device' : device.canManage ? 'Host device' : 'Viewer device'}
          </span>
          {!device.current && (
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(`/host/devices/${device.id}`, { method: 'DELETE' }, csrf);
                  await refresh();
                } catch {
                  setError('Could not remove device.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove access
            </button>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </details>
  );
}
