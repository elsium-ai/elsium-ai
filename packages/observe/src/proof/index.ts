export {
	createProofRecorder,
	verifyProof,
	PROOF_SESSION_METADATA_KEY,
	PROOF_VERSION,
} from './recorder'
export { compareProofs } from './compare'
export type { ReplayStrategy, ReplayDiff, EventDelta, EventDeltaKind } from './compare'
export type {
	ProofRecorder,
	ProofRecorderConfig,
	ProofSession,
	ProofSessionInputs,
	StartSessionOptions,
	FinalizeOptions,
} from './recorder'
export type {
	ExecutionProof,
	ProofEvent,
	ProofEventType,
	ReproducibilityHints,
	VerifyProofResult,
	LLMCallSummary,
	ToolCallSummary,
	RagRetrieveSummary,
	PolicyDecisionSummary,
	ProofInputDocRef,
} from './types'
