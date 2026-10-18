import { describe, expect, it } from 'vitest';
import {
	REASONING_EFFORTS,
	buildModelFields,
	modelOptionFields,
	timeoutMinutesToMs,
} from '../nodes/Hermes/helpers/modelOptions';

describe('buildModelFields', () => {
	it('maps model, provider and reasoning effort to Hermes fields', () => {
		expect(
			buildModelFields({
				model: ' anthropic/claude ',
				provider: 'openrouter',
				reasoningEffort: 'high',
			}),
		).toEqual({
			model: 'anthropic/claude',
			provider: 'openrouter',
			model_options: { reasoning: { effort: 'high' } },
		});
	});

	it('omits empty values', () => {
		expect(buildModelFields({ model: '', provider: '  ' })).toEqual({});
		expect(buildModelFields()).toEqual({});
	});

	it('ignores unknown efforts and normalises case', () => {
		expect(buildModelFields({ reasoningEffort: 'bogus' })).toEqual({});
		expect(buildModelFields({ reasoningEffort: 'XHigh' })).toEqual({
			model_options: { reasoning: { effort: 'xhigh' } },
		});
	});

	it('accepts every documented effort', () => {
		for (const effort of REASONING_EFFORTS) {
			expect(buildModelFields({ reasoningEffort: effort }).model_options?.reasoning.effort).toBe(
				effort,
			);
		}
	});
});

describe('modelOptionFields', () => {
	it('exposes model, provider and reasoningEffort with all effort values', () => {
		expect(modelOptionFields.map((f) => f.name)).toEqual(['model', 'provider', 'reasoningEffort']);
		const effort = modelOptionFields.find((f) => f.name === 'reasoningEffort');
		const values = (effort?.options as Array<{ value: string }>).map((o) => o.value).sort();
		expect(values).toEqual([...REASONING_EFFORTS].sort());
	});
});

describe('timeoutMinutesToMs', () => {
	it('converts minutes to milliseconds', () => {
		expect(timeoutMinutesToMs(2)).toBe(120_000);
		expect(timeoutMinutesToMs(0.5)).toBe(30_000);
	});

	it('defaults to 5 minutes when unset', () => {
		expect(timeoutMinutesToMs(undefined)).toBe(300_000);
		expect(timeoutMinutesToMs('')).toBe(300_000);
	});

	it('returns undefined for 0 or invalid values', () => {
		expect(timeoutMinutesToMs(0)).toBeUndefined();
		expect(timeoutMinutesToMs('abc')).toBeUndefined();
		expect(timeoutMinutesToMs(-1)).toBeUndefined();
	});
});
