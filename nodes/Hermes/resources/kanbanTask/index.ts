import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	KANBAN_ACTIONS,
	KANBAN_LIST_MAX_LIMIT,
	kanbanBridgeRequest,
	parseKanbanList,
	requiredString,
	type KanbanBridgeErrorContext,
} from '../../helpers/kanbanBridge';
import { kanbanTaskFields, kanbanTaskOperations } from './description';

export const kanbanTaskDescription = [kanbanTaskOperations, ...kanbanTaskFields];

/** Route each n8n operation uses on the bridge. */
export const KANBAN_ROUTES: Record<string, string> = {
	create: 'tasks/create',
	get: 'tasks/get',
	getAll: 'tasks/list',
	comment: 'tasks/comment',
	complete: 'tasks/action',
	requestChanges: 'tasks/action',
	block: 'tasks/action',
	unblock: 'tasks/action',
	archive: 'tasks/action',
	assign: 'tasks/action',
	reprioritize: 'tasks/action',
	edit: 'tasks/action',
};

function trimmed(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** Parse a Metadata JSON parameter; returns undefined when it is empty. */
export function parseMetadata(raw: unknown): IDataObject | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw === 'object' && !Array.isArray(raw)) {
		return Object.keys(raw as IDataObject).length ? (raw as IDataObject) : undefined;
	}
	const text = trimmed(raw);
	if (!text || text === '{}') return undefined;
	const parsed = JSON.parse(text) as unknown;
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Metadata must be a JSON object');
	}
	return Object.keys(parsed as IDataObject).length ? (parsed as IDataObject) : undefined;
}

/** Map the Create parameters to the `v1/tasks/create` body. */
export function buildCreateBody(board: string, title: string, options: IDataObject): IDataObject {
	const body: IDataObject = { board, title };
	if (trimmed(options.body)) body.body = options.body as string;
	if (trimmed(options.assignee)) body.assignee = trimmed(options.assignee);
	if (options.priority !== undefined && options.priority !== null && options.priority !== '') {
		body.priority = Number(options.priority);
	}
	const parents = parseKanbanList(options.parents);
	if (parents.length) body.parents = parents;
	const skills = parseKanbanList(options.skills);
	if (skills.length) body.skills = skills;
	if (trimmed(options.idempotencyKey)) body.idempotency_key = trimmed(options.idempotencyKey);
	if (typeof options.triage === 'boolean') body.triage = options.triage;
	if (
		options.maxRuntimeSeconds !== undefined &&
		options.maxRuntimeSeconds !== null &&
		options.maxRuntimeSeconds !== ''
	) {
		body.max_runtime_seconds = Number(options.maxRuntimeSeconds);
	}
	if (trimmed(options.tenant)) body.tenant = trimmed(options.tenant);
	return body;
}

/** Map the Get Many parameters to the `v1/tasks/list` body. */
export function buildListBody(board: string, limit: number, filters: IDataObject): IDataObject {
	const body: IDataObject = { board };
	if (trimmed(filters.status)) body.status = trimmed(filters.status);
	if (trimmed(filters.assignee)) body.assignee = trimmed(filters.assignee);
	const capped = Math.min(Math.max(Math.trunc(limit) || 1, 1), KANBAN_LIST_MAX_LIMIT);
	body.limit = capped;
	return body;
}

/** Collect the per-action fields for `v1/tasks/action`. */
function buildActionBody(
	this: IExecuteFunctions,
	operation: string,
	board: string,
	taskId: string,
	i: number,
): { body: IDataObject; ctx: KanbanBridgeErrorContext } {
	const action = KANBAN_ACTIONS[operation];
	const body: IDataObject = { board, task_id: taskId, action };
	const ctx: KanbanBridgeErrorContext = { board, taskId, action };

	switch (operation) {
		case 'complete': {
			const options = this.getNodeParameter('completeOptions', i, {}) as IDataObject;
			if (trimmed(options.summary)) body.summary = options.summary as string;
			if (trimmed(options.result)) body.result = options.result as string;
			let metadata: IDataObject | undefined;
			try {
				metadata = parseMetadata(options.metadata);
			} catch (error) {
				throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: i });
			}
			if (metadata) body.metadata = metadata;
			break;
		}
		case 'requestChanges':
		case 'block':
			body.reason = requiredString.call(this, 'reason', 'Reason', i);
			break;
		case 'assign': {
			const assignee = requiredString.call(this, 'assignee', 'Assignee', i);
			body.assignee = assignee;
			ctx.assignee = assignee;
			break;
		}
		case 'reprioritize': {
			const priority = this.getNodeParameter('priority', i, 0);
			const value = Number(priority);
			if (!Number.isFinite(value) || !Number.isInteger(value)) {
				throw new NodeOperationError(this.getNode(), 'Priority must be a whole number', {
					itemIndex: i,
				});
			}
			body.priority = value;
			break;
		}
		case 'edit': {
			const fields = this.getNodeParameter('editFields', i, {}) as IDataObject;
			if (trimmed(fields.title)) body.title = trimmed(fields.title);
			if (trimmed(fields.body)) body.body = fields.body as string;
			if (body.title === undefined && body.body === undefined) {
				throw new NodeOperationError(this.getNode(), 'Edit needs a Title or a Body', {
					itemIndex: i,
					description: 'Add at least one field under Fields to Edit.',
				});
			}
			break;
		}
		default:
			break;
	}

	return { body, ctx };
}

export async function executeKanbanTask(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const route = KANBAN_ROUTES[operation];
	if (!route) {
		throw new NodeOperationError(
			this.getNode(),
			`Unsupported Kanban Task operation: ${operation}`,
			{
				itemIndex: i,
			},
		);
	}
	const board = requiredString.call(this, 'board', 'Board', i);

	if (operation === 'create') {
		const title = requiredString.call(this, 'title', 'Title', i);
		const options = this.getNodeParameter('createOptions', i, {}) as IDataObject;
		const body = buildCreateBody(board, title, options);
		const ctx: KanbanBridgeErrorContext = {
			board,
			action: 'create',
			assignee: typeof body.assignee === 'string' ? body.assignee : undefined,
		};
		const response = await kanbanBridgeRequest.call(this, route, body, i, ctx);
		return [{ json: response }];
	}

	if (operation === 'getAll') {
		const limit = this.getNodeParameter('limit', i, 50) as number;
		const filters = this.getNodeParameter('listFilters', i, {}) as IDataObject;
		const response = await kanbanBridgeRequest.call(
			this,
			route,
			buildListBody(board, limit, filters),
			i,
			{ board, action: 'list' },
		);
		const tasks = Array.isArray(response.tasks) ? (response.tasks as IDataObject[]) : [];
		return tasks.map((task) => ({ json: task }));
	}

	const taskId = requiredString.call(this, 'taskId', 'Task ID', i);

	if (operation === 'get') {
		const response = await kanbanBridgeRequest.call(this, route, { board, task_id: taskId }, i, {
			board,
			taskId,
			action: 'get',
		});
		return [{ json: response }];
	}

	if (operation === 'comment') {
		const comment = requiredString.call(this, 'body', 'Comment', i);
		const response = await kanbanBridgeRequest.call(
			this,
			route,
			{ board, task_id: taskId, body: comment },
			i,
			{ board, taskId, action: 'comment' },
		);
		return [{ json: response }];
	}

	const { body, ctx } = buildActionBody.call(this, operation, board, taskId, i);
	const response = await kanbanBridgeRequest.call(this, route, body, i, ctx);
	return [{ json: response }];
}
