import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import {
	createHermesApiError,
	joinUrl,
	normalizeHermesError,
	type HermesFullResponse,
} from '../transport/hermesApiRequest';

/** Credential the Kanban Task resource authenticates with. */
export const KANBAN_BRIDGE_CREDENTIAL = 'hermesKanbanBridgeApi';

/** Route prefix the `kanban-bridge` Hermes plugin mounts on the dashboard. */
export const KANBAN_BRIDGE_BASE_PATH = '/api/plugins/kanban-bridge/v1';

/** Health route used by the credential test. */
export const KANBAN_BRIDGE_HEALTH_PATH = `${KANBAN_BRIDGE_BASE_PATH}/health`;

/** Server-side cap on `v1/tasks/list`. */
export const KANBAN_LIST_MAX_LIMIT = 200;

/**
 * Kanban task statuses, in dashboard column order (`DEFAULT_WORKFLOW` in
 * hermes_cli/kanban_workflow.py, plus `archived`).
 */
export const KANBAN_STATUSES = [
	'triage',
	'todo',
	'scheduled',
	'ready',
	'running',
	'blocked',
	'review',
	'done',
	'archived',
] as const;

/** `action` values accepted by `v1/tasks/action`, keyed by n8n operation. */
export const KANBAN_ACTIONS: Record<string, string> = {
	complete: 'complete',
	requestChanges: 'request_changes',
	block: 'block',
	unblock: 'unblock',
	archive: 'archive',
	assign: 'assign',
	reprioritize: 'reprioritize',
	edit: 'edit',
};

/** Context used to explain a failure in terms of what the request was trying to do. */
export interface KanbanBridgeErrorContext {
	board?: string;
	taskId?: string;
	/** The wire `action` value, e.g. `request_changes`. */
	action?: string;
	assignee?: string;
}

/** Join the bridge base path and a route, e.g. `tasks/create`. */
export function kanbanBridgePath(route: string): string {
	return joinUrl(KANBAN_BRIDGE_BASE_PATH, route);
}

function asObject(value: unknown): IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: {};
}

/**
 * The bridge reports an illegal transition with the reason `kanban_db` gave. Accept it either
 * top-level, nested under `error`, or inside `detail` (FastAPI's default envelope).
 *
 * The shipped plugin raises `HTTPException(detail=<string>)`, which carries no `reason` key, so
 * today every 409 reason arrives via the `server` fallback in `kanbanBridgeErrorMessage`. The
 * three-envelope search is kept as cheap, deliberate defence against the plugin later returning a
 * structured body.
 */
export function extractTransitionReason(body: unknown): string | undefined {
	const envelopes = [body, asObject(body).error, asObject(body).detail];
	for (const envelope of envelopes) {
		const reason = asObject(envelope).reason;
		if (typeof reason === 'string' && reason.trim()) return reason.trim();
	}
	return undefined;
}

function describeTarget(ctx: KanbanBridgeErrorContext): string {
	const parts: string[] = [];
	if (ctx.taskId) parts.push(`task ${ctx.taskId}`);
	if (ctx.board) parts.push(`board "${ctx.board}"`);
	return parts.join(' on ');
}

/**
 * Friendly messages for the bridge's own failures: 400/422 validation, 401 token, 403 scope,
 * 404 unknown task and 409 illegal transition. Returns undefined when the shared Hermes
 * normaliser already explains the status.
 */
export function kanbanBridgeErrorMessage(
	statusCode: number,
	body: unknown,
	ctx: KanbanBridgeErrorContext = {},
): { message: string; description?: string } | undefined {
	const normalized = normalizeHermesError(statusCode, body);
	const server = normalized.serverMessage?.trim();
	const target = describeTarget(ctx);
	const serverSuffix = server ? ` ${server}` : '';

	// 422 is FastAPI's own pydantic error, raised before the plugin's handler runs (e.g. a
	// non-integer Priority); it needs the same field hint as the plugin's own 400.
	if (statusCode === 400 || statusCode === 422) {
		return {
			message: `The Kanban Bridge rejected the request as invalid${server ? `: ${server}` : ''}`,
			description:
				'Check the required fields for this operation (Board and Title for Create, Board and Task ID otherwise) and that Priority and Max Runtime are whole numbers.',
		};
	}
	if (statusCode === 401) {
		return {
			message: 'The Kanban Bridge rejected the token',
			description: `Check the credential's Token (issued by \`kbctl token create\`, starts with \`kbb_\`) and that it has not been revoked — \`kbctl token list\` shows the labels and their state.${serverSuffix}`,
		};
	}
	if (statusCode === 403) {
		const scopeParts = [
			ctx.board ? `board "${ctx.board}"` : undefined,
			ctx.assignee ? `assignee "${ctx.assignee}"` : undefined,
			ctx.action ? `action "${ctx.action}"` : undefined,
		].filter((p): p is string => p !== undefined);
		return {
			message: `This token is not scoped for ${scopeParts.length ? scopeParts.join(' / ') : 'this request'}`,
			description: `Bridge tokens are scoped to a set of boards, assignees and actions, and a request outside any of them is refused rather than widened. Inspect the scopes with \`kbctl token list\` and change them with \`kbctl token scope <label> …\`.${serverSuffix}`,
		};
	}
	if (statusCode === 404) {
		return {
			message: `The Kanban Bridge found no ${target || 'task'}`,
			description: `Task IDs are per board: the same ID on another board is a different task, and an archived task may be filtered out. Use the Get Many operation to list the board's tasks.${serverSuffix}`,
		};
	}
	if (statusCode === 409) {
		const reason = extractTransitionReason(body) ?? server;
		return {
			message: `The Kanban Bridge refused this change${reason ? `: ${reason}` : ' because the task is in a status that does not allow it'}`,
			description: `Kanban transitions are checked against the task's current status (triage, todo, scheduled, ready, running, blocked, review, done, archived)${target ? ` — re-read ${target} with the Get operation to see where it is now` : ''}. Complete (Approve) is meant for a task in review.`,
		};
	}
	return undefined;
}

