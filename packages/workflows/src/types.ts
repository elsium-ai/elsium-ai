import type { z } from 'zod'

// ─── Step ────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface StepConfig<TInput = unknown, TOutput = unknown> {
	name: string
	input?: z.ZodType<TInput>
	handler: (input: TInput, context: StepContext) => Promise<TOutput>
	retry?: RetryConfig
	condition?: (input: TInput, context: StepContext) => boolean
	fallback?: (error: Error, input: TInput) => Promise<TOutput>
	timeoutMs?: number
}

export interface StepContext {
	workflowName: string
	stepIndex: number
	previousOutputs: Record<string, unknown>
	signal?: AbortSignal
}

export interface StepResult<T = unknown> {
	name: string
	status: StepStatus
	data?: T
	error?: string
	durationMs: number
	retryCount: number
}

// ─── Retry ───────────────────────────────────────────────────────

export interface RetryConfig {
	maxRetries: number
	baseDelayMs?: number
	maxDelayMs?: number
	shouldRetry?: (error: Error) => boolean
}

// ─── Workflow ────────────────────────────────────────────────────

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused'

export interface WorkflowConfig {
	name: string
	steps: StepConfig[]
	onStepComplete?: (result: StepResult) => void | Promise<void>
	onStepError?: (error: Error, stepName: string) => void | Promise<void>
	onComplete?: (result: WorkflowResult) => void | Promise<void>
}

export interface WorkflowResult {
	name: string
	status: WorkflowStatus
	steps: StepResult[]
	totalDurationMs: number
	outputs: Record<string, unknown>
}

export interface WorkflowRunOptions {
	signal?: AbortSignal
}

// ─── DAG Workflow ───────────────────────────────────────────────

export interface DagStepConfig<TInput = unknown, TOutput = unknown>
	extends StepConfig<TInput, TOutput> {
	dependsOn?: string[]
}

export interface DagWorkflowConfig {
	name: string
	steps: DagStepConfig[]
	onStepComplete?: (result: StepResult) => void | Promise<void>
	onStepError?: (error: Error, stepName: string) => void | Promise<void>
	onComplete?: (result: WorkflowResult) => void | Promise<void>
}
