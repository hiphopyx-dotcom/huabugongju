# Tencent CloudBase HTTP function

The Tencent entry is an independent deployment of the same business modules.
Updating Vercel does not update this function.

The existing production function is `jbp-workbench`, in Shanghai environment
`unfair-pony-d7gvmlx4ne8e8796a`, running Node.js 20.19 on port 9000.
Preserve its `DATABASE_URL` and exact HTTPS `JBP_PUBLIC_ORIGIN`; never place
credentials in the archive, repository, public files or logs. This adapter uses
the existing Neon HTTP driver; a generic PostgreSQL connection is not interchangeable.

Generate `pages` and run the focused checks from the repository root:

```sh
node scripts/export-github-pages.mjs
node --test deploy/cloudbase/tests/*.test.mjs
JBP_SOURCE_COMMIT=<verified-source-commit> node deploy/cloudbase/build.mjs <new-absolute-output-directory>
```

Zip the **contents** of the output directory, retaining the executable permission
on `scf_bootstrap`. Download and preserve the current function archive first,
then upload the new archive through the official function's code-upload page.
Do not deploy a stale Cloud Studio editor after uploading an archive.

The archive includes all eight API modules, production JavaScript dependencies,
the generated front end, and four shared server imports. Its static manifest
excludes server imports and arbitrary source files. `/healthz` reports the
source commit and a front-end resource hash, not the complete archive hash.

Existing Mac workers continue polling their explicitly trusted Vercel entry;
both entries must retain the same database. Moving to a different database or
retiring Vercel also requires a separately verified worker migration.

Image generation can wait up to 110 seconds. Before configuring real image
credentials, verify that the function and gateway allow the required duration;
the existing trial function is configured for 30 seconds. Do not retry an
uncertain generation or mark it failed merely because a gateway disconnected.

Acceptance must use the Tencent public domain: login and refresh; image gallery,
workspace save and reload; quota status; binary downloads; Chinese reference
paths; and a mobile viewport. No paid generation is necessary for these checks.
Changing the domain does not transfer origin-scoped browser projects: retain
old browser data and import explicit project backups when moving those projects.
