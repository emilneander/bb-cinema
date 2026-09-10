# License and dependency inventory

Original bb cinema code is licensed under the standard [MIT License](../LICENSE), with the approved copyright notice: `Copyright (c) 2026 bb cinema contributors`.

The [standard MIT terms](https://choosealicense.com/licenses/mit/) permit reuse and modification with preservation of the notice and include a warranty disclaimer.

[DEPENDENCIES.json](DEPENDENCIES.json) records the license declarations of 67 installed dependency packages in the local Apple Silicon dependency tree. This is a declaration inventory, not a complete legal compatibility determination or a cross-platform software bill of materials. Recreate it when dependencies/platforms change. These packages retain their own licenses regardless of the license chosen for this project's code.

The tree includes MIT, ISC, 0BSD, BSD-3-Clause, Apache-2.0, MPL-2.0, LGPL-3.0-or-later and CC-BY-4.0 declarations. In particular, packaged distributions require a review of libvips, Lightning CSS, @vercel/og and caniuse-lite notices and applicable source/attribution requirements. Do not ship a bundled binary until the required notices and corresponding-source obligations, where applicable, are addressed. No third-party binaries are included in this source-only candidate.

The TMDB logo remains a third-party asset, with attribution in Settings → Credits. Its use is subject to [TMDB's attribution requirements](https://developer.themoviedb.org/docs/faq), not the project license. Catalogue artwork and movie files are not bundled. Jellyfin runs separately and is not included in this repository or distributed artifact.

The LICENSE file is included in the reviewed source allowlist and source archive. Before distributing a modified or bundled version, review the obligations applicable to that distribution.
