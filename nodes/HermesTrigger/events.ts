import type { IDataObject, INodePropertyOptions } from 'n8n-workflow';

/** Prefix every kanban-bridge delivery's `hook_event_name` carries (`kanban_task_<kind>`). */
export const KANBAN_BRIDGE_EVENT_PREFIX = 'kanban_task_';

/** Test delivery sent by `kbctl targets test`. */
export const KANBAN_BRIDGE_PING_EVENT = 'kanban_bridge_ping';

/**
 * Sentinel "Any Kanban Event" option: matches every `kanban_task_*` delivery plus the bridge ping,
 * so event kinds the plugin adds later need no node update. Not a Hermes hook name.
 */
export const KANBAN_ANY_EVENT = 'kanban_task_*';

/**
 * Curated subset of Hermes `VALID_HOOKS` (hermes_cli/plugins.py) that is useful as an n8n trigger.
 * Deliberately excluded: per-token `on_stream_delta`, `pre_gateway_dispatch` (in-process objects,
 * not serialisable) and the `transform_*` hooks (outbound webhooks are notify-only, so a transform
 * could never take effect).
 */
export const HERMES_TRIGGER_EVENTS: INodePropertyOptions[] = [
	{
		name: 'Agent Loop Stopped',
		value: 'agent_loop_stopped',
		description:
			'A running agent turn was interrupted (/stop, or /new while busy). Carries session_key, platform, reason.',
	},
	{
		name: 'Any Kanban Event',
		value: KANBAN_ANY_EVENT,
		description:
			'Every kanban-bridge delivery (<code>kanban_task_*</code>), whatever the event kind — including kinds the plugin adds later and the <code>kanban_bridge_ping</code> test delivery from <code>kbctl targets test</code>',
	},
	{
		name: 'API Request Error',
		value: 'api_request_error',
		description: 'A provider (LLM) API attempt failed',
	},
	{
		name: 'Human Input Request',
		value: 'on_human_input_request',
		description:
			'The agent is blocked waiting for a person (sudo prompt, clarify question or approval)',
	},
	{
		name: 'Human Input Resolved',
		value: 'on_human_input_resolved',
		description: 'A pending human-input wait ended (answered, skipped, timed out or failed)',
	},
	{
		name: 'Kanban Dispatch Tick',
		value: 'on_kanban_dispatch_tick',
		description:
			'One dispatcher tick finished. Carries board, dry_run, outcome (ok, skipped_locked or idle) and the full DispatchResult in extra.',
	},
	{
		name: 'Kanban Task Archived',
		value: 'kanban_task_archived',
		description:
			'A Kanban task was archived and left the board. Delivered only by the kanban-bridge plugin.',
	},
	{
		name: 'Kanban Task Blocked',
		value: 'kanban_task_blocked',
		description:
			'A Kanban task moved to blocked. Carries board, assignee, run_id and reason. Delivered by Hermes hooks.outbound and by the kanban-bridge plugin.',
	},
	{
		name: 'Kanban Task Changes Requested',
		value: 'kanban_task_changes_requested',
		description:
			'A Kanban task in review was sent back for more work, with a reason. Hermes fires no hook for this, so it only arrives through the kanban-bridge plugin.',
	},
	{
		name: 'Kanban Task Claimed',
		value: 'kanban_task_claimed',
		description:
			'A Kanban task was claimed by the dispatcher, just before the worker is spawned. Carries board, assignee and run_id. Delivered by Hermes hooks.outbound and by the kanban-bridge plugin.',
	},
	{
		name: 'Kanban Task Completed',
		value: 'kanban_task_completed',
		description:
			'A Kanban task was completed. Carries board, assignee, run_id and summary. Delivered by Hermes hooks.outbound and by the kanban-bridge plugin.',
	},
	{
		name: 'Kanban Task Created',
		value: 'kanban_task_created',
		description: 'A Kanban task was created. Delivered only by the kanban-bridge plugin.',
	},
	{
		name: 'Kanban Task Review Requested',
		value: 'kanban_task_review_requested',
		description:
			'A Kanban task moved to review and is waiting for human approval. Hermes fires no hook for this, so it only arrives through the kanban-bridge plugin.',
	},
	{
		name: 'Kanban Task Unblocked',
		value: 'kanban_task_unblocked',
		description:
			'A blocked Kanban task returned to the queue. Delivered only by the kanban-bridge plugin.',
	},
	{
		name: 'Kanban Task Updated',
		value: 'on_kanban_task_updated',
		description:
			'A Kanban task row was written outside claim, complete or block. Carries changed_fields — field names only, never values.',
	},
	{
		name: 'Kanban Worker Exited',
		value: 'on_kanban_worker_exited',
		description:
			'A Kanban worker process was found dead and reclaimed. Carries worker_pid, exit_kind, exit_code, outcome and retry_status.',
	},
	{
		name: 'Kanban Worker Spawned',
		value: 'on_kanban_worker_spawned',
		description:
			'A Kanban worker process was started for a claimed task. Carries worker_pid and workspace_path.',
	},
	{
		name: 'Kanban Worker Stale Claim',
		value: 'on_kanban_worker_stale_claim',
		description:
			'A Kanban claim passed its TTL and was reclaimed. Carries worker_pid, heartbeat_stale and retry_status.',
	},
	{
		name: 'LLM Call Finished',
		value: 'post_llm_call',
		description:
			'A turn finished successfully. Includes user_message, assistant_response and platform in extra.',
	},
	{
		name: 'Post Approval Response',
		value: 'post_approval_response',
		description: 'An approval was decided, timed out or failed to notify',
	},
	{
		name: 'Pre Approval Request',
		value: 'pre_approval_request',
		description:
			'An approval decision is about to be requested. Carries session_key, not a run ID.',
	},
	{
		name: 'Session Ended',
		value: 'on_session_end',
		description: 'A turn was finalised (completed, failed or interrupted flags in extra)',
	},
	{
		name: 'Session Finalized',
		value: 'on_session_finalize',
		description: 'A CLI, TUI or gateway session was torn down',
	},
	{
		name: 'Session Reset',
		value: 'on_session_reset',
		description: 'A session boundary (/new or reset) created a replacement session',
	},
	{
		name: 'Session Started',
		value: 'on_session_start',
		description: 'The first turn of a new session',
	},
	{
		name: 'Stream Ended',
		value: 'on_stream_end',
		description: 'A streaming LLM response finished or errored (full final_text in extra)',
	},
	{
		name: 'Subagent Started',
		value: 'subagent_start',
		description: 'A delegated child agent is about to run',
	},
	{
		name: 'Subagent Stopped',
		value: 'subagent_stop',
		description: 'A delegated child agent exited',
	},
	{
		name: 'Tool Call Finished',
		value: 'post_tool_call',
		description: 'A tool call finished (success, error or blocked)',
	},
	{
		name: 'Tool Call Starting',
		value: 'pre_tool_call',
		description: 'A tool call is about to run (notify-only: cannot block from n8n)',
	},
];

