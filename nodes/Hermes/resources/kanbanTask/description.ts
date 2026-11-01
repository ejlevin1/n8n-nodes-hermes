import type { INodeProperties } from 'n8n-workflow';
import { KANBAN_LIST_MAX_LIMIT, KANBAN_STATUSES } from '../../helpers/kanbanBridge';

const show = (operation: string[]) => ({ show: { resource: ['kanbanTask'], operation } });

/** Operations that address one existing task, i.e. everything except Create and Get Many. */
export const TASK_ID_OPERATIONS = [
	'archive',
	'assign',
	'block',
	'comment',
	'complete',
	'edit',
	'get',
	'reprioritize',
	'requestChanges',
	'unblock',
];

const assigneeDescription =
	'Hermes profile that owns the task (e.g. <code>deal-analyst</code>). The token must have this assignee in its scopes.';

const priorityDescription =
	'Dispatch priority as a whole number; higher goes first (default 0, ordered <code>priority DESC, created_at ASC</code>)';

export const kanbanTaskOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['kanbanTask'] } },
	options: [
		{
			name: 'Archive',
			value: 'archive',
			description: 'Archive a task so it leaves the board',
			action: 'Archive a kanban task',
		},
		{
			name: 'Assign',
			value: 'assign',
			description: 'Move a task to another assignee',
			action: 'Assign a kanban task',
		},
		{
			name: 'Block',
			value: 'block',
			description: 'Move a task to blocked with a reason',
			action: 'Block a kanban task',
		},
		{
			name: 'Comment',
			value: 'comment',
			description: 'Add a comment to a task',
			action: 'Comment on a kanban task',
		},
		{
			name: 'Complete (Approve)',
			value: 'complete',
			description:
				'Complete a task. From review this is the human approval; it also works from other open statuses the board allows.',
			action: 'Complete a kanban task',
		},
		{
			name: 'Create',
			value: 'create',
			description: 'Create a task on a board',
			action: 'Create a kanban task',
		},
		{
			name: 'Edit',
			value: 'edit',
			description: 'Change a task title or body',
			action: 'Edit a kanban task',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Get a task with its comments, recent events and runs',
			action: 'Get a kanban task',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			description: `List the tasks on a board, newest priority first (at most ${KANBAN_LIST_MAX_LIMIT})`,
			action: 'Get many kanban tasks',
		},
		{
			name: 'Reprioritize',
			value: 'reprioritize',
			description: 'Change the dispatch priority of a task',
			action: 'Reprioritize a kanban task',
		},
		{
			name: 'Request Changes',
			value: 'requestChanges',
			description: 'Send a task in review back for more work, with a reason',
			action: 'Request changes on a kanban task',
		},
		{
			name: 'Unblock',
			value: 'unblock',
			description: 'Return a blocked task to the queue',
			action: 'Unblock a kanban task',
		},
	],
	default: 'create',
};

export const kanbanTaskFields: INodeProperties[] = [
	{
		displayName:
			"These operations go to the <code>kanban-bridge</code> plugin on the Hermes <b>dashboard</b>, not the API gateway. Every mutation is recorded with the author <code>n8n:&lt;token label&gt;</code>, and the credential token's scopes decide which boards and assignees it may touch.",
		name: 'bridgeNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['kanbanTask'] } },
	},
	{
		displayName: 'Board',
		name: 'board',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'acquisitions',
		displayOptions: { show: { resource: ['kanbanTask'] } },
		description:
			'Kanban board the task lives on. Task IDs are per board, and the token is refused (403) for any board outside its scopes.',
	},
	{
		displayName: 'Task ID',
		name: 'taskId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(TASK_ID_OPERATIONS),
		description: 'ID of the task on this board',
	},

	// Create
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'Review the Q3 rent roll',
		displayOptions: show(['create']),
		description: 'One-line summary of the task',
	},
	{
		displayName: 'Options',
		name: 'createOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['create']),
		options: [
			{
				displayName: 'Assignee',
				name: 'assignee',
				type: 'string',
				default: '',
				placeholder: 'deal-analyst',
				description: assigneeDescription,
			},
			{
				displayName: 'Body',
				name: 'body',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Full instructions for the agent that picks the task up',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Reuse an existing non-archived task with the same key instead of creating a duplicate. The response then has <code>created: false</code>.',
			},
			{
				displayName: 'Max Runtime (Seconds)',
				name: 'maxRuntimeSeconds',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1800,
				description:
					'Cap on one worker run before the dispatcher stops it and re-queues the task. Leave unset for the board default.',
			},
			{
				displayName: 'Parents',
				name: 'parents',
				type: 'string',
				default: '',
				placeholder: 'task-1, task-2',
				description:
					'Comma-separated task IDs this task depends on. It waits in <code>todo</code> until they are done.',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'number',
				default: 0,
				description: priorityDescription,
			},
			{
				displayName: 'Skills',
				name: 'skills',
				type: 'string',
				default: '',
				placeholder: 'github-code-review, blogwatcher',
				description: 'Comma-separated Hermes skill names to load for the task',
			},
			{
				displayName: 'Tenant',
				name: 'tenant',
				type: 'string',
				default: '',
				description: 'Tenant the task is recorded under, when the board is multi-tenant',
			},
			{
				displayName: 'Triage',
				name: 'triage',
				type: 'boolean',
				default: false,
				description:
					'Whether to park the task in <code>triage</code> for a human to sort instead of queueing it',
			},
		],
	},

	// Get Many
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: KANBAN_LIST_MAX_LIMIT },
		default: 50,
		displayOptions: show(['getAll']),
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'listFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll']),
		options: [
			{
				displayName: 'Assignee',
				name: 'assignee',
				type: 'string',
				default: '',
				placeholder: 'deal-analyst',
				description: 'Only return tasks assigned to this Hermes profile',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'ready',
				description: 'Only return tasks in this status',
				options: KANBAN_STATUSES.map((status) => ({
					name: status.charAt(0).toUpperCase() + status.slice(1),
					value: status,
				})),
			},
		],
	},

	// Comment
	{
		displayName: 'Comment',
		name: 'body',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: show(['comment']),
		description: 'Comment text. It is recorded with the token label as the author.',
	},

	// Complete (Approve)
	{
		displayName: 'Options',
		name: 'completeOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['complete']),
		options: [
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description: 'JSON object stored with the completion, for your own bookkeeping',
			},
			{
				displayName: 'Result',
				name: 'result',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Full result text recorded on the task',
			},
			{
				displayName: 'Summary',
				name: 'summary',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description: 'Short handoff summary shown on the board and sent with the completed event',
			},
		],
	},

	// Request Changes / Block
	{
		displayName: 'Reason',
		name: 'reason',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		displayOptions: show(['requestChanges', 'block']),
		description:
			'Why the task is going back / being blocked. It is stored on the event and delivered to the Hermes Trigger.',
	},

	// Assign
	{
		displayName: 'Assignee',
		name: 'assignee',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'deal-analyst',
		displayOptions: show(['assign']),
		description: assigneeDescription,
	},

	// Reprioritize
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: show(['reprioritize']),
		description: priorityDescription,
	},

	// Edit
	{
		displayName: 'Fields to Edit',
		name: 'editFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['edit']),
		description: 'Set at least one field. Fields left out keep their current value.',
		options: [
			{
				displayName: 'Body',
				name: 'body',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Replacement instructions for the task',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'Replacement one-line summary',
			},
		],
	},
];
