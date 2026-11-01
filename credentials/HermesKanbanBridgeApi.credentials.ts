import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { KANBAN_BRIDGE_HEALTH_PATH } from '../nodes/Hermes/helpers/kanbanBridge';

export class HermesKanbanBridgeApi implements ICredentialType {
	name = 'hermesKanbanBridgeApi';

	displayName = 'Hermes Kanban Bridge API';

	icon: Icon = { light: 'file:../icons/hermes.svg', dark: 'file:../icons/hermes.dark.svg' };

	documentationUrl = 'https://github.com/ejlevin1/n8n-nodes-hermes#hermes-kanban-bridge';

	properties: INodeProperties[] = [
		{
			displayName:
				'The <code>kanban-bridge</code> plugin runs inside the Hermes <b>dashboard</b> process (default profile), not the API gateway. Its host check only accepts loopback <code>Host</code> headers, so from Docker connect to <code>host.docker.internal</code> while keeping <b>Host Header</b> at <code>127.0.0.1:9119</code>.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'http://host.docker.internal:9119',
			placeholder: 'http://host.docker.internal:9119',
			description:
				'URL the Hermes dashboard is reached on. Use <code>http://host.docker.internal:9119</code> from a Docker n8n, or <code>http://127.0.0.1:9119</code> when n8n runs on the same host.',
		},
		{
			displayName: 'Host Header',
			name: 'hostHeader',
			type: 'string',
			required: true,
			default: '127.0.0.1:9119',
			placeholder: '127.0.0.1:9119',
			description:
				'Sent as the <code>Host</code> header, overriding the one derived from Base URL. The dashboard rejects non-loopback hosts, so this must stay a loopback address even when Base URL points at <code>host.docker.internal</code>.',
		},
		{
			displayName: 'Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'kbb_…',
			description:
				'Bridge token issued by <code>kbctl token create</code> (starts with <code>kbb_</code>). Its scopes decide which boards, assignees and actions this credential may touch.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
			},
		},
	};

	// The Host override is not part of `authenticate` because the node's transport sets it per
	// request (and skips it when empty); the test request therefore has to carry it itself.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: KANBAN_BRIDGE_HEALTH_PATH,
			method: 'GET',
			headers: { Host: '={{$credentials.hostHeader}}' },
		},
	};
}
