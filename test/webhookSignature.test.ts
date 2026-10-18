import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IHttpRequestOptions } from 'n8n-workflow';
import {
	HermesWebhookApi,
	signHermesWebhookRequest,
} from '../credentials/HermesWebhookApi.credentials';
import {
	buildWebhookSignatureHeaders,
	computeWebhookSignatureV2,
	currentTimestampSeconds,
} from '../nodes/Hermes/helpers/webhookSignature';

// Vector generated with:
// python3 -c 'import hmac,hashlib;print(hmac.new(b"n8n-test-secret",b"1700000000."+b"{\"event_type\":\"order.created\",\"id\":42}",hashlib.sha256).hexdigest())'
const SECRET = 'n8n-test-secret';
const TIMESTAMP = '1700000000';
const BODY = '{"event_type":"order.created","id":42}';
const EXPECTED_V2 = 'e88e00e6c949643b43866138900490652a5346b035aa2935e8484d42c6af816c';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('webhook signature helpers', () => {
	it('computes the V2 signature matching the Python hmac vector', () => {
		expect(computeWebhookSignatureV2(SECRET, TIMESTAMP, BODY)).toBe(EXPECTED_V2);
	});

	it('uses integer seconds for the timestamp', () => {
		expect(currentTimestampSeconds(1_700_000_000_999)).toBe('1700000000');
		expect(buildWebhookSignatureHeaders(SECRET, BODY, 1_700_000_000_500)).toEqual({
			'X-Webhook-Timestamp': TIMESTAMP,
			'X-Webhook-Signature-V2': EXPECTED_V2,
		});
	});
});

describe('HermesWebhookApi authenticate', () => {
	it('is the async signing function', () => {
		expect(new HermesWebhookApi().authenticate).toBe(signHermesWebhookRequest);
	});

	it('signs a string body with an integer-string timestamp', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_123);
		const request: IHttpRequestOptions = {
			method: 'POST',
			url: 'http://localhost:8644/webhooks/n8n-test',
			body: BODY,
			headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'abc' },
		};
		const signed = await signHermesWebhookRequest({ baseUrl: 'x', secret: SECRET }, request);
		const headers = signed.headers as Record<string, string>;
		expect(headers['X-Webhook-Timestamp']).toBe(TIMESTAMP);
		expect(headers['X-Webhook-Timestamp']).toMatch(/^\d+$/);
		expect(headers['X-Webhook-Signature-V2']).toBe(EXPECTED_V2);
		expect(headers['X-Request-ID']).toBe('abc');
		expect(headers['Content-Type']).toBe('application/json');
		expect(signed.body).toBe(BODY);
		// The original options are not mutated.
		expect(request.headers).not.toHaveProperty('X-Webhook-Signature-V2');
	});

	it('uses the current time when not mocked', async () => {
		const signed = await signHermesWebhookRequest(
			{ secret: SECRET },
			{ method: 'POST', url: 'http://h/webhooks/r', body: BODY },
		);
		const ts = (signed.headers as Record<string, string>)['X-Webhook-Timestamp'];
		expect(ts).toMatch(/^\d+$/);
		expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(5);
	});

	it('passes a GET without a body through unchanged', async () => {
		const request: IHttpRequestOptions = { method: 'GET', url: 'http://localhost:8644/health' };
		const signed = await signHermesWebhookRequest({ secret: SECRET }, request);
		expect(signed).toBe(request);
		expect(signed.headers).toBeUndefined();
	});

	it('does not sign a non-string (object) body', async () => {
		const request: IHttpRequestOptions = {
			method: 'POST',
			url: 'http://h/webhooks/r',
			body: { a: 1 },
		};
		expect(await signHermesWebhookRequest({ secret: SECRET }, request)).toBe(request);
	});
});
