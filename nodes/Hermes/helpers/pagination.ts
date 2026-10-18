import type { IDataObject } from 'n8n-workflow';

/** One page of `GET /api/sessions`. */
export interface SessionPage {
	items: IDataObject[];
	hasMore: boolean;
}

/**
 * Fetch every session page via `has_more`, de-duplicating by `id` (Hermes back-fills pinned
 * sessions on every page). `fetchPage(offset, limit)` returns one page.
 *
 * @param pageSize page size to request (Hermes max is 200)
 * @param maxPages safety cap on the number of requests
 */
export async function paginateSessions(
	fetchPage: (offset: number, limit: number) => Promise<SessionPage>,
	pageSize = 200,
	startOffset = 0,
	maxPages = 1000,
): Promise<IDataObject[]> {
	const seen = new Set<string>();
	const results: IDataObject[] = [];
	let offset = startOffset;
	for (let page = 0; page < maxPages; page++) {
		const { items, hasMore } = await fetchPage(offset, pageSize);
		let added = 0;
		for (const item of items) {
			const id = item.id === undefined || item.id === null ? undefined : String(item.id);
			if (id !== undefined) {
				if (seen.has(id)) continue;
				seen.add(id);
			}
			results.push(item);
			added++;
		}
		if (!hasMore || items.length === 0) break;
		// Advance by what the server returned; if a page contained only duplicates, still move on.
		offset += items.length;
		if (added === 0 && items.length < pageSize) break;
	}
	return results;
}

/**
 * Fetch every message page; the messages endpoint has no `has_more`, so stop as soon as a
 * page returns fewer than `limit` messages. `fetchPage(offset, limit)` returns the page's
 * messages plus the server's `pagination.returned` count when available.
 *
 * @param pageSize page size to request (Hermes max is 500)
 */
export async function paginateMessages(
	fetchPage: (
		offset: number,
		limit: number,
	) => Promise<{ items: IDataObject[]; returned?: number }>,
	pageSize = 500,
	startOffset = 0,
	maxPages = 10000,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let offset = startOffset;
	for (let page = 0; page < maxPages; page++) {
		const { items, returned } = await fetchPage(offset, pageSize);
		results.push(...items);
		const count = typeof returned === 'number' ? returned : items.length;
		if (count < pageSize || count === 0) break;
		offset += count;
	}
	return results;
}
