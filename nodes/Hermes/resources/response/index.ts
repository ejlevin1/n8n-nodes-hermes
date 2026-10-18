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

const showForResponse = { resource: ['response'] };
const showForCreate = { resource: ['response'], operation: ['create'] };

export const responseDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showForResponse },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Run one agent turn through the OpenAI-compatible Responses API',
				action: 'Create a response',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a stored response',
				action: 'Delete a response',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a stored response',
				action: 'Get a response',
			},
		],
		default: 'create',
	},

	// ---- Create ----
	{
		displayName: 'Input',
		name: 'input',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: showForCreate },
		description:
			'The user message to send. To send a list of Responses input items instead, set the Input Items (JSON) option.',
	},
	{
		displayName: 'Instructions',
		name: 'instructions',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		displayOptions: { show: showForCreate },
		description:
			'Optional system instructions for this turn. When continuing a previous response and left empty, the previous instructions are reused.',
	},
	{
		displayName: MODEL_HINT,
		name: 'responseModelHint',
		type: 'notice',
		default: '',
		displayOptions: { show: showForCreate },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: showForCreate },
		options: [
			{
				displayName: 'Conversation',
				name: 'conversation',
				type: 'string',
				default: '',
				description:
					'Named conversation to continue. Hermes chains it to the latest stored response of that name. Cannot be combined with Previous Response ID.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Sent as the <code>Idempotency-Key</code> header so a retried request is not run twice. Leave empty to generate a key from the execution, node, run and item. 1–255 printable ASCII characters.',
			},
			{
				displayName: 'Input Items (JSON)',
				name: 'inputItems',
				type: 'json',
				default: '[]',
				description:
					'Responses API input items, e.g. <code>[{"role": "user", "content": "Hi"}]</code>. When set to a non-empty array it replaces Input.',
			},
			...modelOptionFields,
			{
				displayName: 'Previous Response ID',
				name: 'previousResponseId',
				type: 'string',
				default: '',
				description:
					'Continue from a stored response (its history and session are reused). Cannot be combined with Conversation.',
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
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				default: '',
				description:
					'Scopes long-term memory to a channel or user (sent as <code>X-Hermes-Session-Key</code>)',
			},
			{
				displayName: 'Store',
				name: 'store',
				type: 'boolean',
				default: true,
				description:
					'Whether Hermes stores the response so it can be retrieved later or continued with Previous Response ID',
			},
			timeoutOption,
			{
				displayName: 'Truncation',
				name: 'truncation',
				type: 'options',
				default: 'disabled',
				options: [
					{
						name: 'Auto',
						value: 'auto',
						description: 'Drop the oldest history when it gets too long',
					},
					{
						name: 'Disabled',
						value: 'disabled',
						description: 'Send the full history',
					},
				],
				description: 'How to handle a conversation history that grows too long',
			},
		],
	},

	// ---- Get / Delete ----
	{
		displayName: 'Response ID',
		name: 'responseId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'resp_...',
		displayOptions: { show: { resource: ['response'], operation: ['get', 'delete'] } },
		description: 'ID of the stored response',
	},

	// ---- Shared ----
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['response'], operation: ['create', 'get'] } },
		description:
			'Whether to return a simplified version of the response instead of the raw Responses API data',
	},
];

function parseInputItems(this: IExecuteFunctions, raw: unknown, i: number): IDataObject[] {
	if (raw === undefined || raw === null || raw === '') return [];
	let value: unknown = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch {
			throw new NodeOperationError(this.getNode(), 'Input Items must be valid JSON', {
				itemIndex: i,
			});
		}
	}
	if (!Array.isArray(value)) {
		throw new NodeOperationError(this.getNode(), 'Input Items must be a JSON array', {
			itemIndex: i,
		});
	}
	return value as IDataObject[];
}

function textOfContent(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((part) => {
			if (!part || typeof part !== 'object') return '';
			const p = part as IDataObject;
			return p.type === 'output_text' || p.type === 'text' ? String(p.text ?? '') : '';
		})
		.join('');
}

/**
 * Simplified view of a Responses API object. Tool calls in `output` were already executed by
 * Hermes on the server; they are reported (with their outputs) for information only.
 */
