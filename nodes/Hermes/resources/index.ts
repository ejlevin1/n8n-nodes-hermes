import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { chatDescription, executeChat } from './chat';
import { executeJob, jobDescription } from './job';
import { executeKanbanTask, kanbanTaskDescription } from './kanbanTask';
import { executeResponse, responseDescription } from './response';
import { executeRun, runDescription } from './run';
import { executeSession, sessionDescription } from './session';
import { executeSystem, systemDescription } from './system';
import { executeWebhookRoute, webhookRouteDescription } from './webhookRoute';

export type ResourceValue =
	| 'chat'
	| 'response'
	| 'run'
	| 'session'
	| 'job'
	| 'kanbanTask'
	| 'system'
	| 'webhookRoute';

export type ResourceExecute = (
	this: IExecuteFunctions,
	operation: string,
	i: number,
) => Promise<INodeExecutionData[]>;

export interface ResourceDefinition {
	/** Operation dropdown + fields (each with `displayOptions.show.resource: [value]`). */
	description: INodeProperties[];
	execute: ResourceExecute;
}

/** Dropdown label and hint for every resource value (registered or not). */
export const resourceLabels: Record<ResourceValue, { name: string; description: string }> = {
	chat: { name: 'Chat', description: 'Send a message via the OpenAI-compatible chat endpoint' },
	job: { name: 'Cron Job', description: 'Manage scheduled agent jobs' },
	kanbanTask: {
		name: 'Kanban Task',
		description: 'Drive Hermes Kanban boards through the kanban-bridge plugin',
	},
	response: { name: 'Response', description: 'Create and manage stored Responses API results' },
	run: {
		name: 'Run',
		description: 'Start asynchronous agent runs, wait for them and handle approvals',
	},
	session: { name: 'Session', description: 'Manage Hermes sessions and their messages' },
	system: { name: 'System', description: 'Capabilities, health, models, skills and toolsets' },
	webhookRoute: {
		name: 'Webhook Route',
		description: 'Send a signed event to a Hermes webhook route',
	},
};

/**
 * Resource registry, keyed by Resource value. Each resource module adds exactly one entry:
 * `<value>: { description: <resource>Description, execute: execute<Resource> },`
 */
export const resources: Partial<Record<ResourceValue, ResourceDefinition>> = {
	chat: { description: chatDescription, execute: executeChat },
	job: { description: jobDescription, execute: executeJob },
	kanbanTask: { description: kanbanTaskDescription, execute: executeKanbanTask },
	response: { description: responseDescription, execute: executeResponse },
	run: { description: runDescription, execute: executeRun },
	session: { description: sessionDescription, execute: executeSession },
	system: { description: systemDescription, execute: executeSystem },
	webhookRoute: { description: webhookRouteDescription, execute: executeWebhookRoute },
};
