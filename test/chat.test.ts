import { describe, expect, it, vi } from 'vitest';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { executeChat } from '../nodes/Hermes/resources/chat';
import {
	buildChatMessages,
	parseImageUrls,
	pickHermesHeaders,
	simplifyChatResponse,
} from '../nodes/Hermes/resources/chat/sendMessage';

const completion = {
	id: 'chatcmpl-1',
	model: 'hermes-agent',
	choices: [
		{
			index: 0,
			message: { role: 'assistant', content: 'Hello!', reasoning_content: 'thinking' },
			finish_reason: 'stop',
		},
	],
	usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
};

function mockContext(params: IDataObject, response: unknown) {
	const httpRequestWithAuthentication = vi.fn().mockResolvedValue(response);
	const ctx = {
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getCredentials: vi.fn().mockResolvedValue({ baseUrl: 'http://hermes:8642', apiKey: 'x' }),
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
	return { ctx, httpRequestWithAuthentication };
}

describe('Chat > Send Message', () => {
	it('posts to /v1/chat/completions with session headers and model fields', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{
				message: 'Hi',
				systemPrompt: 'Be brief',
				simplify: true,
				options: {
					sessionId: ' sess-1 ',
					sessionKey: 'user-42',
					model: 'm',
					provider: 'p',
					reasoningEffort: 'low',
					timeout: 1,
				},
			},
			{ statusCode: 200, headers: { 'x-hermes-session-id': 'sess-1' }, body: completion },
		);
		await executeChat.call(ctx, 'sendMessage', 0);
		const [cred, opts] = httpRequestWithAuthentication.mock.calls[0];
		expect(cred).toBe('hermesApi');
		expect(opts.method).toBe('POST');
		expect(opts.url).toBe('http://hermes:8642/v1/chat/completions');
		expect(opts.timeout).toBe(60_000);
		expect(opts.headers['X-Hermes-Session-Id']).toBe('sess-1');
		expect(opts.headers['X-Hermes-Session-Key']).toBe('user-42');
		expect(opts.headers['Idempotency-Key']).toBeUndefined();
		expect(opts.body).toEqual({
			messages: [
				{ role: 'system', content: 'Be brief' },
				{ role: 'user', content: 'Hi' },
			],
			stream: false,
			model: 'm',
			provider: 'p',
			model_options: { reasoning: { effort: 'low' } },
		});
	});

	it('omits session headers when not set and sends an Idempotency-Key on request', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ message: 'Hi', options: { sendIdempotencyKey: true } },
			{ statusCode: 200, headers: {}, body: completion },
		);
		await executeChat.call(ctx, 'sendMessage', 0);
		const headers = httpRequestWithAuthentication.mock.calls[0][1].headers;
		expect(headers['X-Hermes-Session-Id']).toBeUndefined();
		expect(headers['X-Hermes-Session-Key']).toBeUndefined();
		expect(headers['Idempotency-Key']).toMatch(/^n8n-[0-9a-f]{40}$/);
	});

	it('uses an explicit Idempotency Key', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ message: 'Hi', options: { idempotencyKey: 'abc-123' } },
			{ statusCode: 200, headers: {}, body: completion },
		);
		await executeChat.call(ctx, 'sendMessage', 0);
		expect(httpRequestWithAuthentication.mock.calls[0][1].headers['Idempotency-Key']).toBe(
			'abc-123',
		);
	});

	it('includes prior messages and image URLs', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{
				message: 'What is this?',
				options: {
					priorMessages: '[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]',
					imageUrls: 'https://x/a.png, https://x/b.png',
				},
			},
			{ statusCode: 200, headers: {}, body: completion },
		);
		await executeChat.call(ctx, 'sendMessage', 0);
		const messages = httpRequestWithAuthentication.mock.calls[0][1].body.messages;
		expect(messages).toHaveLength(3);
		expect(messages[2].content).toEqual([
			{ type: 'text', text: 'What is this?' },
			{ type: 'image_url', image_url: { url: 'https://x/a.png' } },
			{ type: 'image_url', image_url: { url: 'https://x/b.png' } },
		]);
	});

	it('returns simplified output built from x-hermes-* headers', async () => {
		const { ctx } = mockContext(
			{ message: 'Hi', simplify: true, options: {} },
			{
				statusCode: 200,
				headers: {
					'x-hermes-session-id': 'sess-9',
					'x-hermes-completed': 'false',
					'x-hermes-partial': 'true',
					'x-hermes-error': 'max_iterations',
				},
				body: completion,
			},
		);
		const [item] = await executeChat.call(ctx, 'sendMessage', 0);
		expect(item.json).toMatchObject({
			content: 'Hello!',
			reasoning: 'thinking',
			sessionId: 'sess-9',
			finishReason: 'stop',
			usage: completion.usage,
			completed: false,
			partial: true,
			error: 'max_iterations',
		});
	});

	it('returns the raw body plus hermesHeaders when simplify is off', async () => {
		const { ctx } = mockContext(
			{ message: 'Hi', simplify: false, options: {} },
			{
				statusCode: 200,
				headers: { 'x-hermes-session-id': 's', 'content-type': 'application/json' },
				body: completion,
			},
		);
		const [item] = await executeChat.call(ctx, 'sendMessage', 0);
		expect(item.json.choices).toEqual(completion.choices);
		expect(item.json.hermesHeaders).toEqual({ 'x-hermes-session-id': 's' });
	});

	it('rejects an empty message and invalid prior messages', async () => {
		const empty = mockContext({ message: '  ', options: {} }, {});
		await expect(executeChat.call(empty.ctx, 'sendMessage', 0)).rejects.toThrow(NodeOperationError);
		const badJson = mockContext({ message: 'x', options: { priorMessages: '{nope' } }, {});
		await expect(executeChat.call(badJson.ctx, 'sendMessage', 0)).rejects.toThrow(/valid JSON/);
		const notArray = mockContext({ message: 'x', options: { priorMessages: '{"a":1}' } }, {});
		await expect(executeChat.call(notArray.ctx, 'sendMessage', 0)).rejects.toThrow(/array/);
		const badEntry = mockContext(
			{ message: 'x', options: { priorMessages: '[{"role":"user"}]' } },
			{},
		);
		await expect(executeChat.call(badEntry.ctx, 'sendMessage', 0)).rejects.toThrow(/entry 0/);
	});

	it('rejects unknown operations', async () => {
		const { ctx } = mockContext({}, {});
		await expect(executeChat.call(ctx, 'nope', 0)).rejects.toThrow(/Unsupported/);
	});
});

describe('chat helpers', () => {
	it('simplifyChatResponse falls back to the hermes block and defaults completed to true', () => {
		expect(simplifyChatResponse({ statusCode: 200, headers: {}, body: completion }).completed).toBe(
			true,
		);
		const out = simplifyChatResponse({
			statusCode: 200,
			headers: {},
			body: { ...completion, hermes: { completed: false, partial: true, error: 'interrupted' } },
		});
		expect(out).toMatchObject({
			completed: false,
			partial: true,
			error: 'interrupted',
			sessionId: null,
		});
	});

	it('parseImageUrls splits commas and newlines', () => {
		expect(parseImageUrls('a, b\nc,,')).toEqual(['a', 'b', 'c']);
		expect(parseImageUrls(undefined)).toEqual([]);
	});

	it('buildChatMessages skips a blank system prompt', () => {
		expect(buildChatMessages('hi', '  ', [], [])).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('pickHermesHeaders keeps only x-hermes-* headers', () => {
		expect(pickHermesHeaders({ 'X-Hermes-Partial': 'true', server: 'x' })).toEqual({
			'x-hermes-partial': 'true',
		});
	});
});
