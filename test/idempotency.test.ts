import { describe, expect, it } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	IDEMPOTENCY_KEY_PATTERN,
	buildIdempotencyKey,
	getIdempotencyKey,
	validateIdempotencyKey,
} from '../nodes/Hermes/helpers/idempotency';

function mockContext(runIndex = 0, executionId = 'exec-42') {
	return {
		getNode: () => ({
			id: 'b3a1c2d4-0000-4000-8000-000000000001',
			name: 'Hermes 1',
			type: 'n8n-nodes-hermes.hermes',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getExecutionId: () => executionId,
		getWorkflowDataProxy: () => ({ $runIndex: runIndex }),
	} as unknown as IExecuteFunctions;
}

describe('buildIdempotencyKey', () => {
	it('is deterministic, prefixed and 44 characters long', () => {
		const a = buildIdempotencyKey('e', 'n', 0, 0);
		expect(a).toBe(buildIdempotencyKey('e', 'n', 0, 0));
		expect(a).toMatch(/^n8n-[0-9a-f]{40}$/);
	});

	it('differs per item, run, node and execution', () => {
		const base = buildIdempotencyKey('e', 'n', 0, 0);
		expect(buildIdempotencyKey('e', 'n', 0, 1)).not.toBe(base);
		expect(buildIdempotencyKey('e', 'n', 1, 0)).not.toBe(base);
		expect(buildIdempotencyKey('e', 'm', 0, 0)).not.toBe(base);
		expect(buildIdempotencyKey('f', 'n', 0, 0)).not.toBe(base);
	});
});

describe('getIdempotencyKey', () => {
	it('passes the ASCII regex for a node named "Hermes 1" (name has a space)', () => {
		const key = getIdempotencyKey.call(mockContext(), 0);
		expect(key).toMatch(IDEMPOTENCY_KEY_PATTERN);
		expect(key).not.toContain(' ');
	});

	it('differs across runIndex (loops)', () => {
		const k0 = getIdempotencyKey.call(mockContext(0), 0);
		const k1 = getIdempotencyKey.call(mockContext(1), 0);
		expect(k0).not.toBe(k1);
	});

	it('is stable for the same execution, run and item', () => {
		expect(getIdempotencyKey.call(mockContext(2), 3)).toBe(
			getIdempotencyKey.call(mockContext(2), 3),
		);
	});

	it('returns a valid trimmed override as-is', () => {
		expect(getIdempotencyKey.call(mockContext(), 0, '  my-key_123  ')).toBe('my-key_123');
	});

	it('falls back to the default when the override is blank', () => {
		expect(getIdempotencyKey.call(mockContext(), 0, '   ')).toMatch(/^n8n-/);
	});

	it.each(['has space', 'ünïcode', 'x'.repeat(256), 'tab\there'])(
		'rejects invalid override %j',
		(override) => {
			expect(() => getIdempotencyKey.call(mockContext(), 0, override)).toThrow(NodeOperationError);
		},
	);
});

describe('validateIdempotencyKey', () => {
	it('accepts printable ASCII 1-255 chars', () => {
		expect(validateIdempotencyKey('a')).toBe(true);
		expect(validateIdempotencyKey('!~')).toBe(true);
		expect(validateIdempotencyKey('x'.repeat(255))).toBe(true);
	});

	it('rejects empty, spaces, non-ASCII and over-long keys', () => {
		expect(validateIdempotencyKey('')).toBe(false);
		expect(validateIdempotencyKey('a b')).toBe(false);
		expect(validateIdempotencyKey('é')).toBe(false);
		expect(validateIdempotencyKey('x'.repeat(256))).toBe(false);
	});
});
