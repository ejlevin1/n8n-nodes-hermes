import type {
	IDataObject,
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	INodeProperties,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import {
	hermesApiRequest,
	normalizeHermesError,
	type HermesFullResponse,
} from '../../transport/hermesApiRequest';
import { getIdempotencyKey } from '../../helpers/idempotency';

const showForSendEvent = { resource: ['webhookRoute'], operation: ['sendEvent'] };

/** Header Hermes falls back to for the delivery id (after GitHub/Svix/Standard Webhooks ids). */
export const REQUEST_ID_HEADER = 'X-Request-ID';

export const sendEventDescription: INodeProperties[] = [
	{
		displayName:
			'Hermes acknowledges the event and runs the agent in the background: the agent reply does not come back over HTTP. To act on the reply, use the <b>Hermes Trigger</b> node with the <code>post_llm_call</code> event (filter Platform = <code>webhook</code>).',
		name: 'replyNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: showForSendEvent },
	},
	{
		displayName: 'Route',
		name: 'route',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'n8n-events',
		displayOptions: { show: showForSendEvent },
		description:
			'Name of the webhook route (a key under <code>platforms.webhook.extra.routes</code> or a <code>hermes webhook subscribe</code> name). The request goes to <code>{Base URL}/webhooks/{Route}</code>.',
	},
	{
		displayName: 'Event Type',
		name: 'eventType',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'order.created',
		displayOptions: { show: showForSendEvent },
		description:
			"Sent as <code>event_type</code> in the body, overriding any <code>event_type</code> or <code>type</code> field in the JSON Body. Must be in the route's <code>events</code> list when the route has one, otherwise Hermes ignores the event.",
	},
	{
		displayName: 'JSON Body',
		name: 'jsonBody',
		type: 'json',
		required: true,
		default: '={{ JSON.stringify($json) }}',
		displayOptions: { show: showForSendEvent },
		description:
			'Event payload as a JSON object. Defaults to the incoming item. Available to the route prompt template as <code>{field}</code> / <code>{nested.field}</code>.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: showForSendEvent },
		options: [
			{
				displayName: 'Request ID',
				name: 'requestId',
				type: 'string',
				default: '',
				description:
					'Delivery ID sent as the <code>X-Request-ID</code> header; Hermes answers <code>duplicate</code> when it has already seen it on this route. Leave empty to generate one from the execution, node, run and item, so retries of the same item are deduplicated. 1–255 printable ASCII characters.',
			},
		],
	},
];

/** Normalised Send Event output. */
export interface WebhookSendEventResult extends IDataObject {
	status: string;
	httpStatus: number;
	route: string;
	event: string | null;
	deliveryId: string | null;
	reason: string | null;
}

/**
 * Validate and URL-encode a route name for the `/webhooks/{route}` path segment.
 * Hermes matches `{route_name}` as a single path segment and looks it up verbatim; routes made with
 * `hermes webhook subscribe` follow `^[a-z0-9][a-z0-9_-]*$`, while config.yaml keys may contain
 * other characters (e.g. `:`), so only characters that cannot live in one segment are rejected.
 */
export function validateRouteName(raw: unknown): { route: string; error?: string } {
	const route = typeof raw === 'string' ? raw.trim() : '';
	if (!route) return { route, error: 'Route must not be empty' };
	if (/[/\\?#\s]/.test(route) || [...route].some((c) => c.charCodeAt(0) < 0x20 || c === '\x7f')) {
		return {
			route,
			error: `Invalid route name "${route}": it must be a single path segment without slashes, spaces, "?" or "#" (routes created with "hermes webhook subscribe" use lowercase letters, digits, "-" and "_")`,
		};
	}
	if (route === '.' || route === '..') {
		return { route, error: `Invalid route name "${route}"` };
	}
	return { route };
}

/** Webhook route path for a validated route name. */
export function buildRoutePath(route: string): string {
	return `/webhooks/${encodeURIComponent(route)}`;
}

/**
 * Parse the JSON Body parameter into an object and force `event_type`.
 * Hermes reads the event type from `X-GitHub-Event` / `X-GitLab-Event` headers, then the body's
 * `event_type`, then its `type`; setting `event_type` makes the Event Type field authoritative.
 * Hermes calls `payload.get(...)`, so the body must be a JSON object (an array would 500).
 */
export function buildEventBody(
	rawBody: unknown,
	eventType: string,
): { body?: IDataObject; error?: string } {
	let value: unknown = rawBody;
	if (value === undefined || value === null || value === '') value = {};
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return { error: 'JSON Body must be valid JSON' };
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { error: 'JSON Body must be a JSON object (not an array or a primitive value)' };
	}
	return { body: { ...(value as IDataObject), event_type: eventType } };
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

/**
 * Turn a Hermes webhook response into the normalised result, or `undefined` when it is an error
 * that should be thrown. Successful shapes (see `gateway/platforms/webhook.py`):
 * - 202 `{status: accepted|coalesced, route, event, delivery_id}` (cron routes add `cron_job`)
 * - 200 `{status: duplicate, delivery_id}`
 * - 200 `{status: ignored, event}` (not in the route's `events`) or `{status: ignored, reason: filter|script, route}`
 * - 200 `{status: delivered, route, target, delivery_id}` (`deliver_only`)
 * - 502 `{status: error, error: "Delivery failed", delivery_id}` (`deliver_only` delivery failed)
 */
export function normalizeWebhookResponse(
	statusCode: number,
	body: unknown,
	sent: { route: string; eventType: string; requestId: string },
): WebhookSendEventResult | undefined {
	const obj =
		body && typeof body === 'object' && !Array.isArray(body) ? (body as IDataObject) : undefined;
	const status = obj ? str(obj.status) : null;
	const isSuccess = statusCode >= 200 && statusCode < 300 && status !== null;
	const isDeliveryFailure = statusCode === 502 && status === 'error';
	if (!obj || !status || !(isSuccess || isDeliveryFailure)) return undefined;

	let reason = str(obj.reason);
	if (isDeliveryFailure) reason = str(obj.error) ?? 'Delivery failed';
	else if (status === 'ignored' && !reason) reason = 'event_not_allowed';

	return {
		status,
		httpStatus: statusCode,
		route: str(obj.route) ?? sent.route,
		event: str(obj.event) ?? sent.eventType,
		deliveryId: str(obj.delivery_id) ?? sent.requestId,
		reason,
	};
}

/** Friendly NodeApiError for a webhook response that is not a normalised outcome. */
export function createWebhookError(
	node: INode,
	statusCode: number,
	body: unknown,
	headers: Record<string, unknown>,
	route: string,
	itemIndex: number,
): NodeApiError {
	const normalized = normalizeHermesError(statusCode, body, headers);
	const server = normalized.serverMessage;
	const retryHint = normalized.retryAfter ? ` Retry after ${normalized.retryAfter} second(s).` : '';
	let message: string;
	switch (statusCode) {
		case 400:
			message = `Hermes could not parse the event body for route "${route}"`;
			break;
		case 401:
			message = `Hermes rejected the signature for route "${route}". Check that the credential secret matches the route secret (or WEBHOOK_SECRET) and that the n8n host clock is within 5 minutes of the Hermes host.`;
			break;
		case 403:
			message = server?.toLowerCase().includes('disabled')
				? `Webhook route "${route}" is disabled in Hermes`
				: `Hermes refused the event for route "${route}"${server ? `: ${server}` : ''}`;
			break;
		case 404:
			message = server?.toLowerCase().includes('profile')
				? 'Hermes does not serve the profile in the Base URL (/p/<profile>)'
				: `Hermes has no webhook route named "${route}". Check the route name and that it is enabled.`;
			break;
		case 413:
			message = 'The event body is larger than the Hermes webhook size limit';
			break;
		case 429:
			message = `Rate limit exceeded for webhook route "${route}".${retryHint || ' Try again in a minute.'}`;
			break;
		case 503:
			message = `Hermes could not accept the event right now; retry this delivery with the same Request ID.${retryHint}`;
			break;
		default:
			message = normalized.message;
	}
	const description = [
		server && !message.includes(server) ? server : undefined,
		normalized.description,
	]
		.filter((part, idx, arr) => part && arr.indexOf(part) === idx)
		.join(' | ');
	const errorResponse: JsonObject = {
		statusCode,
		message: server ?? message,
		body: (body && typeof body === 'object' ? body : String(body ?? '')) as JsonObject,
	};
	return new NodeApiError(node, errorResponse, {
		message,
		description: description || undefined,
		httpCode: String(statusCode),
		itemIndex,
	});
}

export async function sendEvent(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const { route, error: routeError } = validateRouteName(this.getNodeParameter('route', i));
	if (routeError) throw new NodeOperationError(this.getNode(), routeError, { itemIndex: i });

	const eventType = String(this.getNodeParameter('eventType', i, '') ?? '').trim();
	if (!eventType) {
		throw new NodeOperationError(this.getNode(), 'Event Type must not be empty', { itemIndex: i });
	}

	const { body, error: bodyError } = buildEventBody(
		this.getNodeParameter('jsonBody', i),
		eventType,
	);
	if (bodyError || !body) {
		throw new NodeOperationError(this.getNode(), bodyError ?? 'Invalid JSON Body', {
			itemIndex: i,
		});
	}

	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const requestId = getIdempotencyKey.call(
		this,
		i,
		typeof options.requestId === 'string' ? options.requestId : undefined,
	);

	// Pre-serialised so the credential signs exactly the bytes that are sent.
	const response = (await hermesApiRequest.call(this, 'POST', buildRoutePath(route), {
		body: JSON.stringify(body),
		headers: { [REQUEST_ID_HEADER]: requestId },
		credentialType: 'hermesWebhookApi',
		ignoreHttpStatusErrors: true,
		returnFullResponse: true,
	})) as HermesFullResponse;

	const statusCode = Number(response.statusCode ?? 0);
	const result = normalizeWebhookResponse(statusCode, response.body, {
		route,
		eventType,
		requestId,
	});
	if (!result) {
		throw createWebhookError(
			this.getNode(),
			statusCode,
			response.body,
			(response.headers ?? {}) as Record<string, unknown>,
			route,
			i,
		);
	}
	return [{ json: result }];
}
