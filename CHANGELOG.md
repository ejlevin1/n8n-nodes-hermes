# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Added

- **Human-in-the-loop Kanban operations**, against `kanban-bridge` **v0.2.0**: **Request Review** (Options: Metadata, Reviewer, Summary) — the only way to move a task into `review`, and where a kanban-tasks `hitl` descriptor is written; **Request Changes (Human)** (Reason; Options: Actor), which claims the review as the token first and so works where plain Request Changes returns 409; and **Reject Case** (Reason), which archives every not-done descendant deepest-first and then the task, the order that stops `recompute_ready` from releasing the children instead. The existing **Request Changes** operation is unchanged — the bridge kept both verbs.
- **Put Into Review** option on Kanban **Create**, with **Review Summary** and **Review Metadata**: Create + Request Review in one bridge call (`initial_review`), which is how a gate card is made. It needs both `create` and `request_review` in the token's scopes; a refused review is a 409 and the bridge deletes the task again. Review fields set with the toggle off are reported as a node error instead of being dropped, because the task would queue rather than wait in review.
- `runs` on the Kanban **Get** output is documented and pinned: the task's latest 20 runs with `outcome`, `summary` and `metadata`, passed through exactly as the bridge sends them. Run metadata is where task metadata lives, so this is how a workflow reads back what Request Review or Complete (Approve) stored.
- `extra.run_metadata` on **Hermes Trigger** deliveries for `kanban_task_review_requested` and `kanban_task_completed`: the run's own `metadata` object, folded in with the other top-level bridge keys and passed through **untouched**, so a `hitl` descriptor survives the hop. Absent when the run has none.
- **Kanban Task** resource on the **Hermes** node, driving Hermes Kanban boards through the `kanban-bridge` plugin: Create, Get, Get Many, Comment, Complete (Approve), Request Changes, Block, Unblock, Archive, Assign, Reprioritize and Edit. Create takes an optional Idempotency Key. Bridge-specific errors explain a rejected token (401), the board / assignee / action that fell outside the token's scopes (403), that task IDs are per board (404) and the transition reason `kanban_db` gave (409).
- New **Hermes Kanban Bridge API** credential (`hermesKanbanBridgeApi`): Base URL (default `http://host.docker.internal:9119`), Host Header (default `127.0.0.1:9119`, sent as `Host` because the dashboard only accepts loopback hosts) and Token. The connection test calls `GET /api/plugins/kanban-bridge/v1/health`.
- Kanban bridge events on the **Hermes Trigger** node: Kanban Task Created, Review Requested, Changes Requested, Unblocked and Archived — kinds Hermes fires no hook for, so they only arrive through the bridge — plus an **Any Kanban Event** wildcard matching every `kanban_task_*` delivery and the `kanban_bridge_ping` from `kbctl targets test`. The existing Claimed / Completed / Blocked options match deliveries from either source.
- A ready-to-paste `plugins.entries.kanban-bridge.settings.targets` block in its own trigger notice, shown when a bridge event is selected, so Kanban users are not sent to `hooks.outbound` (where these events would never fire).
- Six more Kanban events on the **Hermes Trigger** node: Kanban Task Claimed (`kanban_task_claimed`), Kanban Task Updated (`on_kanban_task_updated`), Kanban Worker Spawned / Exited / Stale Claim and Kanban Dispatch Tick. Together with the existing Completed and Blocked events this covers every Kanban hook in Hermes' `VALID_HOOKS`.
- Optional **Board** filter in the **Hermes Trigger** Filters collection, matched (case-insensitively, comma-separated) against the top-level `board` on kanban-bridge deliveries and `extra.board` on Hermes hooks.
- `board` on the trigger's output item, surfaced the same way `platform` already is. Bridge deliveries also fold their task coordinates (`task_id`, `event_id`, `event_kind`, `run_id`, `title`, `status`, `assignee`, `priority`, `actor`, `payload`) into `extra`, so a workflow reads `extra.task_id` whichever source delivered the event.
- Optional **Profile** filter on the **Hermes Trigger** node, matched against the event `profile` field.
- A hint on 401/404 responses when the credential Base URL targets a named profile (`…/p/<profile>`), about per-profile `API_SERVER_KEY` and served profiles.

## 0.1.0 (2026-10-17)

Initial release.

### Added

- **Hermes** action node (usable as an AI Agent tool) with seven resources:
  - **Chat**: Send Message via the OpenAI-compatible chat completions endpoint, with session ID/key, model options, images, prior messages, idempotency and timeout.
  - **Response**: Create, Get and Delete Responses API results.
  - **Run**: Start, Get Status, Wait for Completion, Start and Wait, Respond to Approval (canonical and legacy modes), Respond to Clarification, Steer, Stop and Resolve Unknown.
  - **Session**: Get Many (with de-duplicating Return All), Create, Get, Update, Delete, Get Messages, Fork, Send Message and Set Model.
  - **Cron Job**: Get Many, Create, Get, Update, Delete, Pause, Resume and Run Now.
  - **System**: Get Capabilities, Get Health, List Models, List Model Options, List Skills and List Toolsets.
  - **Webhook Route**: Send Event to a Hermes webhook route, signed with HMAC V2 and de-duplicated by Request ID.
- **Hermes Trigger** node for signed Hermes outbound webhooks (`hooks.outbound`), with signature verification, stale-event rejection, and platform, session and tool-name filters.
- Credentials: **Hermes API**, **Hermes Webhook** and **Hermes Outbound Webhook**.
- Friendly error messages for common Hermes error codes, including `Retry-After` hints.
