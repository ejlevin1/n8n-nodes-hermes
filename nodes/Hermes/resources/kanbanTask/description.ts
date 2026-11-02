import type { INodeProperties } from 'n8n-workflow';
import {
	KANBAN_GET_MAX_RUNS,
	KANBAN_LIST_MAX_LIMIT,
	KANBAN_STATUSES,
} from '../../helpers/kanbanBridge';

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
	'rejectCase',
	'reprioritize',
	'requestChanges',
	'requestChangesHuman',
	'requestReview',
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
			description: `Get a task with its comments, its last 50 events and its latest ${KANBAN_GET_MAX_RUNS} runs, each with the run outcome, summary and metadata`,
			action: 'Get a kanban task',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			description: `List the tasks on a board, highest priority first and oldest first within a priority (at most ${KANBAN_LIST_MAX_LIMIT})`,
			action: 'Get many kanban tasks',
		},
		{
			name: 'Reject Case',
			value: 'rejectCase',
			description:
				'Reject a task and its sub-tree: archive every not-done descendant first, then the task, recording the reason as a comment',
			action: 'Reject a kanban case',
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
			name: 'Request Changes (Human)',
			value: 'requestChangesHuman',
			description:
				'Relay a human verdict on a review task: claim the review as this token, then send the task back to its implementer with a reason',
			action: 'Request changes on a kanban task for a human',
		},
		{
			name: 'Request Review',
			value: 'requestReview',
			description:
				'Move a task in ready or running to review, recording a summary and metadata on the review run',
			action: 'Request review of a kanban task',
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
				typeOptions: { minValue: 1, numberPrecision: 0 },
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
				typeOptions: { numberPrecision: 0 },
				default: 0,
				description: priorityDescription,
			},
			{
				displayName: 'Put Into Review',
				name: 'putIntoReview',
				type: 'boolean',
				default: false,
				description:
					'Whether to create the task already in <code>review</code> instead of queueing it — a gate card waiting for a human decision. Sent as <code>initial_review</code>, so the token needs both <code>create</code> and <code>request_review</code> in its scopes; if the bridge refuses the review it deletes the task again and nothing is left behind.',
			},
			{
				displayName: 'Review Metadata',
				name: 'reviewMetadata',
				type: 'json',
				default: '{}',
				description:
					'JSON object stored as the review run metadata, for example a kanban-tasks <code>hitl</code> descriptor. Needs Put Into Review.',
			},
			{
				displayName: 'Review Summary',
				name: 'reviewSummary',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description:
					'Short summary recorded on the review this task opens, shown on the board and sent with the review_requested event. Needs Put Into Review.',
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

	// Request Review
	{
		displayName: 'Options',
		name: 'requestReviewOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['requestReview']),
		options: [
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description:
					'JSON object stored as the review run metadata — where a kanban-tasks <code>hitl</code> descriptor goes. The Get operation returns it under <code>runs[].metadata</code>.',
			},
			{
				displayName: 'Reviewer',
				name: 'reviewer',
				type: 'string',
				default: '',
				placeholder: 'deal-analyst',
				description:
					'Hermes profile the review is handed to. It also becomes the task assignee, so the token must have it in its scopes. Leave it empty for a gate card that waits for a human.',
			},
			{
				displayName: 'Summary',
				name: 'summary',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description:
					'Short handoff summary shown on the board and sent with the review_requested event',
			},
		],
	},

	// Request Changes (Human)
	{
		displayName:
			'<b>Request Changes (Human)</b> claims the review as this token first, so it also works on a review task with no active reviewer run — the case where plain <b>Request Changes</b> returns 409. It needs a task in <code>review</code> whose review handoff records an implementer; a gate card has none, so use <b>Reject Case</b> or <b>Complete (Approve)</b> on those.',
		name: 'requestChangesHumanNotice',
		type: 'notice',
		default: '',
		displayOptions: show(['requestChangesHuman']),
	},
	{
		displayName: 'Options',
		name: 'requestChangesHumanOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['requestChangesHuman']),
		options: [
			{
				displayName: 'Actor',
				name: 'actor',
				type: 'string',
				default: '',
				placeholder: 'alex@example.invalid',
				description:
					'Human this verdict is relayed for. The bridge prefixes it onto the reason so the implementer sees who asked; the authenticated author stays <code>n8n:&lt;token label&gt;</code>.',
			},
		],
	},

	// Reject Case
	{
		displayName:
			'<b>Reject Case</b> archives the whole sub-tree: every not-done descendant first, deepest first, and only then this task. That order is the point — archiving a parent on its own <i>releases</i> its waiting children to be worked. Descendants already <code>done</code> are kept, and the response lists what was archived under <code>archived_descendants</code>.',
		name: 'rejectCaseNotice',
		type: 'notice',
		default: '',
		displayOptions: show(['rejectCase']),
	},

	// Request Changes / Request Changes (Human) / Block / Reject Case
	{
		displayName: 'Reason',
		name: 'reason',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		displayOptions: show(['requestChanges', 'requestChangesHuman', 'block', 'rejectCase']),
		description:
			'Why the task is going back (Request Changes), being blocked (Block) or being rejected (Reject Case). It is stored on the event and delivered to the Hermes Trigger; Reject Case also records it as a comment on the task.',
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
		typeOptions: { numberPrecision: 0 },
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
