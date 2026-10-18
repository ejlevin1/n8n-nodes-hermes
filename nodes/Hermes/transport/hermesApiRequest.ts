import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export type HermesCredentialType = 'hermesApi' | 'hermesWebhookApi';

export interface HermesRequestOptions {
	body?: IDataObject | string;
	qs?: IDataObject;
	headers?: IDataObject;
	/** Request timeout in milliseconds. */
	timeout?: number;
	/** Return `{ body, headers, statusCode, statusMessage }` instead of only the body. */
	returnFullResponse?: boolean;
	/** Defaults to `hermesApi`. */
	credentialType?: HermesCredentialType;
	/** When true, non-2xx responses are returned instead of thrown. */
	ignoreHttpStatusErrors?: boolean;
}

export interface HermesFullResponse {
	body: unknown;
	headers: Record<string, unknown>;
	statusCode: number;
	statusMessage?: string;
}

export interface NormalizedHermesError {
	/** Friendly message for the n8n error banner. */
	message: string;
	/** Longer explanation, including the raw server message where useful. */
	description?: string;
	httpCode: string;
	/** Hermes error `code` (or `type` when no code is given). */
	code?: string;
	/** The raw server-side error message. */
	serverMessage?: string;
	/** Value of the Retry-After header, when present. */
	retryAfter?: string;
}

/** Join a credential Base URL and an API path: strips trailing slashes from the base. */
export function joinUrl(baseUrl: string, path: string): string {
	const base = String(baseUrl ?? '')
		.trim()
		.replace(/\/+$/, '');
	if (!path) return base;
	return base + (path.startsWith('/') ? path : `/${path}`);
}

function headerValue(
	headers: Record<string, unknown> | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === wanted) {
			if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
			return value === undefined || value === null ? undefined : String(value);
		}
	}
	return undefined;
}

function parseMaybeJson(body: unknown): unknown {
	if (typeof body !== 'string') return body;
	const trimmed = body.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return body;
	try {
		return JSON.parse(trimmed);
	} catch {
		return body;
	}
}

/**
 * Normalise both Hermes error shapes — `{error: {message, type, code}}` and `{error: "..."}` —
 * (plus plain-text bodies) into a friendly message.
 */
export function normalizeHermesError(
	statusCode: number,
	body: unknown,
	headers?: Record<string, unknown>,
): NormalizedHermesError {
	const parsed = parseMaybeJson(body);
	let serverMessage: string | undefined;
	let code: string | undefined;
	let type: string | undefined;

	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const obj = parsed as IDataObject;
		const err = obj.error;
		if (typeof err === 'string') {
			serverMessage = err;
		} else if (err && typeof err === 'object' && !Array.isArray(err)) {
			const errObj = err as IDataObject;
			if (errObj.message !== undefined && errObj.message !== null) {
				serverMessage = String(errObj.message);
			}
			if (typeof errObj.code === 'string' && errObj.code) code = errObj.code;
			if (typeof errObj.type === 'string' && errObj.type) type = errObj.type;
		}
		if (serverMessage === undefined && typeof obj.message === 'string') serverMessage = obj.message;
		if (serverMessage === undefined && typeof obj.detail === 'string') serverMessage = obj.detail;
		if (code === undefined && typeof obj.code === 'string' && obj.code) code = obj.code;
	} else if (typeof parsed === 'string' && parsed.trim()) {
		serverMessage = parsed.trim();
	}

	const retryAfter = headerValue(headers, 'retry-after');
	const effectiveCode = code ?? type;
	const retryHint = retryAfter ? ` Retry after ${retryAfter} second(s).` : '';
	let message: string;

	switch (true) {
		case statusCode === 401 && (code === 'gateway_auth_failed' || type === 'gateway_auth_error'):
			message = 'Hermes rejected the API key. Check that the credential matches API_SERVER_KEY.';
			break;
		case statusCode === 401:
			message = 'Hermes rejected the request as unauthorized. Check the credential.';
			break;
		case statusCode === 409 && code === 'permission_denied':
			message =
				'This session is owned by another surface (for example a chat platform) and cannot be changed through the API.';
			break;
		case statusCode === 409 && code === 'admission_conflict':
			message = 'Hermes is already processing a conflicting request for this session or run.';
			break;
		case statusCode === 409 && code === 'idempotency_key_conflict':
			message =
				'This Idempotency Key was already used with a different request body. Use a new key or send the original request.';
			break;
		case statusCode === 429:
			message = `Hermes rate limit reached.${retryHint}`;
			break;
		case statusCode === 503 && code === 'gateway_draining':
			message = `The Hermes gateway is draining (shutting down or restarting).${retryHint}`;
			break;
		case statusCode === 503:
			message = `Hermes is temporarily unavailable.${retryHint}`;
			break;
		default:
			message = serverMessage
				? `Hermes error ${statusCode}: ${serverMessage}`
				: `Hermes returned HTTP ${statusCode}`;
	}

	const descriptionParts: string[] = [];
	if (serverMessage && !message.includes(serverMessage)) descriptionParts.push(serverMessage);
	if (effectiveCode) descriptionParts.push(`Code: ${effectiveCode}`);
	if (retryAfter && !message.includes('Retry after'))
		descriptionParts.push(`Retry-After: ${retryAfter}`);

	return {
		message,
		description: descriptionParts.length ? descriptionParts.join(' | ') : undefined,
		httpCode: String(statusCode),
		code: effectiveCode,
		serverMessage,
		retryAfter,
	};
}

