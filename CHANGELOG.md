# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Added

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
