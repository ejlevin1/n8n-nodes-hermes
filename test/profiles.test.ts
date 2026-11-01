import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { hermesApiRequest, profileFromBaseUrl } from '../nodes/Hermes/transport/hermesApiRequest';
import { Hermes } from '../nodes/Hermes/Hermes.node';
import { HermesTrigger } from '../nodes/HermesTrigger/HermesTrigger.node';
import { getFilterRejection } from '../nodes/HermesTrigger/events';

const node = {
	id: 'n',
	name: 'Hermes',
	type: 'hermes',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function execCtx(baseUrl: string, response = { body: {}, headers: {}, statusCode: 200 }) {
	const httpRequestWithAuthentication = vi.fn().mockResolvedValue(response);
	const ctx = {
		getCredentials: vi.fn().mockResolvedValue({ baseUrl, apiKey: 'k' }),
		getNodeParameter: vi.fn((_name: string, _i: number, fallback: unknown) => fallback),
		getNode: () => node,
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
	return { ctx, httpRequestWithAuthentication };
}

const authError = {
	body: { error: { message: 'bad', code: 'gateway_auth_failed', type: 'gateway_auth_error' } },
	headers: {},
	statusCode: 401,
};

describe('profiles come from the credential Base URL', () => {
	it('the Hermes node has no Profile parameter', () => {
		const names = new Hermes().description.properties.map((p) => p.name);
		expect(names).not.toContain('profile');
	});

	it('profileFromBaseUrl reads a trailing /p/<profile>', () => {
		expect(profileFromBaseUrl('http://h:8642/p/Comms/')).toBe('comms');
		expect(profileFromBaseUrl('http://h:8642/p/default')).toBe('');
		expect(profileFromBaseUrl('http://h:8642')).toBe('');
		expect(profileFromBaseUrl(undefined)).toBe('');
	});

	it('sends requests to the Base URL as configured, including a profile prefix', async () => {
		const { ctx, httpRequestWithAuthentication } = execCtx('http://h:8642/p/comms/');
		await hermesApiRequest.call(ctx, 'GET', '/v1/models');
		expect(httpRequestWithAuthentication.mock.calls[0][1].url).toBe(
			'http://h:8642/p/comms/v1/models',
		);
	});

	it('explains per-profile API keys on a 401 for a named-profile Base URL', async () => {
		const { ctx } = execCtx('http://h:8642/p/comms', authError);
		const err = (await hermesApiRequest
			.call(ctx, 'GET', '/v1/models')
			.catch((e) => e)) as NodeApiError;
		expect(err).toBeInstanceOf(NodeApiError);
		expect(err.description).toContain('Profile "comms" checks its own API_SERVER_KEY');
	});

	it.each(['http://h:8642', 'http://h:8642/p/default'])(
		'adds no profile hint for %s',
		async (url) => {
			const { ctx } = execCtx(url, authError);
			const err = (await hermesApiRequest
				.call(ctx, 'GET', '/v1/models')
				.catch((e) => e)) as NodeApiError;
			expect(err).toBeInstanceOf(NodeApiError);
			expect(err.description ?? '').not.toContain('Profile "');
		},
	);
});

describe('Hermes Trigger profile filter', () => {
	const trigger = new HermesTrigger();

	it('has an optional free-text Profile filter', () => {
		const prop = trigger.description.properties.find((p) => p.name === 'profile');
		expect(prop).toMatchObject({ type: 'string', default: '' });
		expect(prop?.required).toBeFalsy();
	});

	it('filters events by profile (case-insensitive)', () => {
		const payload = { hook_event_name: 'post_llm_call', profile: 'coder' };
		expect(getFilterRejection(payload, {}, { events: ['post_llm_call'] })).toBeNull();
		expect(
			getFilterRejection(payload, {}, { events: ['post_llm_call'], profile: ' Coder ' }),
		).toBeNull();
		expect(getFilterRejection(payload, {}, { events: ['post_llm_call'], profile: 'ops' })).toMatch(
			/profile "coder"/,
		);
		expect(
			getFilterRejection(
				{ hook_event_name: 'post_llm_call' },
				{},
				{ events: ['post_llm_call'], profile: 'ops' },
			),
		).toMatch(/profile ""/);
	});
});
