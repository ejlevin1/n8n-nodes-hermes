import type { INodeProperties } from 'n8n-workflow';
import { modelOptionFields, timeoutOption } from '../../helpers/modelOptions';

const show = (operation: string[]) => ({ show: { resource: ['session'], operation } });

/** Sources Hermes accepts when creating a session (anything else becomes `api_server`). */
const sourceOptions = [
	{ name: 'API Server', value: 'api_server' },
	{ name: 'Browser', value: 'hermes_browser' },
	{ name: 'CLI', value: 'cli' },
	{ name: 'Dashboard', value: 'dashboard' },
	{ name: 'Desktop', value: 'desktop' },
	{ name: 'Discord', value: 'discord' },
	{ name: 'Slack', value: 'slack' },
	{ name: 'Telegram', value: 'telegram' },
];

const reasoningEffortField = modelOptionFields.find((f) => f.name === 'reasoningEffort');

export const sessionOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['session'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			description: 'Create an empty session',
			action: 'Create a session',
		},
		{
			name: 'Delete',
			value: 'delete',
			description: 'Delete a session and its transcript',
			action: 'Delete a session',
		},
		{
			name: 'Fork',
			value: 'fork',
			description:
				'Branch a session into a new one with a copy of its messages (the original is ended as "branched")',
			action: 'Fork a session',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Get a session',
			action: 'Get a session',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'List sessions, most recently active first',
			action: 'Get many sessions',
		},
		{
			name: 'Get Messages',
			value: 'getMessages',
			description: 'Get the messages of a session',
			action: 'Get session messages',
		},
		{
			name: 'Send Message',
			value: 'sendMessage',
			description:
				'Run one agent turn in an existing session (create it first) and wait for the reply. History is kept by the session.',
			action: 'Send a message to a session',
		},
		{
			name: 'Set Model',
			value: 'setModel',
			description: 'Lock the session to a model and/or provider for future turns',
			action: 'Set the session model',
		},
		{
			name: 'Update',
			value: 'update',
			description: 'Update session metadata such as title or pinned state',
			action: 'Update a session',
		},
	],
	default: 'sendMessage',
};

export const sessionFields: INodeProperties[] = [
	{
		displayName: 'Session ID',
		name: 'sessionId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show([
			'delete',
			'fork',
			'get',
			'getMessages',
			'sendMessage',
			'setModel',
			'update',
		]),
		description:
			'ID of an existing Hermes session (from Create, Get Many or a chat response). Send Message fails if the session does not exist; to start a conversation by ID instead, use Chat › Send Message with Options › Session ID.',
	},

	// ---- Get Many ----
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: show(['getAll', 'getMessages']),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 200 },
		default: 50,
		displayOptions: { show: { resource: ['session'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll']),
		options: [
			{
				displayName: 'Include Child Sessions',
				name: 'includeChildren',
				type: 'boolean',
				default: false,
				description: 'Whether to include child sessions (for example subagent sessions)',
			},
			{
				displayName: 'Include Hidden',
				name: 'includeHidden',
				type: 'boolean',
				default: false,
				description: 'Whether to include hidden sessions. Only honoured together with Title.',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'Number of sessions to skip',
			},
			{
				displayName: 'Source',
				name: 'source',
				type: 'string',
				default: '',
				placeholder: 'e.g. api_server, telegram, cli',
				description: 'Only return sessions from this source',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'Only return sessions whose title matches exactly',
			},
		],
	},

	// ---- Get Messages ----
	{
		displayName: 'Limit',
		name: 'messageLimit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 500 },
		default: 50,
		displayOptions: {
			show: { resource: ['session'], operation: ['getMessages'], returnAll: [false] },
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Options',
		name: 'messageOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['getMessages']),
		options: [
			{
				displayName: 'Include Compacted',
				name: 'includeCompacted',
				type: 'boolean',
				default: false,
				description: 'Whether to include messages that were compacted away by context compression',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'Number of messages to skip',
			},
			{
				displayName: 'Order',
				name: 'order',
				type: 'options',
				default: 'oldest',
				options: [
					{ name: 'Latest', value: 'latest', description: 'The most recent messages' },
					{ name: 'Oldest First', value: 'oldest' },
				],
				description:
					'Which end of the transcript to read from. Return All always reads oldest first.',
			},
		],
	},

	// ---- Create ----
	{
		displayName: 'Additional Fields',
		name: 'createFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['create']),
		options: [
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				default: '',
				description: 'Session ID to use. Leave empty to let Hermes generate one.',
			},
			...modelOptionFields,
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				default: 'api_server',
				options: sourceOptions,
				description: 'Surface the session is attributed to',
			},
			{
				displayName: 'System Prompt',
				name: 'systemPrompt',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'System prompt stored with the session',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'Session title (must be unique)',
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
				displayName: 'Archived',
				name: 'archived',
				type: 'boolean',
				default: false,
				description: 'Whether the session is archived',
			},
			{
				displayName: 'End Reason',
				name: 'endReason',
				type: 'string',
				default: '',
				placeholder: 'e.g. completed',
				description: 'End the session with this reason',
			},
			{
				displayName: 'Hidden',
				name: 'hidden',
				type: 'boolean',
				default: false,
				description: 'Whether the session is hidden from session lists',
			},
			{
				displayName: 'Pinned',
				name: 'pinned',
				type: 'boolean',
				default: false,
				description: 'Whether the session is pinned (pinning also un-hides it)',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'New session title. Empty clears it.',
			},
			{
				displayName: 'Unread',
				name: 'unread',
				type: 'boolean',
				default: false,
				description: 'Whether the session is marked unread',
			},
		],
	},

	// ---- Fork ----
	{
		displayName: 'Options',
		name: 'forkOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['fork']),
		options: [
			{
				displayName: 'New Session ID',
				name: 'id',
				type: 'string',
				default: '',
				description: 'ID for the forked session. Leave empty to let Hermes generate one.',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'Title for the forked session. Defaults to the next title in the lineage.',
			},
		],
	},

	// ---- Send Message ----
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: show(['sendMessage']),
		description: 'The user message to send to the agent',
	},
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: show(['sendMessage']),
		description: 'Whether to return a simplified version of the response instead of the raw data',
	},
	{
		displayName: 'Options',
		name: 'chatOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['sendMessage']),
		options: [
			...modelOptionFields,
			{
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				default: '',
				description:
					'Scopes long-term memory to a channel or user (sent as <code>X-Hermes-Session-Key</code>)',
			},
			{
				displayName: 'System Message',
				name: 'systemMessage',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Extra system instructions for this turn only',
			},
			timeoutOption,
		],
	},

	// ---- Set Model ----
	{
		displayName: 'Model',
		name: 'model',
		type: 'string',
		default: '',
		placeholder: 'e.g. anthropic/claude-sonnet-4',
		displayOptions: show(['setModel']),
		description: 'Model to lock the session to. Set Model, Provider or both.',
	},
	{
		displayName: 'Provider',
		name: 'provider',
		type: 'string',
		default: '',
		placeholder: 'e.g. openrouter',
		displayOptions: show(['setModel']),
		description: 'Inference provider to lock the session to (as configured in Hermes)',
	},
	{
		displayName: 'Options',
		name: 'modelLockOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['setModel']),
		options: reasoningEffortField ? [reasoningEffortField] : [],
	},
];
