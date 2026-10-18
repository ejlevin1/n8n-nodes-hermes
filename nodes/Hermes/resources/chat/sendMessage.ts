import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { hermesApiRequest, type HermesFullResponse } from '../../transport/hermesApiRequest';
import { getIdempotencyKey } from '../../helpers/idempotency';
import {
	buildModelFields,
	MODEL_HINT,
	modelOptionFields,
	timeoutMinutesToMs,
	timeoutOption,
} from '../../helpers/modelOptions';

const showForSendMessage = { resource: ['chat'], operation: ['sendMessage'] };

export const sendMessageDescription: INodeProperties[] = [
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: showForSendMessage },
		description: 'The user message to send to the agent',
	},
	{
		displayName: 'System Prompt',
		name: 'systemPrompt',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		displayOptions: { show: showForSendMessage },
		description: 'Optional extra system instructions for this turn',
	},
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: showForSendMessage },
		description:
			'Whether to return a simplified version of the response instead of the raw OpenAI-compatible data',
	},
	{
		displayName: MODEL_HINT,
		name: 'modelHint',
		type: 'notice',
		default: '',
		displayOptions: { show: showForSendMessage },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: showForSendMessage },
		options: [
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Sent as the <code>Idempotency-Key</code> header so a retried request is not run twice. Leave empty to generate a key from the execution, node, run and item. 1–255 printable ASCII characters.',
			},
			{
				displayName: 'Image URLs',
				name: 'imageUrls',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/a.png, https://example.com/b.jpg',
				description:
					'Comma-separated http(s) or <code>data:image/...</code> URLs attached to the message',
			},
			...modelOptionFields,
			{
				displayName: 'Prior Messages (JSON)',
				name: 'priorMessages',
				type: 'json',
				default: '[]',
				description:
					'Earlier conversation turns as an array of <code>{"role": "user"|"assistant", "content": "..."}</code>. Ignored by the server when Session ID is set (history then comes from the session).',
			},
			{
				displayName: 'Send Idempotency Key',
				name: 'sendIdempotencyKey',
				type: 'boolean',
				default: false,
				description:
					'Whether to send an <code>Idempotency-Key</code> header (auto-generated unless Idempotency Key is set)',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				description:
					'Hermes session to use, sent as the <code>X-Hermes-Session-ID</code> header. If the session exists, Hermes continues it with its stored history (which overrides Prior Messages); if not, Hermes starts a new session under this ID. Use a stable value per conversation (e.g. the chat trigger\'s sessionId) to keep context. Leave empty for a one-off message with no stored history.',
			},
			{
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				default: '',
				description:
					'Scopes long-term memory to a channel or user (sent as <code>X-Hermes-Session-Key</code>)',
			},
			timeoutOption,
		],
	},
];

function parsePriorMessages(this: IExecuteFunctions, raw: unknown, i: number): IDataObject[] {
	if (raw === undefined || raw === null || raw === '') return [];
	let value: unknown = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch {
			throw new NodeOperationError(this.getNode(), 'Prior Messages must be valid JSON', {
				itemIndex: i,
			});
		}
	}
	if (!Array.isArray(value)) {
		throw new NodeOperationError(this.getNode(), 'Prior Messages must be a JSON array', {
			itemIndex: i,
		});
	}
	return value.map((entry, idx) => {
		if (!entry || typeof entry !== 'object' || !('role' in entry) || !('content' in entry)) {
			throw new NodeOperationError(
				this.getNode(),
				`Prior Messages entry ${idx} must be an object with "role" and "content"`,
				{ itemIndex: i },
			);
		}
		return entry as IDataObject;
	});
}

/** Split a comma/newline separated list of URLs. */
export function parseImageUrls(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.map((u) => String(u).trim()).filter(Boolean);
	if (typeof raw !== 'string') return [];
	return raw
		.split(/[\n,]/)
		.map((u) => u.trim())
		.filter(Boolean);
}

/** Build the OpenAI-style `messages` array for a chat completion. */
export function buildChatMessages(
	message: string,
	systemPrompt: string | undefined,
	priorMessages: IDataObject[],
	imageUrls: string[],
): IDataObject[] {
	const messages: IDataObject[] = [];
	if (systemPrompt && systemPrompt.trim()) {
		messages.push({ role: 'system', content: systemPrompt });
	}
	messages.push(...priorMessages);
	if (imageUrls.length) {
		messages.push({
			role: 'user',
			content: [
				{ type: 'text', text: message },
				...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
			],
		});
	} else {
		messages.push({ role: 'user', content: message });
	}
	return messages;
}

