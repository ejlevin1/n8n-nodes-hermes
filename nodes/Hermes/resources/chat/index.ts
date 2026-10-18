import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { sendMessage, sendMessageDescription } from './sendMessage';

export const chatDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['chat'] } },
		options: [
			{
				name: 'Send Message',
				value: 'sendMessage',
				description: 'Send a message to the agent and wait for its reply',
				action: 'Send a message',
			},
		],
		default: 'sendMessage',
	},
	...sendMessageDescription,
];

export async function executeChat(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'sendMessage':
			return await sendMessage.call(this, i);
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported Chat operation: ${operation}`, {
				itemIndex: i,
			});
	}
}
