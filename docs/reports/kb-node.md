STATUS: PARTIAL

# Lane `kb-node` — n8n-nodes-hermes: Kanban bridge support

Branch: `feat/kanban-bridge` (pushed to `origin`). Worktree: `~/Development/n8n-nodes-hermes.wt/kb-node`.

## Blocking problem: PLAN.md was never delivered to this lane

The lane prompt says "The plan you implement (PLAN.md) is appended below your lane prompt" — **nothing
was appended**. PLAN.md does not exist anywhere on mbp-m2. What I checked:

- `~/Development/hermes-kanban-bridge/README.md:5` points at `docs/PLAN.md`, but that repo is the bare
  `83f0ea5 Initial skeleton` commit and contains only `.gitignore`, `README.md`,
  `docs/reports/.gitkeep`, `plugin/.gitkeep`. Same for the `kb-plugin` worktree and the `plugin/v1` branch.
- `git log --all --name-only`, `git stash list` and `git for-each-ref` in both repos: no PLAN.md in any
  commit, branch or stash.
- Filesystem grep for `kanban_task_moved|kanban/tasks|kanbanTask|kanban-bridge` and for `kb-plugin`
  across `~/Development`, `~/Documents`, `~/Desktop`: only the two skeleton READMEs and this repo's README.
- The only `PLAN.md` files on the machine (`~/Development/hermes-tool-approvals/docs/`,
  `~/Development/_import/docs/`) are the **tool-approvals/iPhone** project, unrelated to this lane.

So I built the part of this lane that the **read-only Hermes source determines on its own**, and did
**not** invent the part that only PLAN.md can specify. I deliberately did not guess the bridge's REST
contract: the `kb-plugin` lane is implementing the server side from that same document in parallel, so
invented paths/bodies would be near-certain to mismatch, and a node that posts to wrong URLs is worse
than an absent one.

## What was built

### 1. All Kanban trigger events (`nodes/HermesTrigger/events.ts`)

The trigger offered only `kanban_task_completed` and `kanban_task_blocked`. Hermes' own
`VALID_HOOKS` defines **eight** Kanban hooks (`~/Development/_ref/hermes-agent-b222bce/hermes_cli/plugins.py:108`,
Kanban blocks at lines 157-176). All eight are now selectable, with descriptions taken from the kwargs
documented at those lines:

| Events option             | Hook value                     |
| ------------------------- | ------------------------------ |
| Kanban Dispatch Tick      | `on_kanban_dispatch_tick`      |
| Kanban Task Blocked       | `kanban_task_blocked`          |
| Kanban Task Claimed       | `kanban_task_claimed`          |
| Kanban Task Completed     | `kanban_task_completed`        |
| Kanban Task Updated       | `on_kanban_task_updated`       |
| Kanban Worker Exited      | `on_kanban_worker_exited`      |
| Kanban Worker Spawned     | `on_kanban_worker_spawned`     |
| Kanban Worker Stale Claim | `on_kanban_worker_stale_claim` |

Exported as `KANBAN_EVENTS` (the one shared constant the node, the notice `displayOptions` and the tests
all key off). Events options total 18 → 24, still alphabetical by name, no duplicates.

### 2. Board filter, in the existing Filters collection

Per the lane instruction to place fields like their siblings, I ran the inventory first
(`npm run build` then dumping `description.properties` from `dist`) and confirmed the conventions:
per-operation optional settings live in each operation's `options`/`additionalFields`/`updateFields`
collection, and trigger narrowing lives in the trigger's `filters` collection next to Platform,
Session ID and Tool Name. The Board filter is therefore an **option inside `filters`**, not a top-level
property — asserted by a test so it can't drift.

Semantics mirror the existing Platform filter exactly: comma-separated list, matched case-insensitively,
and an event lacking the field is dropped once the filter is set. It matches **`extra.board`**, not a
top-level `board`, because of the wire shape below. Sorted ahead of Platform to satisfy the n8n lint
rule on collection ordering.

### 3. `board` on the output item

`normalizeEvent` now surfaces `board` from `extra.board`, exactly as it already does for `platform`,
`profile`, `sessionId` and `toolName` — every other filtered field is also exposed top-level, so this
follows the established convention rather than adding a new one. Output item is now
`{event, profile, platform, board, sessionId, toolName, toolInput, cwd, extra, deliveryId, timestamp}`.

### 4. Kanban setup notice

