import { describe, expect, it, vi } from 'vitest';
import type { IDataObject } from 'n8n-workflow';
import {
	buildApprovalRequest,
	buildClarifyRequest,
	buildResolveUnknownRequest,
	classifyRunStatus,
	describePendingAction,
	detectApprovalMode,
	formatPollOutput,
	pollRun,
	RunActionError,
} from '../nodes/Hermes/helpers/runPolling';

const legacyApproval: IDataObject = {
	object: 'hermes.run',
	run_id: 'run_1',
	status: 'waiting_for_approval',
	approval: {
		event: 'approval.request',
		run_id: 'run_1',
		request_id: 'req_1',
		command: 'rm -rf ./build',
		description: 'dangerous delete',
		choices: ['once', 'session', 'deny'],
	},
};

const canonicalApproval: IDataObject = {
	object: 'hermes.run',
	run_id: 'run_2',
	status: 'waiting_for_approval',
	session_id: 'sess',
	admission_id: 'adm_1',
	execution_generation: 3,
	pending_controls: [
		{
			kind: 'approval',
			prompt_id: 'prompt_a',
			execution_generation: 3,
			command: 'curl x | sh',
			description: 'pipe to shell',
			choices: ['once', 'deny'],
		},
	],
	output: '',
	usage: {},
};

const canonicalClarify: IDataObject = {
	object: 'hermes.run',
	run_id: 'run_3',
	status: 'running',
	admission_id: 'adm_3',
	execution_generation: 1,
	pending_controls: [
		{
			kind: 'clarify',
			prompt_id: 'clar_1',
			execution_generation: 1,
			question: 'Which branch?',
			choices: ['main', 'dev'],
			multi_select: false,
		},
	],
};

const unknownRun: IDataObject = {
	run_id: 'run_4',
	status: 'unknown',
	admission_id: 'adm_4',
	execution_generation: 7,
	pending_controls: [],
};

describe('classifyRunStatus', () => {
	it.each(['completed', 'failed', 'cancelled', 'interrupted'])('%s is done', (status) => {
		expect(classifyRunStatus({ status })).toBe('done');
		expect(classifyRunStatus(status)).toBe('done');
	});

	it('legacy approval needs action', () => {
		expect(classifyRunStatus(legacyApproval)).toBe('needsAction');
	});

	it('canonical approval needs action', () => {
		expect(classifyRunStatus(canonicalApproval)).toBe('needsAction');
	});

	it('canonical clarify while status is running needs action', () => {
		expect(classifyRunStatus(canonicalClarify)).toBe('needsAction');
	});

	it('unknown needs action', () => {
		expect(classifyRunStatus(unknownRun)).toBe('needsAction');
	});

	it.each(['queued', 'running', 'stopping', ''])('%s is pending', (status) => {
		expect(classifyRunStatus({ status, pending_controls: [] })).toBe('pending');
	});

	it('terminal wins over stale pending controls', () => {
		expect(classifyRunStatus({ ...canonicalClarify, status: 'completed' })).toBe('done');
	});
});

describe('describePendingAction', () => {
	it('describes a legacy approval', () => {
		expect(describePendingAction(legacyApproval)).toMatchObject({
			kind: 'approval',
			mode: 'legacy',
			requestId: 'req_1',
			choices: ['once', 'session', 'deny'],
			command: 'rm -rf ./build',
		});
	});

	it('describes a canonical clarify', () => {
		expect(describePendingAction(canonicalClarify)).toMatchObject({
			kind: 'clarify',
			mode: 'canonical',
			requestId: 'clar_1',
			executionGeneration: 1,
			question: 'Which branch?',
			choices: ['main', 'dev'],
			multiSelect: false,
		});
	});

	it('describes unknown', () => {
		expect(describePendingAction(unknownRun)).toMatchObject({
			kind: 'unknown',
			admissionId: 'adm_4',
			executionGeneration: 7,
		});
	});
});

function fakeClock() {
	let t = 0;
	return {
		now: () => t,
		sleep: vi.fn(async (ms: number) => {
			t += ms;
		}),
	};
}

