import type { IDataObject } from 'n8n-workflow';

/**
 * Pure run-status state machine and poller for `GET /v1/runs/{id}`. Everything here is free of
 * n8n context so it can be unit-tested with an injected fetcher, sleeper and clock.
 */

/** Statuses after which a run never changes again. */
export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'] as const;

export type RunClassification = 'done' | 'needsAction' | 'pending';

export type ApprovalMode = 'canonical' | 'legacy';

function asObject(value: unknown): IDataObject {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as IDataObject) : {};
}

function statusString(run: IDataObject | string | undefined | null): string {
	if (typeof run === 'string') return run;
	return typeof run?.status === 'string' ? run.status : '';
}

/** `pending_controls[]` entries of a canonical status (empty for legacy statuses). */
export function getPendingControls(run: IDataObject): IDataObject[] {
	const pending = run.pending_controls;
	if (!Array.isArray(pending)) return [];
	return pending.filter((p) => p && typeof p === 'object') as IDataObject[];
}

/**
 * Classify a run status (the whole `GET /v1/runs/{id}` body, or a bare status string):
 * - `done`: terminal (`completed`, `failed`, `cancelled`, `interrupted`);
 * - `needsAction`: `waiting_for_approval`, `unknown`, or any `pending_controls[]` entry
 *   (canonical clarify prompts keep the status at `running`);
 * - `pending`: anything else (`queued`, `running`, `stopping`, ...).
 */
export function classifyRunStatus(run: IDataObject | string): RunClassification {
	const status = statusString(run);
	if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(status)) return 'done';
	if (status === 'waiting_for_approval' || status === 'unknown') return 'needsAction';
	if (typeof run === 'object' && getPendingControls(run).length > 0) return 'needsAction';
	return 'pending';
}

/**
 * Canonical (session-authority) statuses carry `execution_generation` / `pending_controls`;
 * legacy statuses carry an `approval` event instead.
 */
export function detectApprovalMode(run: IDataObject): ApprovalMode {
	return 'execution_generation' in run || Array.isArray(run.pending_controls)
		? 'canonical'
		: 'legacy';
}

