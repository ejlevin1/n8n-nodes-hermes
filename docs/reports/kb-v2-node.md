STATUS: READY-FOR-LIVE

Lane `kb-v2-node` — n8n-nodes-hermes support for kanban-bridge **v0.2.0**, PLAN.md part C.
Branch `feat/kanban-v2` off `main` @58886ae, pushed to `origin/feat/kanban-v2`. Not released —
the version stays `0.1.0` and everything lands under `## Unreleased`, because releasing is the
parent's call.

Contract read from `origin/plugin/v2` @**99ad641** (re-fetched before the final gate run; the
branch had not moved since the first read, so no shape drift to reconcile).

## What was built

| PLAN.md part C item                                        | Where                                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation **Request Review** (summary, metadata, reviewer) | `nodes/Hermes/resources/kanbanTask/description.ts` (`requestReviewOptions`), `index.ts` (`buildActionBody` case `requestReview`)                                                |
| Operation **Request Changes (Human)** (reason, actor)      | `description.ts` (`requestChangesHumanNotice`, `requestChangesHumanOptions`, shared `reason`), `index.ts` (case `requestChangesHuman`)                                          |
| Operation **Reject Case** (reason)                         | `description.ts` (`rejectCaseNotice`, shared `reason`), `index.ts` (case `rejectCase`)                                                                                          |
| Create option **Put Into Review** → `initial_review`       | `description.ts` (`createOptions`: `putIntoReview`, `reviewMetadata`, `reviewSummary`), `index.ts` (`buildCreateBody`)                                                          |
| **Get** output includes `runs`                             | already passed through verbatim; now pinned by a test and documented (`KANBAN_GET_MAX_RUNS`, the Get operation description, README)                                             |
| Trigger passes **`run_metadata`** through untouched        | `nodes/HermesTrigger/events.ts` (`KANBAN_BRIDGE_EXTRA_KEYS`)                                                                                                                    |
| Wire vocabulary                                            | `nodes/Hermes/helpers/kanbanBridge.ts` (`KANBAN_ACTIONS`, `KANBAN_GET_MAX_RUNS`), `index.ts` (`KANBAN_ROUTES`), `description.ts` (`TASK_ID_OPERATIONS`)                         |
| README + CHANGELOG                                         | `README.md` (operations table + new `#### Human-in-the-loop operations`, the `runs` shape, `extra.run_metadata` in the Kanban events section), `CHANGELOG.md` (`## Unreleased`) |

Files touched: 6 source/test + README + CHANGELOG. No new files, no new credential, no
`package.json` change (no node or credential was added or renamed, so `n8n.nodes` /
`n8n.credentials` are untouched).

### Design points worth knowing

- **Field placement follows the repo convention**: required fields are top-level properties,
  optional ones live in an `Options` collection. Request Review is all-optional, so it is a
  collection only (`Metadata`, `Reviewer`, `Summary`); Request Changes (Human) has a required
  Reason top-level and `Actor` in Options; Reject Case has only the required Reason. Collection
  options are alphabetical by display name, which a test pins, because n8n renders them in array
  order.
- **`reason` is one shared property across four operations**, not four properties with the same
  name — two properties sharing a name with mutually exclusive `displayOptions` is legal n8n but
  makes `getNodeParameter('reason')` depend on display context. The two operations whose Reason
  has consequences beyond an event payload get a `notice` instead: Reject Case explains the
  archive cascade, Request Changes (Human) explains why it exists next to Request Changes.
- **Put Into Review is a boolean toggle plus two flat fields, not a nested group.** A
  `fixedCollection` nested inside a `collection` is not reliably rendered by n8n, and
  `initial_review`'s two fields are both optional on the bridge — so `{}` is a legal
  descriptor-less gate card and the _toggle_, not the presence of a field, is what asks for one.
  Review fields set with the toggle **off** are a `NodeOperationError`, not a silent drop: the
  silent version would create a _queued_ card when the workflow asked for a gate, which is the
  one failure the option exists to prevent. Same class of local validation the resource already
  does for `Edit needs a Title or a Body` and `Priority must be a whole number`.
