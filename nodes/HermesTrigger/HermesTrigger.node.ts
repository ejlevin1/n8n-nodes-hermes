import {
	NodeConnectionTypes,
	NodeOperationError,
	type ICredentialTestFunctions,
	type ICredentialsDecrypted,
	type IDataObject,
	type IHookFunctions,
	type INodeCredentialTestResult,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';

import {
	DEFAULT_EVENTS,
	DEFAULT_SIGNING_ENV_VAR,
	HERMES_TRIGGER_EVENTS,
	KANBAN_ANY_EVENT,
	KANBAN_BRIDGE_EVENTS,
	KANBAN_EVENTS,
	TOOL_SCOPED_EVENTS,
	buildKanbanTargetsYaml,
	buildOutboundYaml,
	getFilterRejection,
	getHeader,
	normalizeEvent,
	parseList,
	type HeaderBag,
} from './events';
import { DEFAULT_MAX_EVENT_AGE_MS, isStale, verifySignature } from './verifySignature';

const CREDENTIAL_NAME = 'hermesOutboundWebhookApi';
const RECOMMENDED_SECRET_LENGTH = 32;

const WEBHOOK_URL_PLACEHOLDER = '<this node’s Production URL>';

const SETUP_YAML = buildOutboundYaml(WEBHOOK_URL_PLACEHOLDER, DEFAULT_EVENTS);

const KANBAN_TARGETS_YAML = buildKanbanTargetsYaml(WEBHOOK_URL_PLACEHOLDER, [KANBAN_ANY_EVENT]);

const SETUP_NOTICE =
	'<b>Setup:</b> Hermes outbound hooks are configured only in <code>~/.hermes/config.yaml</code>. ' +
	'Add the block below, replacing <code>url</code> with the Production URL shown above and making ' +
	'<code>events</code> list exactly the events you select here (unlisted events are never sent; ' +
	'selected but unlisted events never arrive). Put the credential’s Signing Secret in ' +
	`<code>~/.hermes/.env</code> as <code>${DEFAULT_SIGNING_ENV_VAR}=…</code>, then restart Hermes ` +
	'(gateway or CLI session). <b>Kanban bridge events</b> (<code>kanban_task_*</code>) do not come ' +
	'from <code>hooks.outbound</code> at all — select one and a second notice shows the ' +
	'<code>targets</code> block they need instead.' +
	`<pre>${SETUP_YAML}</pre>`;

const TOOL_EVENTS_NOTICE =
	'Tool events fire for every tool call. To cut traffic, add a Hermes-side <code>matcher</code> ' +
	'regex to the hook entry, e.g. <code>matcher: "terminal|delegate_task"</code>. The Tool Name ' +
	'filter below is applied again in n8n.';

const APPROVAL_EVENTS_NOTICE =
	'Approval and human-input events carry <code>session_key</code>, not a run ID, so they cannot be ' +
	'correlated with <code>/v1/runs</code>. For API-driven runs, use the Hermes node’s Run ' +
	'operations (Wait for Completion and Respond to Approval) instead. Hermes auto-denies pending ' +
	'approvals after <code>approvals.timeout</code> (default 300 s).';

const KANBAN_EVENTS_NOTICE =
	'Task-scoped Kanban events carry their task coordinates in <code>extra</code> ' +
	'(<code>task_id</code>, <code>board</code>, <code>assignee</code>, <code>run_id</code>, and for ' +
	'bridge deliveries also <code>event_id</code>, <code>event_kind</code>, <code>title</code>, ' +
	'<code>status</code>, <code>priority</code>, <code>actor</code> and the event’s own ' +
	'<code>payload</code>); <code>board</code> is also surfaced top-level. ' +
	'<code>on_kanban_dispatch_tick</code> is board-scoped and carries no task. Use the Board filter ' +
	'below to watch a single board — prefer it over Profile above, because on bridge deliveries ' +
	'<code>profile</code> is the task’s assignee rather than a Hermes profile, so a Profile ' +
	'filter set to a Hermes profile silently drops every bridge event. Note that ' +
	'<code>on_kanban_task_updated</code> reports <code>changed_fields</code> as field names only, ' +
	'never their values.';

const KANBAN_BRIDGE_NOTICE =
	'<b>Kanban bridge setup:</b> <code>kanban_task_*</code> events are pushed by the ' +
	'<code>kanban-bridge</code> plugin, which tails <code>task_events</code> in the Hermes ' +
	'<b>dashboard</b> process — that is the only way review-requested, changes-requested, ' +
	'archived, unblocked and created ever reach n8n, because Hermes fires no hook for them. They are ' +
	'configured in the <b>default</b> profile’s <code>config.yaml</code> under ' +
	'<code>plugins.entries.kanban-bridge.settings.targets</code>, <i>not</i> ' +
	'<code>hooks.outbound</code>. Paste the block below (replacing <code>url</code> with the ' +
	'Production URL above and narrowing <code>boards</code>), put the credential’s Signing ' +
	`Secret in the default profile’s <code>.env</code> as <code>${DEFAULT_SIGNING_ENV_VAR}=…</code>, ` +
	'then restart the dashboard. Signing is identical to Hermes outbound webhooks, so this node ' +
	'verifies both the same way. Check it end to end with <code>kbctl targets test &lt;name&gt;</code>: ' +
	'that sends a <code>kanban_bridge_ping</code>, which only starts the workflow when <b>Any Kanban ' +
	'Event</b> is selected — otherwise it is acknowledged with HTTP 200 and ignored. The ping ' +
	'carries the target’s board (or <code>*</code> for a wildcard target), so a Board filter may ' +
	'drop it too.' +
	`<pre>${KANBAN_TARGETS_YAML}</pre>`;

function reject(this: IWebhookFunctions, status: number): IWebhookResponseData {
	this.getResponseObject().status(status).end();
	return { noWebhookResponse: true };
}

export class HermesTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Hermes Trigger',
		name: 'hermesTrigger',
		icon: { light: 'file:../../icons/hermes.svg', dark: 'file:../../icons/hermes.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ ($parameter["events"] || []).join(", ") }}',
		description:
			'Starts the workflow when Hermes Agent sends a signed outbound webhook (hooks.outbound) or the kanban-bridge plugin pushes a Kanban event',
		defaults: {
			name: 'Hermes Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'hermesOutboundWebhookApi',
				required: true,
				testedBy: 'hermesOutboundWebhookApiTest',
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'hermes',
			},
		],
		properties: [
			{
				displayName: SETUP_NOTICE,
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: HERMES_TRIGGER_EVENTS,
				default: ['post_llm_call'],
				description:
					'Events that start this workflow. Must match the <code>events</code> list of the matching delivery config: the <code>hooks.outbound</code> entry in config.yaml, or the <code>kanban-bridge</code> target for <code>kanban_task_*</code> events.',
			},
			{
				displayName: 'Profile',
				name: 'profile',
				type: 'string',
				default: '',
				placeholder: 'e.g. coder',
				description:
					'Optional. Only start the workflow for events from this Hermes profile (the event <code>profile</code> field, e.g. <code>default</code>). Other events get HTTP 200 without starting it. Leave empty to accept every profile.',
			},
			{
				displayName: TOOL_EVENTS_NOTICE,
				name: 'toolEventsNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						events: TOOL_SCOPED_EVENTS,
					},
				},
			},
			{
				displayName: KANBAN_EVENTS_NOTICE,
				name: 'kanbanEventsNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						events: KANBAN_EVENTS,
					},
				},
			},
			{
				displayName: KANBAN_BRIDGE_NOTICE,
				name: 'kanbanBridgeNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						events: KANBAN_BRIDGE_EVENTS,
					},
				},
			},
			{
				displayName: APPROVAL_EVENTS_NOTICE,
				name: 'approvalEventsNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						events: [
							'pre_approval_request',
							'post_approval_response',
							'on_human_input_request',
							'on_human_input_resolved',
						],
					},
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				description:
					'Events that do not match are acknowledged with HTTP 200 without starting the workflow. When a filter is set, events that lack the field are dropped.',
				options: [
					{
						displayName: 'Board',
						name: 'boards',
						type: 'string',
						default: '',
						placeholder: 'main, release',
						description:
							'Comma-separated list matched (case-insensitive) against the event board — <code>board</code> on kanban-bridge deliveries, <code>extra.board</code> on Hermes hooks. Events without a board (including the bridge ping) are dropped when this is set.',
					},
					{
						displayName: 'Platform',
						name: 'platforms',
						type: 'string',
						default: '',
						placeholder: 'cron, webhook, api_server',
						description:
							'Comma-separated list matched (case-insensitive) against <code>extra.platform</code>, e.g. cron, webhook, api_server, cli, tui, telegram',
					},
					{
						displayName: 'Session ID',
						name: 'sessionId',
						type: 'string',
						default: '',
						description:
							'Only accept events whose session_id, extra.session_key, extra.parent_session_id or extra.child_session_id equals this value',
					},
					{
						displayName: 'Tool Name',
						name: 'toolName',
						type: 'string',
						default: '',
						placeholder: 'terminal|delegate_task',
						description:
							'Regular expression matched against <code>tool_name</code> (unanchored). An invalid pattern is compared literally.',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Max Event Age (Seconds)',
						name: 'maxEventAge',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 300,
						description: 'Tolerance for Reject Stale Events, in either direction (clock skew)',
					},
					{
						displayName: 'Reject Stale Events',
						name: 'rejectStaleEvents',
						type: 'boolean',
						default: true,
						description:
							'Whether to reject (HTTP 401) events whose signed <code>timestamp</code> is outside the Max Event Age window. Protects against replayed requests.',
					},
					{
						displayName: 'Verify Signature',
						name: 'verifySignature',
						type: 'boolean',
						default: true,
						description:
							'Whether to require a valid <code>X-Hermes-Signature-256</code> header (HMAC-SHA256 of the raw body with the Signing Secret). Unsigned or tampered requests get HTTP 401.',
					},
				],
			},
		],
	};

	methods = {
		credentialTest: {
			async hermesOutboundWebhookApiTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const data = (credential.data ?? {}) as IDataObject;
				const secret = typeof data.secret === 'string' ? data.secret : '';
				const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl.trim() : '';

				if (!secret) {
					return { status: 'Error', message: 'Signing Secret is empty' };
				}
				const weak =
					secret.length < RECOMMENDED_SECRET_LENGTH
						? ` Warning: the Signing Secret is shorter than ${RECOMMENDED_SECRET_LENGTH} characters; use a longer random value.`
						: '';

				if (!baseUrl) {
					return {
						status: 'OK',
						message: `Signing Secret is set (no Base URL to check).${weak}`,
					};
				}

				try {
					// ICredentialTestFunctions only exposes the legacy `request` helper (no httpRequest).
					// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
					await this.helpers.request({
						method: 'GET',
						uri: `${baseUrl.replace(/\/+$/, '')}/health`,
						json: true,
						timeout: 10000,
					});
				} catch (error) {
					return {
						status: 'Error',
						message: `Could not reach ${baseUrl}/health: ${(error as Error).message}. The Base URL is optional; clear it if Hermes runs CLI-only without a gateway.`,
					};
				}

				return {
					status: 'OK',
					message: `Hermes is reachable and the Signing Secret is set.${weak}`,
				};
			},
		},
	};

	webhookMethods = {
		default: {
			// Hermes outbound hooks can only be configured in ~/.hermes/config.yaml (no API), so there
			// is nothing to register remotely. Reporting "exists" stops n8n from calling create().
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			// No-op: the user pastes the hooks.outbound block shown in the node's setup notice.
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			// No-op: remove the hooks.outbound entry from config.yaml to stop deliveries.
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const headers = this.getHeaderData() as HeaderBag;
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const filters = this.getNodeParameter('filters', {}) as IDataObject;
		const events = this.getNodeParameter('events', []) as string[];
		const profile = this.getNodeParameter('profile', '') as string;

		const rawBody: Buffer | undefined = req.rawBody;

		if (options.verifySignature !== false) {
			const credentials = await this.getCredentials(CREDENTIAL_NAME);
			const secret = typeof credentials.secret === 'string' ? credentials.secret : '';
			if (!secret) {
				throw new NodeOperationError(
					this.getNode(),
					'The Hermes Outbound Webhook credential has no Signing Secret',
					{ description: 'Set the Signing Secret, or turn off Verify Signature in Options.' },
				);
			}
			if (
				!rawBody ||
				!verifySignature(secret, rawBody, getHeader(headers, 'x-hermes-signature-256'))
			) {
				return reject.call(this, 401);
			}
		}

		let payload: IDataObject;
		if (rawBody && rawBody.length > 0) {
			try {
				payload = JSON.parse(rawBody.toString('utf8')) as IDataObject;
			} catch {
				return reject.call(this, 400);
			}
		} else {
			payload = this.getBodyData();
		}
		if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
			return reject.call(this, 400);
		}

		if (options.rejectStaleEvents !== false) {
			const maxAgeSeconds =
				typeof options.maxEventAge === 'number' && options.maxEventAge > 0
					? options.maxEventAge
					: DEFAULT_MAX_EVENT_AGE_MS / 1000;
			if (isStale(payload.timestamp, Date.now(), maxAgeSeconds * 1000)) {
				return reject.call(this, 401);
			}
		}

		const rejection = getFilterRejection(payload, headers, {
			events,
			platforms: parseList(filters.platforms),
			boards: parseList(filters.boards),
			sessionId: typeof filters.sessionId === 'string' ? filters.sessionId : undefined,
			toolName: typeof filters.toolName === 'string' ? filters.toolName : undefined,
			profile,
		});
		if (rejection !== null) {
			// 200 without workflowData: acknowledged, no execution started.
			return { webhookResponse: { received: true, ignored: true, reason: rejection } };
		}

		return {
			workflowData: [[{ json: normalizeEvent(payload, headers) }]],
		};
	}
}
