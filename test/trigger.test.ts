import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	IDataObject,
	IWebhookFunctions,
} from 'n8n-workflow';
import { HermesTrigger } from '../nodes/HermesTrigger/HermesTrigger.node';
import {
	buildOutboundYaml,
	getFilterRejection,
	normalizeEvent,
} from '../nodes/HermesTrigger/events';
import { computeSignature, isStale, verifySignature } from '../nodes/HermesTrigger/verifySignature';

const SECRET = 'a-very-long-signing-secret-of-32-chars!';
const NOW = Date.parse('2026-10-17T12:00:00.000Z');

function sign(body: string, secret = SECRET): string {
	return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function event(overrides: IDataObject = {}): IDataObject {
	return {
		hook_event_name: 'post_llm_call',
		profile: 'default',
		tool_name: null,
		tool_input: null,
		session_id: 'sess-1',
		cwd: '/home/hermes',
		extra: { platform: 'cron', session_key: 'agent:main:cron:1', assistant_response: 'done' },
		delivery_id: 'd-1',
		timestamp: '2026-10-17T11:59:30.123456Z',
		...overrides,
	};
}

interface CallOptions {
	body?: string;
	signature?: string | null;
	params?: IDataObject;
	secret?: string;
}

async function callWebhook(opts: CallOptions = {}) {
	const body = opts.body ?? JSON.stringify(event());
	const headers: IDataObject = {
		'content-type': 'application/json',
		'x-hermes-event': 'post_llm_call',
		'x-hermes-delivery': 'd-1',
	};
	const signature = opts.signature === undefined ? sign(body) : opts.signature;
	if (signature !== null) headers['x-hermes-signature-256'] = signature;

	const end = vi.fn();
	const status = vi.fn(() => ({ end }));
	const params: IDataObject = {
		events: ['post_llm_call'],
		filters: {},
		options: {},
		...opts.params,
	};

	const ctx = {
		getRequestObject: () => ({ rawBody: Buffer.from(body, 'utf8'), body: {} }),
		getHeaderData: () => headers,
		getBodyData: () => ({}),
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getCredentials: vi.fn().mockResolvedValue({ secret: opts.secret ?? SECRET, baseUrl: '' }),
		getResponseObject: () => ({ status }),
		getNode: () => ({
			id: 't',
			name: 'Hermes Trigger',
			type: 'x',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
	} as unknown as IWebhookFunctions;

	const result = await new HermesTrigger().webhook.call(ctx);
	return { result, status, end };
}

describe('HermesTrigger.webhook', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('accepts a validly signed event and emits the normalised item', async () => {
		const { result, status } = await callWebhook();
		expect(status).not.toHaveBeenCalled();
		expect(result.workflowData).toHaveLength(1);
		expect(result.workflowData?.[0][0].json).toEqual({
			event: 'post_llm_call',
			profile: 'default',
			platform: 'cron',
			board: null,
			sessionId: 'sess-1',
			toolName: null,
			toolInput: null,
			cwd: '/home/hermes',
			extra: { platform: 'cron', session_key: 'agent:main:cron:1', assistant_response: 'done' },
			deliveryId: 'd-1',
			timestamp: '2026-10-17T11:59:30.123456Z',
		});
	});

	it('rejects a tampered body with 401', async () => {
		const original = JSON.stringify(event());
		const tampered = original.replace('done', 'DONE');
		const { result, status, end } = await callWebhook({
			body: tampered,
			signature: sign(original),
		});
		expect(status).toHaveBeenCalledWith(401);
		expect(end).toHaveBeenCalled();
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('rejects a signature of the wrong length with 401 (no timingSafeEqual throw)', async () => {
		const body = JSON.stringify(event());
		const { result, status } = await callWebhook({ body, signature: sign(body).slice(0, -2) });
		expect(status).toHaveBeenCalledWith(401);
		expect(result.noWebhookResponse).toBe(true);
	});

	it('rejects a missing signature and a wrong secret with 401', async () => {
		expect((await callWebhook({ signature: null })).status).toHaveBeenCalledWith(401);
		const body = JSON.stringify(event());
		expect(
			(await callWebhook({ body, signature: sign(body, 'other-secret') })).status,
		).toHaveBeenCalledWith(401);
	});

	it('accepts an unsigned event when Verify Signature is off', async () => {
		const { result } = await callWebhook({
			signature: null,
			params: { options: { verifySignature: false } },
		});
		expect(result.workflowData).toHaveLength(1);
	});

	it('rejects a stale ISO timestamp with 401', async () => {
		const body = JSON.stringify(event({ timestamp: '2026-10-17T11:50:00.000000Z' }));
		const { status, result } = await callWebhook({ body });
		expect(status).toHaveBeenCalledWith(401);
		expect(result.workflowData).toBeUndefined();
	});

	it('accepts a stale timestamp when Reject Stale Events is off, and honours Max Event Age', async () => {
		const body = JSON.stringify(event({ timestamp: '2026-10-17T11:50:00Z' }));
		expect(
			(await callWebhook({ body, params: { options: { rejectStaleEvents: false } } })).result
				.workflowData,
		).toHaveLength(1);
		expect(
			(await callWebhook({ body, params: { options: { maxEventAge: 900 } } })).result.workflowData,
		).toHaveLength(1);
	});

	it('returns 400 for a validly signed non-JSON body', async () => {
		const { status } = await callWebhook({ body: 'not json' });
		expect(status).toHaveBeenCalledWith(400);
	});

	it('acknowledges filtered events without workflowData (event not selected)', async () => {
		const { result, status } = await callWebhook({ params: { events: ['on_session_end'] } });
		expect(status).not.toHaveBeenCalled();
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatchObject({ received: true, ignored: true });
	});

	it('applies the extra.platform filter (case-insensitive, comma list)', async () => {
		const pass = await callWebhook({ params: { filters: { platforms: 'webhook, CRON' } } });
		expect(pass.result.workflowData).toHaveLength(1);
		const drop = await callWebhook({ params: { filters: { platforms: 'webhook,api_server' } } });
		expect(drop.result.workflowData).toBeUndefined();
		expect(drop.result.webhookResponse).toMatchObject({ ignored: true });
	});

	it('applies the session filter against session_id and extra.session_key', async () => {
		expect(
			(await callWebhook({ params: { filters: { sessionId: 'sess-1' } } })).result.workflowData,
		).toHaveLength(1);
		expect(
			(await callWebhook({ params: { filters: { sessionId: 'agent:main:cron:1' } } })).result
				.workflowData,
		).toHaveLength(1);
		expect(
			(await callWebhook({ params: { filters: { sessionId: 'other' } } })).result.workflowData,
		).toBeUndefined();
	});

	it('applies the tool name regex filter', async () => {
		const body = JSON.stringify(
			event({
				hook_event_name: 'post_tool_call',
				tool_name: 'terminal',
				tool_input: { command: 'ls' },
			}),
		);
		const params = { events: ['post_tool_call'] };
		const pass = await callWebhook({ body, params: { ...params, filters: { toolName: '^term' } } });
		expect(pass.result.workflowData?.[0][0].json).toMatchObject({
			toolName: 'terminal',
			toolInput: { command: 'ls' },
		});
		const drop = await callWebhook({
			body,
			params: { ...params, filters: { toolName: 'delegate_task' } },
		});
		expect(drop.result.workflowData).toBeUndefined();
	});

	it('throws when the credential has no secret and verification is on', async () => {
		await expect(callWebhook({ secret: '' })).rejects.toThrow(/Signing Secret/);
	});
});

describe('verifySignature helpers', () => {
	it('computes GitHub-style sha256= signatures', () => {
		expect(computeSignature('s', '{}')).toBe(sign('{}', 's'));
		expect(verifySignature('s', Buffer.from('{}'), sign('{}', 's'))).toBe(true);
		expect(verifySignature('s', '{}', [sign('{}', 's')])).toBe(true);
		expect(verifySignature('', '{}', sign('{}', ''))).toBe(false);
		expect(verifySignature('s', '{}', undefined)).toBe(false);
	});

	it('isStale handles microsecond ISO timestamps, future skew and garbage', () => {
		expect(isStale('2026-10-17T11:59:00.123456Z', NOW)).toBe(false);
		expect(isStale('2026-10-17T11:54:59Z', NOW)).toBe(true);
		expect(isStale('2026-10-17T12:06:00Z', NOW)).toBe(true);
		expect(isStale('nope', NOW)).toBe(true);
		expect(isStale(undefined, NOW)).toBe(true);
	});
});

describe('events helpers', () => {
	it('falls back to the X-Hermes-Event header for the event name', () => {
		const payload = event({ hook_event_name: undefined });
		expect(
			getFilterRejection(
				payload,
				{ 'X-Hermes-Event': 'post_llm_call' },
				{ events: ['post_llm_call'] },
			),
		).toBeNull();
		expect(getFilterRejection(payload, {}, { events: ['post_llm_call'] })).toBe(
			'missing event name',
		);
	});

	it('normalizeEvent uses parent_session_id when no session_id', () => {
		const out = normalizeEvent(event({ session_id: null, extra: { parent_session_id: 'parent' } }));
		expect(out.sessionId).toBe('parent');
		expect(out.platform).toBeNull();
	});

	it('buildOutboundYaml lists only the selected events and uses secret_env', () => {
		const yaml = buildOutboundYaml(
			'https://n8n/webhook/x/hermes',
			['post_llm_call', 'post_tool_call', 'bad event'],
			{
				matcher: 'terminal',
			},
		);
		expect(yaml).toBe(
			[
				'hooks:',
				'  outbound:',
				'    - name: n8n',
				'      url: "https://n8n/webhook/x/hermes"',
				'      events: [post_llm_call, post_tool_call]',
				'      secret_env: HERMES_N8N_WEBHOOK_SECRET',
				'      timeout: 10',
				'      matcher: "terminal"',
			].join('\n'),
		);
	});
});

describe('HermesTrigger credentialTest', () => {
	const test = new HermesTrigger().methods.credentialTest.hermesOutboundWebhookApiTest;

	function run(data: IDataObject, request = vi.fn().mockResolvedValue({ status: 'ok' })) {
		const ctx = { helpers: { request } } as unknown as ICredentialTestFunctions;
		const cred = {
			id: '1',
			name: 'c',
			type: 'hermesOutboundWebhookApi',
			data,
		} as ICredentialsDecrypted;
		return { promise: test.call(ctx, cred), request };
	}

	it('fails on an empty secret', async () => {
		expect(await run({ secret: '' }).promise).toMatchObject({ status: 'Error' });
	});

	it('passes without a Base URL and warns about short secrets', async () => {
		const { promise, request } = run({ secret: 'short', baseUrl: '' });
		const res = await promise;
		expect(res.status).toBe('OK');
		expect(res.message).toMatch(/shorter than 32/);
		expect(request).not.toHaveBeenCalled();
	});

	it('pings {baseUrl}/health when a Base URL is set', async () => {
		const { promise, request } = run({ secret: SECRET, baseUrl: 'http://hermes:8642/' });
		const res = await promise;
		expect(res.status).toBe('OK');
		expect(res.message).not.toMatch(/shorter/);
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ method: 'GET', uri: 'http://hermes:8642/health' }),
		);
	});

	it('reports an unreachable Base URL', async () => {
		const { promise } = run(
			{ secret: SECRET, baseUrl: 'http://down' },
			vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
		);
		const res = await promise;
		expect(res.status).toBe('Error');
		expect(res.message).toContain('ECONNREFUSED');
	});
});