- **A 403 on Request Review names the Reviewer.** `reviewer` reassigns the card, so the bridge
  enforces the token's `assignees` allow-list on it (`_act_request_review` →
  `_require_assignee`, `plugin_api.py:536`). The node sets `ctx.assignee = reviewer` so the
  existing 403 message reads `board "…" / assignee "…" / action "request_review"`, the way Assign
  already does — otherwise the message would name the action and leave the user guessing which
  scope list to widen.
- **`run_metadata` is folded in with the other top-level bridge keys and nothing else.**
  `pickDefined` copies the reference, so the object arrives as `extra.run_metadata` byte-for-byte
  — no reshaping, no flattening, no stringifying — which is the requirement, since it can hold a
  whole `hitl` descriptor. It is omitted when absent or null, exactly like `actor` and `run_id`.
  A test asserts object _identity_ (`toBe`), not just deep equality, so a future refactor that
  copies or normalises it fails.
- **`request_changes` was left completely alone.** The bridge kept both verbs and they are
  different transitions, so the node exposes both operations rather than adding a flag to one.

## Gate output

All four gates green on `d165687`, the pushed tip.

```
npx vitest run
  Test Files  17 passed (17)
       Tests  376 passed (376)

./node_modules/.bin/tsc --noEmit -p tsconfig.json     exit 0  (no output)
npm run lint                                          exit 0  (no findings)
npm run build                                         exit 0  ("Build successful")
```

Baseline on `main` before this lane: **351 passed**, so **+25 tests**. Per touched file:

| File                               | Tests | Was |
| ---------------------------------- | ----- | --- |
| `test/kanbanBridgeTask.test.ts`    | 67    | 47  |
| `test/kanbanBridgeTrigger.test.ts` | 64    | 59  |

Prettier was run with `--write` on exactly the files this lane touched
(`nodes/Hermes/helpers/kanbanBridge.ts`, `nodes/Hermes/resources/kanbanTask/{description,index}.ts`,
`nodes/HermesTrigger/events.ts`, `test/kanbanBridge{Task,Trigger}.test.ts`, `README.md`,
`CHANGELOG.md`) and `--check` passes on all of them.

What the new tests cover:

- **Each new operation's exact request body**: `request_review` with and without every option
  (the no-options case sends only `{board, task_id, action}` — the gate-card call),
  `request_changes_human` with and without `actor`, `reject_case`, and that the response's
  `archived_descendants` reaches the output item intact.
- **`initial_review`**: sent when the toggle is on, with summary and metadata; `{}` for a
  descriptor-less gate; absent when the toggle is off; correct alongside other create fields.
- **Local validation before anything is sent**: a blank Reason on both new reason-taking
  operations, invalid Request Review Metadata (bad JSON and a JSON array), invalid Review
  Metadata on Create, and review fields left behind with the toggle off.
- **The 403 on Request Review names the Reviewer**, from a real mocked request.
- **Get passes `runs` through untouched**, including a `runs[].metadata` holding a `hitl`
  descriptor, asserted both deep-equal and element-wise.
- **`run_metadata`** on `review_requested` and on `completed`, by object identity; absent when
  the delivery omits it or sends `null`; never invented on a Hermes hook delivery.
- **Contract pins updated, not relaxed**: the operation list (15), `KANBAN_ROUTES`,
  `KANBAN_ACTIONS` (including an explicit assertion that `request_changes` and
  `request_changes_human` stay distinct), the shared `reason`'s display list, the new Options
  collections' contents and alphabetical order, the notices, and that the Get description states
  the run count.

## Deviations from PLAN.md