`kanbanEventsNotice` shows only when a Kanban event is selected (`displayOptions.show.events: KANBAN_EVENTS`),
explaining that the task coordinates arrive in `extra`, that `board` is also top-level, and that
`on_kanban_task_updated` carries `changed_fields` as field **names only, never values** (a privacy
property stated at `hermes_cli/plugins.py:171`).

### 5. Wire shape, verified against source (not guessed)

- `agent/outbound_webhooks.py:249` `_serialize_payload` → body is
  `{hook_event_name, profile, ...<_payload_fields>, delivery_id, timestamp}`.
- `agent/shell_hooks.py:87` `_payload_fields` + `:49` `_TOP_LEVEL_PAYLOAD_KEYS = {"tool_name", "args",
"session_id", "parent_session_id"}` → **every other hook kwarg goes into `extra`**. So `board`,
  `task_id`, `assignee`, `run_id`, `profile_name` are all in `extra`, which is why the Board filter
  reads `extra.board`.
- `agent/outbound_webhooks.py:263` `_build_delivery` → signature is
  `X-Hermes-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`, plus `X-Hermes-Event` and
  `X-Hermes-Delivery`. This is what the node's existing `verifySignature` already implements, so the
  bridge-shaped-body signature tests exercise the real scheme.

### 6. Tests — `test/kanbanBridgeTrigger.test.ts` (26 tests, new file)

Covers: the event catalogue matches `VALID_HOOKS` exactly; every Kanban event is registered and the
options stay sorted/duplicate-free; description shape (Board is inside `filters`, correct type/default,
collection stays sorted, notice gated on Kanban events); event matching incl. the `X-Hermes-Event`
header fallback; the Board filter (case-insensitive, multi-board, non-match, missing-board drop, unset,
and composition with the Profile filter); normalized output (`board` top-level, coordinates preserved in
`extra`, `board: null` for non-Kanban events, `changed_fields` passthrough); and the webhook end-to-end
with a **bridge-shaped body** — signed delivery starts the workflow, signature is verified over the exact
raw bytes, a tampered body and an unsigned body both get HTTP 401, a non-matching board is acknowledged
HTTP 200 without starting the workflow, and stale deliveries are rejected/accepted per the option.

All synthetic values only (`kbb_test_...`, `Alex Example`); no real hostnames, keys or personal data.

### 7. Docs

`README.md`: the Trigger events table now lists all eight Kanban hooks; the Filters paragraph documents
Board; a new **Kanban events** subsection gives the per-event `extra` additions and the commit/lock
ordering. `CHANGELOG.md`: three entries under the existing `## Unreleased`. Package version **not** bumped.

## Gate outputs

| Gate                                | Result                                   |
| ----------------------------------- | ---------------------------------------- |
| `npx vitest run`                    | **15 files, 261 tests passed**, 0 failed |
| `npx tsc --noEmit -p tsconfig.json` | exit 0, no diagnostics                   |
| `npm run lint`                      | exit 0, no errors or warnings            |
| `npm run build`                     | exit 0, "Build successful"               |

Baseline before my changes was 14 files / 235 tests; I added 26 and changed 0 behaviourally
(see deviation 1). Prettier run only on the files I touched (all already conformant except README.md).

## Deviations from PLAN.md

PLAN.md was unavailable, so "deviation" can only be measured against the lane prompt's summary of it.

1. **`test/trigger.test.ts:104` edited** (outside a `kanbanBridge*` file). That test asserts the
   normalized item with `toEqual`, i.e. an exact-shape assertion, so adding `board` to the output broke
   it. I added `board: null` to the expectation — the assertion still pins the full shape and nothing was
   weakened or skipped. This is the only pre-existing file changed other than the trigger node, README
   and CHANGELOG.
2. **Event names come from the Hermes source, not the plan.** The lane prompt says "the new trigger
   events" without naming them; I took the eight Kanban hooks in `VALID_HOOKS`. If PLAN.md instead
   specifies bridge-invented event names, these are additive and correct for the hooks Hermes already
   fires, but the plan's names would need adding on top — a one-array change.
3. **`board` exposed top-level on the output item** is slightly beyond a literal reading of "Board
   filter". I did it because every other filtered field is exposed that way and the lane instruction is
   to place things like their siblings; it is a pure addition. Easy to revert if the plan says otherwise.

## Not built — needs PLAN.md

These are the parts whose contract only PLAN.md defines. Each needs the listed specifics before it can
be written; I have **no** basis in the read-only source for any of them, because the bridge plugin's
HTTP surface does not exist in `_ref`.

