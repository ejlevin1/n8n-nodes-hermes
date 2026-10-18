import type { INodeProperties } from 'n8n-workflow';

const show = (operation: string[]) => ({ show: { resource: ['job'], operation } });

const scheduleDescription =
	'When to run: an interval (<code>30m</code>, <code>every 2h</code>), a cron expression (<code>0 9 * * *</code>), a phrase (<code>every monday 9am</code>) or an ISO-8601 timestamp for a one-off run';

const deliverDescription =
	'Where the output is posted: <code>local</code> (save only), <code>all</code> (every home channel), <code>bot-chat</code>, or <code>platform:chat_id[:thread_id]</code> (e.g. <code>telegram:-100123:17</code>). Comma-combine targets.';

const skillsDescription = 'Comma-separated skill names to load for each run';

const promptDescription =
	'What the agent should do on each run (max 5000 characters). Hermes scans prompts for injection and rejects suspicious ones.';

export const jobOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['job'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			description: 'Create a scheduled agent job',
			action: 'Create a cron job',
		},
		{
			name: 'Delete',
			value: 'delete',
			description: 'Delete a cron job',
			action: 'Delete a cron job',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Get a cron job',
			action: 'Get a cron job',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'List cron jobs',
			action: 'Get many cron jobs',
		},
		{
			name: 'Pause',
			value: 'pause',
			description: 'Pause a cron job',
			action: 'Pause a cron job',
		},
		{
			name: 'Resume',
			value: 'resume',
			description: 'Resume a paused cron job',
			action: 'Resume a cron job',
		},
		{
			name: 'Run Now',
			value: 'run',
			description: 'Schedule a cron job to run on the next scheduler tick',
			action: 'Run a cron job now',
		},
		{
			name: 'Update',
			value: 'update',
			description: 'Update a cron job (use Pause/Resume to pause it)',
			action: 'Update a cron job',
		},
	],
	default: 'getAll',
};

export const jobFields: INodeProperties[] = [
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 3f2a9c1b7d4e',
		displayOptions: show(['delete', 'get', 'pause', 'resume', 'run', 'update']),
		description: 'ID of the cron job (12 lowercase hex characters)',
	},

	// ---- Get Many ----
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: show(['getAll']),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: ['job'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Include Disabled',
		name: 'includeDisabled',
		type: 'boolean',
		default: false,
		displayOptions: show(['getAll']),
		description: 'Whether to include disabled jobs',
	},

	// ---- Create ----
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(['create']),
		description: 'Job name (max 200 characters)',
	},
	{
		displayName: 'Schedule',
		name: 'schedule',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. every 1h',
		displayOptions: show(['create']),
		description: scheduleDescription,
	},
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		displayOptions: show(['create']),
		description: `${promptDescription} Can be empty when skills are set`,
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['create']),
		options: [
			{
				displayName: 'Deliver',
				name: 'deliver',
				type: 'string',
				default: 'local',
				description: deliverDescription,
			},
			{
				displayName: 'Paused',
				name: 'paused',
				type: 'boolean',
				default: false,
				description: 'Whether to create the job in a paused state',
			},
			{
				displayName: 'Paused Reason',
				name: 'pausedReason',
				type: 'string',
				default: '',
				description: 'Note stored with a paused job',
			},
			{
				displayName: 'Repeat',
				name: 'repeat',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1,
				description: 'Stop after this many runs. Leave unset to repeat forever.',
			},
			{
				displayName: 'Skills',
				name: 'skills',
				type: 'string',
				default: '',
				placeholder: 'e.g. web-research, summarize',
				description: skillsDescription,
			},
		],
	},

	// ---- Update ----
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['update']),
		options: [
			{
				displayName: 'Deliver',
				name: 'deliver',
				type: 'string',
				default: 'local',
				description: deliverDescription,
			},
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'boolean',
				default: true,
				description: 'Whether the job is enabled. To pause a job, prefer the Pause operation.',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Job name (max 200 characters)',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: promptDescription,
			},
			{
				displayName: 'Repeat',
				name: 'repeat',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1,
				description: 'Stop after this many runs',
			},
			{
				displayName: 'Schedule',
				name: 'schedule',
				type: 'string',
				default: '',
				placeholder: 'e.g. every 1h',
				description: scheduleDescription,
			},
			{
				displayName: 'Skills',
				name: 'skills',
				type: 'string',
				default: '',
				placeholder: 'e.g. web-research, summarize',
				description: `${skillsDescription}. Empty clears them.`,
			},
		],
	},

	// ---- Run Now ----
	{
		displayName: 'Options',
		name: 'runOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['run']),
		options: [
			{
				displayName: 'Extra Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description:
					'Extra context for this one run only (max 5000 characters); the stored prompt is unchanged',
			},
		],
	},
];
