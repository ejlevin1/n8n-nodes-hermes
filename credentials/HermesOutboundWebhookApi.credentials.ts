import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

export class HermesOutboundWebhookApi implements ICredentialType {
	name = 'hermesOutboundWebhookApi';

	displayName = 'Hermes Outbound Webhook API';

	icon: Icon = { light: 'file:../icons/hermes.svg', dark: 'file:../icons/hermes.dark.svg' };

	documentationUrl = 'https://github.com/ejlevin1/n8n-nodes-hermes#hermes-outbound-webhook';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'http://localhost:8642',
			description:
				'Optional. The Hermes host that sends events. Used only by the connection test to check reachability.',
		},
		{
			displayName: 'Signing Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Must match <code>hooks.outbound[].secret</code> (or the value of its <code>secret_env</code>) in the Hermes config.yaml. Use at least 32 characters.',
		},
	];
}
