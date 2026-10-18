import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { resourceLabels, resources, type ResourceValue } from './resources';

const registeredResources = (Object.keys(resources) as ResourceValue[]).sort((a, b) =>
	resourceLabels[a].name.localeCompare(resourceLabels[b].name),
);

const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: registeredResources.map((value) => ({
		name: resourceLabels[value].name,
		value,
		description: resourceLabels[value].description,
	})),
	default: 'chat',
};

const resourceProperties: INodeProperties[] = registeredResources.flatMap(
	(value) => resources[value]?.description ?? [],
);

export class Hermes implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Hermes',
		name: 'hermes',
		icon: { light: 'file:../../icons/hermes.svg', dark: 'file:../../icons/hermes.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Use Hermes Agent (Nous Research): chat with the agent, start async runs with approvals, and manage sessions, cron jobs and webhook routes',
		defaults: {
			name: 'Hermes',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'hermesApi',
				required: true,
				displayOptions: {
					hide: {
						resource: ['webhookRoute'],
					},
				},
			},
			{
				name: 'hermesWebhookApi',
				required: true,
				displayOptions: {
					show: {
						resource: ['webhookRoute'],
					},
				},
			},
		],
		properties: [resourceProperty, ...resourceProperties],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as ResourceValue;
				const operation = this.getNodeParameter('operation', i) as string;
				const definition = resources[resource];
				if (!definition) {
					throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`, {
						itemIndex: i,
					});
				}
				const results = await definition.execute.call(this, operation, i);
				for (const result of results) {
					returnData.push({ ...result, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					// Re-wrapping a NodeApiError returns the original instance.
					error.context.itemIndex ??= i;
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				if (error instanceof NodeOperationError) {
					error.context.itemIndex ??= i;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
