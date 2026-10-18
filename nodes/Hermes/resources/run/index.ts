import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { runFields, runOperationField } from './description';
import { executeRunOperation } from './operations';

export const runDescription: INodeProperties[] = [runOperationField, ...runFields];

export async function executeRun(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	return await executeRunOperation.call(this, operation, i);
}