export function simplifyResponse(
	body: IDataObject,
	headers: Record<string, unknown> = {},
): IDataObject {
	const output = Array.isArray(body.output) ? (body.output as IDataObject[]) : [];
	const texts: string[] = [];
	const reasoning: string[] = [];
	const toolCalls: IDataObject[] = [];
	const byCallId = new Map<string, IDataObject>();

	for (const item of output) {
		switch (item?.type) {
			case 'message':
				if (item.role === undefined || item.role === 'assistant') {
					texts.push(textOfContent(item.content));
				}
				break;
			case 'reasoning': {
				const summary = Array.isArray(item.summary) ? (item.summary as IDataObject[]) : [];
				const text = summary.map((s) => String(s?.text ?? '')).join('');
				if (text) reasoning.push(text);
				break;
			}
			case 'function_call': {
				let args: unknown = item.arguments;
				if (typeof args === 'string' && args.trim()) {
					try {
						args = JSON.parse(args);
					} catch {
						// keep the raw string
					}
				}
				const call: IDataObject = {
					callId: (item.call_id as string) ?? null,
					name: (item.name as string) ?? '',
					arguments: (args as IDataObject) ?? null,
					output: null,
				};
				toolCalls.push(call);
				if (typeof item.call_id === 'string' && item.call_id) byCallId.set(item.call_id, call);
				break;
			}
			case 'function_call_output': {
				const call = typeof item.call_id === 'string' ? byCallId.get(item.call_id) : undefined;
				if (call) call.output = (item.output as string) ?? null;
				else
					toolCalls.push({
						callId: (item.call_id as string) ?? null,
						name: null,
						arguments: null,
						output: (item.output as string) ?? null,
					});
				break;
			}
			default:
				break;
		}
	}

	const sessionHeader = headers['x-hermes-session-id'];
	const errorObj = body.error as IDataObject | undefined;
	const outputText =
		typeof body.output_text === 'string' && body.output_text ? body.output_text : texts.join('\n');

	return {
		id: (body.id as string) ?? null,
		status: (body.status as string) ?? null,
		outputText,
		reasoning: reasoning.length ? reasoning.join('\n') : null,
		toolCalls,
		sessionId:
			sessionHeader === undefined || sessionHeader === null
				? null
				: String(Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader),
		model: (body.model as string) ?? null,
		usage: (body.usage as IDataObject) ?? null,
		error: errorObj && typeof errorObj === 'object' ? ((errorObj.message as string) ?? null) : null,
		createdAt: (body.created_at as number) ?? null,
	};
}

function pickHermesHeaders(headers: Record<string, unknown>): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase().startsWith('x-hermes-')) out[key.toLowerCase()] = value as string;
	}
	return out;
}

/** Build the POST /v1/responses body from node parameters. Exported for tests. */
export function buildResponseBody(
	input: string | IDataObject[],
	instructions: string,
	options: IDataObject,
): IDataObject {
	const body: IDataObject = { input, stream: false };
	if (instructions && instructions.trim()) body.instructions = instructions;
	const previous =
		typeof options.previousResponseId === 'string' ? options.previousResponseId.trim() : '';
	const conversation = typeof options.conversation === 'string' ? options.conversation.trim() : '';
	if (previous) body.previous_response_id = previous;
	if (conversation) body.conversation = conversation;
	if (typeof options.store === 'boolean') body.store = options.store;
	if (options.truncation === 'auto' || options.truncation === 'disabled') {
		body.truncation = options.truncation;
	}
	Object.assign(body, buildModelFields(options));
	return body;
}

async function create(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const inputText = this.getNodeParameter('input', i, '') as string;
	const instructions = this.getNodeParameter('instructions', i, '') as string;
	const simplify = this.getNodeParameter('simplify', i, true) as boolean;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const items = parseInputItems.call(this, options.inputItems, i);
	const input: string | IDataObject[] = items.length ? items : inputText;
	if (!items.length && (!inputText || !String(inputText).trim())) {
		throw new NodeOperationError(this.getNode(), 'Input must not be empty', { itemIndex: i });
	}

	const body = buildResponseBody(input, instructions, options);
	if (body.previous_response_id && body.conversation) {
		throw new NodeOperationError(
			this.getNode(),
			'Use either Previous Response ID or Conversation, not both',
			{ itemIndex: i },
		);
	}

	const headers: IDataObject = {};
	const sessionKey = typeof options.sessionKey === 'string' ? options.sessionKey.trim() : '';
	if (sessionKey) headers['X-Hermes-Session-Key'] = sessionKey;
	const explicitKey =
		typeof options.idempotencyKey === 'string' ? options.idempotencyKey.trim() : '';
	if (explicitKey || options.sendIdempotencyKey === true) {
		headers['Idempotency-Key'] = getIdempotencyKey.call(this, i, explicitKey);
	}

	const response = (await hermesApiRequest.call(this, 'POST', '/v1/responses', {
		body,
		headers,
		timeout: timeoutMinutesToMs(options.timeout),
		returnFullResponse: true,
	})) as HermesFullResponse;

	const resBody = (response.body ?? {}) as IDataObject;
	const resHeaders = (response.headers ?? {}) as Record<string, unknown>;
	if (simplify) return [{ json: simplifyResponse(resBody, resHeaders) }];
	return [{ json: { ...resBody, hermesHeaders: pickHermesHeaders(resHeaders) } }];
}

function requireResponseId(this: IExecuteFunctions, i: number): string {
	const id = String(this.getNodeParameter('responseId', i, '') ?? '').trim();
	if (!id) {
		throw new NodeOperationError(this.getNode(), 'Response ID must not be empty', { itemIndex: i });
	}
	return id;
}

export async function executeResponse(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'create':
			return await create.call(this, i);
		case 'get': {
			const id = requireResponseId.call(this, i);
			const simplify = this.getNodeParameter('simplify', i, true) as boolean;
			const body = (await hermesApiRequest.call(
				this,
				'GET',
				`/v1/responses/${encodeURIComponent(id)}`,
			)) as IDataObject;
			return [{ json: simplify ? simplifyResponse(body ?? {}) : (body ?? {}) }];
		}
		case 'delete': {
			const id = requireResponseId.call(this, i);
			const body = (await hermesApiRequest.call(
				this,
				'DELETE',
				`/v1/responses/${encodeURIComponent(id)}`,
			)) as IDataObject;
			return [{ json: body ?? { id, deleted: true } }];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported Response operation: ${operation}`, {
				itemIndex: i,
			});
	}
}
