import { describe, expect, it, vi } from 'vitest';
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	buildSessionUpdateBody,
	executeSession,
	simplifySessionChat,
} from '../nodes/Hermes/resources/session';

function full(body: unknown, statusCode = 200, headers: Record<string, unknown> = {}) {
	return { statusCode, headers, body };
}

function mockContext(params: IDataObject, handler: (req: IHttpRequestOptions) => unknown) {
	const httpRequestWithAuthentication = vi.fn(
		async (_type: string, req: IHttpRequestOptions) => await handler(req),
	);
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
	const calls = () =>
		httpRequestWithAuthentication.mock.calls.map((c) => c[1] as IHttpRequestOptions);
	return { ctx, httpRequestWithAuthentication, calls };
}

const s = (id: string, pinned = false) => ({ id, pinned });

describe('Session > Get Many', () => {
	it('Return All pages via has_more and dedupes back-filled pinned sessions', async () => {
		const pages: Record<number, IDataObject> = {
			0: { object: 'list', data: [s('a'), s('b'), s('pin', true)], has_more: true },
			3: { object: 'list', data: [s('c'), s('d'), s('pin', true)], has_more: true },
			6: { object: 'list', data: [s('e'), s('pin', true)], has_more: false },
		};
		const { ctx, calls } = mockContext(
			{ returnAll: true, filters: { source: 'api_server' } },
			(req) => {
				const qs = req.qs as IDataObject;
				return full(pages[Number(qs.offset)]);
			},
		);
		const out = await executeSession.call(ctx, 'getAll', 0);
		const ids = out.map((o) => o.json.id);
		expect(ids).toEqual(['a', 'b', 'pin', 'c', 'd', 'e']);
		expect(calls()[0].url).toBe('http://hermes:8642/api/sessions');
		expect((calls()[0].qs as IDataObject).limit).toBe(200);
		expect((calls()[0].qs as IDataObject).source).toBe('api_server');
	});

	it('Return All dedupes by id across pages', async () => {
		let n = 0;
		const { ctx, calls } = mockContext({ returnAll: true, filters: {} }, () => {
			n++;
			if (n === 1) {
				const data = Array.from({ length: 200 }, (_, k) => s(`s${k}`));
				return full({ data: [...data, s('pin', true)], has_more: true });
			}
			return full({ data: [s('s200'), s('pin', true)], has_more: false });
		});
		const out = await executeSession.call(ctx, 'getAll', 0);
		expect(out).toHaveLength(202);
		expect(out.filter((o) => o.json.id === 'pin')).toHaveLength(1);
		expect(calls()).toHaveLength(2);
	});

	it('honours Limit when not returning all', async () => {
		const { ctx, calls } = mockContext(
			{ returnAll: false, limit: 2, filters: { title: 'X' } },
			() => full({ data: [s('a'), s('b'), s('pin', true)], has_more: true }),
		);
		const out = await executeSession.call(ctx, 'getAll', 0);
		expect(out.map((o) => o.json.id)).toEqual(['a', 'b']);
		expect(calls()).toHaveLength(1);
		expect(calls()[0].qs).toMatchObject({ limit: 2, offset: 0, title: 'X' });
	});
});

describe('Session > Get Messages', () => {
	it('Return All forces order=oldest and stops when returned < limit', async () => {
		const { ctx, calls } = mockContext(
			{ sessionId: 'sess-1', returnAll: true, messageOptions: { order: 'latest' } },
			(req) => {
				const qs = req.qs as IDataObject;
				const offset = Number(qs.offset);
				const count = offset === 0 ? 500 : 3;
				return full({
					object: 'list',
					data: Array.from({ length: count }, (_, k) => ({ id: offset + k })),
					pagination: { limit: 500, offset, order: qs.order, returned: count },
				});
			},
		);
		const out = await executeSession.call(ctx, 'getMessages', 0);
		expect(out).toHaveLength(503);
		expect(calls()).toHaveLength(2);
		for (const c of calls()) {
			expect((c.qs as IDataObject).order).toBe('oldest');
			expect((c.qs as IDataObject).limit).toBe(500);
		}
		expect((calls()[1].qs as IDataObject).offset).toBe(500);
		expect(calls()[0].url).toBe('http://hermes:8642/api/sessions/sess-1/messages');
	});

	it('single page honours limit, order and offset', async () => {
		const { ctx, calls } = mockContext(
			{
				sessionId: 'sess-1',
				returnAll: false,
				messageLimit: 10,
				messageOptions: { order: 'latest', offset: 5, includeCompacted: true },
			},
			() => full({ data: [{ id: 1 }], pagination: { returned: 1 } }),
		);
		const out = await executeSession.call(ctx, 'getMessages', 0);
		expect(out).toHaveLength(1);
		expect(calls()[0].qs).toEqual({
			limit: 10,
			offset: 5,
			order: 'latest',
			include_compacted: 'true',
		});
	});
});

