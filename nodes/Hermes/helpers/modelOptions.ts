import type { IDataObject, INodeProperties } from 'n8n-workflow';

export const REASONING_EFFORTS = [
	'none',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
	'ultra',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Hint shown next to Model/Provider on Chat and Response operations. */
export const MODEL_HINT =
	'Model is ignored unless Provider is set, or the server enables <code>direct_model_requests</code>';

/**
 * Model / Provider / Reasoning Effort fields. Meant to be spread into an "Options" collection:
 * `options: [...modelOptionFields, ...]`. They read back as `model`, `provider`, `reasoningEffort`.
 */
export const modelOptionFields: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'model',
		type: 'string',
		default: '',
		placeholder: 'e.g. anthropic/claude-sonnet-4',
		description: `Model to run this request with. ${MODEL_HINT}.`,
	},
	{
		displayName: 'Provider',
		name: 'provider',
		type: 'string',
		default: '',
		placeholder: 'e.g. openrouter',
		description: 'Inference provider to use for this request (as configured in Hermes)',
	},
	{
		displayName: 'Reasoning Effort',
		name: 'reasoningEffort',
		type: 'options',
		default: 'medium',
		description: 'Reasoning effort requested from the model. "None" disables reasoning.',
		options: [
			{ name: 'Extra High', value: 'xhigh' },
			{ name: 'High', value: 'high' },
			{ name: 'Low', value: 'low' },
			{ name: 'Max', value: 'max' },
			{ name: 'Medium', value: 'medium' },
			{ name: 'Minimal', value: 'minimal' },
			{ name: 'None', value: 'none' },
			{ name: 'Ultra', value: 'ultra' },
		],
	},
];

export interface ModelFields {
	model?: string;
	provider?: string;
	model_options?: { reasoning: { effort: string } };
}

/**
 * Convert collection values `{model?, provider?, reasoningEffort?}` into the Hermes request
 * fields `{model?, provider?, model_options?: {reasoning: {effort}}}`. Empty values are omitted.
 */
export function buildModelFields(options: IDataObject = {}): ModelFields {
	const result: ModelFields = {};
	const model = typeof options.model === 'string' ? options.model.trim() : '';
	const provider = typeof options.provider === 'string' ? options.provider.trim() : '';
	const effort =
		typeof options.reasoningEffort === 'string' ? options.reasoningEffort.trim().toLowerCase() : '';
	if (model) result.model = model;
	if (provider) result.provider = provider;
	if (effort && (REASONING_EFFORTS as readonly string[]).includes(effort)) {
		result.model_options = { reasoning: { effort } };
	}
	return result;
}

/** Shared "Timeout" option (minutes) for synchronous agent calls. Default 5 minutes. */
export const timeoutOption: INodeProperties = {
	displayName: 'Timeout (Minutes)',
	name: 'timeout',
	type: 'number',
	typeOptions: { minValue: 0 },
	default: 5,
	description: 'How long to wait for the agent to answer before failing. 0 uses the n8n default.',
};

/** Convert the Timeout option (minutes) to milliseconds; undefined when unset/0. */
export function timeoutMinutesToMs(value: unknown, fallbackMinutes = 5): number | undefined {
	const minutes =
		value === undefined || value === null || value === '' ? fallbackMinutes : Number(value);
	if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
	return Math.round(minutes * 60_000);
}