export interface PendingAction {
	kind: 'approval' | 'clarify' | 'unknown';
	mode: ApprovalMode;
	/** `pending_controls[].prompt_id` (canonical) or `approval.request_id` (legacy). */
	requestId: string | null;
	executionGeneration: number | null;
	admissionId: string | null;
	/** Allowed approval choices, or the clarify options. */
	choices: string[];
	command: string | null;
	description: string | null;
	question: string | null;
	multiSelect: boolean | null;
	timeoutSeconds: number | null;
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function int(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function strList(value: unknown): string[] {
	return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** Describe what a needs-action run is waiting for (the first pending item), or null. */
export function describePendingAction(run: IDataObject): PendingAction | null {
	const mode = detectApprovalMode(run);
	const generation = int(run.execution_generation);
	const admissionId = str(run.admission_id);
	const base = {
		mode,
		executionGeneration: generation,
		admissionId,
		command: null,
		description: null,
		question: null,
		multiSelect: null,
		timeoutSeconds: null,
	};
	const controls = getPendingControls(run);
	const control =
		controls.find((c) => c.kind === 'approval') ??
		controls.find((c) => c.kind === 'clarify') ??
		controls[0];
	if (control) {
		const kind = control.kind === 'clarify' ? 'clarify' : 'approval';
		return {
			...base,
			kind,
			requestId: str(control.prompt_id),
			executionGeneration: int(control.execution_generation) ?? generation,
			choices: strList(control.choices),
			command: str(control.command),
			description: str(control.description),
			question: str(control.question),
			multiSelect: typeof control.multi_select === 'boolean' ? control.multi_select : null,
			timeoutSeconds: typeof control.timeout_s === 'number' ? control.timeout_s : null,
		};
	}
	const status = statusString(run);
	if (status === 'waiting_for_approval') {
		const approval = asObject(run.approval);
		return {
			...base,
			kind: 'approval',
			requestId: str(approval.request_id),
			choices: strList(approval.choices),
			command: str(approval.command),
			description: str(approval.description),
		};
	}
	if (status === 'unknown') {
		return { ...base, kind: 'unknown', requestId: null, choices: [] };
	}
	return null;
}

/** Thrown by the pure builders below; the node wraps it in a NodeOperationError. */
export class RunActionError extends Error {}

export interface BuiltRunRequest {
	mode: ApprovalMode;
	body: IDataObject;
}

/**
 * Build the `POST /v1/runs/{id}/approval` body from the current status.
 * - Canonical: exactly `{request_id, execution_generation, choice}`, with `request_id` taken from
 *   the matching `pending_controls[]` approval's `prompt_id`.
 * - Legacy: `{choice, request_id?, resolve_all?}`.
 * The choice is validated against the approval's `choices` when the server lists them.
 */
export function buildApprovalRequest(
	run: IDataObject,
	choice: string,
	opts: { requestId?: string; resolveAll?: boolean } = {},
): BuiltRunRequest {
	const wanted = String(choice ?? '')
		.trim()
		.toLowerCase();
	const requestId = (opts.requestId ?? '').trim();
	const mode = detectApprovalMode(run);
	const validate = (choices: string[]) => {
		if (choices.length && !choices.includes(wanted)) {
			throw new RunActionError(
				`Choice "${wanted}" is not allowed for this approval. Allowed: ${choices.join(', ')}`,
			);
		}
	};

	if (mode === 'canonical') {
		const approvals = getPendingControls(run).filter((c) => c.kind === 'approval');
		let control: IDataObject | undefined;
		if (requestId) {
			control = approvals.find((c) => c.prompt_id === requestId);
			if (!control) {
				throw new RunActionError(`No pending approval with Request ID "${requestId}" on this run`);
			}
		} else if (approvals.length === 1) {
			control = approvals[0];
		} else if (approvals.length > 1) {
			throw new RunActionError(
				`This run has ${approvals.length} pending approvals; set Request ID to choose one (${approvals
					.map((a) => String(a.prompt_id))
					.join(', ')})`,
			);
		}
		if (!control) {
			throw new RunActionError(
				`Run is not waiting for an approval (status: ${statusString(run) || 'unknown'})`,
			);
		}
		validate(strList(control.choices));
		const generation = int(run.execution_generation) ?? int(control.execution_generation);
		if (generation === null) {
			throw new RunActionError('Run status has no execution_generation; cannot answer approval');
		}
		return {
			mode,
			body: {
				request_id: String(control.prompt_id),
				execution_generation: generation,
				choice: wanted,
			},
		};
	}

	if (statusString(run) !== 'waiting_for_approval') {
		throw new RunActionError(
			`Run is not waiting for an approval (status: ${statusString(run) || 'unknown'})`,
		);
	}
	const approval = asObject(run.approval);
	validate(strList(approval.choices));
	const body: IDataObject = { choice: wanted };
	if (requestId) body.request_id = requestId;
	else if (!opts.resolveAll && str(approval.request_id)) body.request_id = approval.request_id;
	if (opts.resolveAll) body.resolve_all = true;
	return { mode, body };
}

/**
 * Build the `POST /v1/runs/{id}/clarify` body `{request_id, execution_generation, answer}` from the
 * current (canonical) status.
 */
export function buildClarifyRequest(
	run: IDataObject,
	answer: string,
	opts: { requestId?: string } = {},
): BuiltRunRequest {
	const requestId = (opts.requestId ?? '').trim();
	const clarifies = getPendingControls(run).filter((c) => c.kind === 'clarify');
	let control: IDataObject | undefined;
	if (requestId) {
		control = clarifies.find((c) => c.prompt_id === requestId);
		if (!control) {
			throw new RunActionError(
				`No pending clarification with Request ID "${requestId}" on this run`,
			);
		}
	} else if (clarifies.length === 1) {
		control = clarifies[0];
	} else if (clarifies.length > 1) {
		throw new RunActionError(
			`This run has ${clarifies.length} pending clarifications; set Request ID to choose one`,
		);
	}
	if (!control) {
		throw new RunActionError(
			`Run is not waiting for a clarification (status: ${statusString(run) || 'unknown'})`,
		);
	}
	const generation = int(run.execution_generation) ?? int(control.execution_generation);
	if (generation === null) {
		throw new RunActionError('Run status has no execution_generation; cannot answer clarification');
	}
	return {
		mode: 'canonical',
		body: { request_id: String(control.prompt_id), execution_generation: generation, answer },
	};
}

/** Build the `POST /v1/runs/{id}/resolve-unknown` body `{admission_id, execution_generation}`. */
export function buildResolveUnknownRequest(run: IDataObject): BuiltRunRequest {
	const admissionId = str(run.admission_id);
	const generation = int(run.execution_generation);
	if (!admissionId || generation === null) {
		throw new RunActionError(
			'Run status has no admission_id/execution_generation; only canonical runs in status "unknown" can be resolved',
		);
	}
	return {
		mode: 'canonical',
		body: { admission_id: admissionId, execution_generation: generation },
	};
}

export interface PollRunOptions {
	fetchStatus: () => Promise<IDataObject>;
	sleep: (ms: number) => Promise<void>;
	intervalMs: number;
	timeoutMs: number;
	now: () => number;
}

export interface PollRunResult {
	outcome: RunClassification | 'timedOut';
	/** The last status body fetched. */
	run: IDataObject;
	polls: number;
}

/**
 * Poll until the run is done or needs action, or `timeoutMs` elapses. Always fetches at least once.
 */
export async function pollRun(options: PollRunOptions): Promise<PollRunResult> {
	const intervalMs = Math.max(0, options.intervalMs);
	const timeoutMs = Math.max(0, options.timeoutMs);
	const start = options.now();
	let polls = 0;
	for (;;) {
		const run = asObject(await options.fetchStatus());
		polls++;
		const outcome = classifyRunStatus(run);
		if (outcome !== 'pending') return { outcome, run, polls };
		const elapsed = options.now() - start;
		if (elapsed >= timeoutMs) return { outcome: 'timedOut', run, polls };
		await options.sleep(Math.min(intervalMs, timeoutMs - elapsed));
	}
}

/** Node output for a finished poll (done or needs action). */
export function formatPollOutput(result: PollRunResult): IDataObject {
	if (result.outcome === 'timedOut') {
		return {
			run_id: result.run.run_id ?? null,
			status: result.run.status ?? null,
			timedOut: true,
		};
	}
	const needsAction = result.outcome === 'needsAction';
	return {
		...result.run,
		needsAction,
		pendingAction: needsAction
			? ((describePendingAction(result.run) as unknown as IDataObject) ?? null)
			: null,
		timedOut: false,
	};
}
