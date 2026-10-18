import { describe, expect, it, vi } from 'vitest';
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import {
	executeWebhookRoute,
	webhookRouteDescription,
} from '../nodes/Hermes/resources/webhookRoute';
import {
	buildEventBody,
	buildRoutePath,
	normalizeWebhookResponse,
	validateRouteName,
} from '../nodes/Hermes/resources/webhookRoute/sendEvent';
import { buildIdempotencyKey } from '../nodes/Hermes/helpers/idempotency';

const node = {
	id: 'node-1',
	name: 'Hermes 1',
	type: 'n8n-nodes-hermes.hermes',
	typeVersion: 1,
	position: [0, 0] as [number, number],
	parameters: {},
};

interface FakeResponse {
	statusCode: number;
	body: unknown;
	headers?: Record<string, unknown>;
}

function mockContext(params: IDataObject, response: FakeResponse) {
	const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ headers: {}, ...response });
	const getCredentials = vi
		.fn()
		.mockResolvedValue({ baseUrl: 'http://localhost:8644/', secret: 's3cret' });
	const ctx = {
		getCredentials,
		getNode: () => node,
		getExecutionId: () => 'exec-1',
		getWorkflowDataProxy: () => ({ $runIndex: 0 }),
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
	return { ctx, httpRequestWithAuthentication, getCredentials };
}

const baseParams: IDataObject = {
	route: 'n8n-test',
	eventType: 'order.created',
	jsonBody: '{"id":42,"type":"something-else"}',
	options: {},
};

function sentRequest(mock: ReturnType<typeof vi.fn>): IHttpRequestOptions {
	return mock.mock.calls[0][1] as IHttpRequestOptions;
}

describe('webhookRoute description', () => {
	it('has the Send Event operation scoped to the webhookRoute resource', () => {
		const op = webhookRouteDescription.find((p) => p.name === 'operation');
		expect(op?.displayOptions?.show?.resource).toEqual(['webhookRoute']);
		expect(op?.default).toBe('sendEvent');
		for (const p of webhookRouteDescription) {
			expect(p.displayOptions?.show?.resource).toEqual(['webhookRoute']);
		}
	});

	it('says replies do not come back and points to the trigger with post_llm_call', () => {
		const notice = webhookRouteDescription.find((p) => p.type === 'notice');
		expect(notice?.displayName).toMatch(/does not come back over HTTP/);
		expect(notice?.displayName).toMatch(/Hermes Trigger/);
		expect(notice?.displayName).toMatch(/post_llm_call/);
	});

	it('defaults JSON Body to the incoming item', () => {
		const jsonBody = webhookRouteDescription.find((p) => p.name === 'jsonBody');
		expect(String(jsonBody?.default)).toContain('$json');
	});
});

describe('validateRouteName', () => {
	it('accepts CLI-style and config.yaml-style names', () => {
		expect(validateRouteName(' n8n-test ')).toEqual({ route: 'n8n-test' });
		expect(validateRouteName('github_pr')).toEqual({ route: 'github_pr' });
		expect(validateRouteName('team:alerts').error).toBeUndefined();
	});

	it('rejects empty names, slashes, spaces, ? and #', () => {
		expect(validateRouteName('').error).toBeDefined();
		expect(validateRouteName('a/b').error).toBeDefined();
		expect(validateRouteName('a b').error).toBeDefined();
		expect(validateRouteName('a?b').error).toBeDefined();
		expect(validateRouteName('a#b').error).toBeDefined();
		expect(validateRouteName('..').error).toBeDefined();
	});

	it('URL-encodes the path segment', () => {
		expect(buildRoutePath('n8n-test')).toBe('/webhooks/n8n-test');
		expect(buildRoutePath('team:alerts')).toBe('/webhooks/team%3Aalerts');
	});
});

describe('buildEventBody', () => {
	it('parses a JSON string and forces event_type', () => {
		expect(buildEventBody('{"a":1,"event_type":"x","type":"y"}', 'order.created')).toEqual({
			body: { a: 1, event_type: 'order.created', type: 'y' },
		});
	});

	it('accepts an object and an empty body', () => {
		expect(buildEventBody({ a: 1 }, 'e').body).toEqual({ a: 1, event_type: 'e' });
		expect(buildEventBody('', 'e').body).toEqual({ event_type: 'e' });
	});

	it('rejects invalid JSON, arrays and primitives', () => {
		expect(buildEventBody('{nope', 'e').error).toMatch(/valid JSON/);
		expect(buildEventBody('[1,2]', 'e').error).toMatch(/JSON object/);
		expect(buildEventBody('5', 'e').error).toMatch(/JSON object/);
	});
});

describe('normalizeWebhookResponse', () => {
	const sent = { route: 'r', eventType: 'e', requestId: 'req-1' };

	it.each([
		[202, { status: 'accepted', route: 'r', event: 'e', delivery_id: 'd1' }, 'accepted', null],
		[202, { status: 'coalesced', route: 'r', event: 'e', delivery_id: 'd1' }, 'coalesced', null],
		[200, { status: 'duplicate', delivery_id: 'd1' }, 'duplicate', null],
		[200, { status: 'ignored', reason: 'filter', route: 'r' }, 'ignored', 'filter'],
		[200, { status: 'ignored', reason: 'script', route: 'r' }, 'ignored', 'script'],
		[200, { status: 'ignored', event: 'e' }, 'ignored', 'event_not_allowed'],
		[
			200,
			{ status: 'delivered', route: 'r', target: 'telegram', delivery_id: 'd1' },
			'delivered',
			null,
		],
		[
			502,
			{ status: 'error', error: 'Delivery failed', delivery_id: 'd1' },
			'error',
			'Delivery failed',
		],
	])('normalises %i %j', (code, body, status, reason) => {
		const result = normalizeWebhookResponse(code, body, sent);
		expect(result).toMatchObject({ status, httpStatus: code, route: 'r', event: 'e', reason });
		expect(result?.deliveryId).toBe((body as IDataObject).delivery_id ? 'd1' : 'req-1');
	});

	it.each([
		[503, { error: 'Admission unavailable; retry this delivery' }],
		[429, { error: 'Rate limit exceeded' }],
		[401, { error: 'Invalid signature' }],
		[404, { error: 'Unknown route: r' }],
		[502, '<html>Bad Gateway</html>'],
	])('returns undefined for error %i', (code, body) => {
		expect(normalizeWebhookResponse(code, body, sent)).toBeUndefined();
	});
});

