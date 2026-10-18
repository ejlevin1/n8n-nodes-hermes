import type { IDataObject, INodePropertyOptions } from 'n8n-workflow';

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
		name: 'Kanban Task Blocked',
		value: 'kanban_task_blocked',
		description: 'A Kanban task moved to blocked',
	},
	{
		name: 'Kanban Task Completed',
		value: 'kanban_task_completed',
		description: 'A Kanban task was completed',
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

export const DEFAULT_EVENTS = ['post_llm_call'];

export const DEFAULT_SIGNING_ENV_VAR = 'HERMES_N8N_WEBHOOK_SECRET';

export type HeaderBag = Record<string, string | string[] | undefined> | IDataObject;

export interface HermesTriggerFilters {
	/** Events the trigger accepts. An empty list accepts nothing. */
	events: string[];
	/** Accepted `extra.platform` values (case-insensitive). Empty or undefined: any platform. */
	platforms?: string[];
	/** Session to match against session_id / extra.session_key / parent / child session ids. */
	sessionId?: string;
	/** Regex matched against `tool_name`. Invalid regex falls back to literal equality (as Hermes does). */
	toolName?: string;
}

export interface NormalizedHermesEvent extends IDataObject {
	event: string;
	profile: string | null;
	platform: string | null;
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
	if (!filters.events.includes(event)) return `event "${event}" not selected`;

	const platforms = (filters.platforms ?? []).map((p) => p.toLowerCase());
	if (platforms.length > 0) {
		const platform = asNonEmptyString(asObject(payload.extra).platform)?.toLowerCase() ?? null;
		if (platform === null || !platforms.includes(platform)) {
			return `platform "${platform ?? ''}" not in filter`;
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
 */
export function normalizeEvent(payload: IDataObject, headers?: HeaderBag): NormalizedHermesEvent {
	const extra = asObject(payload.extra);
	const toolInput = payload.tool_input;
	return {
		event: getEventName(payload, headers),
		profile: asNonEmptyString(payload.profile),
		platform: asNonEmptyString(extra.platform),
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