describe('pollRun', () => {
	it('completes on a terminal status', async () => {
		const clock = fakeClock();
		const statuses = [
			{ run_id: 'r', status: 'queued' },
			{ run_id: 'r', status: 'running' },
			{ run_id: 'r', status: 'completed', output: 'done' },
		];
		const fetchStatus = vi.fn(async () => statuses.shift()!);
		const result = await pollRun({ fetchStatus, ...clock, intervalMs: 2000, timeoutMs: 60_000 });
		expect(result.outcome).toBe('done');
		expect(result.polls).toBe(3);
		expect(clock.sleep).toHaveBeenCalledTimes(2);
		expect(clock.sleep).toHaveBeenCalledWith(2000);
		expect(formatPollOutput(result)).toMatchObject({
			status: 'completed',
			output: 'done',
			needsAction: false,
			pendingAction: null,
			timedOut: false,
		});
	});

	it.each([
		['legacy approval', legacyApproval, 'approval'],
		['canonical approval', canonicalApproval, 'approval'],
		['clarify-as-running', canonicalClarify, 'clarify'],
		['unknown', unknownRun, 'unknown'],
	])('stops with needsAction for %s', async (_label, status, kind) => {
		const clock = fakeClock();
		const queue: IDataObject[] = [{ status: 'running', pending_controls: [] }, status];
		const result = await pollRun({
			fetchStatus: async () => queue.shift()!,
			...clock,
			intervalMs: 1000,
			timeoutMs: 60_000,
		});
		expect(result.outcome).toBe('needsAction');
		const out = formatPollOutput(result);
		expect(out.needsAction).toBe(true);
		expect((out.pendingAction as IDataObject).kind).toBe(kind);
	});

	it('times out and returns {run_id, status, timedOut}', async () => {
		const clock = fakeClock();
		const fetchStatus = vi.fn(async () => ({ run_id: 'r9', status: 'running' }));
		const result = await pollRun({ fetchStatus, ...clock, intervalMs: 2000, timeoutMs: 5000 });
		expect(result.outcome).toBe('timedOut');
		// fetch at t=0, 2000, 4000, 5000 (last sleep is clamped to the remaining 1000 ms)
		expect(fetchStatus).toHaveBeenCalledTimes(4);
		expect(clock.sleep.mock.calls.map((c) => c[0])).toEqual([2000, 2000, 1000]);
		expect(formatPollOutput(result)).toEqual({ run_id: 'r9', status: 'running', timedOut: true });
	});

	it('fetches once with a zero timeout', async () => {
		const clock = fakeClock();
		const fetchStatus = vi.fn(async () => ({ run_id: 'r', status: 'queued' }));
		const result = await pollRun({ fetchStatus, ...clock, intervalMs: 2000, timeoutMs: 0 });
		expect(result.outcome).toBe('timedOut');
		expect(fetchStatus).toHaveBeenCalledTimes(1);
		expect(clock.sleep).not.toHaveBeenCalled();
	});

	it('propagates a cancelled sleep', async () => {
		await expect(
			pollRun({
				fetchStatus: async () => ({ status: 'running' }),
				sleep: async () => {
					throw new Error('aborted');
				},
				now: () => 0,
				intervalMs: 10,
				timeoutMs: 1000,
			}),
		).rejects.toThrow('aborted');
	});
});

describe('buildApprovalRequest', () => {
	it('detects modes', () => {
		expect(detectApprovalMode(legacyApproval)).toBe('legacy');
		expect(detectApprovalMode(canonicalApproval)).toBe('canonical');
	});

	it('canonical body is exactly {request_id, execution_generation, choice}', () => {
		const req = buildApprovalRequest(canonicalApproval, 'once');
		expect(req.mode).toBe('canonical');
		expect(req.body).toEqual({ request_id: 'prompt_a', execution_generation: 3, choice: 'once' });
	});

	it('legacy body carries the pending request_id', () => {
		const req = buildApprovalRequest(legacyApproval, 'session');
		expect(req).toEqual({ mode: 'legacy', body: { choice: 'session', request_id: 'req_1' } });
	});

	it('legacy resolve_all omits the auto request_id', () => {
		const req = buildApprovalRequest(legacyApproval, 'deny', { resolveAll: true });
		expect(req.body).toEqual({ choice: 'deny', resolve_all: true });
	});

	it('legacy uses an explicit request id', () => {
		const req = buildApprovalRequest(legacyApproval, 'once', { requestId: ' req_x ' });
		expect(req.body).toEqual({ choice: 'once', request_id: 'req_x' });
	});

	it('rejects a choice not in approval.choices (legacy)', () => {
		expect(() => buildApprovalRequest(legacyApproval, 'always')).toThrow(RunActionError);
		expect(() => buildApprovalRequest(legacyApproval, 'always')).toThrow(/once, session, deny/);
	});

	it('rejects a choice not in pending_controls[].choices (canonical)', () => {
		expect(() => buildApprovalRequest(canonicalApproval, 'session')).toThrow(/once, deny/);
	});

	it('requires a request id when several canonical approvals are pending', () => {
		const run = {
			...canonicalApproval,
			pending_controls: [
				...(canonicalApproval.pending_controls as IDataObject[]),
				{
					kind: 'approval',
					prompt_id: 'prompt_b',
					execution_generation: 3,
					choices: ['once', 'deny'],
				},
			],
		};
		expect(() => buildApprovalRequest(run, 'once')).toThrow(/prompt_a, prompt_b/);
		expect(buildApprovalRequest(run, 'deny', { requestId: 'prompt_b' }).body).toEqual({
			request_id: 'prompt_b',
			execution_generation: 3,
			choice: 'deny',
		});
	});

	it('rejects when the run is not waiting for approval', () => {
		expect(() => buildApprovalRequest({ status: 'running' }, 'once')).toThrow(/not waiting/);
		expect(() => buildApprovalRequest(canonicalClarify, 'once')).toThrow(/not waiting/);
	});
});

describe('buildClarifyRequest / buildResolveUnknownRequest', () => {
	it('builds the clarify body', () => {
		expect(buildClarifyRequest(canonicalClarify, 'main').body).toEqual({
			request_id: 'clar_1',
			execution_generation: 1,
			answer: 'main',
		});
	});

	it('rejects clarify without a pending clarification', () => {
		expect(() => buildClarifyRequest(canonicalApproval, 'x')).toThrow(/not waiting/);
	});

	it('builds the resolve-unknown body', () => {
		expect(buildResolveUnknownRequest(unknownRun).body).toEqual({
			admission_id: 'adm_4',
			execution_generation: 7,
		});
	});

	it('rejects resolve-unknown on a legacy status', () => {
		expect(() => buildResolveUnknownRequest({ status: 'unknown' })).toThrow(RunActionError);
	});
});