describe('executeWebhookRoute sendEvent', () => {
	it('POSTs a pre-serialised body with event_type and X-Request-ID using the webhook credential', async () => {
		const { ctx, httpRequestWithAuthentication, getCredentials } = mockContext(baseParams, {
			statusCode: 202,
			body: { status: 'accepted', route: 'n8n-test', event: 'order.created', delivery_id: 'x' },
		});
		const out = await executeWebhookRoute.call(ctx, 'sendEvent', 0);

		expect(getCredentials).toHaveBeenCalledWith('hermesWebhookApi');
		expect(httpRequestWithAuthentication.mock.calls[0][0]).toBe('hermesWebhookApi');
		const req = sentRequest(httpRequestWithAuthentication);
		expect(req.method).toBe('POST');
		expect(req.url).toBe('http://localhost:8644/webhooks/n8n-test');
		expect(typeof req.body).toBe('string');
		expect(JSON.parse(req.body as string)).toEqual({
			id: 42,
			type: 'something-else',
			event_type: 'order.created',
		});
		const headers = req.headers as IDataObject;
		expect(headers['Content-Type']).toBe('application/json');
		expect(headers['X-Request-ID']).toBe(buildIdempotencyKey('exec-1', 'node-1', 0, 0));

		expect(out).toEqual([
			{
				json: {
					status: 'accepted',
					httpStatus: 202,
					route: 'n8n-test',
					event: 'order.created',
					deliveryId: 'x',
					reason: null,
				},
			},
		]);
	});

	it('uses an explicit Request ID', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ ...baseParams, options: { requestId: ' order-42 ' } },
			{ statusCode: 200, body: { status: 'duplicate', delivery_id: 'order-42' } },
		);
		const out = await executeWebhookRoute.call(ctx, 'sendEvent', 0);
		expect(
			(sentRequest(httpRequestWithAuthentication).headers as IDataObject)['X-Request-ID'],
		).toBe('order-42');
		expect(out[0].json).toMatchObject({ status: 'duplicate', deliveryId: 'order-42' });
	});

	it('rejects an invalid Request ID', async () => {
		const { ctx } = mockContext(
			{ ...baseParams, options: { requestId: 'has space' } },
			{ statusCode: 202, body: {} },
		);
		await expect(executeWebhookRoute.call(ctx, 'sendEvent', 0)).rejects.toThrow(NodeOperationError);
	});

	it('rejects a bad route, an empty event type and an array body before sending', async () => {
		for (const params of [
			{ ...baseParams, route: 'a/b' },
			{ ...baseParams, eventType: '  ' },
			{ ...baseParams, jsonBody: '[]' },
		]) {
			const { ctx, httpRequestWithAuthentication } = mockContext(params, {
				statusCode: 202,
				body: {},
			});
			await expect(executeWebhookRoute.call(ctx, 'sendEvent', 0)).rejects.toThrow(
				NodeOperationError,
			);
			expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
		}
	});

	it('returns a deliver_only failure (502) as output', async () => {
		const { ctx } = mockContext(baseParams, {
			statusCode: 502,
			body: { status: 'error', error: 'Delivery failed', delivery_id: 'd' },
		});
		const out = await executeWebhookRoute.call(ctx, 'sendEvent', 0);
		expect(out[0].json).toMatchObject({
			status: 'error',
			httpStatus: 502,
			reason: 'Delivery failed',
		});
	});

	it.each([
		[503, { error: 'Admission unavailable; retry this delivery' }, {}, /retry this delivery/],
		[503, { error: 'Profile x is not being served' }, { 'retry-after': '30' }, /Retry after 30/],
		[429, { error: 'Rate limit exceeded' }, {}, /Rate limit exceeded for webhook route "n8n-test"/],
		[401, { error: 'Invalid signature' }, {}, /rejected the signature/],
		[404, { error: 'Unknown route: n8n-test' }, {}, /no webhook route named "n8n-test"/],
		[403, { error: 'Route disabled: n8n-test' }, {}, /disabled/],
		[413, { error: 'Payload too large' }, {}, /size limit/],
		[400, { error: 'Cannot parse body' }, {}, /could not parse/],
	])('throws a friendly NodeApiError for %i', async (statusCode, body, headers, message) => {
		const { ctx } = mockContext(baseParams, { statusCode, body, headers });
		const error = await executeWebhookRoute.call(ctx, 'sendEvent', 0).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect((error as NodeApiError).message).toMatch(message);
		expect((error as NodeApiError).httpCode).toBe(String(statusCode));
	});

	it('throws on an unknown operation', async () => {
		const { ctx } = mockContext(baseParams, { statusCode: 202, body: {} });
		await expect(executeWebhookRoute.call(ctx, 'nope', 0)).rejects.toThrow(NodeOperationError);
	});
});
