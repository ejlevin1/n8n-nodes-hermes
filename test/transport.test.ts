import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import {
	hermesApiRequest,
	joinUrl,
	normalizeHermesError,
} from '../nodes/Hermes/transport/hermesApiRequest';

const node = {
	id: 'node-1',
	name: 'Hermes',
	type: 'n8n-nodes-hermes.hermes',
	typeVersion: 1,
	position: [0, 0] as [number, number],
	parameters: {},
};

function mockContext(response: unknown, baseUrl = 'http://localhost:8642/') {
	const httpRequestWithAuthentication = vi.fn().mockResolvedValue(response);
	const ctx = {
		getCredentials: vi.fn().mockResolvedValue({ baseUrl, apiKey: 'k'.repeat(16) }),
		getNode: () => node,
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
	return { ctx, httpRequestWithAuthentication };
}

describe('joinUrl', () => {
	it('joins without a trailing slash', () => {
		expect(joinUrl('http://localhost:8642', '/v1/runs')).toBe('http://localhost:8642/v1/runs');
	});

	it('strips one or more trailing slashes', () => {
		expect(joinUrl('http://localhost:8642/', '/v1/runs')).toBe('http://localhost:8642/v1/runs');
		expect(joinUrl('http://localhost:8642///', '/v1/runs')).toBe('http://localhost:8642/v1/runs');
	});

	it('keeps a /p/<profile> prefix', () => {
		expect(joinUrl('https://hermes.example.com/p/work', '/api/sessions')).toBe(
			'https://hermes.example.com/p/work/api/sessions',
		);
		expect(joinUrl('https://hermes.example.com/p/work/', '/api/sessions')).toBe(
			'https://hermes.example.com/p/work/api/sessions',
		);
	});

	it('adds a leading slash to the path when missing', () => {
		expect(joinUrl('http://h:8642', 'health')).toBe('http://h:8642/health');
	});
});

describe('normalizeHermesError', () => {
	it('normalises the OpenAI-style {error: {message, type, code}} shape', () => {
		const n = normalizeHermesError(400, {
			error: { message: 'bad input', type: 'invalid_request_error', code: 'bad_field' },
		});
		expect(n.serverMessage).toBe('bad input');
		expect(n.code).toBe('bad_field');
		expect(n.httpCode).toBe('400');
		expect(n.message).toContain('bad input');
	});

	it('normalises the plain {error: "..."} shape', () => {
		const n = normalizeHermesError(404, { error: 'Session not found' });
		expect(n.serverMessage).toBe('Session not found');
		expect(n.message).toBe('Hermes error 404: Session not found');
	});

	it('parses a JSON string body', () => {
		const n = normalizeHermesError(404, '{"error":"Job not found"}');
		expect(n.serverMessage).toBe('Job not found');
	});

	it('falls back to the type when no code is given', () => {
		const n = normalizeHermesError(400, { error: { message: 'x', type: 'some_type' } });
		expect(n.code).toBe('some_type');
	});

	it('handles an empty body', () => {
		expect(normalizeHermesError(500, undefined).message).toBe('Hermes returned HTTP 500');
	});

	it('gives a friendly message for 401 gateway_auth_failed', () => {
		const n = normalizeHermesError(401, {
			error: {
				message: 'Invalid API key',
				type: 'invalid_request_error',
				code: 'gateway_auth_failed',
			},
		});
		expect(n.message).toMatch(/API_SERVER_KEY/);
		expect(n.description).toContain('Invalid API key');
	});

	it.each([
		['permission_denied', /owned by another surface/],
		['admission_conflict', /conflicting request/],
		['idempotency_key_conflict', /Idempotency Key was already used/],
	])('gives a friendly message for 409 %s', (code, pattern) => {
		const n = normalizeHermesError(409, { error: { message: 'conflict', code } });
		expect(n.message).toMatch(pattern);
		expect(n.code).toBe(code);
	});

	it('surfaces Retry-After on 429', () => {
		const n = normalizeHermesError(429, { error: 'Too many requests' }, { 'retry-after': '7' });
		expect(n.message).toMatch(/rate limit/i);
		expect(n.message).toContain('Retry after 7 second(s)');
		expect(n.retryAfter).toBe('7');
	});

	it('surfaces Retry-After on 503 gateway_draining (case-insensitive header)', () => {
		const n = normalizeHermesError(
			503,
			{ error: { message: 'draining', code: 'gateway_draining' } },
			{ 'Retry-After': ['30'] },
		);
		expect(n.message).toMatch(/draining/);
		expect(n.message).toContain('Retry after 30 second(s)');
	});
});

describe('hermesApiRequest', () => {
	it('builds the URL from the credential Base URL and returns the body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext({
			statusCode: 200,
			headers: {},
			body: { ok: true },
		});
		const result = await hermesApiRequest.call(ctx, 'GET', '/v1/capabilities', { qs: { a: 1 } });
		expect(result).toEqual({ ok: true });
		const [credType, opts] = httpRequestWithAuthentication.mock.calls[0];
		expect(credType).toBe('hermesApi');
		expect(opts.url).toBe('http://localhost:8642/v1/capabilities');
		expect(opts.qs).toEqual({ a: 1 });
		expect(opts.returnFullResponse).toBe(true);
		expect(opts.ignoreHttpStatusErrors).toBe(true);
		expect(opts.json).toBe(true);
	});

	it('sends string bodies verbatim with a JSON content type', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext({
			statusCode: 202,
			headers: {},
			body: '{"status":"accepted"}',
		});
		const result = await hermesApiRequest.call(ctx, 'POST', '/webhooks/r', {
			body: '{"a":1}',
			credentialType: 'hermesWebhookApi',
		});
		expect(result).toEqual({ status: 'accepted' });
		const [credType, opts] = httpRequestWithAuthentication.mock.calls[0];
		expect(credType).toBe('hermesWebhookApi');
		expect(opts.body).toBe('{"a":1}');
		expect(opts.headers['Content-Type']).toBe('application/json');
		expect(opts.json).toBeUndefined();
	});

	it('returns the full response when asked', async () => {
		const { ctx } = mockContext({
			statusCode: 200,
			headers: { 'x-hermes-session-id': 's1' },
			body: { id: 'x' },
		});
		const res = await hermesApiRequest.call(ctx, 'POST', '/v1/chat/completions', {
			body: {},
			returnFullResponse: true,
		});
		expect(res.statusCode).toBe(200);
		expect(res.headers['x-hermes-session-id']).toBe('s1');
		expect(res.body).toEqual({ id: 'x' });
	});

	it('throws a NodeApiError with a friendly message for non-2xx', async () => {
		const { ctx } = mockContext({
			statusCode: 401,
			headers: {},
			body: { error: { message: 'Invalid API key', code: 'gateway_auth_failed' } },
		});
		const err = await hermesApiRequest.call(ctx, 'GET', '/v1/models').catch((e) => e);
		expect(err).toBeInstanceOf(NodeApiError);
		expect(err.message).toMatch(/API_SERVER_KEY/);
		expect(err.httpCode).toBe('401');
	});

	it('returns the error response when ignoreHttpStatusErrors is set', async () => {
		const { ctx } = mockContext({ statusCode: 503, headers: {}, body: { status: 'unavailable' } });
		const res = await hermesApiRequest.call(ctx, 'POST', '/webhooks/r', {
			body: '{}',
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		});
		expect(res.statusCode).toBe(503);
		expect(res.body).toEqual({ status: 'unavailable' });
	});

	it('wraps network failures in a NodeApiError naming the URL', async () => {
		const ctx = {
			getCredentials: vi.fn().mockResolvedValue({ baseUrl: 'http://down:8642' }),
			getNode: () => node,
			helpers: {
				httpRequestWithAuthentication: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
			},
		} as unknown as IExecuteFunctions;
		const err = await hermesApiRequest.call(ctx, 'GET', '/health').catch((e) => e);
		expect(err).toBeInstanceOf(NodeApiError);
		expect(err.message).toContain('http://down:8642/health');
	});
});
