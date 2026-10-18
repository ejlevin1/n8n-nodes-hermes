import type { INodeProperties } from 'n8n-workflow';
import { modelOptionFields } from '../../helpers/modelOptions';

export const RETENTION_NOTE =
	'Hermes keeps run status in memory for 1 hour after its last update. Runs started with an Idempotency-Key are kept durably for 24 hours, and a gateway restart turns unfinished ones into <code>interrupted</code>.';

export const APPROVAL_TIMEOUT_NOTE =
	'Hermes auto-denies a pending approval after <code>approvals.timeout</code> (300 seconds by default), so respond promptly.';

const show = (operations: string[]) => ({ show: { resource: ['run'], operation: operations } });

const RUN_ID_OPERATIONS = [
	'getStatus',
	'waitForCompletion',
	'respondToApproval',
	'respondToClarification',
	'steer',
	'stop',
	'resolveUnknown',
];
const START_OPERATIONS = ['start', 'startAndWait'];
const WAIT_OPERATIONS = ['waitForCompletion', 'startAndWait'];

export const runOperationField: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['run'] } },
	options: [
		{
			name: 'Get Status',
			value: 'getStatus',
			description: 'Get the current status of a run',
			action: 'Get run status',
		},
		{
			name: 'Resolve Unknown',
			value: 'resolveUnknown',
			description:
				'Acknowledge a run in status "unknown" (its gateway lost track of it) so later turns on the session can proceed',
			action: 'Resolve an unknown run',
		},
		{
			name: 'Respond to Approval',
			value: 'respondToApproval',
			description: 'Approve or deny a command the run is waiting on. ,.',
			action: 'Respond to a run approval',
		},
		{
			name: 'Respond to Clarification',
			value: 'respondToClarification',
			description: 'Answer a clarifying question the agent asked during a run',
			action: 'Respond to a run clarification',
		},
		{
			name: 'Start',
			value: 'start',
			description: 'Start an asynchronous agent run and return its run ID immediately',
			action: 'Start a run',
		},
		{
			name: 'Start and Wait',
			value: 'startAndWait',
			description: 'Start a run, then wait until it finishes or needs an approval or clarification',
			action: 'Start a run and wait for it',
		},
		{
			name: 'Steer',
			value: 'steer',
			description: 'Send extra guidance to a run that is currently running',
			action: 'Steer a run',
		},
		{
			name: 'Stop',
			value: 'stop',
			description: 'Stop (interrupt) a run',
			action: 'Stop a run',
		},
		{
			name: 'Wait for Completion',
			value: 'waitForCompletion',
			description: 'Poll a run until it finishes or needs an approval or clarification',
			action: 'Wait for a run to complete',
		},
	],
	default: 'startAndWait',
};