export const HERMES_TRIGGER_EVENT_VALUES: string[] = HERMES_TRIGGER_EVENTS.map((e) =>
	String(e.value),
);

export const TOOL_SCOPED_EVENTS = ['pre_tool_call', 'post_tool_call'];

/**
 * Kanban hooks Hermes itself fires (hermes_cli/plugins.py `VALID_HOOKS`). Every one carries
 * `board`, `task_id`, `assignee`, `run_id` and `profile_name` as hook kwargs, so they land in
 * `extra` (only tool_name/args/session_id/parent_session_id are top-level — agent/shell_hooks.py
 * `_TOP_LEVEL_PAYLOAD_KEYS`). These come from `hooks.outbound` in config.yaml.
 */
export const KANBAN_HOOK_EVENTS = [
	'kanban_task_claimed',
	'kanban_task_completed',
	'kanban_task_blocked',
	'on_kanban_task_updated',
	'on_kanban_worker_spawned',
	'on_kanban_worker_exited',
	'on_kanban_worker_stale_claim',
	'on_kanban_dispatch_tick',
];

/**
 * Events the `kanban-bridge` plugin pushes by tailing `task_events` — `kanban_task_<kind>` for
 * every kind, so it also covers review_requested / changes_requested / archived / unblocked /
 * created, which Hermes fires no hook for. Configured in the plugin's `targets` setting, not
 * `hooks.outbound`. Claimed/completed/blocked are shared with the hook list: the names are
 * identical, so one option matches either source.
 */
