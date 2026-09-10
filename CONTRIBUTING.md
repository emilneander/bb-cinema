# Contributing

Original bb cinema code is licensed under [MIT](LICENSE). This source candidate has not yet been published. Contribution intake begins when the public repository is available.

Use synthetic media and disposable test services. Never attach environment files, invitation links, cookies, private URLs, movie files, watch history, database copies or raw Jellyfin logs to an issue or pull request. Redact identifying details from screenshots.

For a local development change:

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun test tests
bunx playwright install chromium webkit
bun run test:e2e
```

FFmpeg is required for the browser fixtures. Use dedicated application ports and a separate data directory when another cinema is running. Tests emulate two browsers and local media services; they do not use real streaming accounts.

Keep the shared library, wishlist and two-profile scope. Add regression coverage for authorization, synchronization and lifecycle changes. Respect reduced-motion preferences and keyboard/touch controls. Keep ordinary UI copy minimal.

Install Gitleaks and opt into `.githooks` with `git config core.hooksPath .githooks`. Review every new source file, add it to `release-files.json`, then stage it and run `bun run audit:source`. Never solve a secret finding by suppressing a real credential. CI is configured with read-only repository permissions and has no publishing steps.
