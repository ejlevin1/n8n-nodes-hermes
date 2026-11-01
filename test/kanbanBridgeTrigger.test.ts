import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDataObject, IWebhookFunctions } from 'n8n-workflow';
import { HermesTrigger } from '../nodes/HermesTrigger/HermesTrigger.node';
import {
	HERMES_TRIGGER_EVENT_VALUES,
	KANBAN_ANY_EVENT,
	KANBAN_BRIDGE_EVENTS,
	KANBAN_EVENTS,
	KANBAN_HOOK_EVENTS,
	getFilterRejection,
	normalizeEvent,
} from '../nodes/HermesTrigger/events';
import { verifySignature } from '../nodes/HermesTrigger/verifySignature';

const SECRET = 'kbb_test_signing_secret_of_32_chars!!';
const NOW = Date.parse('2026-10-31T12:00:00.000Z');
const FRESH = '2026-10-31T11:59:30.123456Z';

function sign(body: string, secret = SECRET): string {
	return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * A Kanban hook delivery as Hermes puts it on the wire: top-level keys from
 * agent/shell_hooks.py `_payload_fields` plus `hook_event_name`/`delivery_id`/`timestamp` from
 * agent/outbound_webhooks.py `_serialize_payload`. Every Kanban hook kwarg (task_id, board,
 * assignee, run_id, profile_name, ...) is NOT a top-level key, so it lands inside `extra`.
 */
function kanbanEvent(
	event = 'kanban_task_completed',
	extra: IDataObject = {},
	overrides: IDataObject = {},
): IDataObject {
	return {
		hook_event_name: event,
		profile: 'default',
		tool_name: null,
		tool_input: null,
		session_id: '',
		cwd: '/home/hermes',
		extra: {
			task_id: 'kbb_test_task_17',
			board: 'main',
			assignee: 'Alex Example',
			run_id: 'kbb_test_run_4',
			profile_name: 'default',
			...extra,
		},
		delivery_id: 'kbb_test_delivery_1',
		timestamp: FRESH,
		...overrides,
	};
}

interface CallOptions {
	body?: string;
	signature?: string | null;
	params?: IDataObject;
}

async function callWebhook(opts: CallOptions = {}) {
	const body = opts.body ?? JSON.stringify(kanbanEvent());
	const payload = JSON.parse(body) as IDataObject;
	const headers: IDataObject = {
		'content-type': 'application/json',
		'x-hermes-event': String(payload.hook_event_name ?? ''),
		'x-hermes-delivery': String(payload.delivery_id ?? ''),
	};
	const signature = opts.signature === undefined ? sign(body) : opts.signature;
	if (signature !== null) headers['x-hermes-signature-256'] = signature;

	const end = vi.fn();
	const status = vi.fn(() => ({ end }));
	const params: IDataObject = {
		events: KANBAN_EVENTS,
		filters: {},
		options: {},
		profile: '',
		...opts.params,
	};

	const ctx = {
		getRequestObject: () => ({ rawBody: Buffer.from(body, 'utf8'), body: {} }),
		getHeaderData: () => headers,
		getBodyData: () => ({}),
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getCredentials: async () => ({ secret: SECRET }),
		getResponseObject: () => ({ status }),
		getNode: () => ({ name: 'Hermes Trigger', type: 'hermesTrigger' }),
	} as unknown as IWebhookFunctions;

	const result = await new HermesTrigger().webhook.call(ctx);
	return { result, status, end };
}

describe('Kanban bridge: trigger event catalogue', () => {
	it('exposes every Kanban hook from Hermes VALID_HOOKS', () => {
		// hermes_cli/plugins.py:108 VALID_HOOKS — the Kanban task + worker/dispatch observers.
		expect([...KANBAN_HOOK_EVENTS].sort()).toEqual(
			[
				'kanban_task_blocked',
				'kanban_task_claimed',
				'kanban_task_completed',
				'on_kanban_dispatch_tick',
				'on_kanban_task_updated',
				'on_kanban_worker_exited',
				'on_kanban_worker_spawned',
				'on_kanban_worker_stale_claim',
			].sort(),
		);
	});

	it('covers both delivery sources in KANBAN_EVENTS, without duplicating the shared names', () => {
		// claimed/completed/blocked arrive from either source under the same name, so the union
		// must list each exactly once.
		expect(new Set(KANBAN_EVENTS).size).toBe(KANBAN_EVENTS.length);
		for (const event of [...KANBAN_HOOK_EVENTS, ...KANBAN_BRIDGE_EVENTS]) {
			expect(KANBAN_EVENTS).toContain(event);
		}
		for (const shared of ['kanban_task_claimed', 'kanban_task_completed', 'kanban_task_blocked']) {
			expect(KANBAN_HOOK_EVENTS).toContain(shared);
			expect(KANBAN_BRIDGE_EVENTS).toContain(shared);
		}
	});

	it('offers the bridge-only kinds Hermes fires no hook for', () => {
		for (const event of [
			'kanban_task_created',
			'kanban_task_review_requested',
			'kanban_task_changes_requested',
			'kanban_task_unblocked',
			'kanban_task_archived',
		]) {
			expect(KANBAN_BRIDGE_EVENTS).toContain(event);
			expect(KANBAN_HOOK_EVENTS).not.toContain(event);
			expect(HERMES_TRIGGER_EVENT_VALUES).toContain(event);
		}
	});

	it('offers the Any Kanban Event wildcard', () => {
		expect(KANBAN_ANY_EVENT).toBe('kanban_task_*');
		expect(KANBAN_BRIDGE_EVENTS).toContain(KANBAN_ANY_EVENT);
		expect(HERMES_TRIGGER_EVENT_VALUES).toContain(KANBAN_ANY_EVENT);
	});

	it('registers each Kanban event in the selectable Events list', () => {
		for (const event of KANBAN_EVENTS) {
			expect(HERMES_TRIGGER_EVENT_VALUES).toContain(event);
		}
	});

	it('keeps the Events options alphabetical by name and free of duplicates', () => {
		const description = new HermesTrigger().description;
		const events = description.properties.find((p) => p.name === 'events');
		const names = (events?.options ?? []).map((o) => (o as { name: string }).name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
		expect(new Set(HERMES_TRIGGER_EVENT_VALUES).size).toBe(HERMES_TRIGGER_EVENT_VALUES.length);
	});
});

describe('Kanban bridge: description shape', () => {
	const description = new HermesTrigger().description;
	const filters = description.properties.find((p) => p.name === 'filters');

	it('puts the Board filter in the existing Filters collection, not at top level', () => {
		expect(description.properties.some((p) => p.name === 'boards')).toBe(false);
		const option = (filters?.options ?? []).find((o) => (o as { name: string }).name === 'boards');
		expect(option).toBeDefined();
		expect((option as { displayName: string }).displayName).toBe('Board');
		expect((option as { type: string }).type).toBe('string');
		expect((option as { default: unknown }).default).toBe('');
	});

	it('keeps the Filters collection options sorted by display name', () => {
		const names = (filters?.options ?? []).map((o) => (o as { displayName: string }).displayName);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});

	it('shows the Kanban notice only for Kanban events', () => {
		const notice = description.properties.find((p) => p.name === 'kanbanEventsNotice');
		expect(notice?.type).toBe('notice');
		expect(notice?.displayOptions?.show?.events).toEqual(KANBAN_EVENTS);
	});
});

describe('Kanban bridge: event matching', () => {
	const base = { events: KANBAN_EVENTS };

	it('accepts each Kanban event when selected', () => {
		for (const event of KANBAN_EVENTS) {
			expect(getFilterRejection(kanbanEvent(event), undefined, base)).toBeNull();
		}
	});

	it('rejects a Kanban event that is not selected', () => {
		expect(
			getFilterRejection(kanbanEvent('on_kanban_dispatch_tick'), undefined, {
				events: ['kanban_task_completed'],
			}),
		).toBe('event "on_kanban_dispatch_tick" not selected');
	});

	it('matches on the X-Hermes-Event header when the body omits hook_event_name', () => {
		const payload = kanbanEvent('kanban_task_blocked');
		delete payload.hook_event_name;
		expect(
			getFilterRejection(payload, { 'x-hermes-event': 'kanban_task_blocked' }, base),
		).toBeNull();
	});
});

describe('Kanban bridge: Board filter', () => {
	const base = { events: KANBAN_EVENTS };

	it('accepts a matching board, case-insensitively', () => {
		expect(
			getFilterRejection(kanbanEvent('kanban_task_completed', { board: 'Main' }), undefined, {
				...base,
				boards: ['main'],
			}),
		).toBeNull();
	});

	it('accepts any board in a multi-board list', () => {
		for (const board of ['main', 'release']) {
			expect(
				getFilterRejection(kanbanEvent('kanban_task_claimed', { board }), undefined, {
					...base,
					boards: ['main', 'release'],
				}),
			).toBeNull();
		}
	});

	it('rejects a board outside the list', () => {
		expect(
			getFilterRejection(kanbanEvent('kanban_task_completed', { board: 'scratch' }), undefined, {
				...base,
				boards: ['main'],
			}),
		).toBe('board "scratch" not in filter');
	});

	it('drops an event with no board once the filter is set', () => {
		const payload = kanbanEvent('on_kanban_dispatch_tick', { board: undefined });
		delete (payload.extra as IDataObject).board;
		expect(getFilterRejection(payload, undefined, { ...base, boards: ['main'] })).toBe(
			'board "" not in filter',
		);
	});

	it('accepts every board when the filter is unset', () => {
		expect(
			getFilterRejection(kanbanEvent('kanban_task_completed', { board: 'anything' }), undefined, {
				...base,
				boards: [],
			}),
		).toBeNull();
	});

	it('still applies the profile filter alongside the board filter', () => {
		expect(
			getFilterRejection(kanbanEvent(), undefined, {
				...base,
				boards: ['main'],
				profile: 'coder',
			}),
		).toBe('profile "default" does not match filter');
	});
});

describe('Kanban bridge: normalized output', () => {
	it('surfaces board top-level and keeps the task coordinates in extra', () => {
		const out = normalizeEvent(kanbanEvent('kanban_task_completed', { summary: 'shipped' }));
		expect(out.event).toBe('kanban_task_completed');
		expect(out.board).toBe('main');
		expect(out.profile).toBe('default');
		expect(out.extra.task_id).toBe('kbb_test_task_17');
		expect(out.extra.assignee).toBe('Alex Example');
		expect(out.extra.run_id).toBe('kbb_test_run_4');
		expect(out.extra.summary).toBe('shipped');
		expect(out.deliveryId).toBe('kbb_test_delivery_1');
	});

	it('reports board as null for a non-Kanban event', () => {
		expect(normalizeEvent({ hook_event_name: 'post_llm_call', extra: {} }).board).toBeNull();
	});

	it('exposes changed_fields for a task update without inventing values', () => {
		const out = normalizeEvent(
			kanbanEvent('on_kanban_task_updated', { changed_fields: ['status', 'assignee'] }),
		);
		expect(out.extra.changed_fields).toEqual(['status', 'assignee']);
	});
});

describe('Kanban bridge: webhook with a bridge-shaped body', () => {
	// The signed `timestamp` is checked against the clock, so pin it (as test/trigger.test.ts does).
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts the workflow for a signed Kanban delivery', async () => {
		const { result } = await callWebhook();
		const items = result.workflowData?.[0] ?? [];
		expect(items).toHaveLength(1);
		expect(items[0].json.event).toBe('kanban_task_completed');
		expect(items[0].json.board).toBe('main');
	});

	it('verifies the signature over the exact raw Kanban body', () => {
		const body = JSON.stringify(kanbanEvent('on_kanban_worker_spawned'));
		expect(verifySignature(SECRET, Buffer.from(body, 'utf8'), sign(body))).toBe(true);
		// A re-serialized body with different key order must not validate.
		expect(verifySignature(SECRET, Buffer.from(`${body} `, 'utf8'), sign(body))).toBe(false);
		expect(verifySignature(SECRET, Buffer.from(body, 'utf8'), sign(body, 'wrong'))).toBe(false);
	});

	it('rejects a tampered Kanban body with HTTP 401', async () => {
		const good = JSON.stringify(kanbanEvent());
		const tampered = JSON.stringify(kanbanEvent('kanban_task_completed', { board: 'other' }));
		const { result, status } = await callWebhook({ body: tampered, signature: sign(good) });
		expect(status).toHaveBeenCalledWith(401);
		expect(result.workflowData).toBeUndefined();
	});

	it('rejects an unsigned Kanban delivery with HTTP 401', async () => {
		const { status } = await callWebhook({ signature: null });
		expect(status).toHaveBeenCalledWith(401);
	});

	it('acknowledges a board that does not match without starting the workflow', async () => {
		const { result } = await callWebhook({ params: { filters: { boards: 'release' } } });
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toEqual({
			received: true,
			ignored: true,
			reason: 'board "main" not in filter',
		});
	});

	it('starts the workflow when the board filter matches', async () => {
		const { result } = await callWebhook({ params: { filters: { boards: 'main, release' } } });
		expect(result.workflowData?.[0]).toHaveLength(1);
	});

	it('rejects a stale Kanban delivery when Reject Stale Events is on', async () => {
		vi.setSystemTime(NOW + 60 * 60 * 1000);
		const { status } = await callWebhook({ params: { options: { rejectStaleEvents: true } } });
		expect(status).toHaveBeenCalledWith(401);
	});

	it('accepts a stale Kanban delivery when Reject Stale Events is off', async () => {
		vi.setSystemTime(NOW + 60 * 60 * 1000);
		const { result } = await callWebhook({ params: { options: { rejectStaleEvents: false } } });
		expect(result.workflowData?.[0]).toHaveLength(1);
	});
});
