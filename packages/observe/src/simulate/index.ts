export {
	simulatePolicy,
	comparePolicies,
	formatSimulation,
	formatComparison,
} from './simulate'
export type { SimulateOptions } from './simulate'

export { flowPolicyProbe } from './flow-probe'
export type { FlowProbeOptions } from './flow-probe'

export { capabilityProbe } from './capability-probe'
export type { CapabilityProbeOptions } from './capability-probe'

export { verifyCorpus } from './corpus'
export type { VerifiedCorpus, RejectedTrace } from './corpus'

export type {
	PolicyComparison,
	PolicyProbe,
	PolicySimulation,
	SimulatedDecision,
} from './types'
