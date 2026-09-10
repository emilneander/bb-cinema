# Architecture

bb cinema uses a persistent Bun/Hono gateway on loopback port 3000, a Next.js frontend on loopback port 3001, and a local SQLite database. Only the gateway is a browser-facing endpoint. Jellyfin remains a separate native service responsible for media probing, remuxing, transcoding and subtitle conversion. The configured compatibility pin is 12.0.0.

Display profiles identify the two viewers. A separate device-session capability controls service configuration, invitations, device revocation, library refresh and manual matching. Host capability is issued only through the local setup/recovery command, never by selecting a profile or accepting an ordinary viewer invitation. Existing sessions gain no new capability when migration 006 runs.

The host setup form verifies the local Jellyfin service and two restricted users, optionally validates a TMDB token, and saves settings transactionally in the private database. Saved service settings take precedence over their environment equivalents on restart. Network origin, ports and database location remain environment-controlled; setup does not expose a service or alter networking. Metadata discovery is optional for library playback.

The single authoritative room orders shared playback commands and checkpoints position. Media proxy tickets bind resource access to the authenticated device session; playlists are rewritten so upstream credentials are not exposed. Native HLS is preferred, with HLS.js as the fallback. Each viewer chooses audio, subtitle and picture settings independently. Text subtitles use separate WebVTT tracks without reloading video. Burned-in subtitles and audio/quality changes require a new playback stream. Auto selects a resolution and bitrate using a bounded initial connection sample, not continuous adaptive streaming.

Production startup acquires a local instance lock, detects occupied ports, supervises the gateway and frontend as a pair, and retries child exits with bounded exponential backoff. SIGINT/SIGTERM shut both down without restarting. Launch-at-login remains opt-in through a reviewed LaunchAgent; it starts only after macOS login. No installer, signing or automatic network setup is included in this developer preview.

Known work before an end-user release: packaged runtime, signed artifacts, lifecycle UI, log rotation, more complete configuration recovery, physical Safari verification and sustained remote testing. See [release status](RELEASE-STATUS.md), [security](SECURITY.md), and [deployment](DEPLOYMENT.md).
