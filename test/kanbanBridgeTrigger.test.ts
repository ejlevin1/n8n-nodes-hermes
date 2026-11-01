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
	buildKanbanTargetsYaml,
	getEventBoard,
	getFilterRejection,
	isEventSelected,
	isKanbanBridgeEvent,
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

describe('Kanban bridge: webhook with a Hermes hook body', () => {
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

/**
 * A kanban-bridge delivery, exactly as the wire contract in PLAN.md specifies: the
 * outbound-webhook envelope (`hook_event_name`, `profile`, `delivery_id`, `timestamp`) with the
 * task coordinates as TOP-LEVEL keys — unlike Hermes hooks, which bury them in `extra`.
 */
function bridgeEvent(
	event = 'kanban_task_review_requested',
	overrides: IDataObject = {},
): IDataObject {
	return {
		hook_event_name: event,
		profile: 'deal-analyst',
		board: 'acquisitions',
		task_id: 'kbb_test_task_17',
		event_id: 412,
		event_kind: event.replace('kanban_task_', ''),
		run_id: 'kbb_test_run_4',
		title: 'Review the Q3 rent roll',
		status: 'review',
		assignee: 'deal-analyst',
		priority: 5,
		actor: 'n8n:kbb_test_label',
		payload: { reason: 'Unit 12 is missing' },
		delivery_id: 'kbb_test_delivery_2',
		timestamp: FRESH,
		...overrides,
	};
}

function pingEvent(overrides: IDataObject = {}): IDataObject {
	return {
		hook_event_name: 'kanban_bridge_ping',
		profile: '',
		board: 'acquisitions',
		delivery_id: 'kbb_test_delivery_ping',
		timestamp: FRESH,
		...overrides,
	};
}

describe('Kanban bridge: Any Kanban Event wildcard', () => {
	it('recognises every kanban_task_* name and the ping as bridge deliveries', () => {
		expect(isKanbanBridgeEvent('kanban_task_review_requested')).toBe(true);
		expect(isKanbanBridgeEvent('kanban_task_some_future_kind')).toBe(true);
		expect(isKanbanBridgeEvent('kanban_bridge_ping')).toBe(true);
		expect(isKanbanBridgeEvent('on_kanban_task_updated')).toBe(false);
		expect(isKanbanBridgeEvent('post_llm_call')).toBe(false);
	});

	it('selects any bridge kind, including kinds this node does not list', () => {
		expect(isEventSelected('kanban_task_archived', [KANBAN_ANY_EVENT])).toBe(true);
		expect(isEventSelected('kanban_task_some_future_kind', [KANBAN_ANY_EVENT])).toBe(true);
		expect(isEventSelected('kanban_bridge_ping', [KANBAN_ANY_EVENT])).toBe(true);
	});

	it('does not widen the wildcard to Hermes kanban hooks or anything else', () => {
		expect(isEventSelected('on_kanban_task_updated', [KANBAN_ANY_EVENT])).toBe(false);
		expect(isEventSelected('on_kanban_dispatch_tick', [KANBAN_ANY_EVENT])).toBe(false);
		expect(isEventSelected('post_llm_call', [KANBAN_ANY_EVENT])).toBe(false);
	});

	it('still honours exact selections when the wildcard is not selected', () => {
		expect(isEventSelected('kanban_task_archived', ['kanban_task_archived'])).toBe(true);
		expect(isEventSelected('kanban_task_archived', ['kanban_task_created'])).toBe(false);
		expect(isEventSelected('kanban_task_archived', [])).toBe(false);
	});

	it('passes a bridge delivery of a kind the node does not list when the wildcard is on', () => {
		expect(
			getFilterRejection(
				bridgeEvent('kanban_task_some_future_kind'),
				{},
				{
					events: [KANBAN_ANY_EVENT],
				},
			),
		).toBeNull();
	});
});

describe('Kanban bridge: ping handling', () => {
	// The signed `timestamp` is checked against the clock, so pin it (as test/trigger.test.ts does).
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('accepts the ping when Any Kanban Event is selected', () => {
		expect(getFilterRejection(pingEvent(), {}, { events: [KANBAN_ANY_EVENT] })).toBeNull();
	});

	it('ignores the ping when only named events are selected', () => {
		expect(
			getFilterRejection(
				pingEvent(),
				{},
				{
					events: ['kanban_task_review_requested', 'kanban_task_completed'],
				},
			),
		).toBe('event "kanban_bridge_ping" not selected');
	});

	it('passes the ping through a Board filter matching the target’s board', () => {
		expect(
			getFilterRejection(
				pingEvent(),
				{},
				{
					events: [KANBAN_ANY_EVENT],
					boards: ['acquisitions'],
				},
			),
		).toBeNull();
	});

	it('drops a wildcard target’s ping when a named Board filter is set', () => {
		expect(
			getFilterRejection(
				pingEvent({ board: '*' }),
				{},
				{
					events: [KANBAN_ANY_EVENT],
					boards: ['acquisitions'],
				},
			),
		).toBe('board "*" not in filter');
	});

	it('acknowledges an unselected ping with HTTP 200 and no execution', async () => {
		const body = JSON.stringify(pingEvent());
		const { result, status } = await callWebhook({
			body,
			params: { events: ['kanban_task_completed'] },
		});
		expect(status).not.toHaveBeenCalled();
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatchObject({ received: true, ignored: true });
	});

	it('starts the workflow for a signed ping when the wildcard is selected', async () => {
		const body = JSON.stringify(pingEvent());
		const { result } = await callWebhook({ body, params: { events: [KANBAN_ANY_EVENT] } });
		const items = result.workflowData?.[0] ?? [];
		expect(items).toHaveLength(1);
		expect(items[0].json.event).toBe('kanban_bridge_ping');
	});
});

describe('Kanban bridge: the bridge wire body', () => {
	it('reads the board from the top level, where the bridge puts it', () => {
		expect(getEventBoard(bridgeEvent())).toBe('acquisitions');
		// Hermes hooks keep it in extra; both must work.
		expect(getEventBoard(kanbanEvent())).toBe('main');
		expect(getEventBoard({ hook_event_name: 'post_llm_call' })).toBeNull();
	});

	it('filters a bridge delivery on its top-level board', () => {
		expect(
			getFilterRejection(
				bridgeEvent(),
				{},
				{
					events: [KANBAN_ANY_EVENT],
					boards: ['acquisitions'],
				},
			),
		).toBeNull();
		expect(
			getFilterRejection(
				bridgeEvent(),
				{},
				{
					events: [KANBAN_ANY_EVENT],
					boards: ['other-board'],
				},
			),
		).toBe('board "acquisitions" not in filter');
	});

	it('matches the Profile filter against the assignee the bridge sends as profile', () => {
		expect(
			getFilterRejection(
				bridgeEvent(),
				{},
				{
					events: [KANBAN_ANY_EVENT],
					profile: 'Deal-Analyst',
				},
			),
		).toBeNull();
		expect(
			getFilterRejection(bridgeEvent(), {}, { events: [KANBAN_ANY_EVENT], profile: 'coder' }),
		).toBe('profile "deal-analyst" does not match filter');
	});

	it('folds the bridge task coordinates into extra, so both sources read alike', () => {
		const item = normalizeEvent(bridgeEvent());
		expect(item.event).toBe('kanban_task_review_requested');
		expect(item.board).toBe('acquisitions');
		expect(item.profile).toBe('deal-analyst');
		expect(item.extra).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_17',
			event_id: 412,
			event_kind: 'review_requested',
			run_id: 'kbb_test_run_4',
			title: 'Review the Q3 rent roll',
			status: 'review',
			assignee: 'deal-analyst',
			priority: 5,
			actor: 'n8n:kbb_test_label',
			payload: { reason: 'Unit 12 is missing' },
		});
		expect(item.deliveryId).toBe('kbb_test_delivery_2');
		expect(item.timestamp).toBe(FRESH);
	});

	it('omits bridge keys the delivery left out instead of filling in nulls', () => {
		const item = normalizeEvent(
			bridgeEvent('kanban_task_created', { actor: null, run_id: null, payload: {} }),
		);
		expect(item.extra).not.toHaveProperty('actor');
		expect(item.extra).not.toHaveProperty('run_id');
		expect(item.extra.payload).toEqual({});
	});

	it('lets an explicit extra in the body win over the folded keys', () => {
		const item = normalizeEvent(bridgeEvent('kanban_task_created', { extra: { status: 'todo' } }));
		expect(item.extra.status).toBe('todo');
		expect(item.extra.task_id).toBe('kbb_test_task_17');
	});

	it('does not fold anything for a Hermes hook delivery', () => {
		const item = normalizeEvent(kanbanEvent());
		expect(item.extra).toEqual({
			task_id: 'kbb_test_task_17',
			board: 'main',
			assignee: 'Alex Example',
			run_id: 'kbb_test_run_4',
			profile_name: 'default',
		});
		expect(item.extra).not.toHaveProperty('event_id');
	});

	it('folds a ping’s board into extra and leaves it task-less', () => {
		const item = normalizeEvent(pingEvent());
		expect(item.extra).toEqual({ board: 'acquisitions' });
		expect(item.board).toBe('acquisitions');
		expect(item.profile).toBeNull();
	});

	it('keeps a wildcard target’s ping board as "*"', () => {
		const item = normalizeEvent(pingEvent({ board: '*' }));
		expect(item.board).toBe('*');
	});
});

