export {
	createLabel,
	declassify,
	dominates,
	emptyLabel,
	formatLabel,
	joinAll,
	joinLabels,
	taint,
} from './label'
export type { LabelInit } from './label'

export { createFlowPolicy, lethalTrifectaRule } from './policy'

export { createFlowTracker } from './tracker'
export type { FlowTrackerConfig } from './tracker'

export type {
	FlowCondition,
	FlowDecision,
	FlowPolicy,
	FlowRule,
	FlowTracker,
	Origin,
	Sink,
	Tainted,
	TaintLabel,
} from './types'