/**
 * Make an authenticated request to the kanban-bridge plugin. `route` is relative to
 * `/api/plugins/kanban-bridge/v1`, e.g. `tasks/create`.
 */
export async function kanbanBridgeRequest(
	this: IExecuteFunctions,
	route: string,
	body: IDataObject,
	i: number,
	ctx: KanbanBridgeErrorContext = {},
	method: IHttpRequestMethods = 'POST',
): Promise<IDataObject> {
	const credentials = await this.getCredentials(KANBAN_BRIDGE_CREDENTIAL);
	const url = joinUrl(String(credentials.baseUrl ?? ''), kanbanBridgePath(route));
	const hostHeader = String(credentials.hostHeader ?? '').trim();

	const headers: IDataObject = { Accept: 'application/json' };
	// The dashboard's host check only accepts loopback Host headers, so Docker callers connect to
	// host.docker.internal while still sending `Host: 127.0.0.1:9119`.
	if (hostHeader) headers.Host = hostHeader;

	const requestOptions: IHttpRequestOptions = {
		method,
		url,
		headers,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (method !== 'GET') {
		// n8n's request helper drops an empty object body, and the bridge rejects a POST without
		// JSON, so an empty body goes out as a literal `{}` (same as hermesApiRequest).
		if (Object.keys(body).length) {
			requestOptions.body = body;
			requestOptions.json = true;
		} else {
			requestOptions.body = '{}';
			requestOptions.headers = { 'Content-Type': 'application/json', ...headers };
		}
	} else {
		requestOptions.json = true;
	}

	let response: HermesFullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			KANBAN_BRIDGE_CREDENTIAL,
			requestOptions,
		)) as HermesFullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			message: `Could not reach the Hermes Kanban Bridge at ${url}`,
			description:
				'The bridge only answers in the Hermes dashboard process (launchd me.ericlevin.hermes-dashboard, default profile). Check that the dashboard is running, that the kanban-bridge plugin is enabled in the default profile, and that the credential Base URL and Host Header match how n8n reaches it.',
			itemIndex: i,
		});
	}

	const statusCode = Number(response?.statusCode ?? 0);
	if (statusCode >= 200 && statusCode < 300) {
		return asObject(response.body);
	}

	const friendly = kanbanBridgeErrorMessage(statusCode, response.body, ctx);
	if (friendly) {
		const resBody = response.body;
		throw new NodeApiError(
			this.getNode(),
			{
				statusCode,
				message: normalizeHermesError(statusCode, resBody).serverMessage ?? friendly.message,
				body: (resBody && typeof resBody === 'object'
					? resBody
					: String(resBody ?? '')) as JsonObject,
			},
			{
				message: friendly.message,
				description: friendly.description,
				httpCode: String(statusCode),
				itemIndex: i,
			},
		);
	}
	throw createHermesApiError(this.getNode(), statusCode, response.body, response.headers, i);
}

/** Read a required, non-empty string parameter. */
export function requiredString(
	this: IExecuteFunctions,
	name: string,
	label: string,
	i: number,
): string {
	const value = String(this.getNodeParameter(name, i, '') ?? '').trim();
	if (!value) {
		throw new NodeOperationError(this.getNode(), `${label} is required`, { itemIndex: i });
	}
	return value;
}

/** Split a comma/newline separated list into trimmed, non-empty entries. */
export function parseKanbanList(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
	if (typeof raw !== 'string') return [];
	return raw
		.split(/[\n,]/)
		.map((v) => v.trim())
		.filter(Boolean);
}
