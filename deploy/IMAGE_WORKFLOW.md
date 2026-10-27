# Unified image production workflow

The native workshop now follows the original image app's production sequence:
script, explicit asset breakdown, characters, locations, props, and storyboard.
Free-form generation and the personal gallery remain available on the same page.

## Creative continuity

- Characters have front/side/back (3:4) and eight expression (1:1) slots. Later
  views use the latest canonical front image as their identity reference.
- Locations have an orthographic overhead plan and N/W/E/S camera positions.
  Directional stills reference the plan; W/E/S also reference the N still.
- Seventeen visual styles and the original portrait blending, lighting, skin,
  texture, sharpness, and performance controls assemble an editable prompt.
- Storyboards use the shared `storyboard.shotData` contract, preserving action,
  dialogue, shot language, continuity, references, emotion, and OTS coverage.
  Reverse coverage requires two distinct valid character images.
- Workspaces are saved server-side per session owner and project with optimistic
  versions. A stale save retains its local draft and offers backup or reload.
- Image/job metadata is an allowlist: entityId, entityName, slot, episode,
  parentImageId, batchId. Old images default to `{}`. Original backups are still
  parsed locally; selected creative relations are hashed to stable native IDs.

## API additions

Apply the additive `image-schema.sql` again before publishing the new runtime.
It preserves existing media, quota entries, sessions, and accounts.

- GET `workspace&projectId=...`: `{workspace,version}`; an empty workspace has
  version 0. POST `workspace` accepts `{projectId,workspace,version}` and returns
  the saved version; a concurrent edit returns 409.
- GET `list` / `history`: page/pageSize plus projectId, kind, entityId, slot,
  episode and literal q filters. Ownership always comes from the session.
- GET `slots&projectId=...`: latest visible image per entity/slot, including
  fallback after deletion. Returns up to 3300 entries; no history scan polling.
- POST `delete` with `{id}` soft-deletes an owned unlocked image, preserving the
  file and past quota settlement. Administrator trash and restore remain separate.

Natural-language edits and crop/grade copies preserve the original image. A
frozen parent cannot be edited; ordinary reference use remains available.
Canonical deletion/freeze is checked again before storing an editing result.

## Batch and hosting boundaries

The browser shows the exact planned slots and estimated total before submission.
It then submits one independently identified, reserved and settled image at a
time. Stop/close/navigation prevents subsequent requests; the active request can
still finish. Failed, uncertain or interrupted results stop the queue and are
never automatically retried. Refreshing the workspace supports missing-slot
continuation using saved successful versions.

The adapter retains the existing 3-reference, 1K/2K, 3MiB result limits. This
release does not add mask painting, 4K, unattended server batches, or model keys.
Live paid generation requires configured server credentials and an authorized
provider/budget. Mock generation tests do not establish real model output quality.

## Verification

Run the core/backend tests and real-DOM workflow tests, then regenerate `pages`
and build from the `deploy` directory. The root Vinext scaffold is a separate
legacy target; the Vercel project builds `deploy/build.mjs`.

```sh
node --test tests/*.test.mjs deploy/tests/*.test.mjs tools/grok-mac-auth/*.test.mjs
node --test tests/image-workshop.dom.mjs tests/image-workbench.dom.mjs tests/script-workbench.dom.mjs
node scripts/export-github-pages.mjs
cd deploy
npm run build
```
