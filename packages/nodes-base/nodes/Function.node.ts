import { IExecuteFunctions } from 'n8n-core';
import {
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

const { NodeVM } = require('vm2');

export class Function implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Function',
		name: 'function',
		icon: 'fa:code',
		group: ['transform'],
		version: 1,
		description: 'Run custom function code which gets executed once and allows to add, remove, change and replace items.',
		defaults: {
			name: 'Function',
			color: '#FF9922',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'JavaScript Code',
				name: 'functionCode',
				typeOptions: {
					alwaysOpenEditWindow: true,
					editor: 'code',
					rows: 10,
				},
				type: 'string',
				default: 'items[0].json.myVariable = 1;\nreturn items;',
				description: 'The JavaScript code to execute.',
				noDataExpression: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// const item = this.getInputData();
		let items = this.getInputData();
		
		const returnData: INodeExecutionData[] = [];
		
		let item: INodeExecutionData;
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			item = items[itemIndex];
			const newItem: INodeExecutionData = {
				json: JSON.parse(JSON.stringify(item.json)),
			};

			if (item.binary !== undefined) {
				newItem.binary = {};
				Object.assign(newItem.binary, item.binary);
			}
			
			returnData.push(newItem);
		}

		// Define the global objects for the custom function
		const sandbox = {
			getNodeParameter: this.getNodeParameter,
			getWorkflowStaticData: this.getWorkflowStaticData,
			helpers: this.helpers,
			items: returnData,
			// To be able to access data of other items
			$item: (index: number) => this.getWorkflowDataProxy(index),
		};

		// Make it possible to access data via $node, $parameter, ...
		// By default use data from first item
		Object.assign(sandbox, sandbox.$item(0));

		const options = {
			console: 'inherit',
			sandbox,
			require: {
				external: false as boolean | { modules: string[] },
				builtin: [] as string[],
			},
		};

		if (process.env.NODE_FUNCTION_ALLOW_BUILTIN) {
			options.require.builtin = process.env.NODE_FUNCTION_ALLOW_BUILTIN.split(',');
		}

		if (process.env.NODE_FUNCTION_ALLOW_EXTERNAL) {
			options.require.external = { modules: process.env.NODE_FUNCTION_ALLOW_EXTERNAL.split(',') };
		}


		const vm = new NodeVM(options);

		// Get the code to execute
		const functionCode = this.getNodeParameter('functionCode', 0) as string;

		try {
			// Execute the function code
			returnData = (await vm.run(`module.exports = async function() {${functionCode}}()`, __dirname));
		} catch (error) {
			return Promise.reject(error);
		}


		// Do very basic validation of the data
		if (returnData === undefined) {
			throw new NodeOperationError(this.getNode(), 'No data got returned. Always return an Array of items!');
		}
		if (!Array.isArray(returnData)) {
			throw new NodeOperationError(this.getNode(), 'Always an Array of items has to be returned!');
		}
		for (const item of returnData) {
			if (item.json === undefined) {
				throw new NodeOperationError(this.getNode(), 'All returned items have to contain a property named "json"!');
			}
			if (typeof item.json !== 'object') {
				throw new NodeOperationError(this.getNode(), 'The json-property has to be an object!');
			}
			if (item.binary !== undefined) {
				if (Array.isArray(item.binary) || typeof item.binary !== 'object') {
					throw new NodeOperationError(this.getNode(), 'The binary-property has to be an object!');
				}
			}
		}

		return this.prepareOutputData(items);
	}
}
