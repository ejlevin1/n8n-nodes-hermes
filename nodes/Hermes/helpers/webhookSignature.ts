import { createHmac } from 'crypto';
import type { ICredentialDataDecryptedObject, IHttpRequestOptions } from 'n8n-workflow';

/** Header carrying the integer-seconds Unix timestamp bound into the V2 signature. */
export const WEBHOOK_TIMESTAMP_HEADER = 'X-Webhook-Timestamp';

/** Header carrying the Hermes generic HMAC V2 signature. */
export const WEBHOOK_SIGNATURE_V2_HEADER = 'X-Webhook-Signature-V2';

/** Current Unix time in whole seconds, as the string Hermes expects (±300 s replay window). */
export function currentTimestampSeconds(nowMs: number = Date.now()): string {
	return Math.floor(nowMs / 1000).toString();
}

/**
 * Hermes generic HMAC V2 signature: lowercase hex HMAC-SHA256 of `"<timestamp>.<body>"`
 * keyed with the route secret (see `gateway/platforms/webhook.py` in hermes-agent).
 */
export function computeWebhookSignatureV2(secret: string, timestamp: string, body: string): string {
	return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

/**
 * Build the two signing headers for a pre-serialised request body.
 */
export function buildWebhookSignatureHeaders(
	secret: string,
	body: string,
	nowMs: number = Date.now(),
): Record<string, string> {
	const timestamp = currentTimestampSeconds(nowMs);
	return {
		[WEBHOOK_TIMESTAMP_HEADER]: timestamp,
		[WEBHOOK_SIGNATURE_V2_HEADER]: computeWebhookSignatureV2(secret, timestamp, body),
	};
}

/**
 * Signs a request for the Hermes webhook adapter using generic HMAC V2.
 * Only string bodies are signed (the node pre-serialises JSON so the exact bytes are signed);
 * requests without a string body (e.g. the health check) pass through unchanged.
 */
export async function signHermesWebhookRequest(
	credentials: ICredentialDataDecryptedObject,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const body = requestOptions.body;
	if (typeof body !== 'string') {
		return requestOptions;
	}
	const secret = String(credentials.secret ?? '');
	return {
		...requestOptions,
		headers: {
			...(requestOptions.headers ?? {}),
			...buildWebhookSignatureHeaders(secret, body),
		},
	};
}
