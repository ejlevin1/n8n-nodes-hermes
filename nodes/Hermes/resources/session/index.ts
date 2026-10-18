import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { hermesApiRequest, type HermesFullResponse } from '../../transport/hermesApiRequest';
import { buildModelFields, timeoutMinutesToMs } from '../../helpers/modelOptions';
import { paginateMessages, paginateSessions } from '../../helpers/pagination';
import { sessionFields, sessionOperations } from './description';

export const sessionDescription: INodeProperties[] = [sessionOperations, ...sessionFields];

/** Hermes limits. */
export const SESSION_PAGE_MAX = 200;
export const MESSAGE_PAGE_MAX = 500;

function toItems(list: IDataObject[]): INodeExecutionData[] {
	return list.map((json) => ({ json }));
}

function sessionPath(id: string, suffix = ''): string {
	return `/api/sessions/${encodeURIComponent(id)}${suffix}`;
}

function getSessionId(this: IExecuteFunctions, i: number): string {
	const id = String(this.getNodeParameter('sessionId', i, '') ?? '').trim();
	if (!id) {
		throw new NodeOperationError(this.getNode(), 'Session ID must not be empty', { itemIndex: i });
	}
	return id;
}

/** `{session: {...}}` → the session object. */
function unwrapSession(body: unknown): IDataObject {
	const obj = (body ?? {}) as IDataObject;
	return (obj.session && typeof obj.session === 'object' ? obj.session : obj) as IDataObject;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(n, min), max);
}

/** Map the Update Fields collection to the PATCH body. Exported for tests. */
export function buildSessionUpdateBody(fields: IDataObject): IDataObject {
	const body: IDataObject = {};
	if (fields.title !== undefined) body.title = String(fields.title);
	if (typeof fields.endReason === 'string' && fields.endReason.trim()) {
		body.end_reason = fields.endReason.trim();
	}
	for (const flag of ['pinned', 'archived', 'hidden', 'unread'] as const) {
		if (fields[flag] !== undefined) body[flag] = fields[flag] === true;
	}
	return body;
}

/** Simplified Send Message output. Exported for tests. */
export function simplifySessionChat(
	body: IDataObject,
	headers: Record<string, unknown> = {},
): IDataObject {
	const message = (body.message ?? {}) as IDataObject;
	const keyHeader = headers['x-hermes-session-key'];
	return {
		content: (message.content as string) ?? '',
		status: (body.status as string) ?? null,
		sessionId: (body.session_id as string) ?? null,
		sessionKey: keyHeader === undefined || keyHeader === null ? null : String(keyHeader),
		usage: (body.usage as IDataObject) ?? null,
		runtime: (body.runtime as IDataObject) ?? null,
	};
}

async function getAll(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
	const baseQs: IDataObject = {};
	if (typeof filters.source === 'string' && filters.source.trim()) {
		baseQs.source = filters.source.trim();
	}
	const title = typeof filters.title === 'string' ? filters.title.trim() : '';
	if (title) {
		baseQs.title = title;
		if (filters.includeHidden === true) baseQs.include_hidden = 'true';
	}
	if (filters.includeChildren === true) baseQs.include_children = 'true';
	const startOffset = clampInt(filters.offset, 0, 1_000_000, 0);

	const fetchPage = async (offset: number, limit: number) => {
		const res = (await hermesApiRequest.call(this, 'GET', '/api/sessions', {
			qs: { ...baseQs, limit, offset },
		})) as IDataObject;
		const data = Array.isArray(res?.data) ? (res.data as IDataObject[]) : [];
		return { items: data, hasMore: res?.has_more === true };
	};

	if (returnAll) {
		return toItems(await paginateSessions(fetchPage, SESSION_PAGE_MAX, startOffset));
	}
	const limit = clampInt(this.getNodeParameter('limit', i, 50), 1, SESSION_PAGE_MAX, 50);
	const { items } = await fetchPage(startOffset, limit);
	// Pinned sessions are back-filled past the page; keep the result within Limit (deduped).
	const seen = new Set<string>();
	const unique = items.filter((s) => {
		const id = s.id === undefined || s.id === null ? undefined : String(s.id);
		if (id === undefined) return true;
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
	return toItems(unique.slice(0, limit));
}

async function getMessages(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const id = getSessionId.call(this, i);
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const options = this.getNodeParameter('messageOptions', i, {}) as IDataObject;
	const startOffset = clampInt(options.offset, 0, Number.MAX_SAFE_INTEGER, 0);
	const extraQs: IDataObject = {};
	if (options.includeCompacted === true) extraQs.include_compacted = 'true';

	const fetchPage = async (offset: number, limit: number, order: string) => {
		const res = (await hermesApiRequest.call(this, 'GET', sessionPath(id, '/messages'), {
			qs: { ...extraQs, limit, offset, order },
		})) as IDataObject;
		const data = Array.isArray(res?.data) ? (res.data as IDataObject[]) : [];
		const pagination = (res?.pagination ?? {}) as IDataObject;
		const returned = typeof pagination.returned === 'number' ? pagination.returned : undefined;
		return { items: data, returned };
	};

	if (returnAll) {
		// Paging is only stable oldest-first; the endpoint has no has_more, so stop on a short page.
		return toItems(
			await paginateMessages(
				async (offset, limit) => await fetchPage(offset, limit, 'oldest'),
				MESSAGE_PAGE_MAX,
				startOffset,
			),
		);
	}
	const limit = clampInt(this.getNodeParameter('messageLimit', i, 50), 1, MESSAGE_PAGE_MAX, 50);
	const order = options.order === 'latest' ? 'latest' : 'oldest';
	const { items } = await fetchPage(startOffset, limit, order);
	return toItems(items);
}

async function create(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const fields = this.getNodeParameter('createFields', i, {}) as IDataObject;
	const body: IDataObject = {};
	if (typeof fields.id === 'string' && fields.id.trim()) body.id = fields.id.trim();
	if (typeof fields.title === 'string' && fields.title.trim()) body.title = fields.title.trim();
	if (typeof fields.systemPrompt === 'string' && fields.systemPrompt.trim()) {
		body.system_prompt = fields.systemPrompt;
	}
	if (typeof fields.source === 'string' && fields.source) body.source = fields.source;
	Object.assign(body, buildModelFields(fields));
	const res = await hermesApiRequest.call(this, 'POST', '/api/sessions', { body });
	return [{ json: unwrapSession(res) }];
}

async function update(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const id = getSessionId.call(this, i);
	const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
	const body = buildSessionUpdateBody(fields);
	if (!Object.keys(body).length) {
		throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
			itemIndex: i,
		});
	}
	const res = await hermesApiRequest.call(this, 'PATCH', sessionPath(id), { body });
	return [{ json: unwrapSession(res) }];
}