1. **Bridge credential** (`credentials/HermesKanbanBridgeApi.credentials.ts`) — need: credential name/
   display name, field list, how the bearer token is sent (`Authorization: Bearer` assumed but unstated),
   the exact **Host header override** field semantics (fixed value? only when set? applied to every
   request?), and the health path for the test request (`/health`? `/kanban/health`? versioned?).
2. **Kanban Task resource** (`nodes/Hermes/resources/kanbanTask/`) — need: the operation list ("all
   operations" is unresolvable), and per operation the HTTP method, path, path/query params and request
   body shape. Also whether it registers as a new `ResourceValue` on the existing Hermes node (and so
   needs its own `credentials[].displayOptions` entry like `webhookRoute` has) or as a separate node.
3. **Error hints** — the lane prompt names 401 token / 403 scope / 404 / 409 reason, but the hints must
   key off the bridge's actual error `code` values (the existing `normalizeHermesError` switches on
   `code`, e.g. `gateway_auth_failed`, `permission_denied`). Need the bridge's code strings and the 409
   `reason` field's location in the body.
4. **Shared helper module** — the lane asks for one; it has nothing to hold until (1)-(3) are specified.
5. **kanban-bridge targets config YAML snippet** — the bridge has its **own** targets config (per its
   README it does "signed push", separate from `hooks.outbound`). Need the config file path, the block
   structure and the key names. The existing `buildOutboundYaml` emits the `hooks.outbound` shape and is
   almost certainly the wrong one; I left it untouched rather than guess.
6. **Ping handling** — not a concept in the current trigger or in Hermes' outbound webhooks. Need the
   ping's event name/body and the expected response (HTTP 200 + what payload?) before implementing.

## What the parent must do

### To unblock the rest of this lane

Re-run the lane with PLAN.md actually appended, or commit it to
`~/Development/hermes-kanban-bridge/docs/PLAN.md` (where its README already points) and say so. Items
1-6 above are the minimum set it must answer. Everything already built is independent of those answers
and does not need redoing.

### To deploy what is built

This branch only changes the trigger's event list, one filter and one output field — it is safe to merge
and deploy on its own, and needs no bridge plugin present.

1. Merge `feat/kanban-bridge` into your merged `main` and pull it on the Mac mini.
2. From the Mac mini's folder: `./n8n-mgmt nodes update dev n8n-nodes-hermes --yes`

### To verify live

No new credential is required — the trigger keeps using the existing **Hermes Outbound Webhook API**
credential (Base URL optional, Signing Secret required). If you don't have one yet: in n8n, Credentials →
New → _Hermes Outbound Webhook API_, set **Signing Secret** to a random value of 32+ characters, and put
that same value in `~/.hermes/.env` as `HERMES_N8N_WEBHOOK_SECRET=…`. Leave Base URL empty unless you
want the credential test to probe `<base>/health`.

Then:

1. In n8n, open a Hermes Trigger node and confirm the Events dropdown now lists all eight Kanban entries,
   that selecting one shows the Kanban notice, and that **Add Filter** offers **Board**.
2. Add to `~/.hermes/config.yaml` and restart Hermes (gateway or CLI session):

   ```yaml
   hooks:
     outbound:
       - name: n8n
         url: "<the node's Production URL>"
         events: [kanban_task_claimed, kanban_task_completed, on_kanban_task_updated]
         secret_env: HERMES_N8N_WEBHOOK_SECRET
         timeout: 10
   ```

   The node's setup notice renders this block for whatever events are selected — paste from there so the
   `events` list matches (unlisted events are never sent).

3. Drive a Kanban task through claim → complete on a board and confirm the workflow fires, that
   `$json.board` is populated and `$json.extra` carries `task_id`/`assignee`/`run_id`, and that setting
   the Board filter to a _different_ board stops executions (the delivery is still acknowledged 200).

## Proposed (not built)

- **`on_kanban_dispatch_tick` is high-volume** — it fires once per dispatcher tick per board. Worth a
  warning in its option description, or a default-off guard, once real tick rates are known.
- **Delivery de-duplication.** `deliveryId` is already surfaced but the trigger never de-duplicates;
  Hermes retries on connection errors and 5xx. A "Drop Duplicate Deliveries" option with a bounded
  in-memory LRU of recent `delivery_id`s would make Kanban automations idempotent.
- **`board` as a `loadOptions` dropdown** instead of free text, once the bridge can list boards.
- The trigger's `checkExists`/`create`/`delete` are no-ops because `hooks.outbound` has no API. If the
  bridge's targets config is writable over its REST API, the Kanban path could register itself properly
  and drop the paste-this-YAML step.