1. **Request Review exposes `Reviewer`, which the lane prompt's field list omits.** The lane
   prompt says "Request Review (summary, metadata JSON)"; PLAN.md **part B** specifies the action
   as `request_review (summary, metadata, reviewer)` and the bridge implements it
   (`plugin_api.py:528-532`, `ActionBody.reviewer`). I followed part B, because without it the
   node cannot reach a documented field of the verb it is wrapping, and `reviewer` is the second
   of only two ways to point a card at a profile. It is optional, in Options, defaults absent,
   and its description says to leave it empty for a gate card — which is the part B warning that
   a reviewer "would quietly turn the gate into an agent-step review card"
   (`plugin_api.py:243-252`). If the parent wants it gone it is one option object and one `if`.
2. **The Create option is named "Put Into Review", not "Put into review with descriptor".**
   PLAN.md part C uses the longer phrase; the lane prompt uses the shorter one. n8n display names
   are Title Case, and the descriptor is carried by the separate **Review Metadata** field, so
   naming it in the toggle would be misleading for the descriptor-less gate card the bridge
   explicitly allows. The wire key is `initial_review` either way.
3. **Review fields set with Put Into Review off are a node error.** PLAN.md does not specify what
   happens; the alternative is dropping them silently, which would create a queued card when a
   gate was asked for. Called out here because it is a behaviour the plan does not mandate.
4. **Reject Case and Request Changes (Human) require a non-empty Reason in the node**, matching
   the bridge, which 400s without one (`plugin_api.py:576`, `:687`) — itself kb-v2's deviation 3.
   The node catches it locally so the workflow fails without a round trip, exactly as Block and
   Request Changes already do.
5. **Two notices added** (`rejectCaseNotice`, `requestChangesHumanNotice`). Not asked for, but the
   resource already uses a notice for exactly this kind of guidance (`bridgeNotice`), the archive
   cascade is destructive and non-obvious, and the two Request Changes variants are otherwise
   indistinguishable in the operation dropdown.
6. **The 409 error hint gained one clause** naming the ready/running rule for Request Review and
   the implementer rule for Request Changes (Human). The bridge's own 409 detail is still what the
   message shows; this is only the generic description a user reads when they have no idea which
   status rule they hit.

No deviation was needed for PLAN.md's description of the bridge: the `plugin/v2` shapes matched
the kb-v2 report exactly at @99ad641.

## Known gaps

- **Get's `runs` is not split into output items.** It stays nested in the single output item, as
  the whole `tasks/get` response always has. A workflow that wants one item per run uses an Item
  Lists / Split Out node. PLAN.md says "Get shows runs", which it does.
- **`run_metadata` is only reachable as `extra.run_metadata`**, not as a top-level field on the
  output item the way `board` is. Top-level promotion is for scalars a filter matches on
  (`board`, `platform`, `profile`); `run_metadata` is an arbitrary object and nothing filters on
  it. A workflow reads `{{ $json.extra.run_metadata }}`.
- **The 400 hint does not mention `ArtifactPreservationError`.** `request_review` 400s when
  `metadata["artifacts"]` names a file it cannot stage (`plugin_api.py:305-315`). The bridge's
  detail string names the bad path and the node surfaces it in the message, so the user does see
  the real reason — but the generic description still talks about required fields and whole
  numbers. Not worth a fifth branch in the hint until someone actually trips it.
- **No node-side guard that the bridge is v0.2.0.** A v0.1.0 bridge answers the three new actions
  with a 400/422 from pydantic's `action` dispatch and `initial_review` is simply ignored by an
  older `CreateBody`. The node has no version negotiation and PLAN.md does not ask for one; the
  README states the minimum version instead.
- **`Actor` is not and cannot be authenticated** by the node — it is whatever the workflow sends,
  and the authenticated author is always the token label. Stated in the field description and the
  README, per the bridge's own security model.
- **Not exercised against a live bridge.** Every test is against mocked HTTP with the shapes read
  off `plugin/v2`; the live verification is the parent's step below.

## Proposed (not built)

- A **Get Runs** operation (or a `Split Runs Into Items` option on Get) for workflows that iterate
  runs — today that is a Split Out node away.
- A **Reviewer** / **Actor** dropdown loaded from the token's own scopes via `v1/health`, which
  returns them. It would turn a 403 into an impossible selection, but needs a `loadOptions`
  method and a credential round trip on every panel open.
