import { describe, expect, it, vi } from 'vitest';
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { Hermes } from '../nodes/Hermes/Hermes.node';
import { resourceLabels, resources } from '../nodes/Hermes/resources';
import {
	KANBAN_ROUTES,
	buildCreateBody,
	buildListBody,
	executeKanbanTask,
	kanbanTaskDescription,
	parseMetadata,
} from '../nodes/Hermes/resources/kanbanTask';
import { TASK_ID_OPERATIONS } from '../nodes/Hermes/resources/kanbanTask/description';
import {
	KANBAN_ACTIONS,
	KANBAN_GET_MAX_RUNS,
	KANBAN_LIST_MAX_LIMIT,
	extractTransitionReason,
	kanbanBridgeErrorMessage,
} from '../nodes/Hermes/helpers/kanbanBridge';

const BASE_URL = 'http://host.docker.internal:9119';
const HOST_HEADER = '127.0.0.1:9119';
const TOKEN = 'kbb_test_token_not_a_real_secret';

const node = {
	id: 'node-1',
	name: 'Hermes 1',
	type: 'n8n-nodes-hermes.hermes',
	typeVersion: 1,
	position: [0, 0] as [number, number],
	parameters: {},
};

interface FakeResponse {
	statusCode: number;
	body: unknown;
	headers?: Record<string, unknown>;
}