export const KANBAN_BRIDGE_EVENTS = [
	KANBAN_ANY_EVENT,
	'kanban_task_created',
	'kanban_task_claimed',
	'kanban_task_review_requested',
	'kanban_task_changes_requested',
	'kanban_task_completed',
	'kanban_task_blocked',
	'kanban_task_unblocked',
	'kanban_task_archived',
];

/** Every Kanban option, from either source. These are the events the Board filter narrows. */
export const KANBAN_EVENTS = [...new Set([...KANBAN_BRIDGE_EVENTS, ...KANBAN_HOOK_EVENTS])];

/** True for a delivery that can only have come from the kanban-bridge plugin. */
export function isKanbanBridgeEvent(event: string): boolean {
	return event.startsWith(KANBAN_BRIDGE_EVENT_PREFIX) || event === KANBAN_BRIDGE_PING_EVENT;
}

/**
 * Bridge-delivery keys that sit top-level in the body (see the wire contract) but are the Kanban
 * equivalents of what Hermes hooks put in `extra`. They are folded into `extra` so a workflow
 * reads `extra.task_id` whichever source delivered the event.
 */
export const KANBAN_BRIDGE_EXTRA_KEYS = [
	'board',
	'task_id',
	'event_id',
	'event_kind',
	'run_id',
	'title',
	'status',
	'assignee',
	'priority',
	'actor',
	'payload',
];

export const DEFAULT_EVENTS = ['post_llm_call'];

export const DEFAULT_SIGNING_ENV_VAR = 'HERMES_N8N_WEBHOOK_SECRET';

export type HeaderBag = Record<string, string | string[] | undefined> | IDataObject;

export interface HermesTriggerFilters {
	/** Events the trigger accepts. An empty list accepts nothing. */
	events: string[];
	/** Accepted `extra.platform` values (case-insensitive). Empty or undefined: any platform. */
	platforms?: string[];
	/** Accepted board values (case-insensitive), top-level or `extra.board`. Empty: any board. */
	boards?: string[];
	/** Session to match against session_id / extra.session_key / parent / child session ids. */
	sessionId?: string;
	/** Regex matched against `tool_name`. Invalid regex falls back to literal equality (as Hermes does). */
	toolName?: string;
	/** Hermes profile the event must come from (payload `profile`, case-insensitive). Empty: any. */
	profile?: string;
}

export interface NormalizedHermesEvent extends IDataObject {
	event: string;
	profile: string | null;
	platform: string | null;
	/** `extra.board` for Kanban events, else null. Mirrors how `platform` is surfaced. */
	board: string | null;
	sessionId: string | null;
	toolName: string | null;
	toolInput: IDataObject | null;
	cwd: string | null;
	extra: IDataObject;
	deliveryId: string | null;
	timestamp: string | null;
}

/** Case-insensitive header lookup that copes with Express' string | string[] values. */
export function getHeader(headers: HeaderBag | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== wanted) continue;
		if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
		if (value === undefined || value === null) return undefined;
		return String(value);
	}
	return undefined;
}

function asObject(value: unknown): IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: {};
}

/** Copy the listed keys that are actually present (and not null) into a new object. */
function pickDefined(source: IDataObject, keys: string[]): IDataObject {
	const picked: IDataObject = {};
	for (const key of keys) {
		if (source[key] !== undefined && source[key] !== null) picked[key] = source[key];
	}
	return picked;
}

function asNonEmptyString(value: unknown): string | null {
	if (typeof value === 'string' && value !== '') return value;
	if (typeof value === 'number') return String(value);
	return null;
}

/**
 * Event name: prefer the signed body field `hook_event_name`; fall back to the unsigned
 * `X-Hermes-Event` header.
 */
export function getEventName(payload: IDataObject, headers?: HeaderBag): string {
	return (
		asNonEmptyString(payload.hook_event_name) ??
		getHeader(headers, 'x-hermes-event') ??
		''
	).trim();
}

/** All session identifiers carried by an event, most specific first, de-duplicated. */
export function getSessionCandidates(payload: IDataObject): string[] {
	const extra = asObject(payload.extra);
	const values = [
		payload.session_id,
		extra.session_key,
		extra.parent_session_id,
		extra.child_session_id,
	]
		.map(asNonEmptyString)
		.filter((v): v is string => v !== null);
	return [...new Set(values)];
}

