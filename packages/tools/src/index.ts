// Define
export { defineTool } from './define'
export type { ToolConfig, ToolContext, Tool, ToolExecutionResult } from './define'

// Sandbox (process isolation for tool handlers)
export type { Capability, SandboxConfig, SandboxRunner } from './sandbox/index'

// Toolkit
export { createToolkit } from './toolkit'
export type { Toolkit } from './toolkit'

// Format
export { formatToolResult, formatToolResultAsText } from './format'

// Built-in tools
export { httpFetchTool, calculatorTool, jsonParseTool, currentTimeTool } from './builtin'

// Retrieval tool
export { createRetrievalTool } from './retrieval'
export type { RetrievalToolConfig, RetrievalResult, RetrieveFn } from './retrieval'

// Capability guard — opt-in wrapper that gates tool execution on a CapabilityToken
export { withCapability } from './capability-guard'
export type { CapabilityGuardOptions, CapabilityDenialEvent } from './capability-guard'

// Information-flow guard — gates a tool on the provenance of the context it
// runs in, complementing the capability check on the caller.
export { withFlowControl } from './flow-guard'
export type { FlowGuardOptions } from './flow-guard'

// Tool contracts — sideEffectLevel, preconditions, idempotency, dry-run, approval
export { createInMemoryIdempotencyStore } from './contracts'
export type {
	SideEffectLevel,
	PreconditionResult,
	PreconditionFn,
	PreconditionFailure,
	IdempotencyEntry,
	IdempotencyStore,
	InMemoryIdempotencyStoreConfig,
	ApprovalRequest,
	ApprovalDecision,
	ApprovalHandler,
	RequireApproval,
} from './contracts'
