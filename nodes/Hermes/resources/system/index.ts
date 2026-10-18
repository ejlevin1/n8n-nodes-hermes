import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { hermesApiRequest } from '../../transport/hermesApiRequest';

const showForSystem = { resource: ['system'] };

export const systemDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showForSystem },
		options: [
			{
				name: 'Get Capabilities',
				value: 'getCapabilities',
				description: 'Get the features and endpoints this Hermes API server supports',
				action: 'Get capabilities',
			},
			{
				name: 'Get Health',
				value: 'getHealth',
				description: 'Get detailed gateway health',
				action: 'Get health',
			},
			{
				name: 'List Model Options',
				value: 'listModelOptions',
				description: 'List providers and models that can be selected per request',
				action: 'List model options',
			},
			{
				name: 'List Models',
				value: 'listModels',
				description: 'List models exposed on the OpenAI-compatible endpoint',
				action: 'List models',
			},
			{
				name: 'List Skills',
				value: 'listSkills',
				description: 'List the skills available to the agent',
				action: 'List skills',
			},
			{
				name: 'List Toolsets',
				value: 'listToolsets',
				description: 'List the toolsets available to the agent',
				action: 'List toolsets',
			},
		],
		default: 'getCapabilities',
	},
];

function toItems(response: unknown): INodeExecutionData[] {
	if (Array.isArray(response)) {
		return response.map((entry) => ({
			json: (entry && typeof entry === 'object' ? entry : { value: entry }) as IDataObject,
		}));
	}
	if (response && typeof response === 'object') {
		return [{ json: response as IDataObject }];
	}
	return [{ json: { value: response as string } }];
}

/** Return the `data` array of an OpenAI-style list as items, else the whole response. */
function listToItems(response: unknown): INodeExecutionData[] {
	if (response && typeof response === 'object' && !Array.isArray(response)) {
		const data = (response as IDataObject).data;
		if (Array.isArray(data)) return toItems(data);
	}
	return toItems(response);
}

export async function executeSystem(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getCapabilities':
			return toItems(await hermesApiRequest.call(this, 'GET', '/v1/capabilities'));
		case 'getHealth':
			return toItems(await hermesApiRequest.call(this, 'GET', '/health/detailed'));
		case 'listModels':
			return listToItems(await hermesApiRequest.call(this, 'GET', '/v1/models'));
		case 'listModelOptions':
			return toItems(await hermesApiRequest.call(this, 'GET', '/api/model/options'));
		case 'listSkills':
			return listToItems(await hermesApiRequest.call(this, 'GET', '/v1/skills'));
		case 'listToolsets':
			return listToItems(await hermesApiRequest.call(this, 'GET', '/v1/toolsets'));
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported System operation: ${operation}`, {
				itemIndex: i,
			});
	}
}
