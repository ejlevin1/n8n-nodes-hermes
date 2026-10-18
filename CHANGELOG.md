# Changelog

All notable changes to this project are documented in this file.

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
