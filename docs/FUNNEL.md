# Funnel trial

Prepared locally; not enabled. Funnel gives viewers a public HTTPS address without requiring Tailscale on the viewing device. The Mac still runs bb cinema and Jellyfin and must stay awake. No router forwarding or movie upload is needed.

## Before enabling

1. Install and sign in to Tailscale on the Mac. Viewers do not need to install Tailscale.
2. Run `bun run funnel:check`. It only reads status and checks local HTTP responses. It reports the required APP_ORIGIN if the current value differs. Do not share status JSON, .env, cookies or invitation codes publicly.
3. Back up with `bun run db:backup`. Record the old APP_ORIGIN, set the reported HTTPS origin in .env, build with `bun run build`, then restart the app with `bun run start`. Do not run the development server publicly. Both browsers should use the new HTTPS address; existing localhost cookies do not transfer.
4. Run `bun test tests` and `bun run funnel:check`. The preflight checks that the running gateway rejects unexpected hosts and unauthenticated library, diagnostics, identity and bitrate requests. It is a limited check, not a security certification.
5. Review current dependencies, ensure only loopback listeners for ports 3000, 3001 and 8096, and review existing Tailscale Serve/Funnel configuration so this app does not replace another service on HTTPS port 443.

## Explicit public activation

Only after the owner approves public exposure:

```sh
bun run funnel:start --allow-public
```

Tailscale may require a one-time browser approval for Funnel. This exposes the login page to the internet; authentication protects catalogue, library, diagnostics and streams. Share a new single-use invitation privately (`bun run invite partner`). Invited devices can select either named profile; profiles are not separate authorization boundaries.

## Verify public DNS first

Run `bun run funnel:public-check`. This uses public DNS and forces HTTPS through the published relay addresses, avoiding MagicDNS on the Mac. A normal curl on the host can reach its private tailnet address and give a misleading success. New Funnel DNS records can take up to 10 minutes to appear.

## Test from the remote network

Open the HTTPS address in Safari, pair, then open Settings / diagnostics and run the existing connection test. Repeat three times. This downloads 8 MiB of random data per test; a fast result is only a first check, not a sustained-speed guarantee.

Then play an actual episode at 1080p / 6 Mbps for at least 10 minutes, testing pause, seek, fullscreen exit and reconnect. Test shared playback with both browsers. Aim for headroom above 6 Mbps and no repeated buffering. Funnel has non-configurable bandwidth limits and no promised cross-region performance. Keep paid hosting as a fallback only if the trial fails.

## Stop and revert

```sh
bun run funnel:stop
bun run funnel:status
```

This disables this trial's port 443 handler; it does not reset unrelated ports. Confirm status has no public handler for bb cinema. Restore the previous APP_ORIGIN and restart for localhost/private access. Stopping the app alone does not remove persistent Funnel configuration. No automatic startup changes are made by these preparation scripts.

## Current security limits

Invite redemption has a global eight-attempt/minute budget and request size limits. This reduces guessing but permits a remote caller to temporarily exhaust the login budget; this is not a DDoS-resistant service. Sessions last 30 days. The current Next.js CSP still permits inline scripts and eval, and should be tightened in a subsequent hardening pass. Keep the trial limited to the two invited people; the URL itself is not a secret or an access control.

Official references: [Funnel](https://tailscale.com/docs/features/tailscale-funnel), [CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel).
