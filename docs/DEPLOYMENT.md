# Private macOS deployment

Nothing here requires port forwarding, a public domain, Funnel or cloud media storage. The provided scripts do not install Jellyfin, change accounts, alter tailnet policies, or install startup agents automatically.

## Native Jellyfin

1. Install the **latest stable** native macOS Jellyfin from the [official release feed](https://github.com/jellyfin/jellyfin/releases/latest). At verification time it is **12.0.0**. Never use an RC/unstable release or anything below 10.11.10. If a newer stable version is released, review its migration/security notes and API compatibility, then update `JELLYFIN_VERSION` to exactly match your installation.
2. Configure one movies folder in Jellyfin, using media you can legally play. Grant the Jellyfin process read access to that folder; do not grant the custom application general filesystem access. Set up automatic folder scanning or a scheduled library scan. bb cinema refreshes its view of Jellyfin every minute and supports an owner-triggered refresh; it does not trigger Jellyfin's filesystem scan.
3. In Dashboard → Networking, disable automatic port mapping and remote access through public interfaces. Bind HTTP to `127.0.0.1` and port 8096 (edit the `LocalNetworkAddresses` setting in Jellyfin's `network.xml` if not exposed in the current UI, with Jellyfin stopped). Disable unnecessary discovery/plugins. Verify actual listening addresses with `lsof -nP -iTCP:8096 -sTCP:LISTEN`; stop and correct any `*`/LAN listener before remote use. Do not rely on an unchecked UI setting.
4. Create two **non-administrator** Jellyfin users dedicated to this app. Enable media playback, audio/video transcoding and remuxing. Restrict them to the movies library. Disable deletion, subtitle management/uploading, downloading, remote control of other users and administration. Keep the regular Jellyfin admin account separate. Enter both accounts in the host setup form; neither user's Jellyfin token is exposed to browsers.
5. Enable **VideoToolbox** under Playback → Transcoding. Use the packaged Jellyfin FFmpeg. Follow the [official Apple acceleration guide](https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/apple/) for codec and HDR tone-mapping configuration. Trigger a 1080p/6 Mbps transcode and inspect Jellyfin's FFmpeg log/Activity Monitor locally to confirm hardware acceleration.
6. Run `bun run check:jellyfin`. The application rejects unsafe account permissions and a mismatched server version.

If the app cannot play a movie, first verify the same file plays through the native Jellyfin web client using the same restricted account. Confirm both users can access the same movies library. Native HEVC support does not imply every profile/audio/container combination can direct play; the conservative profile allows Jellyfin to choose remux or HLS transcode.

## TMDB

Obtain your own API Read Access Token using the [official API documentation](https://developer.themoviedb.org/), enter it in the optional TMDB field during host setup, then run `bun run check:tmdb` if you need a command-line check. Never put it in a `NEXT_PUBLIC_*` variable. Metadata and artwork pass through the Mac so remote viewers do not need direct TMDB access. Respect the [TMDB terms and attribution](https://developer.themoviedb.org/docs/faq). The official logo is bundled unmodified in `apps/web/public/tmdb.svg`.

## Tailscale and HTTPS

1. Install Tailscale on the host Mac and viewing devices and verify both can connect. Either invite the partner into the tailnet with a restrictive policy, or use **Share machine** on only the Mac in Tailscale's Machines page; the viewer accepts with their own account. Device sharing does not itself restrict ports. Do not share a subnet router or exit node. Consult [device sharing](https://tailscale.com/docs/features/sharing).
2. Replace broad default allows with an explicit policy allowing only the owner's required access and the partner to the Mac's **TCP 443**. For an in-tailnet partner, a reviewed grant might use `src: ["partner@example.com"]`, `dst: ["100.x.y.z"]`, `ip: ["tcp:443"]`. For a shared external user use the documented `autogroup:shared` selector scoped to this Mac. Review the current [policy documentation](https://tailscale.com/docs/reference/syntax/policy-file), existing grants, device sharing and policy tests; do not paste an example over your existing policy. Grants are additive, so a broad allow rule defeats restrictions. Verify the partner cannot reach TCP 22, 3001 or 8096. Only the authenticated gateway needs exposure.
3. Find the Mac's MagicDNS HTTPS name in Tailscale, e.g. `cinema-mac.your-tailnet.ts.net`. Set `APP_ORIGIN=https://cinema-mac.your-tailnet.ts.net` exactly (no path/port unless your Serve config uses one). Restart the application. The gateway intentionally rejects other Host/Origin values. Once using HTTPS, use this same origin on the Mac too.
4. After reviewing your tailnet HTTPS settings, explicitly run `bun run tailscale:serve`. It executes `tailscale serve --bg http://127.0.0.1:3000`, then prints status. For private access, do not use `tailscale funnel`. Serve can require enabling tailnet HTTPS certificates interactively. [Official Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve).
5. Check `bun run tailscale:check`, open the private HTTPS URL on the viewing device, and redeem its partner invitation. Check cookies are HttpOnly, Secure, SameSite=Strict and scoped to `/`. Do not expose raw Jellyfin separately; native HLS works through the same application origin.

All application listeners remain on localhost. Optional HTTP fallback: use a private Tailscale Serve HTTP listener, for example `tailscale serve --bg --http=80 http://127.0.0.1:3000`, with a matching `http://...ts.net` APP_ORIGIN and a TCP 80 grant instead of 443. Traffic is still encrypted by Tailscale, but browsers won't set Secure cookies. Do not enable both paths unnecessarily. The default script assumes port 3000; if you change PORT, update the Serve target too.

## Network quality

Run the authenticated Settings → Test this connection **on the viewing device**, not the Mac. It measures an uncached random 8 MB payload without compression. Aim for sustained throughput comfortably above 6 Mbps, with headroom (9+ Mbps is a useful initial indication). A short HTTP sample cannot predict a whole movie. Run at least a 20-minute actual playback trial and inspect buffering and drift in diagnostics. On the Mac, `tailscale status` and `tailscale ping <viewer-device-name-or-IP>` indicate direct versus relayed routing. A DERP relay or regional connectivity limitations can constrain throughput. Do not promise 1080p just because both devices joined the tailnet. Try 1080p/4 Mbps or 720p/3 Mbps when necessary. No automatic networking changes or circumvention mechanisms are built in.

## Startup and power

```sh
bun run build
bun run launchagent
plutil -lint config/local.our-cinema.plist
```

Review the generated absolute paths. Install explicitly if desired:

```sh
mkdir -p ~/Library/LaunchAgents
cp config/local.our-cinema.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.our-cinema.plist
```

The LaunchAgent starts after your macOS user logs in, not before FileVault unlock/login. Configure Jellyfin and Tailscale to start at login through their native settings. Start order is not critical: library refresh retries each minute. If one application process exits unexpectedly, the supervisor stops the other and restarts the pair with bounded backoff. Repeated failures cause it to exit; launchd retries according to its throttle policy. Restore the room paused after app/Mac restart, reconnect and mark both users ready.

Keep the Mac plugged in, with its lid open, and run `bun run awake` during playback. Stop it with Ctrl-C after the movie. `caffeinate` cannot guarantee playback with a closed lid or after power/network loss. This intentionally does not prevent sleep permanently at login.

Logs are local JSON event/error summaries under `data/logs/` when launched by launchd. Rotate/archive them periodically; no log shipping is configured.

## Backup and recovery

Run `bun run db:backup` while the app is live; SQLite `VACUUM INTO` creates a consistent standalone snapshot, including WAL state. Do **not** copy just the live `.sqlite` file while ignoring its WAL. Store backups and a separately encrypted copy of `.env` somewhere private. The database also contains saved service credentials from the setup form. Database backups contain authentication hashes and CSRF values as well as your wishlist; protect them like credentials. Back up Jellyfin configuration separately using Jellyfin's supported backup procedure.

For recovery: stop the LaunchAgent (`launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.our-cinema.plist`) and any dev server. Move the existing `data` database, `-wal`, and `-shm` files together into a private archive; copy the chosen backup to `DATABASE_PATH` and restore mode 600. Restore `.env`, run migrations and service checks, then restart. For a stolen device, use Settings → Invitations & devices to revoke its session; the device loses API and socket access. If host access is lost, run `bun run setup` locally to authorize a replacement host device, then revoke the lost device. Clear all sessions after restoring an old backup to prevent revival of a previously revoked session, then generate new invitations. Restored playback always starts paused.

## Optional public Funnel trial

The default deployment above remains private. For the separately approved browser-only trial, see [FUNNEL.md](FUNNEL.md). Preparation does not enable public access.