function mockContext(params: IDataObject, response: FakeResponse, credentials?: IDataObject) {
	const httpRequestWithAuthentication = vi.fn().mockResolvedValue({ headers: {}, ...response });
	const getCredentials = vi
		.fn()
		.mockResolvedValue(
			credentials ?? { baseUrl: `${BASE_URL}/`, hostHeader: HOST_HEADER, token: TOKEN },
		);
	const ctx = {
		getCredentials,
		getNode: () => node,
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
	return { ctx, httpRequestWithAuthentication, getCredentials };
}

function sent(mock: ReturnType<typeof vi.fn>): IHttpRequestOptions {
	return mock.mock.calls[0][1] as IHttpRequestOptions;
}

function credentialTypeUsed(mock: ReturnType<typeof vi.fn>): string {
	return mock.mock.calls[0][0] as string;
}

async function run(operation: string, params: IDataObject, response: FakeResponse) {
	const { ctx, httpRequestWithAuthentication } = mockContext(params, response);
	const items = await executeKanbanTask.call(ctx, operation, 0);
	return {
		items,
		request: sent(httpRequestWithAuthentication),
		mock: httpRequestWithAuthentication,
	};
}

async function expectFailure(operation: string, params: IDataObject, response: FakeResponse) {
	const { ctx } = mockContext(params, response);
	try {
		await executeKanbanTask.call(ctx, operation, 0);
	} catch (error) {
		return error as NodeApiError;
	}
	throw new Error('expected the operation to fail');
}

const ok = (body: unknown): FakeResponse => ({ statusCode: 200, body });

describe('Kanban Task: description shape', () => {
	const property = (name: string) => kanbanTaskDescription.find((p) => p.name === name);

	it('scopes every property to the kanbanTask resource', () => {
		for (const p of kanbanTaskDescription) {
			expect(p.displayOptions?.show?.resource).toEqual(['kanbanTask']);
		}
	});

	it('offers all fifteen operations from the plan, alphabetical and action-labelled', () => {
		const operation = property('operation');
		const options = (operation?.options ?? []) as Array<{
			name: string;
			value: string;
			action?: string;
		}>;
		expect(options.map((o) => o.value).sort()).toEqual(
			[
				'create',
				'get',
				'getAll',
				'comment',
				'complete',
				'requestReview',
				'requestChanges',
				'requestChangesHuman',
				'rejectCase',
				'block',
				'unblock',
				'archive',
				'assign',
				'reprioritize',
				'edit',
			].sort(),
		);
		expect(options.map((o) => o.name)).toEqual(
			[...options.map((o) => o.name)].sort((a, b) => a.localeCompare(b)),
		);
		for (const o of options) expect(o.action).toBeTruthy();
		expect(options.find((o) => o.value === 'complete')?.name).toBe('Complete (Approve)');
	});

	it('requires Board on every operation', () => {
		const board = property('board');
		expect(board?.required).toBe(true);
		expect(board?.displayOptions?.show).toEqual({ resource: ['kanbanTask'] });
		expect(board?.displayOptions?.show?.operation).toBeUndefined();
	});

	it('requires Task ID on every operation except Create and Get Many', () => {
		const taskId = property('taskId');
		expect(taskId?.required).toBe(true);
		const shown = taskId?.displayOptions?.show?.operation as string[];
		expect([...shown].sort()).toEqual([...TASK_ID_OPERATIONS].sort());
		expect(shown).not.toContain('create');
		expect(shown).not.toContain('getAll');
	});

	it('puts the optional Create fields in an Options collection, alphabetically', () => {
		const options = property('createOptions');
		expect(options?.type).toBe('collection');
		expect(options?.displayOptions?.show?.operation).toEqual(['create']);
		const names = (options?.options ?? []).map((o) => (o as { displayName: string }).displayName);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
		expect(names).toContain('Idempotency Key');
		expect(names).toContain('Assignee');
		expect(names).toContain('Priority');
	});

	it('refuses decimals on every integer field, because the bridge models them as int', () => {
		const createOptions = (property('createOptions')?.options ?? []) as Array<{
			name: string;
			typeOptions?: { numberPrecision?: number };
		}>;
		for (const name of ['priority', 'maxRuntimeSeconds']) {
			const field = createOptions.find((o) => o.name === name);
			expect(field?.typeOptions?.numberPrecision, name).toBe(0);
		}
		expect(property('priority')?.typeOptions?.numberPrecision).toBe(0);
	});

	it('caps the Get Many Limit at the bridge maximum', () => {
		const limit = property('limit');
		expect(limit?.typeOptions?.maxValue).toBe(KANBAN_LIST_MAX_LIMIT);
		expect(limit?.default).toBe(50);
	});

	it('offers only real kanban statuses in the list filter', () => {
		const filters = property('listFilters');
		const status = (filters?.options ?? []).find(
			(o) => (o as { name: string }).name === 'status',
		) as { options?: Array<{ value: string }> } | undefined;
		expect((status?.options ?? []).map((o) => o.value)).toEqual([
			'triage',
			'todo',
			'scheduled',
			'ready',
			'running',
			'blocked',
			'review',
			'done',
			'archived',
		]);
	});

	it('requires a Reason for Request Changes, Request Changes (Human), Block and Reject Case', () => {
		const reason = property('reason');
		expect(reason?.required).toBe(true);
		expect(reason?.displayOptions?.show?.operation).toEqual([
			'requestChanges',
			'requestChangesHuman',
			'block',
			'rejectCase',
		]);
	});

	it('keeps the optional Request Review and Request Changes (Human) fields in Options', () => {
		for (const [name, operation, expected] of [
			['requestReviewOptions', 'requestReview', ['metadata', 'reviewer', 'summary']],
			['requestChangesHumanOptions', 'requestChangesHuman', ['actor']],
		] as Array<[string, string, string[]]>) {
			const collection = property(name);
			expect(collection?.type, name).toBe('collection');
			expect(collection?.displayOptions?.show?.operation, name).toEqual([operation]);
			const options = (collection?.options ?? []) as Array<{
				name: string;
				displayName: string;
			}>;
			expect(
				options.map((o) => o.name),
				name,
			).toEqual(expected);
			// n8n renders collection options in array order, so they have to be alphabetical.
			const labels = options.map((o) => o.displayName);
			expect(labels, name).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
		}
	});

	it('offers the gate-card create option, alphabetically placed with the rest', () => {
		const options = (property('createOptions')?.options ?? []) as Array<{
			name: string;
			type: string;
			displayName: string;
		}>;
		expect(options.find((o) => o.name === 'putIntoReview')?.type).toBe('boolean');
		expect(options.find((o) => o.name === 'reviewMetadata')?.type).toBe('json');
		expect(options.find((o) => o.name === 'reviewSummary')?.type).toBe('string');
		const labels = options.map((o) => o.displayName);
		expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
	});

	it('warns about the Reject Case archive order before the user runs it', () => {
		const notice = property('rejectCaseNotice');
		expect(notice?.type).toBe('notice');
		expect(notice?.displayOptions?.show?.operation).toEqual(['rejectCase']);
		expect(notice?.displayName).toMatch(/not-done descendant/);
		expect(notice?.displayName).toMatch(/releases/);
		expect(property('requestChangesHumanNotice')?.type).toBe('notice');
	});

	it('tells the user how many runs Get returns', () => {
		const operation = property('operation');
		const get = ((operation?.options ?? []) as Array<{ value: string; description?: string }>).find(
			(o) => o.value === 'get',
		);
		expect(KANBAN_GET_MAX_RUNS).toBe(20);
		expect(get?.description).toContain(String(KANBAN_GET_MAX_RUNS));
		expect(get?.description).toMatch(/metadata/);
	});

	it('registers the resource so the node renders it', () => {
		expect(resourceLabels.kanbanTask.name).toBe('Kanban Task');
		expect(resources.kanbanTask?.execute).toBe(executeKanbanTask);
		const names = new Hermes().description.properties.map((p) => p.name);
		expect(names).toContain('createOptions');
		expect(names).toContain('board');
	});
});

describe('Kanban Task: the request actually sent', () => {
	it('posts to the bridge base path with the Host override and the bridge credential', async () => {
		const { request, mock } = await run(
			'create',
			{ board: 'acquisitions', title: 'Review the Q3 rent roll', createOptions: {} },
			ok({ task_id: 'kbb_test_task_1', created: true, status: 'ready' }),
		);
		expect(request.method).toBe('POST');
		expect(request.url).toBe(`${BASE_URL}/api/plugins/kanban-bridge/v1/tasks/create`);
		expect((request.headers ?? {}).Host).toBe(HOST_HEADER);
		expect((request.headers ?? {}).Accept).toBe('application/json');
		expect(credentialTypeUsed(mock)).toBe('hermesKanbanBridgeApi');
		// The bearer token is added by the credential's authenticate, never inlined here.
		expect(JSON.stringify(request)).not.toContain(TOKEN);
	});

	it('omits the Host header when the credential leaves it empty', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ board: 'acquisitions', taskId: 'kbb_test_task_1' },
			ok({}),
			{ baseUrl: BASE_URL, hostHeader: '  ', token: TOKEN },
		);
		await executeKanbanTask.call(ctx, 'get', 0);
		expect((sent(httpRequestWithAuthentication).headers ?? {}).Host).toBeUndefined();
	});

	it('routes every operation to the documented path', () => {
		expect(KANBAN_ROUTES).toEqual({
			create: 'tasks/create',
			get: 'tasks/get',
			getAll: 'tasks/list',
			comment: 'tasks/comment',
			complete: 'tasks/action',
			requestReview: 'tasks/action',
			requestChanges: 'tasks/action',
			requestChangesHuman: 'tasks/action',
			rejectCase: 'tasks/action',
			block: 'tasks/action',
			unblock: 'tasks/action',
			archive: 'tasks/action',
			assign: 'tasks/action',
			reprioritize: 'tasks/action',
			edit: 'tasks/action',
		});
	});
});