describe('Kanban bridge: webhook with the bridge wire body', () => {
	// The signed `timestamp` is checked against the clock, so pin it (as test/trigger.test.ts does).
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('verifies the bridge signature with the Hermes outbound scheme', async () => {
		const body = JSON.stringify(bridgeEvent());
		expect(verifySignature(SECRET, Buffer.from(body, 'utf8'), sign(body))).toBe(true);
		const { result, status } = await callWebhook({
			body,
			params: { events: [KANBAN_ANY_EVENT] },
		});
		expect(status).not.toHaveBeenCalled();
		const items = result.workflowData?.[0] ?? [];
		expect(items[0].json.event).toBe('kanban_task_review_requested');
		expect(items[0].json.board).toBe('acquisitions');
		expect((items[0].json.extra as IDataObject).task_id).toBe('kbb_test_task_17');
	});

	it('rejects a tampered bridge body with HTTP 401', async () => {
		const body = JSON.stringify(bridgeEvent());
		const tampered = body.replace('acquisitions', 'other-board');
		const { status } = await callWebhook({
			body: tampered,
			signature: sign(body),
			params: { events: [KANBAN_ANY_EVENT] },
		});
		expect(status).toHaveBeenCalledWith(401);
	});

	it('starts for each bridge-only kind when it is selected by name', async () => {
		for (const event of [
			'kanban_task_created',
			'kanban_task_review_requested',
			'kanban_task_changes_requested',
			'kanban_task_unblocked',
			'kanban_task_archived',
		]) {
			const { result } = await callWebhook({
				body: JSON.stringify(bridgeEvent(event)),
				params: { events: [event] },
			});
			expect(result.workflowData?.[0]?.[0].json.event).toBe(event);
		}
	});

	it('acknowledges a bridge delivery for another board without starting the workflow', async () => {
		const { result, status } = await callWebhook({
			body: JSON.stringify(bridgeEvent()),
			params: { events: [KANBAN_ANY_EVENT], filters: { boards: 'other-board' } },
		});
		expect(status).not.toHaveBeenCalled();
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatchObject({ received: true, ignored: true });
	});
});

