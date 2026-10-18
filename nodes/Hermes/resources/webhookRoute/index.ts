import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { sendEvent, sendEventDescription } from './sendEvent';

export const webhookRouteDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['webhookRoute'] } },
		options: [
			{
				name: 'Send Event',
				value: 'sendEvent',
				description:
					'Send a signed event to a webhook route. The agent reply is not returned; use the Hermes Trigger with post_llm_call to receive it.',
				action: 'Send an event to a webhook route',
			},
		],
		default: 'sendEvent',
	},
	...sendEventDescription,
];

export async function executeWebhookRoute(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'sendEvent':
			return await sendEvent.call(this, i);
		default:
			throw new NodeOperationError(
				this.getNode(),
				`Unsupported Webhook Route operation: ${operation}`,
				{ itemIndex: i },
			);
	}
}