describe('Session > Send Message', () => {
	it('posts to /chat with timeout, session key and model fields', async () => {
		const { ctx, calls } = mockContext(
			{
				sessionId: 'sess/1',
				message: 'Hello',
				simplify: true,
				chatOptions: {
					sessionKey: 'k',
					systemMessage: 'Be brief',
					provider: 'p',
					model: 'm',
					timeout: 1,
				},
			},
			() =>
				full(
					{
						object: 'hermes.session.chat.completion',
						status: 'completed',
						session_id: 'sess/1',
						message: { role: 'assistant', content: 'Hi!' },
						usage: { total_tokens: 3 },
						runtime: { provider: 'p', model: 'm' },
					},
					200,
					{ 'x-hermes-session-key': 'k' },
				),
		);
		const out = await executeSession.call(ctx, 'sendMessage', 0);
		const req = calls()[0];
		expect(req.method).toBe('POST');
		expect(req.url).toBe('http://hermes:8642/api/sessions/sess%2F1/chat');
		expect(req.timeout).toBe(60_000);
		expect((req.headers as IDataObject)['X-Hermes-Session-Key']).toBe('k');
		expect(req.body).toEqual({
			message: 'Hello',
			system_message: 'Be brief',
			model: 'm',
			provider: 'p',
		});
		expect(out[0].json).toMatchObject({ content: 'Hi!', status: 'completed', sessionId: 'sess/1' });
	});

	it('defaults the timeout to 5 minutes', async () => {
		const { ctx, calls } = mockContext({ sessionId: 'a', message: 'x', chatOptions: {} }, () =>
			full({ message: { content: '' } }),
		);
		await executeSession.call(ctx, 'sendMessage', 0);
		expect(calls()[0].timeout).toBe(300_000);
	});

	it('simplifySessionChat handles an empty body', () => {
		expect(simplifySessionChat({})).toMatchObject({ content: '', sessionId: null });
	});
});

describe('Session > CRUD', () => {
	it('creates a session and unwraps {session}', async () => {
		const { ctx, calls } = mockContext(
			{ createFields: { id: 'my-id', title: 'T', systemPrompt: 'SP', source: 'cli' } },
			() => full({ object: 'hermes.session', session: { id: 'my-id', title: 'T' } }, 201),
		);
		const out = await executeSession.call(ctx, 'create', 0);
		expect(calls()[0].body).toEqual({
			id: 'my-id',
			title: 'T',
			system_prompt: 'SP',
			source: 'cli',
		});
		expect(out[0].json).toEqual({ id: 'my-id', title: 'T' });
	});

	it('update maps fields to the PATCH body', async () => {
		expect(
			buildSessionUpdateBody({ title: 'New', pinned: true, unread: false, endReason: ' done ' }),
		).toEqual({ title: 'New', pinned: true, unread: false, end_reason: 'done' });
		const { ctx, calls } = mockContext({ sessionId: 's1', updateFields: { archived: true } }, () =>
			full({ session: { id: 's1', archived: true } }),
		);
		await executeSession.call(ctx, 'update', 0);
		expect(calls()[0].method).toBe('PATCH');
		expect(calls()[0].body).toEqual({ archived: true });
	});

	it('update without fields fails before calling Hermes', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ sessionId: 's1', updateFields: {} },
			() => full({}),
		);
		await expect(executeSession.call(ctx, 'update', 0)).rejects.toBeInstanceOf(NodeOperationError);
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('forks a session', async () => {
		const { ctx, calls } = mockContext({ sessionId: 's1', forkOptions: { title: 'Branch' } }, () =>
			full({ session: { id: 'api_1', parent_session_id: 's1' } }, 201),
		);
		const out = await executeSession.call(ctx, 'fork', 0);
		expect(calls()[0].url).toBe('http://hermes:8642/api/sessions/s1/fork');
		expect(calls()[0].body).toEqual({ title: 'Branch' });
		expect(out[0].json.parent_session_id).toBe('s1');
	});

	it('set model requires model or provider', async () => {
		const { ctx } = mockContext({ sessionId: 's1', model: '', provider: '' }, () => full({}));
		await expect(executeSession.call(ctx, 'setModel', 0)).rejects.toBeInstanceOf(
			NodeOperationError,
		);
	});

	it('set model posts to /model', async () => {
		const { ctx, calls } = mockContext(
			{ sessionId: 's1', model: 'm', provider: '', modelLockOptions: {} },
			() => full({ object: 'hermes.session.model_lock', session_id: 's1' }),
		);
		await executeSession.call(ctx, 'setModel', 0);
		expect(calls()[0].url).toBe('http://hermes:8642/api/sessions/s1/model');
		expect(calls()[0].body).toEqual({ model: 'm' });
	});

	it('deletes a session', async () => {
		const { ctx, calls } = mockContext({ sessionId: 's1' }, () =>
			full({ object: 'hermes.session.deleted', id: 's1', deleted: true }),
		);
		const out = await executeSession.call(ctx, 'delete', 0);
		expect(calls()[0].method).toBe('DELETE');
		expect(out[0].json.deleted).toBe(true);
	});
});
