import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class HermesApi implements ICredentialType {
	name = 'hermesApi';

	displayName = 'Hermes API';

	icon: Icon = { light: 'file:../icons/hermes.svg', dark: 'file:../icons/hermes.dark.svg' };

	documentationUrl = 'https://github.com/ejlevin1/n8n-nodes-hermes#hermes-api';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'http://localhost:8642',
			placeholder: 'http://localhost:8642',
			description:
				"URL of the Hermes API server. To use a named Hermes profile, end it with <code>/p/&lt;profile&gt;</code> (e.g. <code>http://localhost:8642/p/coder</code>) and use that profile's own API key.",
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'The <code>API_SERVER_KEY</code> configured on the Hermes gateway (16+ characters)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/capabilities',
			method: 'GET',
		},
	};
}
