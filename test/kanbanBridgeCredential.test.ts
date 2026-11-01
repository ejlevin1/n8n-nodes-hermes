import { describe, expect, it } from 'vitest';
import { HermesKanbanBridgeApi } from '../credentials/HermesKanbanBridgeApi.credentials';
import {
	KANBAN_BRIDGE_BASE_PATH,
	KANBAN_BRIDGE_CREDENTIAL,
	KANBAN_BRIDGE_HEALTH_PATH,
} from '../nodes/Hermes/helpers/kanbanBridge';
import { Hermes } from '../nodes/Hermes/Hermes.node';

const credential = new HermesKanbanBridgeApi();
const property = (name: string) => credential.properties.find((p) => p.name === name);

describe('Hermes Kanban Bridge credential', () => {
	it('is named hermesKanbanBridgeApi, matching what the resource requests', () => {
		expect(credential.name).toBe('hermesKanbanBridgeApi');
		expect(credential.name).toBe(KANBAN_BRIDGE_CREDENTIAL);
		expect(credential.displayName).toBe('Hermes Kanban Bridge API');
	});

	it('defaults Base URL to host.docker.internal:9119', () => {
		const baseUrl = property('baseUrl');
		expect(baseUrl?.type).toBe('string');
		expect(baseUrl?.required).toBe(true);
		expect(baseUrl?.default).toBe('http://host.docker.internal:9119');
	});

	it('defaults the Host override to the loopback the dashboard accepts', () => {
		const hostHeader = property('hostHeader');
		expect(hostHeader?.displayName).toBe('Host Header');
		expect(hostHeader?.required).toBe(true);
		expect(hostHeader?.default).toBe('127.0.0.1:9119');
		expect(String(hostHeader?.description)).toMatch(/Host/);
	});

	it('stores the token as a password and never defaults it to a value', () => {
		const token = property('token');
		expect(token?.type).toBe('string');
		expect(token?.typeOptions?.password).toBe(true);
		expect(token?.required).toBe(true);
		expect(token?.default).toBe('');
	});

	it('sends the token as a bearer header', () => {
		expect(credential.authenticate.type).toBe('generic');
		expect(credential.authenticate.properties.headers).toEqual({
			Authorization: '=Bearer {{$credentials.token}}',
		});
	});

	it('tests against the bridge health route, carrying the Host override', () => {
		expect(KANBAN_BRIDGE_BASE_PATH).toBe('/api/plugins/kanban-bridge/v1');
		expect(KANBAN_BRIDGE_HEALTH_PATH).toBe('/api/plugins/kanban-bridge/v1/health');
		expect(credential.test.request.method).toBe('GET');
		expect(credential.test.request.url).toBe(KANBAN_BRIDGE_HEALTH_PATH);
		expect(credential.test.request.baseURL).toBe('={{$credentials.baseUrl}}');
		expect(credential.test.request.headers).toEqual({ Host: '={{$credentials.hostHeader}}' });
	});

	it('does not leak a token value anywhere in the credential definition', () => {
		expect(JSON.stringify(credential)).not.toMatch(/kbb_[A-Za-z0-9_-]{8,}/);
	});
});

describe('Hermes node credential wiring', () => {
	const credentials = new Hermes().description.credentials ?? [];
	const byName = (name: string) => credentials.find((c) => c.name === name);

	it('requires the bridge credential only for the Kanban Task resource', () => {
		const bridge = byName('hermesKanbanBridgeApi');
		expect(bridge?.required).toBe(true);
		expect(bridge?.displayOptions?.show?.resource).toEqual(['kanbanTask']);
	});

	it('stops asking for the gateway API key on Kanban Task', () => {
		expect(byName('hermesApi')?.displayOptions?.hide?.resource).toEqual([
			'webhookRoute',
			'kanbanTask',
		]);
	});

	it('offers Kanban Task in the Resource dropdown', () => {
		const resource = new Hermes().description.properties.find((p) => p.name === 'resource');
		const options = (resource?.options ?? []) as Array<{ name: string; value: string }>;
		expect(options.map((o) => o.value)).toContain('kanbanTask');
		expect(options.find((o) => o.value === 'kanbanTask')?.name).toBe('Kanban Task');
	});
});