describe('Kanban Task: request body per operation', () => {
	it('Create sends only the fields that were set, with snake_case keys', async () => {
		const { request } = await run(
			'create',
			{
				board: ' acquisitions ',
				title: ' Review the Q3 rent roll ',
				createOptions: {
					body: 'Check every unit.',
					assignee: 'deal-analyst',
					priority: 5,
					parents: 'kbb_test_task_1, kbb_test_task_2',
					skills: 'github-code-review',
					idempotencyKey: 'kbb_test_key_1',
					triage: true,
					maxRuntimeSeconds: 900,
					tenant: 'acme',
				},
			},
			ok({ task_id: 'kbb_test_task_9', created: true, status: 'triage' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			title: 'Review the Q3 rent roll',
			body: 'Check every unit.',
			assignee: 'deal-analyst',
			priority: 5,
			parents: ['kbb_test_task_1', 'kbb_test_task_2'],
			skills: ['github-code-review'],
			idempotency_key: 'kbb_test_key_1',
			triage: true,
			max_runtime_seconds: 900,
			tenant: 'acme',
		});
	});

	it('Create with no options sends just board and title', () => {
		expect(buildCreateBody('acquisitions', 'A task', {})).toEqual({
			board: 'acquisitions',
			title: 'A task',
		});
	});

	it('Create surfaces an idempotent replay as created: false', async () => {
		const { items } = await run(
			'create',
			{
				board: 'acquisitions',
				title: 'A task',
				createOptions: { idempotencyKey: 'kbb_test_key_1' },
			},
			ok({ task_id: 'kbb_test_task_9', created: false, status: 'ready' }),
		);
		expect(items).toEqual([
			{ json: { task_id: 'kbb_test_task_9', created: false, status: 'ready' } },
		]);
	});

	it('Get sends board and task_id', async () => {
		const { request, items } = await run(
			'get',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9' },
			ok({ id: 'kbb_test_task_9', status: 'review', comments: [], events: [] }),
		);
		expect(request.body).toEqual({ board: 'acquisitions', task_id: 'kbb_test_task_9' });
		expect(items).toHaveLength(1);
	});

	it('Get Many sends the filters and the capped limit, and splits the tasks into items', async () => {
		const { request, items } = await run(
			'getAll',
			{
				board: 'acquisitions',
				limit: 500,
				listFilters: { status: 'review', assignee: 'deal-analyst' },
			},
			ok({ tasks: [{ id: 'kbb_test_task_1' }, { id: 'kbb_test_task_2' }] }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			status: 'review',
			assignee: 'deal-analyst',
			limit: KANBAN_LIST_MAX_LIMIT,
		});
		expect(items).toEqual([
			{ json: { id: 'kbb_test_task_1' } },
			{ json: { id: 'kbb_test_task_2' } },
		]);
	});

	it('Get Many returns no items when the board is empty', async () => {
		const { items } = await run('getAll', { board: 'acquisitions', limit: 50 }, ok({ tasks: [] }));
		expect(items).toEqual([]);
	});

	it('Comment sends the comment as body', async () => {
		const { request } = await run(
			'comment',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9', body: 'Looks good to me' },
			ok({ comment_id: 7 }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			body: 'Looks good to me',
		});
	});

	it('Complete sends action=complete with the optional completion fields', async () => {
		const { request } = await run(
			'complete',
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
				completeOptions: {
					summary: 'Approved by Alex Example',
					result: 'All 42 units reconciled.',
					metadata: '{"approver":"Alex Example"}',
				},
			},
			ok({ ok: true, status: 'done' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'complete',
			summary: 'Approved by Alex Example',
			result: 'All 42 units reconciled.',
			metadata: { approver: 'Alex Example' },
		});
	});

	it('Complete with no options sends only the action', async () => {
		const { request } = await run(
			'complete',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9', completeOptions: {} },
			ok({ ok: true, status: 'done' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'complete',
		});
	});

	it('Request Changes sends action=request_changes with the reason', async () => {
		const { request } = await run(
			'requestChanges',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9', reason: 'Unit 12 is missing' },
			ok({ ok: true, status: 'ready' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'request_changes',
			reason: 'Unit 12 is missing',
		});
	});

	it('Request Review sends action=request_review with the optional review fields', async () => {
		const { request } = await run(
			'requestReview',
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
				requestReviewOptions: {
					summary: 'Gate 1: worth a look?',
					metadata: '{"hitl":{"v":1,"stage":"worth-a-look"}}',
					reviewer: ' deal-analyst ',
				},
			},
			ok({ ok: true, status: 'review' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'request_review',
			summary: 'Gate 1: worth a look?',
			metadata: { hitl: { v: 1, stage: 'worth-a-look' } },
			reviewer: 'deal-analyst',
		});
	});

	it('Request Review with no options sends only the action, for a gate card', async () => {
		const { request } = await run(
			'requestReview',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9', requestReviewOptions: {} },
			ok({ ok: true, status: 'review' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'request_review',
		});
	});

	it('Request Review names the Reviewer in a 403, because the bridge scopes it as an assignee', async () => {
		const error = await expectFailure(
			'requestReview',
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
				requestReviewOptions: { reviewer: 'deal-analyst' },
			},
			{ statusCode: 403, body: { detail: 'assignee not in scope' } },
		);
		expect(error.message).toMatch(/deal-analyst/);
		expect(error.message).toMatch(/request_review/);
	});

	it('Request Changes (Human) sends action=request_changes_human with the reason and actor', async () => {
		const { request } = await run(
			'requestChangesHuman',
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
				reason: 'The rent schedule is missing',
				requestChangesHumanOptions: { actor: ' alex@example.invalid ' },
			},
			ok({ ok: true, status: 'ready' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'request_changes_human',
			reason: 'The rent schedule is missing',
			actor: 'alex@example.invalid',
		});
	});

	it('Request Changes (Human) omits the actor when it is not set', async () => {
		const { request } = await run(
			'requestChangesHuman',
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
				reason: 'The rent schedule is missing',
				requestChangesHumanOptions: {},
			},
			ok({ ok: true, status: 'ready' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'request_changes_human',
			reason: 'The rent schedule is missing',
		});
	});

	it('Reject Case sends action=reject_case with the reason and returns the archived descendants', async () => {
		const { request, items } = await run(
			'rejectCase',
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
				reason: 'Outside the buy box',
			},
			ok({
				ok: true,
				status: 'archived',
				archived_descendants: ['kbb_test_task_11', 'kbb_test_task_10'],
			}),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'reject_case',
			reason: 'Outside the buy box',
		});
		expect(items).toEqual([
			{
				json: {
					ok: true,
					status: 'archived',
					archived_descendants: ['kbb_test_task_11', 'kbb_test_task_10'],
				},
			},
		]);
	});

	it('Create sends initial_review when Put Into Review is on', async () => {
		const { request } = await run(
			'create',
			{
				board: 'acquisitions',
				title: 'Chiropractic practice · Kenosha County, WI',
				createOptions: {
					putIntoReview: true,
					reviewSummary: 'Worth a look?',
					reviewMetadata: '{"hitl":{"v":1,"process":"acquisitions"}}',
				},
			},
			ok({ task_id: 'kbb_test_task_9', created: true, status: 'review' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			title: 'Chiropractic practice · Kenosha County, WI',
			initial_review: {
				summary: 'Worth a look?',
				metadata: { hitl: { v: 1, process: 'acquisitions' } },
			},
		});
	});

	it('Create sends an empty initial_review for a descriptor-less gate card', () => {
		// Both fields are optional on the bridge, so the toggle alone is a valid gate card.
		expect(buildCreateBody('acquisitions', 'A gate', { putIntoReview: true })).toEqual({
			board: 'acquisitions',
			title: 'A gate',
			initial_review: {},
		});
	});

	it('Create omits initial_review when Put Into Review is off', () => {
		expect(buildCreateBody('acquisitions', 'A task', { putIntoReview: false })).toEqual({
			board: 'acquisitions',
			title: 'A task',
		});
	});

	it('Create keeps initial_review alongside the parents that make it a gate', async () => {
		const { request } = await run(
			'create',
			{
				board: 'acquisitions',
				title: 'Gate 1',
				createOptions: { putIntoReview: true, priority: 5, reviewSummary: 'Worth a look?' },
			},
			ok({ task_id: 'kbb_test_task_9', created: true, status: 'review' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			title: 'Gate 1',
			priority: 5,
			initial_review: { summary: 'Worth a look?' },
		});
	});

	it('Get passes the runs array through untouched, metadata and all', async () => {
		const runs = [
			{
				id: 'kbb_test_run_3',
				profile: 'deal-analyst',
				status: 'done',
				outcome: 'review_requested',
				started_at: '2026-11-01T10:00:00Z',
				ended_at: '2026-11-01T10:42:00Z',
				summary: 'Analysis ready',
				metadata: { hitl: { v: 1, stage: 'pursue' }, upside: ['owner hours'] },
				error: null,
			},
		];
		const { items } = await run(
			'get',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9' },
			ok({ board: 'acquisitions', task: { id: 'kbb_test_task_9', status: 'review' }, runs }),
		);
		expect((items[0].json as IDataObject).runs).toEqual(runs);
		// The same object, not a re-shaped copy: a `hitl` descriptor has to survive the hop.
		expect(((items[0].json as IDataObject).runs as IDataObject[])[0].metadata).toEqual(
			runs[0].metadata,
		);
	});

	it('Block sends action=block with the reason', async () => {
		const { request } = await run(
			'block',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9', reason: 'Waiting on the seller' },
			ok({ ok: true, status: 'blocked' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'block',
			reason: 'Waiting on the seller',
		});
	});

	it('Unblock and Archive send only the action', async () => {
		for (const [operation, action] of [
			['unblock', 'unblock'],
			['archive', 'archive'],
		]) {
			const { request } = await run(
				operation,
				{ board: 'acquisitions', taskId: 'kbb_test_task_9' },
				ok({ ok: true, status: 'ready' }),
			);
			expect(request.body).toEqual({
				board: 'acquisitions',
				task_id: 'kbb_test_task_9',
				action,
			});
		}
	});

	it('Assign sends action=assign with the assignee', async () => {
		const { request } = await run(
			'assign',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9', assignee: ' deal-analyst ' },
			ok({ ok: true, status: 'ready' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'assign',
			assignee: 'deal-analyst',
		});
	});

	it('Reprioritize sends action=reprioritize with a whole-number priority', async () => {
		const { request } = await run(
			'reprioritize',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9', priority: 7 },
			ok({ ok: true, status: 'ready' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'reprioritize',
			priority: 7,
		});
	});

	it('Edit sends action=edit with only the fields that were filled in', async () => {
		const { request } = await run(
			'edit',
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
				editFields: { title: ' New title ' },
			},
			ok({ ok: true, status: 'ready' }),
		);
		expect(request.body).toEqual({
			board: 'acquisitions',
			task_id: 'kbb_test_task_9',
			action: 'edit',
			title: 'New title',
		});
	});

	it('maps every action operation to the plan’s wire action value', () => {
		expect(KANBAN_ACTIONS).toEqual({
			complete: 'complete',
			requestReview: 'request_review',
			requestChanges: 'request_changes',
			requestChangesHuman: 'request_changes_human',
			rejectCase: 'reject_case',
			block: 'block',
			unblock: 'unblock',
			archive: 'archive',
			assign: 'assign',
			reprioritize: 'reprioritize',
			edit: 'edit',
		});
	});

	it('keeps request_changes and request_changes_human as two distinct verbs', () => {
		// The bridge kept the old verb for back-compat; they are not the same transition.
		expect(KANBAN_ACTIONS.requestChanges).not.toBe(KANBAN_ACTIONS.requestChangesHuman);
	});
});

describe('Kanban Task: local validation', () => {
	const failsWith = async (operation: string, params: IDataObject) => {
		const { ctx } = mockContext(params, ok({}));
		await expect(executeKanbanTask.call(ctx, operation, 0)).rejects.toThrow(NodeOperationError);
	};

	it('rejects an empty Board, Title, Task ID, Comment, Reason or Assignee', async () => {
		await failsWith('create', { board: '  ', title: 'A task', createOptions: {} });
		await failsWith('create', { board: 'acquisitions', title: ' ', createOptions: {} });
		await failsWith('get', { board: 'acquisitions', taskId: '' });
		await failsWith('comment', { board: 'acquisitions', taskId: 'kbb_test_task_9', body: '' });
		await failsWith('block', { board: 'acquisitions', taskId: 'kbb_test_task_9', reason: ' ' });
		await failsWith('assign', { board: 'acquisitions', taskId: 'kbb_test_task_9', assignee: '' });
	});

	it('rejects an Edit with no fields set', async () => {
		await failsWith('edit', {
			board: 'acquisitions',
			taskId: 'kbb_test_task_9',
			editFields: {},
		});
	});

	it('rejects a non-integer priority and invalid Metadata before sending anything', async () => {
		await failsWith('reprioritize', {
			board: 'acquisitions',
			taskId: 'kbb_test_task_9',
			priority: 1.5,
		});
		await failsWith('complete', {
			board: 'acquisitions',
			taskId: 'kbb_test_task_9',
			completeOptions: { metadata: 'not json' },
		});
		await failsWith('complete', {
			board: 'acquisitions',
			taskId: 'kbb_test_task_9',
			completeOptions: { metadata: '[1,2]' },
		});
	});

	it('rejects a Reason-less Request Changes (Human) or Reject Case before sending anything', async () => {
		await failsWith('requestChangesHuman', {
			board: 'acquisitions',
			taskId: 'kbb_test_task_9',
			reason: ' ',
			requestChangesHumanOptions: {},
		});
		await failsWith('rejectCase', {
			board: 'acquisitions',
			taskId: 'kbb_test_task_9',
			reason: '',
		});
	});

	it('rejects invalid Request Review Metadata before sending anything', async () => {
		await failsWith('requestReview', {
			board: 'acquisitions',
			taskId: 'kbb_test_task_9',
			requestReviewOptions: { metadata: 'not json' },
		});
		await failsWith('requestReview', {
			board: 'acquisitions',
			taskId: 'kbb_test_task_9',
			requestReviewOptions: { metadata: '["a"]' },
		});
	});

	it('refuses review fields left behind with Put Into Review off, instead of dropping them', async () => {
		// Silently ignoring them would queue the card when the workflow asked for a gate.
		await failsWith('create', {
			board: 'acquisitions',
			title: 'A gate',
			createOptions: { reviewSummary: 'Worth a look?' },
		});
		await failsWith('create', {
			board: 'acquisitions',
			title: 'A gate',
			createOptions: { reviewMetadata: '{"hitl":{"v":1}}' },
		});
	});

	it('rejects invalid Review Metadata on Create', async () => {
		await failsWith('create', {
			board: 'acquisitions',
			title: 'A gate',
			createOptions: { putIntoReview: true, reviewMetadata: 'not json' },
		});
	});

	it('rejects an unknown operation', async () => {
		const { ctx } = mockContext({}, ok({}));
		await expect(executeKanbanTask.call(ctx, 'nope', 0)).rejects.toThrow(
			/Unsupported Kanban Task operation/,
		);
	});

	it('treats an empty Metadata object as unset', () => {
		expect(parseMetadata('')).toBeUndefined();
		expect(parseMetadata('{}')).toBeUndefined();
		expect(parseMetadata({})).toBeUndefined();
		expect(parseMetadata('{"a":1}')).toEqual({ a: 1 });
		expect(parseMetadata({ a: 1 })).toEqual({ a: 1 });
	});

	it('clamps the list limit into 1..200', () => {
		expect(buildListBody('b', 0, {}).limit).toBe(1);
		expect(buildListBody('b', 50, {}).limit).toBe(50);
		expect(buildListBody('b', 9999, {}).limit).toBe(KANBAN_LIST_MAX_LIMIT);
	});
});

describe('Kanban Task: error hints', () => {
	it('401 points at the token and kbctl token list', () => {
		const hint = kanbanBridgeErrorMessage(401, { error: { message: 'invalid token' } });
		expect(hint?.message).toMatch(/rejected the token/);
		expect(hint?.description).toMatch(/kbctl token list/);
		expect(hint?.description).toMatch(/kbb_/);
	});

	it('403 names the board, assignee and action that fell outside the scopes', () => {
		const hint = kanbanBridgeErrorMessage(
			403,
			{ error: { message: 'board not in scope' } },
			{
				board: 'acquisitions',
				assignee: 'deal-analyst',
				action: 'assign',
			},
		);
		expect(hint?.message).toMatch(/not scoped/);
		expect(hint?.message).toMatch(/acquisitions/);
		expect(hint?.message).toMatch(/deal-analyst/);
		expect(hint?.message).toMatch(/assign/);
		expect(hint?.description).toMatch(/kbctl token scope/);
	});

	it('404 names the task and board, because task IDs are per board', () => {
		const hint = kanbanBridgeErrorMessage(
			404,
			{ detail: 'not found' },
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
			},
		);
		expect(hint?.message).toMatch(/kbb_test_task_9/);
		expect(hint?.message).toMatch(/acquisitions/);
		expect(hint?.description).toMatch(/per board/);
	});

	it('409 shows the transition reason kanban_db gave', () => {
		const hint = kanbanBridgeErrorMessage(
			409,
			{ reason: 'task is already done' },
			{
				board: 'acquisitions',
				taskId: 'kbb_test_task_9',
			},
		);
		expect(hint?.message).toMatch(/task is already done/);
		expect(hint?.description).toMatch(/review/);
	});

	it('409 surfaces the reason from the plugin’s real {detail: "<string>"} envelope', () => {
		const hint = kanbanBridgeErrorMessage(
			409,
			{ detail: 'complete refused: parent dependencies are not satisfied' },
			{ board: 'acquisitions', taskId: 'kbb_test_task_9' },
		);
		expect(hint?.message).toMatch(/parent dependencies are not satisfied/);
	});

	it('409 surfaces a FastAPI detail string for a blocked-or-scheduled refusal', () => {
		const hint = kanbanBridgeErrorMessage(409, {
			detail: 'unblock refused: task is not blocked or scheduled',
		});
		expect(hint?.message).toMatch(/task is not blocked or scheduled/);
	});

	it('reads the 409 reason wherever the bridge puts it, and falls back to the message', () => {
		expect(extractTransitionReason({ reason: 'a' })).toBe('a');
		expect(extractTransitionReason({ error: { reason: 'b' } })).toBe('b');
		expect(extractTransitionReason({ detail: { reason: 'c' } })).toBe('c');
		expect(extractTransitionReason({ detail: 'no reason here' })).toBeUndefined();
		const hint = kanbanBridgeErrorMessage(409, { error: { message: 'illegal transition' } });
		expect(hint?.message).toMatch(/illegal transition/);
	});

	it('400 explains which fields the operation needs', () => {
		const hint = kanbanBridgeErrorMessage(400, { detail: 'board is required' });
		expect(hint?.message).toMatch(/board is required/);
		expect(hint?.description).toMatch(/Board and Title/);
	});

	it('422 gets the same field hint, because pydantic rejects before the plugin handler runs', () => {
		const hint = kanbanBridgeErrorMessage(422, {
			detail: [{ loc: ['body', 'priority'], msg: 'Input should be a valid integer' }],
		});
		expect(hint?.description).toMatch(/whole numbers/);
	});

	it('leaves statuses it has nothing to add for to the shared normaliser', () => {
		expect(kanbanBridgeErrorMessage(500, { error: 'boom' })).toBeUndefined();
		expect(kanbanBridgeErrorMessage(503, {})).toBeUndefined();
	});

	it('raises the hint as a NodeApiError from a real request', async () => {
		const error = await expectFailure(
			'complete',
			{ board: 'acquisitions', taskId: 'kbb_test_task_9', completeOptions: {} },
			{ statusCode: 409, body: { reason: 'task is in status todo, not review' } },
		);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toMatch(/task is in status todo, not review/);
		expect(error.context.itemIndex).toBe(0);
	});

	it('explains an unreachable bridge in terms of the dashboard process', async () => {
		const httpRequestWithAuthentication = vi
			.fn()
			.mockRejectedValue(new Error('connect ECONNREFUSED'));
		const ctx = {
			getCredentials: async () => ({ baseUrl: BASE_URL, hostHeader: HOST_HEADER, token: TOKEN }),
			getNode: () => node,
			getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
				(({ board: 'acquisitions', taskId: 'kbb_test_task_9' }) as IDataObject)[name] ?? fallback,
			helpers: { httpRequestWithAuthentication },
		} as unknown as IExecuteFunctions;
		await expect(executeKanbanTask.call(ctx, 'get', 0)).rejects.toThrow(
			/Could not reach the Hermes Kanban Bridge/,
		);
	});
});
