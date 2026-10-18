import { describe, expect, it, vi } from 'vitest';
import type { IDataObject } from 'n8n-workflow';
import { paginateMessages, paginateSessions } from '../nodes/Hermes/helpers/pagination';

const ids = (items: IDataObject[]) => items.map((i) => i.id);

describe('paginateSessions', () => {
	it('follows has_more and dedupes pinned sessions back-filled on every page', async () => {
		const pages: Record<number, { items: IDataObject[]; hasMore: boolean }> = {
			0: { items: [{ id: 'pin' }, { id: 'a' }, { id: 'b' }], hasMore: true },
			3: { items: [{ id: 'pin' }, { id: 'c' }, { id: 'd' }], hasMore: true },
			6: { items: [{ id: 'pin' }, { id: 'e' }], hasMore: false },
		};
		const fetchPage = vi.fn(async (offset: number) => pages[offset]);
		const result = await paginateSessions(fetchPage, 3);
		expect(ids(result)).toEqual(['pin', 'a', 'b', 'c', 'd', 'e']);
		expect(fetchPage).toHaveBeenCalledTimes(3);
		expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 3, 6]);
		expect(fetchPage.mock.calls[0][1]).toBe(3);
	});

	it('stops on an empty page even if has_more is true', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({ items: [{ id: 'a' }], hasMore: true })
			.mockResolvedValueOnce({ items: [], hasMore: true });
		const result = await paginateSessions(fetchPage, 1);
		expect(ids(result)).toEqual(['a']);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('honours the start offset and the max pages cap', async () => {
		let n = 0;
		const fetchPage = vi.fn(async () => ({ items: [{ id: `s${n++}` }], hasMore: true }));
		const result = await paginateSessions(fetchPage, 1, 10, 4);
		expect(result).toHaveLength(4);
		expect(fetchPage.mock.calls[0][0]).toBe(10);
	});

	it('keeps items without an id', async () => {
		const fetchPage = vi.fn(async () => ({ items: [{ x: 1 }, { x: 2 }], hasMore: false }));
		expect(await paginateSessions(fetchPage)).toHaveLength(2);
	});
});

describe('paginateMessages', () => {
	it('stops when returned < limit', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({ items: [{ id: 1 }, { id: 2 }], returned: 2 })
			.mockResolvedValueOnce({ items: [{ id: 3 }, { id: 4 }], returned: 2 })
			.mockResolvedValueOnce({ items: [{ id: 5 }], returned: 1 });
		const result = await paginateMessages(fetchPage, 2);
		expect(ids(result)).toEqual([1, 2, 3, 4, 5]);
		expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 2, 4]);
	});

	it('makes one extra request when the last page is exactly full', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({ items: [{ id: 1 }, { id: 2 }], returned: 2 })
			.mockResolvedValueOnce({ items: [], returned: 0 });
		const result = await paginateMessages(fetchPage, 2);
		expect(result).toHaveLength(2);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('uses items.length when returned is missing', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce({ items: [{ id: 1 }] });
		expect(await paginateMessages(fetchPage, 5)).toHaveLength(1);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});
});
