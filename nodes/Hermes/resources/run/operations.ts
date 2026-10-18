import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import {
	createHermesApiError,
	hermesApiRequest,
	normalizeHermesError,
	type HermesFullResponse,
} from '../../transport/hermesApiRequest';
import { getIdempotencyKey } from '../../helpers/idempotency';
import { buildModelFields } from '../../helpers/modelOptions';
import {
	buildApprovalRequest,
	buildClarifyRequest,
	buildResolveUnknownRequest,
	formatPollOutput,
	pollRun,
	RunActionError,
} from '../../helpers/runPolling';

function trimmed(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function runPath(runId: string, suffix = ''): string {
	return `/v1/runs/${encodeURIComponent(runId)}${suffix}`;
}

function getRunId(this: IExecuteFunctions, i: number): string {
	const runId = trimmed(this.getNodeParameter('runId', i, ''));
	if (!runId) {
		throw new NodeOperationError(this.getNode(), 'Run ID must not be empty', { itemIndex: i });
	}
	return runId;
}

/** Run a pure request builder, turning its validation errors into NodeOperationErrors. */
function buildOrThrow<T>(ctx: IExecuteFunctions, i: number, build: () => T): T {
	try {
		return build();
	} catch (error) {
		const message =
			error instanceof RunActionError || error instanceof Error ? error.message : String(error);
		throw new NodeOperationError(ctx.getNode(), message, { itemIndex: i });
	}
}

/** Build the `POST /v1/runs` body from the Input and the Options collection. */
export function buildStartRunBody(input: string, options: IDataObject = {}): IDataObject {
	const body: IDataObject = { input };
	const sessionId = trimmed(options.sessionId);
	const instructions = typeof options.instructions === 'string' ? options.instructions : '';
	const previousResponseId = trimmed(options.previousResponseId);
	const authorId = trimmed(options.authorId);
	const authorName = trimmed(options.authorName);
	if (sessionId) body.session_id = sessionId;
	if (instructions.trim()) body.instructions = instructions;
	if (previousResponseId) body.previous_response_id = previousResponseId;
	Object.assign(body, buildModelFields(options));
	if (authorId || authorName) {
		const author: IDataObject = {};
		if (authorId) author.id = authorId;
		if (authorName) author.name = authorName;
		body.author = author;
	}
	return body;
}

async function fetchRunStatus(this: IExecuteFunctions, runId: string): Promise<IDataObject> {
	return ((await hermesApiRequest.call(this, 'GET', runPath(runId))) ?? {}) as IDataObject;
}

async function startRun(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const input = this.getNodeParameter('input', i, '') as string;
	if (!input || !String(input).trim()) {
		throw new NodeOperationError(this.getNode(), 'Input must not be empty', { itemIndex: i });
	}
	const options = this.getNodeParameter('startOptions', i, {}) as IDataObject;
	const headers: IDataObject = {
		'Idempotency-Key': getIdempotencyKey.call(this, i, trimmed(options.idempotencyKey)),
	};
	const sessionKey = trimmed(options.sessionKey);
	if (sessionKey) headers['X-Hermes-Session-Key'] = sessionKey;

	const body = (await hermesApiRequest.call(this, 'POST', '/v1/runs', {
		body: buildStartRunBody(input, options),
		headers,
	})) as IDataObject;
	return {
		run_id: body?.run_id ?? null,
		status: body?.status ?? null,
		replayed: body?.replayed === true,
	};
}

async function waitForRun(this: IExecuteFunctions, i: number, runId: string): Promise<IDataObject> {
	const intervalSeconds = Number(this.getNodeParameter('pollInterval', i, 2));
	const timeoutMinutes = Number(this.getNodeParameter('waitTimeout', i, 5));
	const errorOnTimeout = this.getNodeParameter('errorOnTimeout', i, false) as boolean;
	const intervalMs = Math.max(1, Number.isFinite(intervalSeconds) ? intervalSeconds : 2) * 1000;
	const timeoutMs = Math.max(0, Number.isFinite(timeoutMinutes) ? timeoutMinutes : 5) * 60_000;
	const signal = this.getExecutionCancelSignal();

	const result = await pollRun({
		fetchStatus: async () => await fetchRunStatus.call(this, runId),
		sleep: async (ms) => {
			try {
				await sleep(ms, signal);
			} catch {
				throw new NodeOperationError(
					this.getNode(),
					'Execution was cancelled while waiting for the run',
					{ itemIndex: i },
				);
			}
		},
		intervalMs,
		timeoutMs,
		now: () => Date.now(),
	});

	if (result.outcome === 'timedOut' && errorOnTimeout) {
		throw new NodeOperationError(
			this.getNode(),
			`Run ${runId} did not finish within ${timeoutMinutes} minute(s) (last status: ${String(
				result.run.status ?? 'unknown',
			)})`,
			{
				itemIndex: i,
				description:
					'The run is still going on the server. Use Wait for Completion with this Run ID to keep waiting.',
			},
		);
	}
	return formatPollOutput(result);
}

async function postControl(
	this: IExecuteFunctions,
	runId: string,
	suffix: string,
	body?: IDataObject,
): Promise<IDataObject> {
	return ((await hermesApiRequest.call(this, 'POST', runPath(runId, suffix), {
		...(body ? { body } : {}),
	})) ?? {}) as IDataObject;
}

async function respondToApproval(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const runId = getRunId.call(this, i);
	const choice = this.getNodeParameter('choice', i) as string;
	const options = this.getNodeParameter('approvalOptions', i, {}) as IDataObject;
	const status = await fetchRunStatus.call(this, runId);
	const request = buildOrThrow(this, i, () =>
		buildApprovalRequest(status, choice, {
			requestId: trimmed(options.requestId),
			resolveAll: options.resolveAll === true,
		}),
	);
	const response = await postControl.call(this, runId, '/approval', request.body);
	return { run_id: runId, mode: request.mode, ...response };
}

async function respondToClarification(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const runId = getRunId.call(this, i);
	const answer = this.getNodeParameter('answer', i, '') as string;
	if (!answer || !String(answer).trim()) {
		throw new NodeOperationError(this.getNode(), 'Answer must not be empty', { itemIndex: i });
	}
	const options = this.getNodeParameter('clarifyOptions', i, {}) as IDataObject;
	const status = await fetchRunStatus.call(this, runId);
	const request = buildOrThrow(this, i, () =>
		buildClarifyRequest(status, answer, { requestId: trimmed(options.requestId) }),
	);
	const response = await postControl.call(this, runId, '/clarify', request.body);
	return { run_id: runId, ...response };
}

async function resolveUnknown(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const runId = getRunId.call(this, i);
	const status = await fetchRunStatus.call(this, runId);
	const request = buildOrThrow(this, i, () => buildResolveUnknownRequest(status));
	const response = await postControl.call(this, runId, '/resolve-unknown', request.body);
	return { run_id: runId, ...response };
}

async function steer(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const runId = getRunId.call(this, i);
	const input = this.getNodeParameter('steerInput', i, '') as string;
	if (!input || !String(input).trim()) {
		throw new NodeOperationError(this.getNode(), 'Guidance must not be empty', { itemIndex: i });
	}
	const response = (await hermesApiRequest.call(this, 'POST', runPath(runId, '/steer'), {
		body: { input },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	})) as HermesFullResponse;
	const statusCode = Number(response.statusCode);
	if (statusCode >= 200 && statusCode < 300) {
		return { run_id: runId, ...((response.body ?? {}) as IDataObject) };
	}
	const normalized = normalizeHermesError(statusCode, response.body, response.headers);
	if (
		statusCode === 409 &&
		(normalized.code === 'run_not_accepting_steer' || normalized.code === 'steer_not_accepted')
	) {
		throw new NodeApiError(
			this.getNode(),
			{ statusCode, code: normalized.code, message: normalized.serverMessage ?? '' },
			{
				message:
					normalized.code === 'run_not_accepting_steer'
						? `Run ${runId} is not accepting steer input right now`
						: `Run ${runId} did not accept the steer input`,
				description:
					'Steering only works while the run status is "running" (not queued, waiting for approval, stopping or finished). Check the status with Get Status and try again.',
				httpCode: '409',
				itemIndex: i,
			},
		);
	}
	throw createHermesApiError(this.getNode(), statusCode, response.body, response.headers, i);
}

export async function executeRunOperation(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	let json: IDataObject;
	switch (operation) {
		case 'start':
			json = await startRun.call(this, i);
			break;
		case 'getStatus':
			json = await fetchRunStatus.call(this, getRunId.call(this, i));
			break;
		case 'waitForCompletion':
			json = await waitForRun.call(this, i, getRunId.call(this, i));
			break;
		case 'startAndWait': {
			const started = await startRun.call(this, i);
			const runId = trimmed(started.run_id);
			if (!runId) {
				throw new NodeOperationError(this.getNode(), 'Hermes did not return a run ID', {
					itemIndex: i,
				});
			}
			json = { ...(await waitForRun.call(this, i, runId)), replayed: started.replayed };
			break;
		}
		case 'respondToApproval':
			json = await respondToApproval.call(this, i);
			break;
		case 'respondToClarification':
			json = await respondToClarification.call(this, i);
			break;
		case 'steer':
			json = await steer.call(this, i);
			break;
		case 'stop': {
			const runId = getRunId.call(this, i);
			json = { run_id: runId, ...(await postControl.call(this, runId, '/stop')) };
			break;
		}
		case 'resolveUnknown':
			json = await resolveUnknown.call(this, i);
			break;
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported Run operation: ${operation}`, {
				itemIndex: i,
			});
	}
	return [{ json }];
}
