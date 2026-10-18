import { describe, expect, it, vi } from 'vitest';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { executeRun, runDescription } from '../nodes/Hermes/resources/run';
import { buildStartRunBody } from '../nodes/Hermes/resources/run/operations';

const node = {
	id: 'node-1',
	name: 'Hermes 1',
	type: 'n8n-nodes-hermes.hermes',
	typeVersion: 1,
	position: [0, 0] as [number, number],
	parameters: {},
};

interface MockResponse {
	statusCode?: number;
	body: unknown;
}

function mockContext(params: IDataObject, responses: MockResponse[]) {
	const httpRequestWithAuthentication = vi.fn(async () => {
		const next = responses.shift();
		if (!next) throw new Error('unexpected request');
		return { statusCode: next.statusCode ?? 200, headers: {}, body: next.body };
	});
	const ctx = {
		getCredentials: vi.fn().mockResolvedValue({ baseUrl: 'http://hermes:8642/', apiKey: 'k' }),
		getNode: () => node,
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getExecutionId: () => 'exec-1',
		getWorkflowDataProxy: () => ({ $runIndex: 0 }),
		getExecutionCancelSignal: () => undefined,
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
	return { ctx, httpRequestWithAuthentication };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (mock: any, n: number) => mock.mock.calls[n][1];

describe('run description', () => {
	it('has an operation dropdown scoped to resource run', () => {
		const op = runDescription[0];
		expect(op.name).toBe('operation');
		expect(op.displayOptions?.show?.resource).toEqual(['run']);
		const values = (op.options as Array<{ value: string }>).map((o) => o.value).sort();
		expect(values).toEqual(
			[
				'getStatus',
				'resolveUnknown',
				'respondToApproval',
				'respondToClarification',
				'start',
				'startAndWait',
				'steer',
				'stop',
				'waitForCompletion',
			].sort(),
		);
	});
});

describe('buildStartRunBody', () => {
	it('maps options to Hermes fields', () => {
		expect(
			buildStartRunBody('do it', {
				sessionId: ' s1 ',
				instructions: 'be brief',
				previousResponseId: 'resp_1',
				model: 'm',
				provider: 'p',
				reasoningEffort: 'high',
				authorId: 'u1',
				authorName: 'Eric',
			}),
		).toEqual({
			input: 'do it',
			session_id: 's1',
			instructions: 'be brief',
			previous_response_id: 'resp_1',
			model: 'm',
			provider: 'p',
			model_options: { reasoning: { effort: 'high' } },
			author: { id: 'u1', name: 'Eric' },
		});
	});

	it('omits empty options', () => {
		expect(buildStartRunBody('x', {})).toEqual({ input: 'x' });
	});
});

describe('executeRun', () => {
	it('Start sends an auto Idempotency-Key and returns {run_id, status, replayed}', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ input: 'hello', startOptions: { sessionKey: 'chan' } },
			[{ statusCode: 202, body: { run_id: 'run_1', status: 'queued', replayed: false } }],
		);
		const out = await executeRun.call(ctx, 'start', 0);
		expect(out).toEqual([{ json: { run_id: 'run_1', status: 'queued', replayed: false } }]);
		const req = call(httpRequestWithAuthentication, 0);
		expect(req.method).toBe('POST');
		expect(req.url).toBe('http://hermes:8642/v1/runs');
		expect(req.headers['Idempotency-Key']).toMatch(/^n8n-[0-9a-f]{40}$/);
		expect(req.headers['X-Hermes-Session-Key']).toBe('chan');
		expect(req.body).toEqual({ input: 'hello' });
	});

	it('Start and Wait returns the terminal status', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ input: 'hello', pollInterval: 1, waitTimeout: 1 },
			[
				{ statusCode: 202, body: { run_id: 'run_1', status: 'queued', replayed: true } },
				{ body: { run_id: 'run_1', status: 'completed', output: 'hi' } },
			],
		);
		const [item] = await executeRun.call(ctx, 'startAndWait', 0);
		expect(item.json).toMatchObject({
			run_id: 'run_1',
			status: 'completed',
			output: 'hi',
			needsAction: false,
			timedOut: false,
			replayed: true,
		});
		expect(call(httpRequestWithAuthentication, 1).url).toBe('http://hermes:8642/v1/runs/run_1');
	});

	it('Wait for Completion with a zero timeout errors when Error on Timeout is set', async () => {
		const { ctx } = mockContext(
			{ runId: 'run_1', pollInterval: 1, waitTimeout: 0, errorOnTimeout: true },
			[{ body: { run_id: 'run_1', status: 'running' } }],
		);
		await expect(executeRun.call(ctx, 'waitForCompletion', 0)).rejects.toThrow(NodeOperationError);
	});

	it('Wait for Completion with a zero timeout returns timedOut by default', async () => {
		const { ctx } = mockContext({ runId: 'run_1', pollInterval: 1, waitTimeout: 0 }, [
			{ body: { run_id: 'run_1', status: 'running' } },
		]);
		const [item] = await executeRun.call(ctx, 'waitForCompletion', 0);
		expect(item.json).toEqual({ run_id: 'run_1', status: 'running', timedOut: true });
	});

	it('Respond to Approval posts the canonical body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ runId: 'run_2', choice: 'once', approvalOptions: {} },
			[
				{
					body: {
						run_id: 'run_2',
						status: 'waiting_for_approval',
						execution_generation: 2,
						pending_controls: [
							{
								kind: 'approval',
								prompt_id: 'p1',
								execution_generation: 2,
								choices: ['once', 'deny'],
							},
						],
					},
				},
				{ body: { status: 'resolved' } },
			],
		);
		const [item] = await executeRun.call(ctx, 'respondToApproval', 0);
		const req = call(httpRequestWithAuthentication, 1);
		expect(req.url).toBe('http://hermes:8642/v1/runs/run_2/approval');
		expect(req.body).toEqual({ request_id: 'p1', execution_generation: 2, choice: 'once' });
		expect(item.json).toMatchObject({ run_id: 'run_2', mode: 'canonical', status: 'resolved' });
	});

	it('Respond to Approval rejects a choice the approval does not allow', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ runId: 'run_1', choice: 'always', approvalOptions: {} },
			[
				{
					body: {
						run_id: 'run_1',
						status: 'waiting_for_approval',
						approval: { request_id: 'r', choices: ['once', 'deny'] },
					},
				},
			],
		);
		await expect(executeRun.call(ctx, 'respondToApproval', 0)).rejects.toThrow(
			/not allowed.*once, deny/,
		);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
	});

	it('Respond to Clarification posts {request_id, execution_generation, answer}', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ runId: 'run_3', answer: 'main', clarifyOptions: {} },
			[
				{
					body: {
						run_id: 'run_3',
						status: 'running',
						execution_generation: 1,
						pending_controls: [{ kind: 'clarify', prompt_id: 'c1', execution_generation: 1 }],
					},
				},
				{ body: { status: 'resolved' } },
			],
		);
		await executeRun.call(ctx, 'respondToClarification', 0);
		expect(call(httpRequestWithAuthentication, 1).body).toEqual({
			request_id: 'c1',
			execution_generation: 1,
			answer: 'main',
		});
	});

	it('Steer surfaces run_not_accepting_steer clearly', async () => {
		const { ctx } = mockContext({ runId: 'run_1', steerInput: 'go left' }, [
			{
				statusCode: 409,
				body: {
					error: {
						message: 'Run is not currently accepting steer input: run_1',
						type: 'invalid_request_error',
						code: 'run_not_accepting_steer',
					},
				},
			},
		]);
		const err = await executeRun.call(ctx, 'steer', 0).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(NodeApiError);
		expect((err as NodeApiError).message).toBe('Run run_1 is not accepting steer input right now');
		expect((err as NodeApiError).httpCode).toBe('409');
	});

	it('Steer sends {input}', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext(
			{ runId: 'run_1', steerInput: 'go left' },
			[{ body: { object: 'hermes.run.steer', run_id: 'run_1', accepted: true } }],
		);
		const [item] = await executeRun.call(ctx, 'steer', 0);
		expect(call(httpRequestWithAuthentication, 0).body).toEqual({ input: 'go left' });
		expect(item.json.accepted).toBe(true);
	});

	it('Stop and Resolve Unknown hit the right endpoints', async () => {
		const stop = mockContext({ runId: 'run_1' }, [
			{ body: { run_id: 'run_1', status: 'stopping' } },
		]);
		await executeRun.call(stop.ctx, 'stop', 0);
		expect(call(stop.httpRequestWithAuthentication, 0).url).toBe(
			'http://hermes:8642/v1/runs/run_1/stop',
		);

		const unk = mockContext({ runId: 'run_4' }, [
			{ body: { run_id: 'run_4', status: 'unknown', admission_id: 'a4', execution_generation: 5 } },
			{ body: { status: 'resolved' } },
		]);
		await executeRun.call(unk.ctx, 'resolveUnknown', 0);
		const req = call(unk.httpRequestWithAuthentication, 1);
		expect(req.url).toBe('http://hermes:8642/v1/runs/run_4/resolve-unknown');
		expect(req.body).toEqual({ admission_id: 'a4', execution_generation: 5 });
	});
});