- Surfacing `archived_descendants` as one output item per archived id on Reject Case, for
  workflows that want to fan out cleanup.
- A **Kanban Task Commented** trigger event option. The bridge pushes `kanban_task_commented`
  (every `task_events` kind passes through, `plugin/core/events.py:47`) and Reject Case's reason
  comment generates one, but the node's Events list has no option for it — only **Any Kanban
  Event** matches it today.

## Live-test notes for the parent

### Deploy

Nothing to deploy on the Mac mini for this lane; it is an n8n package. **kanban-bridge v0.2.0
must be live first** (see the `kb-v2` report), and the bridge token must carry the three new
actions — scopes fail closed:

```sh
kbctl token list                 # shows each token's actions
kbctl token scope n8n-dev --actions get,list,create,comment,complete,request_review,request_changes_human,reject_case,archive
# no dashboard restart needed for a scope change
```

Then install the node package into n8n from this branch:

```sh
git -C <n8n-nodes-hermes checkout> fetch origin feat/kanban-v2
git -C <n8n-nodes-hermes checkout> checkout feat/kanban-v2
npm ci && npm run build          # exits 0; writes dist/
# then whichever install path n8n-dev uses for this package (link / custom dir), and restart n8n
```

### Verify

In n8n, with the existing **Hermes Kanban Bridge** credential:

1. **The operations appear.** Hermes node → Resource _Kanban Task_ → the Operation dropdown lists
   fifteen entries including **Reject Case**, **Request Changes (Human)** and **Request Review**.
   Picking Reject Case shows the red-flag notice about the archive order; picking Request Changes
   (Human) shows the notice about the 409 gap.
2. **Gate card in one call.** Operation _Create_, Board `acquisitions`, Title
   `kbb_test gate — delete me`, Options → **Put Into Review** on, **Review Summary** `kbb_test`,
   **Review Metadata** `{"hitl":{"v":1}}`. Expect output `{task_id: …, created: true, status:
"review"}`. On the board the card is in `review` with no assignee.
3. **The descriptor round-trips.** Operation _Get_ on that task id. Expect
   `runs[-1].metadata == {"hitl": {"v": 1}}` and `task.status == "review"`.
4. **The trigger carries it.** The Hermes Trigger listening for **Kanban Task Review Requested**
   (or **Any Kanban Event**) should have fired for step 2 with
   `extra.run_metadata == {"hitl": {"v": 1}}`, `extra.event_kind == "review_requested"`, and the
   signature still verified with the unchanged credential. **That one delivery is the whole wire
   change** — if it arrives verified with `run_metadata` present, the trigger half of this lane is
   confirmed.
5. **The toggle guard.** Same Create node, turn **Put Into Review** off but leave **Review
   Summary** filled. Expect the node to fail before any request with
   `Review Summary and Review Metadata need Put Into Review turned on`.
6. **Clean up through the new verb.** Operation _Reject Case_ on the task from step 2, Reason
   `kbb_test cleanup`. Expect `{ok: true, status: "archived", archived_descendants: []}`, a
   `[kanban-bridge] reject_case: kbb_test cleanup` comment on the card, and the card off the
   board.
7. **Request Review on a real agent step** (optional, needs a card in `ready`): Operation
   _Request Review_, Options → Summary + Metadata, Reviewer left empty. Expect
   `{ok: true, status: "review"}`. With a **Reviewer** the token does not have in `assignees`,
   expect a 403 whose message names `assignee "<reviewer>"` — that is the error-context change.
8. **Request Changes (Human)** on a deep-analysis card that is in `review` with an implementer:
   Reason + Options → Actor `alex@example.invalid`. Expect `{ok: true, status: "ready"}` and the
   implementer's context to show `alex@example.invalid: <reason>`. On a **gate** card expect a 409
   explaining there is no implementer — that is the documented path to Reject Case instead.

All test data above uses the synthetic prefixes (`kbb_test_…`, `Alex Example`,
`alex@example.invalid`); nothing in the code, fixtures or docs carries real identities or tokens.
