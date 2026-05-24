// Mock Provider
export { mockProvider } from './mock-provider'
export type { MockProvider, MockProviderOptions, MockResponseConfig } from './mock-provider'

// Fixtures
export { createFixture, loadFixture, createRecorder } from './fixtures'
export type { Fixture, FixtureEntry, FixtureRecorder } from './fixtures'

// Eval
export { runEvalSuite, formatEvalReport } from './eval'
export type {
	EvalCase,
	EvalCriterion,
	EvalResult,
	CriterionResult,
	EvalSuiteConfig,
	EvalSuiteResult,
	LLMJudge,
} from './eval'

// Snapshot
export { createSnapshotStore, hashOutput, testSnapshot } from './snapshot'
export type { PromptSnapshot, SnapshotStore, SnapshotTestResult } from './snapshot'

// Prompts
export { createPromptRegistry, definePrompt } from './prompts'
export type { PromptDefinition, PromptDiff, DiffLine, PromptRegistry } from './prompts'

// Regression
export { createRegressionSuite } from './regression'
export type {
	RegressionBaseline,
	RegressionResult,
	RegressionDetail,
	RegressionSuite,
} from './regression'

// Budgeted regression suite (O3 — per-case tolerance + maxDelta)
export { createBudgetedRegressionSuite } from './regression-budgets'
export type {
	BudgetedCaseResult,
	BudgetedRegressionBaseline,
	BudgetedRegressionCase,
	BudgetedRegressionReport,
	BudgetedRegressionSuite,
	CaseOutcome,
} from './regression-budgets'

// Replay
export { createReplayRecorder, createReplayPlayer, hashRequest } from './replay'
export type {
	ReplayEntry,
	ReplayMatchStrategy,
	ReplayPlayer,
	ReplayPlayerOptions,
	ReplayRecorder,
} from './replay'

// Trace replay with variable substitution (O4)
export { applyOverride, replayWithOverride } from './trace-replay-override'
export type {
	OverrideEntryComparison,
	OverrideReport,
	TraceOverride,
} from './trace-replay-override'

// Audit-grade signed replay + streaming replay (R5)
export {
	createSignedReplayRecorder,
	createSignedReplayPlayer,
	createStreamReplayRecorder,
	createStreamReplayPlayer,
	verifyReplay,
} from './replay-audit'
export type {
	ReplayVerification,
	SignedReplayEntry,
	SignedReplayFile,
	SignedReplayPlayer,
	SignedReplayPlayerOptions,
	SignedReplayRecorder,
	SignedReplayRecorderConfig,
	StreamReplayEntry,
	StreamReplayPlayer,
	StreamReplayRecorder,
} from './replay-audit'

// Pinning
export { createPinStore, pinOutput } from './pinning'
export type { Pin, PinStore, PinResult } from './pinning'

// Determinism
export { assertDeterministic, assertStable } from './determinism'
export type { DeterminismResult, StabilityResult } from './determinism'

// Dataset
export { loadDataset, loadDatasetFromJSON, loadDatasetFromCSV } from './dataset'
export type { EvalDataset, DatasetLoaderOptions } from './dataset'

// Eval Comparison
export { saveBaseline, loadBaseline, compareResults, formatComparison } from './eval-compare'
export type { EvalBaseline, EvalComparison } from './eval-compare'

// Tool Assertions
export { assertToolCalls, toolCallsToEvalCriteria } from './tool-assertions'
export type { ToolCallEntry, ToolAssertion, ToolAssertionResult } from './tool-assertions'

// Multi-Turn Conversation
export { runConversation, formatConversationReport } from './multi-turn'
export type {
	ConversationTurn,
	TurnAssertion,
	TurnResult,
	ConversationScenarioConfig,
	ConversationResult,
} from './multi-turn'

// Red Team
export {
	getBuiltInProbes,
	getBuiltInMultiTurnProbes,
	runRedTeam,
	formatRedTeamReport,
} from './red-team'
export type {
	AttackCategory,
	AttackProbe,
	MultiTurnAttackProbe,
	RedTeamConfig,
	ProbeResult,
	MultiTurnProbeResult,
	RedTeamResult,
} from './red-team'

// Agent Metrics
export { computeAgentMetrics, computeToolMetrics, formatAgentMetrics } from './agent-metrics'
export type { AgentMetrics, ToolMetrics } from './agent-metrics'

// CI Reporter
export { toJUnitXML, toGitHubAnnotations, toMarkdownSummary } from './ci-reporter'

// Agent Eval
export { runAgentEval, formatAgentEvalReport } from './agent-eval'
export type {
	AgentEvalCase,
	AgentEvalConfig,
	AgentEvalCaseResult,
	AgentEvalResult,
} from './agent-eval'

// replayFrom — time-travel replay with overrides
export { createTraceRecorder, replayFrom } from './replay-from'
export type {
	TraceStep,
	AgentTrace,
	TraceRecorder,
	TraceRecorderConfig,
	StepExecutor,
	StepOverride,
	ReplayFromOptions,
	ReplayedStep,
	ReplayResult,
} from './replay-from'
