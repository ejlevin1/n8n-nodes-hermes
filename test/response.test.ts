import { describe, expect, it, vi } from 'vitest';
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import {
	buildResponseBody,
	executeResponse,
	simplifyResponse,
} from '../nodes/Hermes/resources/response';

function full(body: unknown, statusCode = 200, headers: Record<string, unknown> = {}) {
	return { statusCode, headers, body };
}

function mockContext(params: IDataObject, ...responses: unknown[]) {
	const httpRequestWithAuthentication = vi.fn();
	for (const r of responses) httpRequestWithAuthentication.mockResolvedValueOnce(r);
	const ctx = {
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getCredentials: vi.fn().mockResolvedValue({ baseUrl: 'http://hermes:8642/', apiKey: 'x' }),
		getNode: () => ({
			id: 'node-1',
			name: 'Hermes 1',
			type: 'n8n-nodes-hermes.hermes',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getExecutionId: () => 'exec-1',
		getWorkflowDataProxy: () => ({ $runIndex: 0 }),
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
	const request = (n = 0) => httpRequestWithAuthentication.mock.calls[n][1] as IHttpRequestOptions;
	return { ctx, httpRequestWithAuthentication, request };
}

const responseBody = {
	id: 'resp_abc',
	object: 'response',
	status: 'completed',
	created_at: 1700000000,
	model: 'hermes-agent',
	output: [
		{
			id: 'rs_1',
			type: 'reasoning',
			status: 'completed',
			summary: [{ type: 'summary_text', text: 'hmm' }],
		},
		{
			id: 'fc_1',
			type: 'function_call',
			status: 'completed',
			name: 'terminal',
			arguments: '{"command":"ls"}',
			call_id: 'call_1',
		},
		{
			id: 'fco_1',
			type: 'function_call_output',
			status: 'completed',
			call_id: 'call_1',
			output: 'a.txt',
		},
		{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] },
	],
	usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
};

describe('Response > simplifyResponse', () => {
	it('extracts output text, reasoning and executed tool calls', () => {
		const s = simplifyResponse(responseBody, { 'x-hermes-session-id': 'sess-9' });
		expect(s.outputText).toBe('Done.');
		expect(s.reasoning).toBe('hmm');
		expect(s.sessionId).toBe('sess-9');
		expect(s.toolCalls).toEqual([
			{ callId: 'call_1', name: 'terminal', arguments: { command: 'ls' }, output: 'a.txt' },
		]);
		expect(s.status).toBe('completed');
		expect(s.error).toBeNull();
	});

	it('surfaces a failed response error', () => {
		const s = simplifyResponse({
			...responseBody,
			status: 'failed',
			error: { code: 'agent_error', message: 'boom' },
		});
		expect(s.error).toBe('boom');
	});
});

describe('Response > buildResponseBody', () => {
	it('maps options to the Responses API body', () => {
		const body = buildResponseBody('Hi', 'Be brief', {
			previousResponseId: ' resp_1 ',
			store: false,
			truncation: 'auto',
			model: 'm',
			provider: 'p',
			reasoningEffort: 'high',
		});
		expect(body).toEqual({
			input: 'Hi',
			stream: false,
			instructions: 'Be brief',
			previous_response_id: 'resp_1',
			store: false,
			truncation: 'auto',
			model: 'm',
			provider: 'p',
			model_options: { reasoning: { effort: 'high' } },
		});
	});
});

describe('Response > Create', () => {
	it('posts to /v1/responses with timeout, session key and idempotency key', async () => {
		const { ctx, request } = mockContext(
			{
				input: 'List files',
				instructions: '',
				simplify: true,
				options: { sessionKey: 'chan-1', sendIdempotencyKey: true, timeout: 2 },
			},
			full(responseBody, 200, { 'x-hermes-session-id': 'sess-9' }),
		);
		const out = await executeResponse.call(ctx, 'create', 0);
		const req = request();
		expect(req.method).toBe('POST');
		expect(req.url).toBe('http://hermes:8642/v1/responses');
		expect(req.timeout).toBe(120_000);
		expect((req.headers as IDataObject)['X-Hermes-Session-Key']).toBe('chan-1');
		expect(String((req.headers as IDataObject)['Idempotency-Key'])).toMatch(/^n8n-[0-9a-f]{40}$/);
		expect((req.body as IDataObject).input).toBe('List files');
		expect(out[0].json.outputText).toBe('Done.');
		expect(out[0].json.sessionId).toBe('sess-9');
	});

	it('defaults the timeout to 5 minutes', async () => {
		const { ctx, request } = mockContext({ input: 'x', options: {} }, full(responseBody));
		await executeResponse.call(ctx, 'create', 0);
		expect(request().timeout).toBe(300_000);
	});

	it('sends JSON input items instead of the text input', async () => {
		const items = [{ role: 'user', content: 'Hello' }];
		const { ctx, request } = mockContext(
			{ input: '', options: { inputItems: JSON.stringify(items) } },
			full(responseBody),
		);
		await executeResponse.call(ctx, 'create', 0);
		expect((request().body as IDataObject).input).toEqual(items);
	});

	it('rejects Previous Response ID together with Conversation', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext({
			input: 'x',
			options: { previousResponseId: 'resp_1', conversation: 'c' },
		});
		await expect(executeResponse.call(ctx, 'create', 0)).rejects.toBeInstanceOf(NodeOperationError);
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('returns raw output with hermes headers when not simplified', async () => {
		const { ctx } = mockContext(
			{ input: 'x', simplify: false, options: {} },
			full(responseBody, 200, { 'x-hermes-session-id': 's', other: 'y' }),
		);
		const out = await executeResponse.call(ctx, 'create', 0);
		expect(out[0].json.id).toBe('resp_abc');
		expect(out[0].json.hermesHeaders).toEqual({ 'x-hermes-session-id': 's' });
	});
});

describe('Response > Get / Delete', () => {
	it('gets a stored response by id', async () => {
		const { ctx, request } = mockContext(
			{ responseId: 'resp_abc', simplify: false },
			full(responseBody),
		);
		const out = await executeResponse.call(ctx, 'get', 0);
		expect(request().method).toBe('GET');
		expect(request().url).toBe('http://hermes:8642/v1/responses/resp_abc');
		expect(out[0].json.id).toBe('resp_abc');
	});

	it('deletes a stored response', async () => {
		const { ctx, request } = mockContext(
			{ responseId: 'resp_abc' },
			full({ id: 'resp_abc', object: 'response', deleted: true }),
		);
		const out = await executeResponse.call(ctx, 'delete', 0);
		expect(request().method).toBe('DELETE');
		expect(out[0].json.deleted).toBe(true);
	});

	it('throws a NodeApiError for a missing response', async () => {
		const { ctx } = mockContext(
			{ responseId: 'nope' },
			full({ error: { message: 'Response not found: nope', type: 'invalid_request_error' } }, 404),
		);
		await expect(executeResponse.call(ctx, 'get', 0)).rejects.toBeInstanceOf(NodeApiError);
	});
});
