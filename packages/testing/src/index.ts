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

// Classification Metrics
export {
	computeConfusionMatrix,
	computeClassificationReport,
	runClassificationEval,
	formatClassificationReport,
	formatConfusionMatrix,
} from './classification'
export type {
	ClassificationCase,
	LabelMetrics,
	AverageMetrics,
	ConfusionMatrix,
	ClassificationReport,
	ClassificationOptions,
	ClassificationEvalCase,
	ClassificationEvalConfig,
	ClassificationPrediction,
	ClassificationEvalResult,
} from './classification'

// RAG Eval (faithfulness, relevancy, context precision/recall)
export {
	faithfulness,
	answerRelevancy,
	contextPrecision,
	contextRecall,
	runRagEval,
	formatRagEvalReport,
} from './rag-eval'
export type {
	RagMetricResult,
	FaithfulnessInput,
	AnswerRelevancyInput,
	ContextRelevanceInput,
	RagEvalCase,
	RagEvalConfig,
	RagCaseResult,
	RagEvalAggregate,
	RagEvalResult,
} from './rag-eval'

// Structured LLM-as-a-judge (rubric)
export { createRubricJudge } from './llm-judge'
export type {
	TextGenerator,
	RubricCriterion,
	RubricBreakdownItem,
	RubricJudgeResult,
	RubricJudgeConfig,
	RubricJudge,
} from './llm-judge'

// Judge alignment — is the judge trustworthy vs human ground-truth?
export {
	computeJudgeAlignment,
	runJudgeAlignment,
	assessJudgeConsistency,
} from './judge-alignment'
export type {
	AlignmentPair,
	JudgeAlignmentOptions,
	JudgeAlignmentResult,
	AgreementStrength,
	LabeledJudgeCase,
	JudgeScorer,
	JudgeConsistencyOptions,
	JudgeConsistencyResult,
} from './judge-alignment'

// Eval Attestation (signed, hash-chained, verifiable eval records)
// Ed25519 eval proofs — third-party-verifiable (offline, no shared secret)
export { proveEvalSuite, verifyEvalProof } from './eval-proof'
export type { EvalProofOptions } from './eval-proof'

export { attestEvalSuite, verifyEvalAttestation, formatAttestation } from './attestation'
export type {
	AttestationMetadata,
	AttestedOverride,
	AttestedGovernance,
	AttestationSummary,
	AttestationHeader,
	AttestationRecord,
	AttestationEntry,
	EvalAttestation,
	AttestEvalOptions,
	AttestationVerification,
} from './attestation'

// Eval-as-policy gate + compliance mapping
export {
	runEvalGate,
	toAttestedGovernance,
	buildEvalComplianceReport,
	formatEvalComplianceReport,
} from './eval-policy'
export type {
	GovernanceAssertion,
	EvalGateConfig,
	GovernanceViolation,
	EvalGateCaseResult,
	EvalGateResult,
	EvalComplianceControlResult,
	EvalComplianceReport,
	EvalComplianceReportOptions,
} from './eval-policy'

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
