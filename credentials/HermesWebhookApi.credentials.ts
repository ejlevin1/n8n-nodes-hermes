import type {
	IAuthenticate,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { signHermesWebhookRequest } from '../nodes/Hermes/helpers/webhookSignature';

export class HermesWebhookApi implements ICredentialType {
	name = 'hermesWebhookApi';

	displayName = 'Hermes Webhook API';

	icon: Icon = { light: 'file:../icons/hermes.svg', dark: 'file:../icons/hermes.dark.svg' };

	documentationUrl = 'https://github.com/ejlevin1/n8n-nodes-hermes#hermes-webhook';

	properties: INodeProperties[] = [
		{
			displayName:
				'One credential holds one route secret (or the global <code>WEBHOOK_SECRET</code>). The connection test only checks that the webhook adapter is reachable; the secret can only be verified by sending to a route.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'http://localhost:8644',
			placeholder: 'http://localhost:8644',
			description:
				'URL of the Hermes webhook adapter. May include a profile prefix such as <code>/p/&lt;profile&gt;</code>.',
		},
		{
			displayName: 'Route Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'HMAC secret of the webhook route (its <code>secret</code> in config.yaml) or the global <code>WEBHOOK_SECRET</code>',
		},
	];

	authenticate: IAuthenticate = signHermesWebhookRequest;

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/health',
			method: 'GET',
		},
	};
}
