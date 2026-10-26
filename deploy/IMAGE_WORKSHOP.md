# Native personal image workshop

The canvas phone/password session is the sole image owner. Members do not need
an original-workshop account. The former iframe has been replaced by a native
composer, personal gallery, local historical-backup selector and storyboard
binding. The old hosted application itself is not modified.

## Release

Apply `image-schema.sql` after `schema.sql` and
`migrations/estimated-token-quota.sql`. The new DDL and functions are additive
and repeatable. Deploy from this folder; build copies the generated `../pages`.

The server reads `XAI_API_KEY` (optionally `XAI_IMAGE_MODEL`), or an explicit
`AI_API_KEY` + `AI_BASE_URL` + optional `AI_IMAGE_MODEL`. Store secrets only in
the hosting environment UI. A key's presence means configured, not verified.
Without a key, import/gallery/content still work and generation fails before
quota reservation. No key was present during this implementation, and no paid
production generation is included in acceptance.

## Accounting and interrupted requests

One request generates one image. Owner + request UUID is idempotent, with an
input hash to reject UUID reuse for different content. Job creation/reservation
and image/asset/charge use database transactions. HTTP rejections release the
hold; transport failures, malformed success, revoked sessions and uncertain
persistence retain the hold and never automatically call the model again.

The UI restores unresolved jobs from the server after reload. Administrators
can review an uncertain request using the existing quota ledger and explicitly
charge or release it. The job still says that its image result is unconfirmed;
only its quota review is resolved. Imported images do not debit generation
quota. The original bytes are served by an authenticated, no-store route.

## Historical migration

The original authenticated `/api/backup` JSON may contain member password
hashes. It is parsed only in browser memory. Only explicitly selected image
bytes, name, category, prompt, original project title and a stable source ID
reach this API. Passwords, member rows and the full backup are never sent.
Legacy ownership is declared by the file, not remotely authenticated: users
must explicitly confirm ownership. Mixed owners and ambiguous rows stay
visible as unavailable. Remote images are fetched without credentials; failed
CORS/expired URLs stay unimported, with a visible error.

This migrates image assets, not the entire old project database or old password
hashes. Source identity/content deduplication is scoped to the current canvas
account. Admin tombstones prevent re-importing a deleted historical record.
Images adopted into multiple projects keep the same canonical ID so lock/delete
controls apply everywhere on the next online synchronization. Downloaded or
offline copies cannot be remotely recalled.

## Verification

`npm ci --ignore-scripts` in this folder installs the declared PGlite runtime.
`node --test tests/*.test.mjs` exercises actual PostgreSQL functions without a
live service or generation key. From the repository root run the full native
suite and `node --test tests/image-workshop.dom.mjs` (happy-dom required).