/**
 * Test a tool name against a user regex. Mirrors Hermes' matcher semantics: `re.search`-style
 * (unanchored) match, and an invalid pattern degrades to literal equality.
 */
export function matchesToolName(pattern: string, toolName: string | null): boolean {
	if (toolName === null) return false;
	try {
		return new RegExp(pattern).test(toolName);
	} catch {
		return pattern === toolName;
	}
}

/** Split a comma-separated list into trimmed, non-empty, lower-cased entries. */
export function parseList(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(parseList);
	if (typeof value !== 'string') return [];
	return value
		.split(',')
		.map((v) => v.trim().toLowerCase())
		.filter((v) => v !== '');
}

/**
 * Whether an event name is covered by the selected options. Exact match, or the
 * "Any Kanban Event" sentinel covering every `kanban_task_*` delivery and the bridge ping.
 */
export function isEventSelected(event: string, selected: string[]): boolean {
	if (selected.includes(event)) return true;
	return selected.includes(KANBAN_ANY_EVENT) && isKanbanBridgeEvent(event);
}

/**
 * Board the event is about. kanban-bridge puts `board` top-level (wire contract); Hermes hooks
 * pass it as a hook kwarg, so it lands in `extra.board`.
 */
export function getEventBoard(payload: IDataObject): string | null {
	return asNonEmptyString(payload.board) ?? asNonEmptyString(asObject(payload.extra).board);
}

/**
 * Returns `null` when the event passes every filter, otherwise a short human-readable reason.
 * Filters narrow: when a filter is set, events that lack the field (e.g. no `extra.platform`,
 * no `tool_name`) are rejected.
 */
export function getFilterRejection(
	payload: IDataObject,
	headers: HeaderBag | undefined,
	filters: HermesTriggerFilters,
): string | null {
	const event = getEventName(payload, headers);
	if (!event) return 'missing event name';
	if (!isEventSelected(event, filters.events)) return `event "${event}" not selected`;

	const profile = filters.profile?.trim().toLowerCase();
	if (profile) {
		const eventProfile = asNonEmptyString(payload.profile)?.toLowerCase() ?? null;
		if (eventProfile !== profile) return `profile "${eventProfile ?? ''}" does not match filter`;
	}

	const platforms = (filters.platforms ?? []).map((p) => p.toLowerCase());
	if (platforms.length > 0) {
		const platform = asNonEmptyString(asObject(payload.extra).platform)?.toLowerCase() ?? null;
		if (platform === null || !platforms.includes(platform)) {
			return `platform "${platform ?? ''}" not in filter`;
		}
	}

	const boards = (filters.boards ?? []).map((b) => b.toLowerCase());
	if (boards.length > 0) {
		const board = getEventBoard(payload)?.toLowerCase() ?? null;
		if (board === null || !boards.includes(board)) {
			return `board "${board ?? ''}" not in filter`;
		}
	}

	const sessionId = filters.sessionId?.trim();
	if (sessionId) {
		if (!getSessionCandidates(payload).includes(sessionId)) return 'session does not match filter';
	}

	const toolPattern = filters.toolName?.trim();
	if (toolPattern) {
		if (!matchesToolName(toolPattern, asNonEmptyString(payload.tool_name))) {
			return 'tool name does not match filter';
		}
	}

	return null;
}

export function matchesFilters(
	payload: IDataObject,
	headers: HeaderBag | undefined,
	filters: HermesTriggerFilters,
): boolean {
	return getFilterRejection(payload, headers, filters) === null;
}

/**
 * Map the Hermes outbound payload (agent/outbound_webhooks.py `_serialize_payload` +
 * agent/shell_hooks.py `_payload_fields`) to the trigger's output item.
 *
 * Wire shape: `{hook_event_name, profile, tool_name, tool_input, session_id, cwd, extra,
 * delivery_id, timestamp}`; `extra` holds every other hook kwarg (platform, session_key, ...).
 *
 * kanban-bridge deliveries use the same envelope but put the task coordinates top-level
 * (`board, task_id, event_id, event_kind, run_id, title, status, assignee, priority, actor,
 * payload`). Those are folded into `extra` so a workflow reads `extra.task_id` whichever source
 * delivered the event; an explicit `extra` in the body still wins.
 */
