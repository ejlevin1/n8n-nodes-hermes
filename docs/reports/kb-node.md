STATUS: READY-FOR-LIVE

# Lane `kb-node` — n8n-nodes-hermes: Kanban bridge support (PLAN.md part B)

Branch: `feat/kanban-bridge` (pushed to `origin`). Worktree: `~/Development/n8n-nodes-hermes.wt/kb-node`.
Package version **not** bumped (still 0.1.0); everything is under `## Unreleased` in CHANGELOG.md.

The independent review (`kb-node-review`, VERDICT: CHANGES-REQUIRED at `d71b0c0`) has been
addressed in full — see "Review round 1 fixes" below. One major finding (N1, a real status the node
could not express) and eight minor/nits; the wire contract needed no change.

PLAN.md was delivered on the `kb-node-2` continuation. Part B is now complete: the credential, the
Kanban Task resource with all twelve operations, the error hints, the new trigger events, the Board
filter and the targets-config snippet. Everything the first session had built from guesses was
re-checked against PLAN.md; the two corrections it needed are in "Corrections to the first session"
below.

## What was built

### 1. Credential — `credentials/HermesKanbanBridgeApi.credentials.ts`

`hermesKanbanBridgeApi` / "Hermes Kanban Bridge API", exactly the three fields from PLAN.md part B:

| Field           | Type               | Default                            |
| --------------- | ------------------ | ---------------------------------- |
| **Base URL**    | string, required   | `http://host.docker.internal:9119` |
| **Host Header** | string, required   | `127.0.0.1:9119`                   |
| **Token**       | password, required | — (`kbb_…`)                        |

- Bearer token via `authenticate` (`Authorization: =Bearer {{$credentials.token}}`).
- **Host override**: the transport sets `Host` per request from `hostHeader` (skipped when blank), and
  the credential **test request** carries `headers: { Host: '={{$credentials.hostHeader}}' }`. It is
  deliberately _not_ in `authenticate`: that way the header is visible in the request options the tests
  assert on, instead of being injected inside `httpRequestWithAuthentication` where a unit test cannot
  see it. Trade-off recorded under "Known gaps" — the HTTP Request node would not get it for free.
- Test request: `GET /api/plugins/kanban-bridge/v1/health`, as specified.
- A notice explains the dashboard-only, loopback-`Host` constraint from the plan's platform facts.

### 2. Shared helper — `nodes/Hermes/helpers/kanbanBridge.ts` (the one module the lane asked for)

Holds everything both the credential and the resource need: `KANBAN_BRIDGE_CREDENTIAL`,
`KANBAN_BRIDGE_BASE_PATH` (`/api/plugins/kanban-bridge/v1`), `KANBAN_BRIDGE_HEALTH_PATH`,
`KANBAN_LIST_MAX_LIMIT` (200), `KANBAN_STATUSES`, `KANBAN_ACTIONS` (n8n operation → wire `action`),
`kanbanBridgeRequest`, `kanbanBridgeErrorMessage`, `extractTransitionReason`, `requiredString`,
`parseKanbanList`. The credential imports the health path from here, so the two can never drift (same
direction as the existing `HermesWebhookApi` → `helpers/webhookSignature` import).

