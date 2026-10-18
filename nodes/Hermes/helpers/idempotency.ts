import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { createHash } from 'crypto';

/** Printable ASCII without spaces, 1–255 characters (what Hermes accepts for Idempotency-Key). */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

/**
 * Deterministic default key: `'n8n-' + sha256(executionId|nodeId|runIndex|itemIndex)` truncated
 * to 40 hex characters. Unique per item and per loop iteration, stable across retries of the same item.
 */
export function buildIdempotencyKey(
	executionId: string,
	nodeId: string,
	runIndex: number,
	itemIndex: number,
): string {
	const digest = createHash('sha256')
		.update(`${executionId}|${nodeId}|${runIndex}|${itemIndex}`, 'utf8')
		.digest('hex');
	return `n8n-${digest.slice(0, 40)}`;
}

/** True when `key` is an acceptable idempotency key. */
export function validateIdempotencyKey(key: string): boolean {
	return typeof key === 'string' && IDEMPOTENCY_KEY_PATTERN.test(key);
}

/**
 * Resolve the idempotency key for item `i`: the trimmed `override` when given (validated),
 * otherwise the deterministic default.
 */
export function getIdempotencyKey(this: IExecuteFunctions, i: number, override?: string): string {
	const trimmed = typeof override === 'string' ? override.trim() : '';
	if (trimmed) {
		if (!validateIdempotencyKey(trimmed)) {
			throw new NodeOperationError(
				this.getNode(),
				'Invalid idempotency key: use 1–255 printable ASCII characters without spaces',
				{ itemIndex: i },
			);
		}
		return trimmed;
	}
	const proxy = this.getWorkflowDataProxy(i);
	const runIndex = Number(proxy.$runIndex ?? 0);
	return buildIdempotencyKey(String(this.getExecutionId() ?? ''), this.getNode().id, runIndex, i);
}
