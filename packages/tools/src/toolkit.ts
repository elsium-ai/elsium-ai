import { ElsiumError } from '@elsium-ai/core'
import type { ToolDefinition } from '@elsium-ai/core'
import type { Tool, ToolContext, ToolExecutionResult } from './define'

export interface Toolkit {
	readonly name: string
	readonly tools: ReadonlyArray<Tool>

	getTool(name: string): Tool | undefined
	execute(
		toolName: string,
		input: unknown,
		context?: Partial<ToolContext>,
	): Promise<ToolExecutionResult>
	toDefinitions(): ToolDefinition[]
}

export function createToolkit(name: string, tools: Tool[]): Toolkit {
	const seen = new Set<string>()
	for (const tool of tools) {
		if (seen.has(tool.name)) {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: `Duplicate tool name "${tool.name}" in toolkit "${name}"`,
				retryable: false,
				metadata: { toolkit: name, tool: tool.name },
			})
		}
		seen.add(tool.name)
	}
	const toolMap = new Map(tools.map((t) => [t.name, t]))

	return {
		name,
		tools,

		getTool(toolName: string): Tool | undefined {
			return toolMap.get(toolName)
		},

		async execute(
			toolName: string,
			input: unknown,
			context?: Partial<ToolContext>,
		): Promise<ToolExecutionResult> {
			const tool = toolMap.get(toolName)
			if (!tool) {
				return {
					success: false,
					error: `Tool "${toolName}" not found in toolkit "${name}". Available: ${tools.map((t) => t.name).join(', ')}`,
					toolCallId: context?.toolCallId ?? 'unknown',
					durationMs: 0,
				}
			}

			return tool.execute(input, context)
		},

		toDefinitions(): ToolDefinition[] {
			return tools.map((t) => t.toDefinition())
		},
	}
}
