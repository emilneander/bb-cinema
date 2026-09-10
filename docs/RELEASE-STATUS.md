# Source preparation status

This is a source-only developer preview. Original code is licensed under MIT with the approved copyright label “bb cinema contributors.”

## Privacy boundary

The source copy excludes runtime credentials, databases, watch history, backups, logs, generated launch configuration, screenshots, recordings, downloaded applications and media. Private deployment incident notes and upgrade records are not part of the source distribution. Historical personal defaults were removed from the profile migration in this fresh source baseline.

`release-files.json` is the reviewed file allowlist. `bun run audit:source` checks the exact staged content, rejects private/runtime paths and symlinks, scans staged text with Gitleaks, and scans all existing Git refs when commits exist. Findings are redacted. Commit and push hooks run this check in the prepared local repository. These checks reduce risk; they are not a guarantee that arbitrary personal information can always be detected.

For another checkout, install Gitleaks, then opt into the hooks with:

```sh
git config core.hooksPath .githooks
```

Any new source file requires review and an explicit allowlist update. Keep real secrets in a private environment file. Test credentials and synthetic fixtures are deliberately non-production data.

## Developer-preview work completed

- Migration 006 separates host administration from display profiles. Existing devices are not automatically promoted.
- A local ten-minute host setup link opens the browser form. It validates two restricted Jellyfin accounts and optional TMDB access, saves service settings transactionally, and names both profiles.
- Host-only connection settings preserve or replace passwords and keep, replace or remove the TMDB token. Validation bypasses metadata caches; a saved configuration is distinguished from a failed library refresh.
- Host-only settings create viewer invitations and revoke devices. A viewer cannot gain host access by selecting a different profile.
- The production supervisor prevents duplicate instances, detects port conflicts, restarts crashed children with bounded backoff, and shuts down cleanly on signals.
- A source-only archive command exports the audited Git index with fixed archive timestamps. It neither creates a commit nor uploads anything.
- Read-only GitHub Actions configuration runs the source audit, build, typecheck and browser tests. Actions are pinned to reviewed commit IDs. Remote CI has not run because no repository is published.
- A dependency declaration inventory is prepared, and the approved MIT license is applied to original project code. Third-party licenses remain separate.

## Verification

Verified on the isolated source copy:

- Frozen-lockfile dependency installation, production build and strict typecheck.
- 40 unit/integration tests, including guest-to-host escalation prevention, CSRF, revocation, setup validation, persisted credentials and bounded crash recovery.
- Four Chromium/WebKit scenarios: paired playback plus initial host setup and viewer invitation. A buffered-range snapshot race found during testing was fixed.
- Full application smoke test on disposable ports: initial startup, host pairing, duplicate-start rejection, gateway crash recovery, session persistence, occupied-port rejection, graceful shutdown and lock cleanup.
- The source audit rejects a deliberately staged runtime-file probe. Real credentials, profile names and local media identifiers are checked privately against staged source before handoff.

Final checks passed for 86 staged source files: Gitleaks found no leaks, the private-data comparison found no matches, and the source archive contains exactly the staged files with no links or runtime data. Two exports produced identical SHA-256 hashes. Generated build/test files are ignored, not part of the source archive. Automated browsers do not establish real-device reliability or remote-network performance.

## Before claiming a stable end-user release

- Packaged runtime, signed/notarized Mac app, lifecycle UI, log rotation and clean second-Mac installation.
- Physical validation of playback lifecycle changes, including automatic-next startup timeout recovery.
- Nonce-based production CSP hardening and invitation rate-limit availability work. The production CSP no longer allows eval, but still allows inline scripts; the public Funnel route remains an advanced trial.
- Physical Safari and sustained remote-network acceptance.

The repository distributes source code only. Cloning it does not install a startup service, expose a network endpoint or provide media files.

The final local review and fresh-archive verification are recorded in [REVIEW.md](REVIEW.md).