`kanbanBridgeRequest` reuses the existing transport's `joinUrl`, `normalizeHermesError` and
`createHermesApiError` rather than duplicating them, and carries over its empty-POST-body workaround
(`{}` as a literal string, since n8n's helper drops an empty object body).

### 3. Kanban Task resource — `nodes/Hermes/resources/kanbanTask/`

All twelve operations from E1, each mapped onto the plan's routes:

| Operation          | Route           | Body                                                                                                                   |
| ------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Create             | `tasks/create`  | `board, title` + `body, assignee, priority, parents[], skills[], idempotency_key, triage, max_runtime_seconds, tenant` |
| Get                | `tasks/get`     | `board, task_id`                                                                                                       |
| Get Many           | `tasks/list`    | `board, status, assignee, limit`                                                                                       |
| Comment            | `tasks/comment` | `board, task_id, body`                                                                                                 |
| Complete (Approve) | `tasks/action`  | `action: complete` + `summary, result, metadata`                                                                       |
| Request Changes    | `tasks/action`  | `action: request_changes` + `reason`                                                                                   |
| Block              | `tasks/action`  | `action: block` + `reason`                                                                                             |
| Unblock / Archive  | `tasks/action`  | `action: unblock` / `archive`                                                                                          |
| Assign             | `tasks/action`  | `action: assign` + `assignee`                                                                                          |
| Reprioritize       | `tasks/action`  | `action: reprioritize` + `priority`                                                                                    |
| Edit               | `tasks/action`  | `action: edit` + `title` / `body`                                                                                      |

Field placement follows the inventory of the existing collections (dumped from `dist` after
`npm run build`, as the lane asked): **Board** is required on every operation, **Task ID** on the ten
that address an existing task, and every optional per-request setting sits in that operation's own
collection — `createOptions`, `completeOptions`, `editFields` ("Fields to Edit"), `listFilters`
("Filters"). Nothing optional was added at top level. Get Many splits `{tasks: […]}` into one output
item per task; everything else returns the response body as one item.

Local validation before anything goes on the wire: empty Board/Title/Task ID/Comment/Reason/Assignee,
an Edit with no fields, a non-integer Priority, and malformed Metadata JSON.

### 4. Error hints

`kanbanBridgeErrorMessage` covers exactly the five statuses the plan names, and leaves everything else
(5xx, 429, …) to the existing shared normaliser:

- **400** — names the server message and lists the required fields per operation.
- **401** — "rejected the token", points at `kbctl token list` and the `kbb_` prefix.
- **403** — names which of board / assignee / action fell outside the scopes, and the exact
  `kbctl token scope <label> …` fix. Scope context is threaded from the operation, so the message is
  specific (e.g. _not scoped for board "acquisitions" / assignee "deal-analyst" / action "assign"_).
- **404** — names task and board and explains that task IDs are per board.
- **409** — shows the `kanban_db` reason. `extractTransitionReason` looks for `reason` top-level, under
  `error`, and under `detail` (FastAPI's envelope), falling back to the server message, because the
  exact error envelope is the plugin lane's choice and PLAN.md does not pin it.

A network failure explains the dashboard-only deployment (launchd `me.ericlevin.hermes-dashboard`,
plugin enabled in `default`, Base URL / Host Header).

### 5. Trigger: bridge events, wildcard and ping

New event options: **Kanban Task Created / Review Requested / Changes Requested / Unblocked /
Archived** — the kinds Hermes fires no hook for — plus **Any Kanban Event**, a wildcard
(`KANBAN_ANY_EVENT = 'kanban_task_*'`) matching every `kanban_task_*` delivery including kinds the
plugin adds later, and the `kanban_bridge_ping`. Claimed/Completed/Blocked already existed under the
identical names, so one selection now matches either source — asserted by a test.

`isEventSelected` implements the wildcard; it deliberately does **not** widen to the Hermes
`on_kanban_*` hooks (those are not `kanban_task_*` deliveries). Ping handling is exactly as the wire
contract says: accepted when the wildcard is selected, otherwise HTTP 200 + ignored.

Event sets are split so each has one meaning: `KANBAN_HOOK_EVENTS` (Hermes `VALID_HOOKS`),
`KANBAN_BRIDGE_EVENTS` (what the plugin pushes, incl. the wildcard) and `KANBAN_EVENTS` (the union,
used by the Board-filter notice).

### 6. Targets config snippet

`buildKanbanTargetsYaml` emits the plan's shape, in its own notice gated on `KANBAN_BRIDGE_EVENTS`:

```yaml
plugins:
  entries:
    kanban-bridge:
      settings:
        targets:
          - name: n8n
            url: '<this node's Production URL>'
            boards: ['*']
            events: ['*']
            secret_env: HERMES_N8N_WEBHOOK_SECRET
```

The wildcard renders `events: ["*"]`; named selections render the list; non-bridge selections are
filtered out. The notice states plainly that these do **not** come from `hooks.outbound`, and the
existing `hooks.outbound` notice now says so too and points at it. The secret is only ever referenced
by `secret_env`, never inlined. `buildOutboundYaml` is untouched and still emits the `hooks.outbound`
shape for the Hermes hooks.

### 7. Docs

`README.md`: four-surface table; a **Hermes Kanban Bridge** credential section (enable plugin →
`kbctl token create --out` → credential, scopes, `n8n:<label>` attribution, why Base URL and Host
Header are separate); a **Kanban Task** operations section with the route/field table and the error
semantics; and a rewritten **Kanban events** section with the two-sources table, the wildcard, the ping,
the targets YAML and where each source puts the task fields. `CHANGELOG.md`: four new entries under the
existing `## Unreleased`, plus the two amended ones.

## Gate outputs

| Gate                                | Result                                   |
| ----------------------------------- | ---------------------------------------- |
| `npx vitest run`                    | **17 files, 351 tests passed**, 0 failed |
| `npx tsc --noEmit -p tsconfig.json` | exit 0, no diagnostics                   |
| `npm run lint`                      | exit 0, no errors or warnings            |
| `npm run build`                     | exit 0, "Build successful"               |

Baseline at the start of the build session was 15 files / 264 tests; the new work adds 87 tests in two
new files plus 30 appended to the existing Kanban trigger file, and changed nothing behaviourally in
the other resources. Test counts by new/changed file (review round 1 added 6):

- `test/kanbanBridgeCredential.test.ts` — 10 (new)
- `test/kanbanBridgeTask.test.ts` — 47 (new; 43 before round 1)
- `test/kanbanBridgeTrigger.test.ts` — 59 (was 29; 57 before round 1)

Round 1 re-ran every gate on the final tree: `npx eslint nodes credentials --ext .ts` is also exit 0,
`npm run build` emits `dist/credentials/HermesKanbanBridgeApi.credentials.js`, and
`npx prettier --check` is clean on all six changed files.

Prettier was run only on the files touched. Two exceptions, both pre-existing: `Hermes.node.json` and
`HermesTrigger.node.json` are not prettier-conformant on `main` either (prettier wants
`"categories": ["Development", "Utility"]` on one line), so adding alias entries to them was left in the
repo's own style rather than reformatting unrelated lines. `nodes/Hermes/resources/chat/sendMessage.ts`
is also non-conformant on `main` and was not touched.

## Corrections to the first session

The first session had no PLAN.md and said so. Checking its work against the real plan found two things
to fix, both now corrected:

1. **The Board filter read only `extra.board`.** That is right for Hermes hooks, but the bridge's wire
   contract puts `board` **top-level**, so bridge deliveries would have been dropped by any Board
   filter. `getEventBoard` now reads top-level `board` first, then `extra.board`; the filter and the
   output item both use it. Tested from both shapes.
2. **Bridge task fields would have been silently discarded.** `normalizeEvent` returns a fixed-shape
   item, so the bridge's top-level `task_id, event_id, event_kind, run_id, title, status, assignee,
priority, actor, payload` had nowhere to go. They are now folded into `extra` for bridge deliveries
   only — which also makes the two sources read alike (`extra.task_id` either way). An explicit `extra`
   in the body still wins; absent keys are omitted rather than nulled.

Everything else it built (the eight Hermes Kanban hook options, the Board filter's placement inside the
existing Filters collection, `board` top-level on the item, the signature work) matched PLAN.md and was
kept. Its "PLAN.md missing" deviation is resolved and removed.

## Deviations from PLAN.md

1. **"List" is labelled "Get Many" (value `getAll`).** PLAN.md part B names the operation _List_. n8n's
   UX guidelines and the repo's own convention (Cron Job, Session) use _Get Many_, and
   `n8n-nodes-base/node-param-description-wrong-for-limit` enforces the paired `Limit` wording, which
   is part of the same pattern. The wire call is unchanged: `POST v1/tasks/list`. Label only.
2. **"Any Kanban Event" has no `(kanban_task_*)` suffix in its label.** PLAN.md writes the option as
   `Any Kanban Event (kanban_task_*)`; n8n's option-name title-case lint rejects the bare lowercase
   identifier (it autofixes to the nonsense `Kanban_task_*`). The pattern is in the option's
   description and in the README table instead.
3. **Reason is `required` for Request Changes and Block.** PLAN.md lists it as a per-action field
   without saying whether it is mandatory; `request_changes`/`block` are meaningless without one, and a
   client-side check beats a 400. If the plugin accepts a reason-less block, this is stricter than the
   server by one field.
4. **Create's Max Runtime (Seconds) shows a default of 1800 in the collection UI.** Collection options
   need a `default`; it is only sent when the user adds the field, so an untouched Create still omits
   `max_runtime_seconds` and the board default applies.
5. **PLAN.md's "Statuses:" line omits `scheduled`; the node follows the source instead.** PLAN.md lists
   eight statuses (`triage`, `todo`, `ready`, `running`, `blocked`, `review`, `done`, `archived`). The
   real set is nine: `DEFAULT_WORKFLOW.columns` includes `Column("scheduled", "Scheduled", "⏱",
drag_target=False)` between `todo` and `ready`, and `DEFAULT_STATUSES =
frozenset(DEFAULT_WORKFLOW.keys()) | {ARCHIVED}` — `hermes_cli/kanban_workflow.py:114-142`. It is
   persisted, not cosmetic: `kanban_db.py:3878` writes `SET status = 'scheduled'` and `unblock_task`
   resumes out of it (`kanban_db.py:3589`, `WHERE id = ? AND status IN ('blocked', 'scheduled')`).
   Because `kanban_db.py:1427` validates the `status` filter against `VALID_STATUSES`, the bridge
   already accepted `status: "scheduled"` on `v1/tasks/list` — only Get Many could not express it.
   The first session followed PLAN.md here and did not record the deviation; found by `kb-node-review`
   as N1 and fixed in `3727b4e`. `KANBAN_STATUSES` is now in dashboard column order.

## Known gaps

1. **Nothing was tested against a live bridge** — the plugin is being built in parallel, so every test
   runs against fakes shaped by the wire contract. The parts most worth watching on first live run:
   - the **`Host` header actually surviving** n8n's request pipeline (axios does pass an explicit
     `Host` through, but this has not been observed against the real dashboard);
   - the **error envelope**. The shipped plugin raises `HTTPException(detail=<str>)`, so the reason
     reaches the user through `normalizeHermesError`'s `detail` branch and the `server` fallback, not
     through `extractTransitionReason`; round 1 added tests for that real path (N3). The
     three-envelope search is kept as defence if the plugin later returns a structured body.
     403/404/401 hints only need the status code, so they are safe either way.
2. **The `Host` override is not in the credential's `authenticate`.** A user wiring this credential into
   a plain HTTP Request node would have to add the header manually. Deliberate (see §1); say the word
   and it moves.
3. **No de-duplication.** Delivery is at-least-once and `delivery_id` + `event_id` are both surfaced,
   but the trigger does not de-duplicate. Same as the existing behaviour for `hooks.outbound`.
4. **Board is free text, not a dropdown.** The bridge has no list-boards route in PLAN.md.
5. **`kbctl`'s own routes (`targets test`, `status`, token management) are not exposed** in the node —
   PLAN.md part B does not list them as operations.

## What the parent must do

### Deploy

1. Merge `feat/kanban-bridge` into your merged `main` and pull it on the Mac mini.
2. From the Mac mini's folder: `./n8n-mgmt nodes update dev n8n-nodes-hermes --yes`

Nothing here needs the plugin to be present: the trigger changes and the resource description load
fine without it. Only executing a Kanban Task operation needs the bridge running.

### Create the credential

On the Hermes host, with the plugin enabled in the `default` profile and the dashboard restarted:

```bash
kbctl token create --label n8n-dev --boards <board> --assignees <assignee> --out ~/n8n-dev.token
```

Then in n8n: **Credentials → New → Hermes Kanban Bridge API**

- **Base URL**: `http://host.docker.internal:9119` (Docker n8n) or `http://127.0.0.1:9119` (same host)
- **Host Header**: `127.0.0.1:9119` — leave it at the default
- **Token**: the `kbb_…` value from `~/n8n-dev.token`

Press **Test**: it calls `GET /api/plugins/kanban-bridge/v1/health` and a pass proves the token is
valid, unrevoked and that the `Host` override is accepted.

### Verify the resource live

1. Hermes node → Resource **Kanban Task** → **Create**, Board `<board>`, Title `kbb_test_task_1`.
   Expect `{task_id, created: true, status}`.
2. Re-run it with the same **Idempotency Key** under Options → expect `created: false` and the same
   `task_id`.
3. **Get** that task; **Comment** on it; **Reprioritize** it to 5; **Assign** it; **Block** then
   **Unblock** it; **Get Many** with Status `ready`, then again with Status **Scheduled** — that
   option only exists after the N1 fix, and should return 200 (an empty list is fine).
4. Negative checks, which exercise the hints:
   - a board outside the token's scopes → 403 naming the board and `kbctl token scope`
   - `task_id` that does not exist → 404 saying task IDs are per board
   - **Complete** a task that is in `todo` → 409 with the `kanban_db` reason
   - a token revoked with `kbctl token revoke` → 401 pointing at `kbctl token list`
5. Finally **Archive** the test task.

### Verify the trigger live

1. Hermes Trigger → Events: select **Any Kanban Event**. Confirm the Kanban-bridge notice appears with
   the `targets` YAML, and that **Add Filter** offers **Board**. Copy the Production URL.
2. Put a 32+ character secret in the **default profile's** `.env` as `HERMES_N8N_WEBHOOK_SECRET=…`, add
   the `targets` block from the notice to the default profile's `config.yaml` (replacing `url`, and
   narrowing `boards` to the real board), and restart the dashboard.
3. Create a **Hermes Outbound Webhook** credential whose Signing Secret is that same value, and attach
   it to the trigger. Leave its Base URL empty.
4. `kbctl targets test n8n` → the `kanban_bridge_ping` should start one execution, with
   `$json.event == "kanban_bridge_ping"`.
5. Drive a task through create → review → approve from the Hermes side and confirm executions for
   `kanban_task_created`, `kanban_task_review_requested` and `kanban_task_completed`, with
   `$json.board` populated and `$json.extra` carrying `task_id`, `event_id`, `event_kind`, `title`,
   `status` and the event `payload`.
6. Set the Board filter to a **different** board and confirm deliveries stop starting executions while
   still being acknowledged with HTTP 200. **The ping behaves differently from what the first draft of
   this report said:** `ping_payload` always carries a board — the target's first named board, else
   `*` (`plugin/core/events.py:131-149`, `plugin/scripts/kbctl.py:286`). So with `boards: [<real
board>]` in the target, a Board filter set to that board will **start** an execution for the ping;
   only a wildcard target's `board: "*"` is dropped by a named filter. Expect that, not silence (N2).

7. **Watch the `Host` override on the first live call** — the one thing no unit test can reach. The
   credential **Test** button is the cheapest proof: it sends `Host: ={{$credentials.hostHeader}}`
   explicitly (`credentials/HermesKanbanBridgeApi.credentials.ts:71-78`), while `authenticate`
   deliberately does not carry it. If Test passes from the Docker n8n, every resource call will too. If
   it fails, compare against `curl -H 'Host: 127.0.0.1:9119' http://host.docker.internal:9119/…health`
   from inside the n8n container to separate "n8n dropped the header" from "the dashboard refused".

## Review round 1 fixes

`kb-node-review` reviewed `d71b0c0` and returned CHANGES-REQUIRED: one major (N1) and eight
minor/nits. All nine are addressed in two commits. No feature, policy or wire-contract change — the
reviewer confirmed routes, bodies and event names/keys already match the plugin, and they are
untouched.

| id  | sev   | fix                                                                                                                                                                                                                                                                                                                 | commit    |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| N1  | major | `scheduled` added to `KANBAN_STATUSES` after `todo` (dashboard column order), so Get Many's Status filter can select it; 409 hint text and README enumerate all nine; test assertion updated; PLAN.md deviation recorded above with the `kanban_workflow.py:114-142` citation.                                      | `3727b4e` |
| N2  | minor | `pingEvent` fixture now carries `board: 'acquisitions'` with a second `board: '*'` case; the board-filter test was asserting against a body the bridge never sends. Notice, README and live step 6 reworded to "the ping carries the target's board (or `*` for a wildcard target), so a Board filter may drop it". | `e15eb61` |
| N3  | minor | Two 409 cases added with the plugin's real `{detail: "<string>"}` envelope, pinning the `server`-fallback path that actually carries the reason today.                                                                                                                                                              | `e15eb61` |
| N4  | minor | `typeOptions: { numberPrecision: 0 }` on Create's Priority and Max Runtime (and on Reprioritize's Priority, which only guarded at run time), plus 422 folded into the 400 branch so FastAPI's pydantic error gets the same "whole numbers" hint.                                                                    | `e15eb61` |
| N5  | minor | One sentence in `KANBAN_EVENTS_NOTICE` and the README: on bridge deliveries `profile` is the task's assignee, so a Profile filter set to a Hermes profile silently drops every bridge event — prefer the Board filter and leave Profile empty.                                                                      | `e15eb61` |
| N6  | nit   | Notice now says _task-scoped_ Kanban events carry those coordinates, and that `on_kanban_dispatch_tick` is board-scoped and carries no task.                                                                                                                                                                        | `e15eb61` |
| N7  | nit   | Get Many's description: "highest priority first and oldest first within a priority", matching `ORDER BY priority DESC, created_at ASC` (`kanban_db.py:1447`).                                                                                                                                                       | `e15eb61` |
| N8  | nit   | README note only, UI unchanged as the reviewer suggested: `tasks/list` has no offset or cursor and caps at 200, so there is nothing for a Return All to page through.                                                                                                                                               | `e15eb61` |
| N9  | nit   | Comment on `extractTransitionReason` now says the three-envelope search is deliberate, cheap defence and that the shipped plugin only ever hits the `server` fallback.                                                                                                                                              | `e15eb61` |