async function fork(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const id = getSessionId.call(this, i);
	const options = this.getNodeParameter('forkOptions', i, {}) as IDataObject;
	const body: IDataObject = {};
	if (typeof options.id === 'string' && options.id.trim()) body.id = options.id.trim();
	if (typeof options.title === 'string' && options.title.trim()) body.title = options.title.trim();
	const res = await hermesApiRequest.call(this, 'POST', sessionPath(id, '/fork'), { body });
	return [{ json: unwrapSession(res) }];
}

async function sendMessage(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const id = getSessionId.call(this, i);
	const message = this.getNodeParameter('message', i, '') as string;
	const simplify = this.getNodeParameter('simplify', i, true) as boolean;
	const options = this.getNodeParameter('chatOptions', i, {}) as IDataObject;
	if (!message || !String(message).trim()) {
		throw new NodeOperationError(this.getNode(), 'Message must not be empty', { itemIndex: i });
	}
	const body: IDataObject = { message, ...buildModelFields(options) };
	if (typeof options.systemMessage === 'string' && options.systemMessage.trim()) {
		body.system_message = options.systemMessage;
	}
	const headers: IDataObject = {};
	const sessionKey = typeof options.sessionKey === 'string' ? options.sessionKey.trim() : '';
	if (sessionKey) headers['X-Hermes-Session-Key'] = sessionKey;

	const response = (await hermesApiRequest.call(this, 'POST', sessionPath(id, '/chat'), {
		body,
		headers,
		timeout: timeoutMinutesToMs(options.timeout),
		returnFullResponse: true,
	})) as HermesFullResponse;
	const resBody = (response.body ?? {}) as IDataObject;
	if (simplify) return [{ json: simplifySessionChat(resBody, response.headers ?? {}) }];
	return [{ json: resBody }];
}

async function setModel(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const id = getSessionId.call(this, i);
	const options = this.getNodeParameter('modelLockOptions', i, {}) as IDataObject;
	const fields = buildModelFields({
		model: this.getNodeParameter('model', i, '') as string,
		provider: this.getNodeParameter('provider', i, '') as string,
		reasoningEffort: options.reasoningEffort,
	});
	if (!fields.model && !fields.provider) {
		throw new NodeOperationError(this.getNode(), 'Set Model, Provider or both', { itemIndex: i });
	}
	const res = await hermesApiRequest.call(this, 'POST', sessionPath(id, '/model'), {
		body: { ...fields } as IDataObject,
	});
	return [{ json: (res ?? {}) as IDataObject }];
}

export async function executeSession(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getAll':
			return await getAll.call(this, i);
		case 'create':
			return await create.call(this, i);
		case 'get': {
			const id = getSessionId.call(this, i);
			return [{ json: unwrapSession(await hermesApiRequest.call(this, 'GET', sessionPath(id))) }];
		}
		case 'update':
			return await update.call(this, i);
		case 'delete': {
			const id = getSessionId.call(this, i);
			const res = await hermesApiRequest.call(this, 'DELETE', sessionPath(id));
			return [{ json: (res ?? { id, deleted: true }) as IDataObject }];
		}
		case 'getMessages':
			return await getMessages.call(this, i);
		case 'fork':
			return await fork.call(this, i);
		case 'sendMessage':
			return await sendMessage.call(this, i);
		case 'setModel':
			return await setModel.call(this, i);
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported Session operation: ${operation}`, {
				itemIndex: i,
			});
	}
}
