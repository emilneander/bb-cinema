# Developer-preview review — 2026-09-09

Verdict: suitable for a limited, self-hosted developer preview after the publication gates below. It is not yet an easy-install or stable end-user release. This review covers the isolated source candidate; it does not deploy changes to an existing installation and is not an independent penetration test.

## Findings fixed

| Priority | Finding                                                                                                                          | Resolution                                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| High     | Delayed stop/progress reports could target a replacement stream, or a stream belonging to another device using the same profile. | Reports require an opaque stream ID and the owning authenticated device. Stop detaches the stream before awaiting upstream cleanup. Tickets are revoked only for that stream. A regression test exercises both stale reports and replacement during cleanup. |
| Medium   | A negotiation superseded while awaiting old-stream cleanup could leave a new transcode running.                                  | Both stale-generation exits stop the abandoned playback session. Encoding cleanup is attempted even if the stopped report fails.                                                                                                                             |
| Medium   | Automatic next-episode startup could wait indefinitely for the browser's play promise.                                           | Startup has a 30-second deadline, pauses on failure and returns to an explicit readiness action.                                                                                                                                                             |
| Medium   | Production allowed JavaScript eval.                                                                                              | The supervisor explicitly sets the runtime mode; eval is allowed only in development. Production startup and browser tests passed without it. Inline-script hardening remains below.                                                                         |
| Low      | The source audit allowed an allowlisted file to be missing.                                                                      | The staged index must contain every allowlisted file.                                                                                                                                                                                                        |
| Low      | Two server messages still used the former product name.                                                                          | Updated to bb cinema.                                                                                                                                                                                                                                        |

## Remaining findings and release limits

1. **Setup usability — resolved in follow-up.** Settings → Connections now opens a host-only editor. Omitted passwords preserve existing credentials; TMDB can be kept, replaced or removed. Validation failure leaves saved settings untouched. Token checks bypass cached metadata. A refresh failure after saving is reported separately, with a Continue action. Browser tests cover that partial-success path and viewer exclusion.
2. **Public-endpoint availability — medium.** The shared eight-attempt invitation budget can be exhausted by an unauthenticated caller. It limits guessing but does not provide denial-of-service protection. Keep private tailnet deployment as the default; a general public-hosting release needs an availability design and load testing.
3. **CSP — medium defense-in-depth gap.** Production still permits inline scripts/styles for the current Next.js output. Add per-response nonces or reviewed hashes and browser coverage before describing CSP as strict. Removing eval does not resolve this remaining gap.
4. **Installation and operations — medium.** Bun, Node and native Jellyfin still require manual installation. A generated LaunchAgent requires explicit installation and starts after login. A signed/notarized Mac application, lifecycle UI, automatic log rotation and clean second-Mac acceptance remain unfinished.
5. **Playback acceptance — medium.** Automated WebKit is not physical Safari. Validate full-screen controls, text/burned subtitles, timeout recovery, long playback and changing network conditions on real devices. Auto quality selects an initial bitrate; it does not continuously adapt, and synchronization cannot overcome inadequate throughput.
6. **Maintenance — low.** Large server/UI modules remain maintainability costs. Split them around authentication, setup and playback when adding features; avoid a broad refactor immediately before the first preview.

## Review coverage and evidence

Reviewed the authentication and host-capability boundaries, setup persistence, playback negotiation/report lifecycle, media ticket proxy, synchronization/buffering/reconnection, startup supervisor, backup/recovery instructions, source allowlist/export, CI definition and release/licensing documentation.

Verified using an exported source archive extracted into a new directory containing spaces, without a copied environment file or private database:

- Frozen dependency installation, production build and strict typecheck pass.
- 40 unit/integration tests pass with 221 assertions in the archive baseline (230 after the connection-editor follow-up), including privilege escalation, CSRF, pairing, revocation, setup validation, buffering, reconnect and stale playback reporting.
- All four Chromium/WebKit browser scenarios pass, including two-viewer playback, native text subtitle switching, reconnect, host setup and viewer invitation.
- The production supervisor starts the exported application on disposable loopback ports, serves the page without eval in its CSP, and shuts down with lock cleanup.
- `bun audit` reports no known vulnerabilities for the installed dependency graph at review time. This is an advisory check, not proof of absence of vulnerabilities.
- Gitleaks finds no secrets in staged source. A private comparison against the original installation finds no credential, profile-name, media-identifier or personal-hostname matches. No private values are included in this report.
- The archive contains regular source files/directories only. Generated runtime/build files are excluded. The exporter uses fixed timestamps and the exact audited index.

The normal local browser run logged a generic upstream request failure during playback teardown; it did not fail an assertion. The fresh-archive browser run passed without that message. A teardown warning is not evidence of reliable sustained remote playback.

## Publication gates

- Confirm the public Git author identity, review the initial commit and rerun the source/history audit before first push. No commit or remote exists at review time.
- MIT is already approved for original code. Third-party code/assets retain their own licenses. Review applicable attribution obligations for the intended distribution; the dependency declaration inventory does not establish binary-distribution compliance.
- Obtain explicit publication authorization. No public repository, upload, network exposure or live-installation change is performed by this review.

The connection editor follow-up is complete. Next, review the public Git identity and initial commit, then publish only as a developer preview after the gates above. A one-click Mac release is a separate milestone.

## Visual and usability follow-up

Inspected fixture screenshots at 1440×1000, 1024×768 and 390×844 for setup, Home, Discover, empty Wishlist, Library, movie details, Settings, connection editing, lobby and active playback. The checked application screens had no horizontal document overflow. Screenshot artifacts stay in ignored local data and are not distributed.

Fixed cramped inline form labels and clipped password hints, excessive editor spacing, a duplicate brand label, indistinct connection-management buttons and duplicate “Connections” section names. The editor now has a Settings back action, full-width fields, paired desktop account columns and a single-column phone layout. Phone poster grids use two columns with larger title, metadata and availability text. The original minimal palette and shared-library structure remain.

The production build and typecheck pass. Existing Chromium/WebKit browser scenarios cover setup, credential editing, partial-save feedback, viewer restrictions, navigation, modal positioning and playback. This is an internal design pass using synthetic content, not user research or exhaustive accessibility certification. Real artwork, dense libraries, long translated titles and physical-device interaction still merit wider acceptance testing.