Deviations from the reviewer's suggested fixes, both widenings rather than narrowings:

- **N4** — `numberPrecision: 0` was also added to Reprioritize's Priority, which the finding did not
  ask for. It already rejected decimals at run time, so leaving it as the only integer field the UI
  accepted decimals in would have been inconsistent; the run-time guard and its test are unchanged.
- **N4** — the optional 422 fold was taken. Without it a decimal Priority surfaces as a raw FastAPI
  error even though the 400 hint already promises those fields are whole numbers.

Nothing else in the review needed action: the reviewer's "What checks out" section (gates, wire
contract against `origin/plugin/v1` @ `d4ca41d`, correctness against the real Hermes source, secrets
hygiene) reported no defects, and the four pre-existing PLAN.md deviations were accepted as justified.

## Proposed (not built)

- **`board` as a `loadOptions` dropdown**, if the bridge gains a list-boards route.
- **Drop Duplicate Deliveries** option on the trigger — a bounded LRU over `delivery_id` / `event_id`
  would make Kanban automations idempotent under at-least-once retry.
- **A Bridge Health operation** (or a System sub-operation) so a workflow can check `scopes` and
  `token_label` without the credential test.
- **A warning on `on_kanban_dispatch_tick`**: it fires once per dispatcher tick per board and is by far
  the highest-volume Kanban option.
- **Wire the trigger's `create`/`delete` webhook methods to the bridge**, if `targets` ever becomes
  writable over REST; today they are no-ops and the user pastes YAML.
