import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeProperties,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import {
	createHermesApiError,
	hermesApiRequest,
	normalizeHermesError,
	type HermesFullResponse,
} from '../../transport/hermesApiRequest';
import { jobFields, jobOperations } from './description';

export const jobDescription: INodeProperties[] = [jobOperations, ...jobFields];

/** Hermes cron job IDs: 12 lowercase hex characters. */
export const JOB_ID_PATTERN = /^[a-f0-9]{12}$/;
export const MAX_PROMPT_LENGTH = 5000;
export const MAX_NAME_LENGTH = 200;
/** The only fields `PATCH /api/jobs/{id}` applies (anything else is dropped by Hermes). */
export const JOB_UPDATE_ALLOWED_FIELDS = [
	'name',
	'schedule',
	'prompt',
	'deliver',
	'skills',
	'skill',
	'repeat',
	'enabled',
] as const;

export function isValidJobId(id: string): boolean {
	return JOB_ID_PATTERN.test(id);
}

/** Split a comma/newline separated skills list. */
export function parseSkills(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
	if (typeof raw !== 'string') return [];
	return raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Returns an error message when the prompt is too long, else undefined. */
export function checkPromptLength(prompt: unknown, label = 'Prompt'): string | undefined {
	if (typeof prompt !== 'string') return undefined;
	if (prompt.length > MAX_PROMPT_LENGTH) {
		return `${label} is ${prompt.length} characters; Hermes allows at most ${MAX_PROMPT_LENGTH}`;
	}
	return undefined;
}

/** Map the Update Fields collection to a PATCH body containing only allowed fields. */
export function buildJobUpdateBody(fields: IDataObject): IDataObject {
	const candidate: IDataObject = {};
	if (typeof fields.name === 'string' && fields.name.trim()) candidate.name = fields.name.trim();
	if (typeof fields.schedule === 'string' && fields.schedule.trim()) {
		candidate.schedule = fields.schedule.trim();
	}
	if (typeof fields.prompt === 'string') candidate.prompt = fields.prompt;
	if (typeof fields.deliver === 'string' && fields.deliver.trim()) {
		candidate.deliver = fields.deliver.trim();
	}
	if (fields.skills !== undefined) candidate.skills = parseSkills(fields.skills);
	if (fields.repeat !== undefined && fields.repeat !== null && fields.repeat !== '') {
		candidate.repeat = Number(fields.repeat);
	}
	if (typeof fields.enabled === 'boolean') candidate.enabled = fields.enabled;

	const allowed = new Set<string>(JOB_UPDATE_ALLOWED_FIELDS);
	const body: IDataObject = {};
	for (const [key, value] of Object.entries(candidate)) {
		if (allowed.has(key)) body[key] = value;
	}
	return body;
}

/** Map the Create parameters to the POST body. */
export function buildJobCreateBody(
	name: string,
	schedule: string,
	prompt: string,
	fields: IDataObject,
): IDataObject {
	const body: IDataObject = { name: name.trim(), schedule: schedule.trim(), prompt: prompt ?? '' };
	if (typeof fields.deliver === 'string' && fields.deliver.trim()) {
		body.deliver = fields.deliver.trim();
	}
	const skills = parseSkills(fields.skills);
	if (skills.length) body.skills = skills;
	if (fields.repeat !== undefined && fields.repeat !== null && fields.repeat !== '') {
		body.repeat = Number(fields.repeat);
	}
	if (typeof fields.paused === 'boolean') body.paused = fields.paused;
	if (typeof fields.pausedReason === 'string' && fields.pausedReason.trim()) {
		body.paused_reason = fields.pausedReason.trim();
	}
	return body;
}

/**
 * Friendly messages for the cron-specific failures: 400 from the prompt injection scan,
 * 501 when cron is not available and 424 when a job was saved but not registered.
 * Returns undefined for anything the shared transport already explains.
 */
export function cronErrorMessage(
	statusCode: number,
	body: unknown,
): { message: string; description?: string } | undefined {
	const normalized = normalizeHermesError(statusCode, body);
	const server = normalized.serverMessage ?? '';
	if (statusCode === 400 && /^blocked\b/i.test(server)) {
		return {
			message: 'Hermes blocked the cron prompt because it looks like a prompt injection',
			description: `${server} Rephrase the prompt and remove hidden characters, instructions to ignore rules, or commands that send data elsewhere.`,
		};
	}
	if (statusCode === 400 && /invalid job id/i.test(server)) {
		return { message: 'Invalid cron job ID: it must be 12 lowercase hex characters' };
	}
	if (statusCode === 501) {
		return {
			message: 'Cron jobs are not available on this Hermes server',
			description:
				server ||
				'The cron module could not be loaded by the API server. Check the Hermes installation.',
		};
	}
	if (statusCode === 424) {
		const obj = (body && typeof body === 'object' ? body : {}) as IDataObject;
		const jobId = typeof obj.job_id === 'string' ? obj.job_id : undefined;
		return {
			message: `The cron job${jobId ? ` ${jobId}` : ''} was saved but could not be registered with the scheduler`,
			description: `Do not create it again. Pause and resume it, or update it, to retry registration.${server ? ` ${server}` : ''}`,
		};
	}
	return undefined;
}

async function jobRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	i: number,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const response = (await hermesApiRequest.call(this, method, path, {
		body,
		qs,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	})) as HermesFullResponse;
	const statusCode = Number(response?.statusCode ?? 0);
	if (statusCode >= 200 && statusCode < 300) {
		return (response.body ?? {}) as IDataObject;
	}
	const friendly = cronErrorMessage(statusCode, response.body);
	if (friendly) {
		const resBody = response.body;
		throw new NodeApiError(
			this.getNode(),
			{
				statusCode,
				message: normalizeHermesError(statusCode, resBody).serverMessage ?? friendly.message,
				body: (resBody && typeof resBody === 'object'
					? resBody
					: String(resBody ?? '')) as JsonObject,
			},
			{
				message: friendly.message,
				description: friendly.description,
				httpCode: String(statusCode),
				itemIndex: i,
			},
		);
	}
	throw createHermesApiError(this.getNode(), statusCode, response.body, response.headers, i);
}