export function normalizeEvent(payload: IDataObject, headers?: HeaderBag): NormalizedHermesEvent {
	const event = getEventName(payload, headers);
	const extra = isKanbanBridgeEvent(event)
		? { ...pickDefined(payload, KANBAN_BRIDGE_EXTRA_KEYS), ...asObject(payload.extra) }
		: asObject(payload.extra);
	const toolInput = payload.tool_input;
	return {
		event,
		profile: asNonEmptyString(payload.profile),
		platform: asNonEmptyString(extra.platform),
		board: getEventBoard(payload),
		sessionId: getSessionCandidates(payload)[0] ?? null,
		toolName: asNonEmptyString(payload.tool_name),
		toolInput:
			toolInput !== null && typeof toolInput === 'object' && !Array.isArray(toolInput)
				? (toolInput as IDataObject)
				: null,
		cwd: asNonEmptyString(payload.cwd),
		extra,
		deliveryId:
			asNonEmptyString(payload.delivery_id) ?? getHeader(headers, 'x-hermes-delivery') ?? null,
		timestamp: asNonEmptyString(payload.timestamp),
	};
}

export interface OutboundYamlOptions {
	name?: string;
	secretEnv?: string;
	/** Optional Hermes-side tool regex; only emitted when a tool-scoped event is selected. */
	matcher?: string;
	timeout?: number;
}

/**
 * Ready-to-paste `hooks.outbound` block for `~/.hermes/config.yaml`, listing only `events` and
 * signing via `secret_env` (the secret itself lives in `~/.hermes/.env`).
 */
export function buildOutboundYaml(
	webhookUrlPlaceholder: string,
	events: string[],
	options: OutboundYamlOptions = {},
): string {
	const selected = events.filter((e) => /^[a-z0-9_]+$/.test(e));
	const lines = [
		'hooks:',
		'  outbound:',
		`    - name: ${options.name ?? 'n8n'}`,
		`      url: ${JSON.stringify(webhookUrlPlaceholder)}`,
		`      events: [${selected.join(', ')}]`,
		`      secret_env: ${options.secretEnv ?? DEFAULT_SIGNING_ENV_VAR}`,
		`      timeout: ${options.timeout ?? 10}`,
	];
	if (options.matcher && selected.some((e) => TOOL_SCOPED_EVENTS.includes(e))) {
		lines.push(`      matcher: ${JSON.stringify(options.matcher)}`);
	}
	return lines.join('\n');
}

export interface KanbanTargetsYamlOptions {
	name?: string;
	secretEnv?: string;
	/** Boards the target receives events for; `['*']` for every board the plugin knows. */
	boards?: string[];
}

/**
 * Ready-to-paste `plugins.entries.kanban-bridge.settings.targets` block for the **default**
 * profile's `config.yaml`. The bridge pushes from the dashboard process, so this is configured
 * here and not under `hooks.outbound`; the secret itself lives in the default profile's `.env`
 * under `secret_env`.
 */
export function buildKanbanTargetsYaml(
	webhookUrlPlaceholder: string,
	events: string[],
	options: KanbanTargetsYamlOptions = {},
): string {
	const kanban = events.filter((e) => KANBAN_BRIDGE_EVENTS.includes(e));
	const eventsValue = kanban.includes(KANBAN_ANY_EVENT)
		? '["*"]'
		: `[${kanban.filter((e) => /^[a-z0-9_]+$/.test(e)).join(', ')}]`;
	const boards = options.boards?.length ? options.boards : ['*'];
	return [
		'plugins:',
		'  entries:',
		'    kanban-bridge:',
		'      settings:',
		'        targets:',
		`          - name: ${options.name ?? 'n8n'}`,
		`            url: ${JSON.stringify(webhookUrlPlaceholder)}`,
		`            boards: [${boards.map((b) => JSON.stringify(b)).join(', ')}]`,
		`            events: ${eventsValue}`,
		`            secret_env: ${options.secretEnv ?? DEFAULT_SIGNING_ENV_VAR}`,
	].join('\n');
}
