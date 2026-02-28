import type { ToolResult } from '@elsium-ai/core'
import type { ToolExecutionResult } from './define'

export function formatToolResult(result: ToolExecutionResult): ToolResult {
	if (result.success) {
		return {
			toolCallId: result.toolCallId,
			content: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2),
		}
	}

	return {
		toolCallId: result.toolCallId,
		content: `Error: ${result.error}`,
		isError: true,
	}
}

export function formatToolResultAsText(result: ToolExecutionResult): string {
	if (result.success) {
		return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)
	}
	return `[Tool Error] ${result.error}`
}
