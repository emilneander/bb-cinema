# Acceptance record

Automated coverage and hardware acceptance are separate. See the final test report for actual commands/results. Never mark the physical checks below passed merely because a synthetic movie fixture played in a browser test.

## Automated gates

- Strict TypeScript check and Next.js production build.
- Invitation consumption, two fixed identities, session expiry/revocation, CSRF and Origin checks.
- SQLite wishlist persistence and automatic/manual TMDB provider matching.
- Authoritative play/pause/seek, readiness gating, buffering threshold, user pause preventing automatic resume, disconnected pause and durable restart.
- Session-scoped media URLs, Range bytes, rewritten HLS segments and key/map references, rejection of cross-origin/traversal references.
- Two isolated browser sessions: search, save, select, readiness, shared play/pause/seek, reconnect. Browser fixtures emulate Jellyfin/TMDB, not their native servers.
- Desktop and landscape tablet layout (using an iPad viewport fixture) and keyboard controls in automated browsers.

## Real-device browser acceptance (pending)

Repeat on desktop and mobile browsers, including Safari and Chromium-based browsers. Firefox coverage is pending. iPad Safari is one useful example, not the only viewing target.

1. Add a legally held H.264/AAC MP4 to the configured local folder; let Jellyfin scan it. Add its TMDB entry to the wishlist first. Confirm status becomes Available after a refresh.
2. Verify Jellyfin stable version and restricted permissions for both accounts. Confirm no administrator token in browser requests, storage, HTML or playlists. Verify only loopback native services with `lsof` and only private Serve in `tailscale serve status`.
3. From the remote network, open the exact private HTTPS URL in the remote browser. Confirm library and artwork work through the Mac and pair using a fresh invitation.
4. Open the same room on both devices. Verify the selected movie is shared, each can prepare its own stream, and ordinary Start playback is gated on both ready states.
5. Test play, pause and seek from each device in both inline and full-screen video. Verify native full-screen controls propagate and local volume changes do not alter the other device.
6. Play for 20+ minutes at 1080p/6 Mbps. Record stream method, transcode settings, measured throughput and drift. Normal playback drift should stay below 500 ms. Test the actual host-to-viewer route, not just local Wi-Fi.
7. Temporarily constrain/disconnect the remote device network. Buffering >1.2 seconds must pause both; buffer recovery resumes only if the pause was automatic. Deliberately pause while buffering and verify it remains paused. Silent disconnection detection can take up to 15 seconds.
8. Reconnect/reload the browser. The room snapshot and position should restore; reactivate playback if prompted, re-ready and resume. Background the browser/lock the device and repeat.
9. Repeat with MKV H.264 (remux), a file requiring 1080p transcoding (confirm VideoToolbox), HEVC if available, alternate audio, SRT/VTT, and ASS/PGS subtitles. Verify burned-in subtitles on a transcoded stream and seeking across HLS segment boundaries. Test early, late, and rapid seeks.
10. Restart the Mac and log in. Confirm native services and application restart, wishlist persists, both seats show unready, and playback restores paused. Test a backup restore with the service stopped and sessions cleared.

Known limits to evaluate: Safari user-gesture restrictions, background-tab suspension, regional Tailscale throughput and relays, subtitle/codec negotiation in the actual Jellyfin release. Automated WebKit is not a full iPad hardware/OS emulation. Auto quality samples the connection on lobby entry; it does not continuously adapt during playback. The app never downloads/acquires media or bypasses DRM.