/** Build a NodeApiError from a non-2xx Hermes response. */
export function createHermesApiError(
	node: INode,
	statusCode: number,
	body: unknown,
	headers?: Record<string, unknown>,
	itemIndex?: number,
): NodeApiError {
	const normalized = normalizeHermesError(statusCode, body, headers);
	const parsed = parseMaybeJson(body);
	const errorResponse: JsonObject = {
		statusCode,
		code: normalized.code ?? null,
		message: normalized.serverMessage ?? normalized.message,
		body: (parsed && typeof parsed === 'object' ? parsed : String(parsed ?? '')) as JsonObject,
	};
	return new NodeApiError(node, errorResponse, {
		message: normalized.message,
		description: normalized.description,
		httpCode: normalized.httpCode,
		itemIndex,
	});
}

/**
 * Make an authenticated request to Hermes. `path` is appended to the credential Base URL.
 */
export async function hermesApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	opts: HermesRequestOptions = {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
	const credentialType: HermesCredentialType = opts.credentialType ?? 'hermesApi';
	const credentials = await this.getCredentials(credentialType);
	const url = joinUrl(String(credentials.baseUrl ?? ''), path);

	const requestOptions: IHttpRequestOptions = {
		method,
		url,
		headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (opts.qs && Object.keys(opts.qs).length) requestOptions.qs = opts.qs;
	if (opts.timeout !== undefined && opts.timeout > 0) requestOptions.timeout = opts.timeout;
	if (opts.body !== undefined) {
		requestOptions.body = opts.body;
		if (typeof opts.body === 'string') {
			requestOptions.headers = { 'Content-Type': 'application/json', ...requestOptions.headers };
		} else {
			requestOptions.json = true;
		}
	} else {
		requestOptions.json = true;
	}

	let response: HermesFullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			credentialType,
			requestOptions,
		)) as HermesFullResponse;
	} catch (error) {
		// NodeApiError re-wraps to the original instance; anything else is a network-level failure.
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			message: `Could not reach Hermes at ${url}`,
		});
	}

	const statusCode = Number(response?.statusCode ?? 0);
	const headers = (response?.headers ?? {}) as Record<string, unknown>;
	const body = parseMaybeJson(response?.body);

	if ((statusCode < 200 || statusCode >= 300) && !opts.ignoreHttpStatusErrors) {
		throw createHermesApiError(this.getNode(), statusCode, body, headers);
	}

	if (opts.returnFullResponse) {
		return { ...response, body, headers, statusCode } as HermesFullResponse;
	}
	return body;
}
