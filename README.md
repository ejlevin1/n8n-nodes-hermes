# n8n-nodes-hermes

This is an n8n community node package for [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research. It lets n8n workflows drive a Hermes agent and react to what it does.

It contains two nodes:

- **Hermes** (action node, also usable as a tool by the n8n AI Agent): talk to the agent, run long asynchronous agent work with approvals, manage sessions and cron jobs, read capabilities, drive Kanban boards, and send signed events to Hermes webhook routes.
- **Hermes Trigger**: starts a workflow when Hermes sends a signed outbound lifecycle event (`hooks.outbound`) or the `kanban-bridge` plugin pushes a Kanban event — for example when a turn finishes, a tool runs, an approval is requested, or a Kanban task asks for review.

Hermes exposes four HTTP surfaces, and each has its own credential:

| Surface                                                       | Default port           | Used by                                                          | Credential                                          |
| ------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| API server (OpenAI-compatible, runs, sessions, jobs)          | 8642                   | Hermes node (all resources except Webhook Route and Kanban Task) | [Hermes API](#hermes-api)                           |
| Webhook adapter (inbound routes)                              | 8644                   | Hermes node, Webhook Route resource                              | [Hermes Webhook](#hermes-webhook)                   |
| Dashboard, `kanban-bridge` plugin                             | 9119                   | Hermes node, Kanban Task resource                                | [Hermes Kanban Bridge](#hermes-kanban-bridge)       |
| Outbound webhooks (`hooks.outbound`) and kanban-bridge pushes | n/a (Hermes calls n8n) | Hermes Trigger                                                   | [Hermes Outbound Webhook](#hermes-outbound-webhook) |

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Trigger events](#trigger-events)
- [Usage tips and patterns](#usage-tips-and-patterns)
- [Compatibility](#compatibility)
- [Resources](#resources)
- [License](#license)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In short: in n8n go to **Settings > Community Nodes > Install** and enter `n8n-nodes-hermes`.

The package has no runtime dependencies.

## Credentials

Every credential has a **Base URL** field holding the Hermes host. Requests go to `Base URL + path`; trailing slashes are removed. The Base URL may include a profile prefix such as `http://hermes.local:8642/p/coder` when Hermes runs multiple profiles on one gateway (`gateway.multiplex_profiles`).

The examples below assume Hermes reads environment variables from `~/.hermes/.env` and configuration from `~/.hermes/config.yaml`. Restart the gateway (`hermes gateway`) after changing either file.

### Profiles

One Hermes gateway serves every profile on the host: `default` at the bare URL and each named profile under `/p/<profile>/`. The profile is chosen by the credential, not the node:

- Set the credential's **Base URL** to `http://<hermes-host>:8642/p/<profile>` (names as shown by `hermes profile list`).
- Each named profile checks its **own** `API_SERVER_KEY`, from `~/.hermes/profiles/<profile>/.env`; it does not inherit the default profile's key. Put that profile's key in the credential, so you have one credential per profile. A 401 or 404 on a profile Base URL adds a hint about the key or about the profile not being served.
- The **Hermes Trigger** node has an optional **Profile** filter: only events whose `profile` field matches (case-insensitive) start the workflow. Other events get HTTP 200 without starting it.

### Hermes API

Used by every Hermes node resource except Webhook Route.

1. Enable the API server in `~/.hermes/.env`:

   ```bash
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<random string, at least 16 characters>   # e.g. openssl rand -hex 32
   # API_SERVER_PORT=8642      # default
   # API_SERVER_HOST=0.0.0.0   # only if n8n runs on another machine or container
   ```

   Hermes refuses to start the API server with a key shorter than 16 characters. The default bind address is `127.0.0.1`, so set `API_SERVER_HOST` when n8n is not on the same host, and keep the port behind a firewall or reverse proxy: the API server gives full access to the agent's tools, including terminal commands.

2. In n8n, create a **Hermes API** credential:
   - **Base URL**: `http://<hermes-host>:8642` (default `http://localhost:8642`)
   - **API Key**: the value of `API_SERVER_KEY`

The connection test calls `GET /v1/capabilities`, which is authenticated, so it checks both the host and the key.

### Hermes Webhook

Used by the Hermes node's **Webhook Route > Send Event** operation. Requests are signed with Hermes generic HMAC V2 (`X-Webhook-Timestamp` in integer seconds plus `X-Webhook-Signature-V2 = hex(HMAC_SHA256(secret, timestamp + "." + body))`), so the route's secret never leaves n8n.

1. Enable the webhook adapter in `~/.hermes/.env`:

   ```bash
   WEBHOOK_ENABLED=true
   # WEBHOOK_PORT=8644                 # default
   # WEBHOOK_SECRET=<global fallback>  # used by routes without their own secret
   ```

2. Define a route in `~/.hermes/config.yaml`:

   ```yaml
   platforms:
     webhook:
       enabled: true
       extra:
         port: 8644
         routes:
           n8n:
             secret: '<random route secret>'
             prompt: 'Event {event_type} from n8n: {message}'
             deliver: log # or telegram, slack, discord, ...
   ```

3. In n8n, create a **Hermes Webhook** credential:
   - **Base URL**: `http://<hermes-host>:8644` (default `http://localhost:8644`)
   - **Route Secret**: the route's `secret` (or the global `WEBHOOK_SECRET`)

One credential holds one secret. Create one credential per route if your routes use different secrets.

The connection test calls `GET /health`, which only proves the adapter is reachable. The secret can only be verified by sending to a route.

### Hermes Outbound Webhook

Used by the **Hermes Trigger**. Hermes signs every outbound delivery with `X-Hermes-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`, and the trigger checks it.

1. Add the trigger to a workflow, select the events you want, and copy its **Production URL**.
2. Generate a signing secret (at least 32 characters, e.g. `openssl rand -hex 32`) and put it in `~/.hermes/.env`:

   ```bash
   HERMES_N8N_WEBHOOK_SECRET=<signing secret>
   ```

3. Add a `hooks.outbound` entry to `~/.hermes/config.yaml`. The trigger node shows this block, ready to paste:

   ```yaml
   hooks:
     outbound:
       - name: n8n
         url: 'https://<your-n8n>/webhook/<id>/hermes'
         events: [post_llm_call]
         secret_env: HERMES_N8N_WEBHOOK_SECRET
         timeout: 10
   ```

   `events` must list exactly the events selected in the trigger: events not listed here are never sent. For `pre_tool_call` / `post_tool_call` you can add `matcher: "terminal|delegate_task"` (a regex on the tool name) to cut traffic.

4. In n8n, create a **Hermes Outbound Webhook** credential:
   - **Signing Secret**: the same value as `HERMES_N8N_WEBHOOK_SECRET`
   - **Base URL** (optional): the Hermes host, used only by the connection test to ping `/health`

The connection test checks that the secret is set (and warns if it is shorter than 32 characters). If a Base URL is set it also pings `{Base URL}/health`. Outbound hooks fire from CLI-only installs too, so the Base URL is optional.

### Hermes Kanban Bridge

Used by the Hermes node's [Kanban Task](#kanban-task) resource. This surface is **not** the API gateway: it is a router the [`kanban-bridge`](https://github.com/ejlevin1/hermes-kanban-bridge) plugin mounts inside the Hermes **dashboard** process (default profile, `127.0.0.1:9119`) under `/api/plugins/kanban-bridge/v1/`.

1. Enable the plugin in the **default** profile and restart the dashboard.
2. Mint a scoped token on the Hermes host. It is written to the file you name and never printed:

   ```bash
   kbctl token create --label n8n-dev --boards acquisitions --assignees deal-analyst --out ~/n8n-dev.token
   ```

3. In n8n, create a **Hermes Kanban Bridge API** credential:
   - **Base URL**: `http://host.docker.internal:9119` when n8n runs in Docker, `http://127.0.0.1:9119` when it runs on the Hermes host
   - **Host Header**: `127.0.0.1:9119` — sent as the `Host` header
   - **Token**: the `kbb_…` value from the file above

The dashboard's host check accepts **loopback `Host` headers only**. That is why Base URL and Host Header are separate fields: a Docker n8n connects to `host.docker.internal` but must still claim `Host: 127.0.0.1:9119`. Leaving Host Header empty omits the header and the dashboard will reject the request.

The connection test calls `GET /api/plugins/kanban-bridge/v1/health`, which returns the bridge version, the token's label and its scopes — so a passing test proves the token is valid and unrevoked.

**Scopes.** A token is scoped to a set of boards, assignees and actions. A request outside any of them is refused with 403 rather than widened; the node's error explains which of board / assignee / action fell outside. Inspect scopes with `kbctl token list`, change them with `kbctl token scope <label> …`, and revoke with `kbctl token revoke <label>`.

**Attribution.** Every mutation is recorded on the task with the author `n8n:<token label>`, so board history shows which n8n credential made a change.

## Operations

The Hermes node has eight resources.

### Chat

`POST /v1/chat/completions` (non-streaming).

- **Send Message**: send a message and wait for the reply. Options: Session ID (`X-Hermes-Session-Id`, continues a server-side session), Session Key (`X-Hermes-Session-Key`, scopes long-term memory), Model / Provider / Reasoning Effort, Image URLs, Prior Messages (JSON), Idempotency Key, Timeout (default 5 min). Simplified output: `{content, reasoning, sessionId, finishReason, usage, completed, partial, error}`; turn Simplify off for the raw response plus the `x-hermes-*` headers.

### Response

`/v1/responses`.

- **Create**: input, instructions, previous response ID or conversation, store, truncation, model options. Tool calls are already executed on the server; the simplified output contains the final text and the output items.
- **Get**, **Delete** by ID.

### Run

`/v1/runs`, asynchronous agent work with approvals.

- **Start**: returns `{run_id, status, replayed}`. Sends an automatic `Idempotency-Key`, so a retried n8n item does not start a second run.
- **Get Status**.
- **Wait for Completion**: polls the run (default every 2 s, timeout 5 min). Stops on a terminal status (`completed`, `failed`, `cancelled`, `interrupted`), or returns `needsAction` when the run waits for an approval, a clarification, or is in an `unknown` state. On timeout it returns `{timedOut: true}`, or fails if Error on Timeout is set.
- **Start and Wait**: both in one step.
- **Respond to Approval**: `once`, `session`, `always` or `deny`. Detects canonical and legacy approval modes automatically. There is deliberately no auto-approve option.
- **Respond to Clarification**, **Steer** (send extra input to a running run), **Stop**, **Resolve Unknown**.

Run status is kept in memory for 1 hour after the last update. Runs started with an idempotency key are kept durably for 24 hours; a gateway restart marks them `interrupted`.

### Session

`/api/sessions`.

- **Get Many** (filters: source, title; Return All pages through every session and removes duplicates of pinned sessions), **Create**, **Get**, **Update** (title, pinned, archived, hidden, unread, end reason), **Delete**.
- **Get Messages** (Return All reads oldest-first), **Fork**, **Send Message**, **Set Model**.

Sessions owned by another surface (for example a Telegram chat) can't be changed through the API; Hermes answers 409 `permission_denied` and the node says so.

### Cron Job

`/api/jobs`.

- **Get Many** (optionally including disabled jobs), **Create** (name, schedule, prompt up to 5000 characters, deliver, skills, repeat, paused), **Get**, **Update**, **Delete**, **Pause**, **Resume**, **Run Now** (optionally with a one-off prompt).

### System

- **Get Capabilities**, **Get Health** (`/health/detailed`), **List Models**, **List Model Options**, **List Skills**, **List Toolsets**.

### Kanban Task

Uses the [Hermes Kanban Bridge](#hermes-kanban-bridge) credential. Every operation is a `POST` under `/api/plugins/kanban-bridge/v1/` with the ids in the JSON body, and every operation takes **Board** (required) — task IDs are per board.

| Operation              | Route           | Fields                                                                                                                       |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Create**             | `tasks/create`  | Title (required); Options: Assignee, Body, Idempotency Key, Max Runtime (Seconds), Parents, Priority, Skills, Tenant, Triage |
| **Get**                | `tasks/get`     | Task ID. Returns the task with its comments, last 50 events and a runs summary.                                              |
| **Get Many**           | `tasks/list`    | Limit (≤ 200); Filters: Assignee, Status. One output item per task.                                                          |
| **Comment**            | `tasks/comment` | Task ID, Comment                                                                                                             |
| **Complete (Approve)** | `tasks/action`  | Task ID; Options: Metadata, Result, Summary. From `review` this is the human approval.                                       |
| **Request Changes**    | `tasks/action`  | Task ID, Reason — sends a task in review back for more work                                                                  |
| **Block**              | `tasks/action`  | Task ID, Reason                                                                                                              |
| **Unblock**            | `tasks/action`  | Task ID                                                                                                                      |
| **Archive**            | `tasks/action`  | Task ID                                                                                                                      |
| **Assign**             | `tasks/action`  | Task ID, Assignee                                                                                                            |
| **Reprioritize**       | `tasks/action`  | Task ID, Priority (whole number; higher is dispatched first)                                                                 |
| **Edit**               | `tasks/action`  | Task ID; Fields to Edit: Body, Title (at least one)                                                                          |

**Create** is idempotent when you set an **Idempotency Key**: an existing non-archived task with the same key is returned instead of a duplicate, and the response has `created: false`. Statuses are `triage`, `todo`, `ready`, `running`, `blocked`, `review`, `done` and `archived`.

Bridge-specific errors get their own messages: **401** points at the token and `kbctl token list`; **403** names the board / assignee / action that fell outside the token's scopes; **404** reminds you that task IDs are per board; **409** shows the transition reason `kanban_db` gave (for example completing a task that is in `todo`, not `review`). An unreachable bridge explains that the plugin only answers in the dashboard process.

To react to board changes rather than drive them, use the **Hermes Trigger**'s [Kanban events](#kanban-events).

### Webhook Route

Uses the [Hermes Webhook](#hermes-webhook) credential.

- **Send Event**: `POST /webhooks/{route}` with an Event Type (sent as `event_type`), a JSON body (default: the incoming item), and a Request ID (sent as `X-Request-ID`; automatic by default, so retries are de-duplicated). Output: `{status, httpStatus, route, event, deliveryId, reason}` where `status` is `accepted`, `coalesced`, `duplicate`, `ignored`, `delivered`, or an error status.

Hermes webhook routes are fire-and-forget: the agent's reply goes to the route's `deliver` target (a chat platform or the log), never back over HTTP. To get the reply in n8n, use the Hermes Trigger with **LLM Call Finished** (`post_llm_call`) and filter on Platform `webhook`.

### Errors

Both Hermes error shapes (`{"error": {"message", "type", "code"}}` and `{"error": "..."}`) are turned into readable n8n errors, with specific messages for 401 `gateway_auth_failed`, 409 `permission_denied` / `admission_conflict` / `idempotency_key_conflict`, 429 rate limits and 503 `gateway_draining` (including the `Retry-After` value). **Continue On Fail** is supported.

## Trigger events

The Hermes Trigger accepts these events (select one or more):

| Event                                         | Hook name                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| LLM Call Finished                             | `post_llm_call`                                                                       |
| Session Started / Ended / Finalized / Reset   | `on_session_start`, `on_session_end`, `on_session_finalize`, `on_session_reset`       |
| Tool Call Starting / Finished                 | `pre_tool_call`, `post_tool_call`                                                     |
| Subagent Started / Stopped                    | `subagent_start`, `subagent_stop`                                                     |
| Pre Approval Request / Post Approval Response | `pre_approval_request`, `post_approval_response`                                      |
| Human Input Request / Resolved                | `on_human_input_request`, `on_human_input_resolved`                                   |
| Any Kanban Event                              | `kanban_task_*` (any bridge delivery, plus `kanban_bridge_ping`)                      |
| Kanban Task Claimed / Completed / Blocked     | `kanban_task_claimed`, `kanban_task_completed`, `kanban_task_blocked`                 |
| Kanban Task Created / Archived                | `kanban_task_created`, `kanban_task_archived`                                         |
| Kanban Task Review Requested                  | `kanban_task_review_requested`                                                        |
| Kanban Task Changes Requested                 | `kanban_task_changes_requested`                                                       |
| Kanban Task Unblocked                         | `kanban_task_unblocked`                                                               |
| Kanban Task Updated                           | `on_kanban_task_updated`                                                              |
| Kanban Worker Spawned / Exited / Stale Claim  | `on_kanban_worker_spawned`, `on_kanban_worker_exited`, `on_kanban_worker_stale_claim` |
| Kanban Dispatch Tick                          | `on_kanban_dispatch_tick`                                                             |
| Agent Loop Stopped                            | `agent_loop_stopped`                                                                  |
| API Request Error                             | `api_request_error`                                                                   |
| Stream Ended                                  | `on_stream_end`                                                                       |

Per-token `on_stream_delta`, `pre_gateway_dispatch` and the `transform_*` hooks are not offered.

**Filters**: Board (comma-separated, case-insensitive; matches the top-level `board` on kanban-bridge deliveries and `extra.board` on Hermes hooks), Platform (matches `extra.platform`, e.g. `cron`, `webhook`, `api_server`, `cli`), Session ID (matches `session_id`, `extra.session_key`, `extra.parent_session_id` or `extra.child_session_id`) and Tool Name (regex). Events that don't match are acknowledged with HTTP 200 and don't start the workflow. When a filter is set, events that lack the field are dropped.

**Options**: Verify Signature (default on; bad or missing signatures get HTTP 401), Reject Stale Events (default on; the signed `timestamp` must be within Max Event Age, default 300 s).

Each item contains `{event, profile, platform, board, sessionId, toolName, toolInput, cwd, extra, deliveryId, timestamp}`.

### Kanban events

Kanban events reach n8n from **two** sources, and the node treats them the same way:

| Source                                          | Events                                                                                                                                                                                        | Configured in                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Hermes `hooks.outbound`                         | `kanban_task_claimed`, `kanban_task_completed`, `kanban_task_blocked`, `on_kanban_task_updated`, the three worker hooks and `on_kanban_dispatch_tick`                                         | `hooks.outbound` in `~/.hermes/config.yaml`                                               |
| [`kanban-bridge`](#hermes-kanban-bridge) plugin | `kanban_task_<kind>` for **every** `task_events` kind — `created`, `claimed`, `review_requested`, `changes_requested`, `completed`, `blocked`, `unblocked`, `archived`, and kinds added later | `plugins.entries.kanban-bridge.settings.targets` in the **default** profile's config.yaml |

Hermes fires **no hook** for review-requested, changes-requested, archived, unblocked or created, so those only ever arrive through the bridge, which tails the `task_events` table in the dashboard process. The shared names (`claimed`, `completed`, `blocked`) are identical, so one selected event matches either source. Signing is the same scheme in both cases, so the trigger verifies both with the same credential.

**Any Kanban Event** is a wildcard that matches every `kanban_task_*` delivery — including kinds the plugin adds later — plus the `kanban_bridge_ping` that `kbctl targets test <name>` sends. With any other selection the ping is acknowledged with HTTP 200 and ignored; note that a ping carries no board, so a Board filter drops it too.

Select a Kanban bridge event and the node shows a ready-to-paste `targets` block:

```yaml
plugins:
  entries:
    kanban-bridge:
      settings:
        targets:
          - name: n8n
            url: 'https://<your-n8n>/webhook/<id>/hermes'
            boards: ['acquisitions']
            events: ['*']
            secret_env: HERMES_N8N_WEBHOOK_SECRET
```

The secret lives in the default profile's `.env` under the name given by `secret_env`, never inline. Restart the dashboard after editing the config.

**Where the task fields land.** Hermes hooks pass the task coordinates as hook kwargs, so they arrive inside `extra`. The bridge sends them top-level instead, and the node folds them into `extra` so a workflow reads `extra.task_id` whichever source delivered the event (an explicit `extra` in the body still wins). `board` is also surfaced top-level (like `platform`) so the Board filter is easy to pair with an expression. Bridge deliveries add `event_id`, `event_kind`, `title`, `status`, `priority`, `actor` and the event's own `payload` (for example `{reason: …}` or `{summary: …}`) to `extra`; `profile` holds the task's assignee. `event_id` and `deliveryId` together let you de-duplicate at-least-once deliveries downstream.

Per-event additions for the Hermes hooks:

| Event                          | Adds to `extra`                                                        |
| ------------------------------ | ---------------------------------------------------------------------- |
| `kanban_task_completed`        | `summary`                                                              |
| `kanban_task_blocked`          | `reason`                                                               |
| `on_kanban_task_updated`       | `changed_fields` — field **names** only, never their values            |
| `on_kanban_worker_spawned`     | `worker_pid`, `workspace_path`                                         |
| `on_kanban_worker_exited`      | `worker_pid`, `exit_kind`, `exit_code`, `outcome`, `retry_status`      |
| `on_kanban_worker_stale_claim` | `worker_pid`, `heartbeat_stale`, `retry_status`                        |
| `on_kanban_dispatch_tick`      | `board`, `dry_run`, `outcome` (`ok`/`skipped_locked`/`idle`), `result` |

`kanban_task_claimed` fires in the dispatcher just before the worker is spawned; `completed` and `blocked` fire in whichever process drove the task. All of them fire **after** the DB commit, so a slow n8n workflow never holds the SQLite write lock.

**Caveats**

- **Approval hooks carry `session_key`, not a run ID.** `pre_approval_request`, `post_approval_response` and the human-input events can't be matched to a `/v1/runs` run. For API-driven runs, handle approvals with the Run resource (Wait for Completion, then Respond to Approval).
- **Unsigned deliveries.** If the variable named by `secret_env` is not set in Hermes' environment, Hermes logs a warning and sends deliveries **unsigned**. With Verify Signature on (the default) the trigger rejects them with 401; check the Hermes log if nothing arrives.
- **Kanban bridge events do not come from `hooks.outbound`.** Listing `kanban_task_review_requested` there has no effect: Hermes never fires it. Configure the bridge's `targets` instead, and remember that a target has its own `boards` and `events` lists which must include what you select in the node.
- Outbound hooks are configured only in `config.yaml`; there is no API to register them. Activating or deactivating the workflow doesn't change Hermes' configuration. Remove the `hooks.outbound` entry to stop deliveries.
- Hermes retries a delivery only after connection errors or 5xx responses, and the trigger does not de-duplicate (each delivery has its own `deliveryId` if you want to de-duplicate downstream).
- Outbound hooks fire for CLI sessions, gateway platforms, cron jobs and webhook-triggered runs alike. Use the Platform filter to narrow.

## Usage tips and patterns

### Use Hermes as an OpenAI chat model

This package has no chat-model sub-node because n8n's built-in one already works. In an AI Agent or chain, add the **OpenAI Chat Model** node and create an OpenAI credential with:

- **API Key**: your `API_SERVER_KEY`
- **Base URL**: `http://<hermes-host>:8642/v1`

Hermes then serves the model calls (with its own tools, memory and skills behind them).

### Approval timeout

Hermes **auto-denies** a pending approval after `approvals.timeout` (default 300 seconds). A human-in-the-loop flow has to answer inside that window:

1. **Run > Start and Wait** (or Wait for Completion) returns with `needsAction` and the approval details.
2. Send the request to a person (Slack, email, n8n Form) using **Send and Wait for Response**, with a wait limit shorter than `approvals.timeout`.
3. **Run > Respond to Approval** with their choice, then **Wait for Completion** again.

If people need longer, raise `approvals.timeout` in `config.yaml`. If they don't answer in time, treat the run as denied.

### Long-running jobs

**Wait for Completion** holds an n8n worker while it polls, so keep it for runs of a few minutes. For longer work, poll without holding a worker:

1. **Run > Start**
2. n8n **Wait** node (e.g. 1 minute)
3. **Run > Get Status**
4. **IF** `status` is `completed`, `failed`, `cancelled` or `interrupted`: continue; if it is waiting for approval, branch to your approval flow; otherwise loop back to the Wait node.

Remember that run status is only kept for 1 hour after its last update.

## Compatibility

- n8n 1.x and later with community nodes enabled (`n8nNodesApiVersion` 1). Developed and tested against n8n-workflow 2.43.
- Hermes Agent `main` as of October 2026 (API server runs, sessions and jobs APIs; webhook adapter with HMAC V2; `hooks.outbound`). Older Hermes releases may lack some endpoints; **System > Get Capabilities** shows what your server supports.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Hermes Agent on GitHub](https://github.com/NousResearch/hermes-agent)
- [Hermes API server docs](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md)
- [Hermes webhooks docs](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/webhooks.md)
- [Hermes hooks docs (outbound webhooks)](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/hooks.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE.md)