function header(headers: Record<string, unknown>, name: string): string | undefined {
	const value = headers[name.toLowerCase()];
	if (value === undefined || value === null) return undefined;
	return Array.isArray(value) ? String(value[0]) : String(value);
}

/** Collect the `x-hermes-*` response headers (names arrive lowercased). */
export function pickHermesHeaders(headers: Record<string, unknown>): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase().startsWith('x-hermes-')) out[key.toLowerCase()] = value as string;
	}
	return out;
}

/** Simplified chat output from a full response. */
export function simplifyChatResponse(response: HermesFullResponse): IDataObject {
	const body = (response.body ?? {}) as IDataObject;
	const headers = (response.headers ?? {}) as Record<string, unknown>;
	const choices = Array.isArray(body.choices) ? (body.choices as IDataObject[]) : [];
	const choice = choices[0] ?? {};
	const msg = (choice.message ?? {}) as IDataObject;
	const hermes = (body.hermes ?? {}) as IDataObject;

	const completedHeader = header(headers, 'x-hermes-completed');
	const partialHeader = header(headers, 'x-hermes-partial');
	const errorHeader = header(headers, 'x-hermes-error');

	const completed =
		completedHeader !== undefined
			? completedHeader.toLowerCase() === 'true'
			: hermes.completed !== undefined
				? hermes.completed === true
				: true;
	const partial =
		partialHeader !== undefined ? partialHeader.toLowerCase() === 'true' : hermes.partial === true;
	const error =
		errorHeader ?? (typeof hermes.error === 'string' && hermes.error ? hermes.error : null);

	return {
		content: (msg.content as string) ?? '',
		reasoning: (msg.reasoning_content as string) ?? null,
		sessionId: header(headers, 'x-hermes-session-id') ?? null,
		sessionKey: header(headers, 'x-hermes-session-key') ?? null,
		finishReason: (choice.finish_reason as string) ?? null,
		usage: (body.usage as IDataObject) ?? null,
		completed,
		partial,
		error,
		model: (body.model as string) ?? null,
		id: (body.id as string) ?? null,
	};
}

export async function sendMessage(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const message = this.getNodeParameter('message', i) as string;
	const systemPrompt = this.getNodeParameter('systemPrompt', i, '') as string;
	const simplify = this.getNodeParameter('simplify', i, true) as boolean;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	if (!message || !String(message).trim()) {
		throw new NodeOperationError(this.getNode(), 'Message must not be empty', { itemIndex: i });
	}

	const priorMessages = parsePriorMessages.call(this, options.priorMessages, i);
	const imageUrls = parseImageUrls(options.imageUrls);

	const body: IDataObject = {
		messages: buildChatMessages(message, systemPrompt, priorMessages, imageUrls),
		stream: false,
		...buildModelFields(options),
	};

	const headers: IDataObject = {};
	const sessionId = typeof options.sessionId === 'string' ? options.sessionId.trim() : '';
	const sessionKey = typeof options.sessionKey === 'string' ? options.sessionKey.trim() : '';
	if (sessionId) headers['X-Hermes-Session-Id'] = sessionId;
	if (sessionKey) headers['X-Hermes-Session-Key'] = sessionKey;
	const explicitKey =
		typeof options.idempotencyKey === 'string' ? options.idempotencyKey.trim() : '';
	if (explicitKey || options.sendIdempotencyKey === true) {
		headers['Idempotency-Key'] = getIdempotencyKey.call(this, i, explicitKey);
	}

	const response = (await hermesApiRequest.call(this, 'POST', '/v1/chat/completions', {
		body,
		headers,
		timeout: timeoutMinutesToMs(options.timeout),
		returnFullResponse: true,
	})) as HermesFullResponse;

	if (simplify) {
		return [{ json: simplifyChatResponse(response) }];
	}
	return [
		{
			json: {
				...((response.body ?? {}) as IDataObject),
				hermesHeaders: pickHermesHeaders(response.headers ?? {}),
			},
		},
	];
}