describe('Kanban bridge: targets config snippet', () => {
	it('emits the plugin settings path, not hooks.outbound', () => {
		const yaml = buildKanbanTargetsYaml('<url>', [KANBAN_ANY_EVENT]);
		expect(yaml).toContain('plugins:');
		expect(yaml).toContain('  entries:');
		expect(yaml).toContain('    kanban-bridge:');
		expect(yaml).toContain('      settings:');
		expect(yaml).toContain('        targets:');
		expect(yaml).not.toContain('hooks:');
		expect(yaml).not.toContain('outbound:');
	});

	it('uses the target keys from the wire contract and references the secret by env var', () => {
		const yaml = buildKanbanTargetsYaml('https://n8n.example/webhook/hermes', [KANBAN_ANY_EVENT], {
			name: 'n8n-dev',
			boards: ['acquisitions'],
		});
		expect(yaml).toContain('          - name: n8n-dev');
		expect(yaml).toContain('            url: "https://n8n.example/webhook/hermes"');
		expect(yaml).toContain('            boards: ["acquisitions"]');
		expect(yaml).toContain('            events: ["*"]');
		expect(yaml).toContain('            secret_env: HERMES_N8N_WEBHOOK_SECRET');
		// The secret itself is never written into the snippet.
		expect(yaml).not.toContain(SECRET);
	});

	it('lists the selected bridge events and ignores non-bridge selections', () => {
		const yaml = buildKanbanTargetsYaml('<url>', [
			'kanban_task_review_requested',
			'kanban_task_completed',
			'post_llm_call',
			'on_kanban_dispatch_tick',
		]);
		expect(yaml).toContain(
			'            events: [kanban_task_review_requested, kanban_task_completed]',
		);
	});

	it('defaults boards to every board', () => {
		expect(buildKanbanTargetsYaml('<url>', [KANBAN_ANY_EVENT])).toContain(
			'            boards: ["*"]',
		);
	});

	it('is rendered in a Kanban-bridge-only notice that points away from hooks.outbound', () => {
		const description = new HermesTrigger().description;
		const notice = description.properties.find((p) => p.name === 'kanbanBridgeNotice');
		expect(notice?.type).toBe('notice');
		expect(notice?.displayOptions?.show?.events).toEqual(KANBAN_BRIDGE_EVENTS);
		expect(String(notice?.displayName)).toContain('plugins.entries.kanban-bridge.settings.targets');
		expect(String(notice?.displayName)).toMatch(/not<\/i> <code>hooks.outbound/);
		expect(String(notice?.displayName)).toContain('kanban_bridge_ping');
		expect(String(notice?.displayName)).toContain('        targets:');
	});

	it('keeps the hooks.outbound notice but sends Kanban users to the bridge one', () => {
		const description = new HermesTrigger().description;
		const setup = String(
			description.properties.find((p) => p.name === 'setupNotice')?.displayName ?? '',
		);
		expect(setup).toContain('hooks:');
		expect(setup).toMatch(/do not come\s+from <code>hooks.outbound/);
	});
});
