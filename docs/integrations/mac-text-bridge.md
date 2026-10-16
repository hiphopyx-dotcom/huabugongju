# Mac text generation bridge

The owner verified official Grok CLI login and a real text response on their Mac mini. This change connects existing phone accounts to that machine for text only. Images and video are excluded until separately verified.

The existing Vercel application authenticates users and assigns immutable Grok account IDs. An admin downloads a per-account Mac configuration with a restricted worker credential. Only its hash is stored server-side. It grants that worker access to text jobs for one Grok account, not user administration. Rotating or revoking the configuration invalidates the previous credential. The Grok login credentials remain with the official CLI on the Mac.

The Mac maps this configuration to an existing local profile and actively polls the same production origin over HTTPS. It listens on no local or public port. A database lease serializes execution per account. The worker executes a tool-disabled CLI call in a private empty work directory with a deadline. It sends only the text result or a bounded error category back. No API key fallback, shell command interpolation, debug logs, or credential export is allowed.

A member submits a prompt through a separate text-generation dialog. The server selects their current assignment, never an account ID supplied by the member. Each job captures the account and member session version. Claims and completions recheck permission so disabled or reassigned accounts cannot continue queued jobs. Results are visible only to their submitter. Admins can submit test jobs using an explicit account selector but cannot list other members' text jobs through this endpoint.

Jobs require a recent worker heartbeat. Duplicate submission keys return the same job. Queue limits bound backlog. Expired running jobs fail without automatically repeating a potentially billable generation. Completion uses a per-job lease token and accepts idempotent retries. Server and worker bounds prevent overlapping expired executions.

Validation covers admin-only worker provisioning, member isolation and assignment tampering, revocation, single execution leases, duplicate requests, disconnect/expiry, invalidation after reassignment, empty/oversized results, local environment isolation, and injection-safe CLI arguments. Post-deployment real execution still needs the owner to download one configuration and start the worker on the already-authorized Mac. Do not claim end-to-end production generation before that test.