export const runFields: INodeProperties[] = [
	// ---------------- Start / Start and Wait ----------------
	{
		displayName: 'Input',
		name: 'input',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: show(START_OPERATIONS),
		description: 'The task or message for the agent',
	},
	{
		displayName: 'Options',
		name: 'startOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(START_OPERATIONS),
		options: [
			{
				displayName: 'Author ID',
				name: 'authorId',
				type: 'string',
				default: '',
				description:
					'ID of the person (or bot) this input comes from. Only labels the turn for memory.',
			},
			{
				displayName: 'Author Name',
				name: 'authorName',
				type: 'string',
				default: '',
				description: 'Display name of the author of this input. Only labels the turn for memory.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Sent as the <code>Idempotency-Key</code> header so a retry replays the same run instead of starting a new one. Leave empty to generate a key from the execution, node, run and item. 1–255 printable ASCII characters.',
			},
			{
				displayName: 'Instructions',
				name: 'instructions',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Extra system instructions for this run',
			},
			...modelOptionFields,
			{
				displayName: 'Previous Response ID',
				name: 'previousResponseId',
				type: 'string',
				default: '',
				description: 'Continue from a stored Responses API result',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				description: 'Run inside an existing Hermes session (its history is loaded)',
			},
			{
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				default: '',
				description:
					'Scopes long-term memory to a channel or user (sent as <code>X-Hermes-Session-Key</code>)',
			},
		],
	},

	// ---------------- Run ID ----------------
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. run_0123456789abcdef',
		displayOptions: show(RUN_ID_OPERATIONS),
		description: 'ID of the run, as returned by Start. ,.',
	},

	// ---------------- Wait ----------------
	{
		displayName: 'Poll Interval (Seconds)',
		name: 'pollInterval',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 2,
		displayOptions: show(WAIT_OPERATIONS),
		description: 'How often to check the run status',
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'waitTimeout',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 5,
		displayOptions: show(WAIT_OPERATIONS),
		description:
			'How long to wait before giving up. The run keeps going on the server; use Wait for Completion again to resume waiting.',
	},
	{
		displayName: 'Error on Timeout',
		name: 'errorOnTimeout',
		type: 'boolean',
		default: false,
		displayOptions: show(WAIT_OPERATIONS),
		description:
			'Whether to fail when the timeout is reached. When off, the node outputs <code>{run_id, status, timedOut: true}</code>.',
	},
	{
		displayName: `Waiting stops when the run finishes (completed, failed, cancelled, interrupted) or needs action (an approval, a clarification, or status "unknown"); the output then has <code>needsAction: true</code> and a <code>pendingAction</code> object. ${RETENTION_NOTE}`,
		name: 'waitNotice',
		type: 'notice',
		default: '',
		displayOptions: show(WAIT_OPERATIONS),
	},

	// ---------------- Respond to Approval ----------------
	{
		displayName: APPROVAL_TIMEOUT_NOTE,
		name: 'approvalNotice',
		type: 'notice',
		default: '',
		displayOptions: show(['respondToApproval']),
	},
	{
		displayName: 'Choice',
		name: 'choice',
		type: 'options',
		required: true,
		default: 'once',
		displayOptions: show(['respondToApproval']),
		options: [
			{ name: 'Always', value: 'always', description: 'Approve now and permanently allow it' },
			{ name: 'Deny', value: 'deny', description: 'Refuse the command' },
			{ name: 'Once', value: 'once', description: 'Approve this one time' },
			{
				name: 'Session',
				value: 'session',
				description: 'Approve for the rest of this session',
			},
		],
		description:
			'How to answer. It is checked against the choices Hermes allows for this approval (some approvals only allow Once or Deny).',
	},
	{
		displayName: 'Options',
		name: 'approvalOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['respondToApproval']),
		options: [
			{
				displayName: 'Request ID',
				name: 'requestId',
				type: 'string',
				default: '',
				description:
					'Answer a specific approval (its <code>pendingAction.requestId</code>). Required when several approvals are pending. Defaults to the pending one.',
			},
			{
				displayName: 'Resolve All (Legacy Mode Only)',
				name: 'resolveAll',
				type: 'boolean',
				default: false,
				description:
					'Whether to apply the choice to every pending approval of the run. Only used by gateways without canonical sessions.',
			},
		],
	},

	// ---------------- Respond to Clarification ----------------
	{
		displayName: 'Answer',
		name: 'answer',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		displayOptions: show(['respondToClarification']),
		description: 'Your answer to the agent’s question',
	},
	{
		displayName: 'Options',
		name: 'clarifyOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['respondToClarification']),
		options: [
			{
				displayName: 'Request ID',
				name: 'requestId',
				type: 'string',
				default: '',
				description:
					'Answer a specific question (its <code>pendingAction.requestId</code>). Defaults to the pending one.',
			},
		],
	},

	// ---------------- Steer ----------------
	{
		displayName: 'Guidance',
		name: 'steerInput',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		displayOptions: show(['steer']),
		description:
			'Text injected into the running agent. Only accepted while the run status is <code>running</code>.',
	},
];