function getJobId(this: IExecuteFunctions, i: number): string {
	const id = String(this.getNodeParameter('jobId', i, '') ?? '').trim();
	if (!isValidJobId(id)) {
		throw new NodeOperationError(
			this.getNode(),
			`Invalid Job ID "${id}": it must be 12 lowercase hex characters`,
			{ itemIndex: i },
		);
	}
	return id;
}

function assertPrompt(this: IExecuteFunctions, prompt: unknown, i: number, label?: string): void {
	const err = checkPromptLength(prompt, label);
	if (err) throw new NodeOperationError(this.getNode(), err, { itemIndex: i });
}

function unwrapJob(body: IDataObject): IDataObject {
	return (body.job && typeof body.job === 'object' ? body.job : body) as IDataObject;
}

async function getAll(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const includeDisabled = this.getNodeParameter('includeDisabled', i, false) as boolean;
	const body = await jobRequest.call(
		this,
		'GET',
		'/api/jobs',
		i,
		undefined,
		includeDisabled ? { include_disabled: 'true' } : undefined,
	);
	let jobs = Array.isArray(body.jobs) ? (body.jobs as IDataObject[]) : [];
	if (!returnAll) {
		const limit = Math.max(1, Math.floor(Number(this.getNodeParameter('limit', i, 50)) || 50));
		jobs = jobs.slice(0, limit);
	}
	return jobs.map((json) => ({ json }));
}

async function create(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const name = String(this.getNodeParameter('name', i, '') ?? '');
	const schedule = String(this.getNodeParameter('schedule', i, '') ?? '');
	const prompt = String(this.getNodeParameter('prompt', i, '') ?? '');
	const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	if (!name.trim()) {
		throw new NodeOperationError(this.getNode(), 'Name must not be empty', { itemIndex: i });
	}
	if (name.trim().length > MAX_NAME_LENGTH) {
		throw new NodeOperationError(
			this.getNode(),
			`Name must be at most ${MAX_NAME_LENGTH} characters`,
			{ itemIndex: i },
		);
	}
	if (!schedule.trim()) {
		throw new NodeOperationError(this.getNode(), 'Schedule must not be empty', { itemIndex: i });
	}
	assertPrompt.call(this, prompt, i);
	const body = buildJobCreateBody(name, schedule, prompt, fields);
	if (
		body.repeat !== undefined &&
		(!Number.isInteger(body.repeat) || (body.repeat as number) < 1)
	) {
		throw new NodeOperationError(this.getNode(), 'Repeat must be a positive whole number', {
			itemIndex: i,
		});
	}
	return [{ json: unwrapJob(await jobRequest.call(this, 'POST', '/api/jobs', i, body)) }];
}

async function update(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const id = getJobId.call(this, i);
	const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
	const body = buildJobUpdateBody(fields);
	if (!Object.keys(body).length) {
		throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
			itemIndex: i,
		});
	}
	if (typeof body.name === 'string' && body.name.length > MAX_NAME_LENGTH) {
		throw new NodeOperationError(
			this.getNode(),
			`Name must be at most ${MAX_NAME_LENGTH} characters`,
			{ itemIndex: i },
		);
	}
	assertPrompt.call(this, body.prompt, i);
	if (
		body.repeat !== undefined &&
		(!Number.isInteger(body.repeat) || (body.repeat as number) < 1)
	) {
		throw new NodeOperationError(this.getNode(), 'Repeat must be a positive whole number', {
			itemIndex: i,
		});
	}
	return [
		{
			json: unwrapJob(
				await jobRequest.call(this, 'PATCH', `/api/jobs/${encodeURIComponent(id)}`, i, body),
			),
		},
	];
}

async function runNow(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const id = getJobId.call(this, i);
	const options = this.getNodeParameter('runOptions', i, {}) as IDataObject;
	const prompt = typeof options.prompt === 'string' ? options.prompt : '';
	assertPrompt.call(this, prompt, i, 'Extra Prompt');
	const body: IDataObject = prompt.trim() ? { prompt } : {};
	return [
		{
			json: unwrapJob(
				await jobRequest.call(this, 'POST', `/api/jobs/${encodeURIComponent(id)}/run`, i, body),
			),
		},
	];
}

export async function executeJob(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getAll':
			return await getAll.call(this, i);
		case 'create':
			return await create.call(this, i);
		case 'get': {
			const id = getJobId.call(this, i);
			return [
				{
					json: unwrapJob(
						await jobRequest.call(this, 'GET', `/api/jobs/${encodeURIComponent(id)}`, i),
					),
				},
			];
		}
		case 'update':
			return await update.call(this, i);
		case 'delete': {
			const id = getJobId.call(this, i);
			const res = await jobRequest.call(this, 'DELETE', `/api/jobs/${encodeURIComponent(id)}`, i);
			return [{ json: { id, deleted: res.ok === true || res.ok === undefined, ...res } }];
		}
		case 'pause':
		case 'resume': {
			const id = getJobId.call(this, i);
			const res = await jobRequest.call(
				this,
				'POST',
				`/api/jobs/${encodeURIComponent(id)}/${operation}`,
				i,
				{},
			);
			return [{ json: unwrapJob(res) }];
		}
		case 'run':
			return await runNow.call(this, i);
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported Cron Job operation: ${operation}`, {
				itemIndex: i,
			});
	}
}
