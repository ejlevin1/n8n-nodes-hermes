import { createHmac, timingSafeEqual } from 'crypto';

/** Default tolerance for the signed `timestamp` field (5 minutes). */
export const DEFAULT_MAX_EVENT_AGE_MS = 5 * 60 * 1000;

/**
 * Compute the GitHub-style signature Hermes sends in `X-Hermes-Signature-256`:
 * `'sha256=' + hex(HMAC_SHA256(secret, rawBody))`, computed over the exact raw body bytes.
 */
export function computeSignature(secret: string, rawBody: Buffer | string): string {
	return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time comparison of the received `X-Hermes-Signature-256` header against the expected
 * signature. Returns false for an empty secret, a missing header, or a length mismatch (checked
 * before `timingSafeEqual`, which throws on unequal lengths).
 */
export function verifySignature(
	secret: string,
	rawBody: Buffer | string,
	header: string | string[] | undefined,
): boolean {
	if (!secret) return false;
	const received = Array.isArray(header) ? header[0] : header;
	if (typeof received !== 'string' || received.length === 0) return false;

	const expected = Buffer.from(computeSignature(secret, rawBody), 'utf8');
	const actual = Buffer.from(received.trim(), 'utf8');
	if (expected.length !== actual.length) return false;
	return timingSafeEqual(expected, actual);
}

/**
 * True when the ISO-8601 `timestamp` is missing, unparseable, or further than `maxAgeMs` from
 * `nowMs` in either direction (a future timestamp beyond the window is treated as stale too, to
 * bound clock-skew abuse). Hermes emits e.g. `2026-07-22T14:00:00.123456Z`.
 */
export function isStale(
	isoTimestamp: unknown,
	nowMs: number,
	maxAgeMs: number = DEFAULT_MAX_EVENT_AGE_MS,
): boolean {
	if (typeof isoTimestamp !== 'string' || isoTimestamp.trim() === '') return true;
	const parsed = Date.parse(normalizeIsoFraction(isoTimestamp.trim()));
	if (Number.isNaN(parsed)) return true;
	return Math.abs(nowMs - parsed) > maxAgeMs;
}

/**
 * Python's `datetime.isoformat()` emits microseconds (6 fractional digits). `Date.parse` handles
 * that in V8, but trim to milliseconds so parsing doesn't depend on engine leniency.
 */
function normalizeIsoFraction(value: string): string {
	return value.replace(/(\.\d{3})\d+/, '$1');
}
