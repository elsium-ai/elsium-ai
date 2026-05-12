/**
 * Declarative policy engine (G3).
 *
 * ADR-0002 decision: built-in TypeScript evaluator (Option B).
 * Cedar (Option A) was considered and rejected for the MVP because:
 *  - The 8 operators we ship are ~100 LOC of TS — ~1.5MB of WASM is overkill.
 *  - Cedar's official node binding has friction (community forks exist).
 *  - PolicyEvaluator is a Strategy port — we can swap in Cedar later without
 *    a breaking change if the use case grows.
 *
 * MVP scope (fase 2a):
 *  - 8 condition operators: eq, ne, gt, lt, gte, lte, in, matches.
 *  - NO nested boolean composition (and/or/not) — those require multiple
 *    policies with priority instead, until fase 3.
 *
 * Coexists with closure-based policies in ./policy.ts during v0.x. Both APIs
 * remain supported; the declarative form is the recommended path going forward.
 */

import { ElsiumError } from './errors'
import type { Middleware, MiddlewareContext, MiddlewareNext } from './types'

// ─── Data model ─────────────────────────────────────────────────

export interface PolicyDocument {
	readonly apiVersion: 'elsium.policy/v1'
	readonly kind: 'Policy'
	readonly metadata: {
		readonly name: string
		readonly description?: string
		readonly tags?: readonly string[]
	}
	readonly spec: PolicySpec
}

export interface PolicySpec {
	readonly effect: 'allow' | 'deny'
	readonly subjects?: readonly SubjectSelector[]
	readonly actions: readonly ActionSelector[]
	readonly resources?: readonly ResourceSelector[]
	readonly when?: ConditionExpression
	/** Higher priority documents are evaluated first. Default 0. */
	readonly priority?: number
}

export type SubjectKind = 'role' | 'user' | 'tenant' | 'agent'

export interface SubjectSelector {
	readonly type: SubjectKind
	readonly match: MatchPattern
}

export interface ActionSelector {
	readonly type: 'model:use' | 'tool:call' | 'agent:execute' | 'workflow:run' | (string & {})
	readonly target?: MatchPattern
}

export type ResourceKind = 'model' | 'tool' | 'tenant' | 'workflow'

export interface ResourceSelector {
	readonly kind: ResourceKind
	readonly id: MatchPattern
}

/** Either an exact string, a membership test, or a regex. */
export type MatchPattern = string | { readonly in: readonly string[] } | { readonly regex: string }

/**
 * Condition expression — 8 simple ops, no nested boolean composition.
 * Nested and/or/not are deferred to fase 3 (or available out-of-the-box
 * if/when we add a Cedar evaluator alongside).
 */
export type ConditionExpression =
	| {
			readonly op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte'
			readonly field: string
			readonly value: string | number | boolean
	  }
	| { readonly op: 'in'; readonly field: string; readonly values: readonly (string | number)[] }
	| { readonly op: 'matches'; readonly field: string; readonly regex: string }

// ─── Bundle (set of policies) ────────────────────────────────────

export interface PolicyBundle {
	readonly apiVersion: 'elsium.policy/v1'
	readonly documents: readonly PolicyDocument[]
	readonly defaultEffect: 'allow' | 'deny'
}

// ─── Authorization request and result ───────────────────────────

export interface AuthorizationRequest {
	readonly principal: { readonly type: SubjectKind; readonly id: string }
	readonly action: { readonly type: string; readonly target?: string }
	readonly resource?: { readonly kind: ResourceKind; readonly id: string }
	readonly context?: Readonly<Record<string, string | number | boolean>>
}

export interface EvaluationResult {
	readonly decision: 'allow' | 'deny'
	readonly reason: string
	readonly matchedPolicy?: string
}

// ─── Evaluator (Strategy port) ──────────────────────────────────

export interface PolicyEvaluator {
	readonly name: 'builtin' | (string & {})
	evaluate(bundle: PolicyBundle, request: AuthorizationRequest): EvaluationResult
}

// ─── Verification issue (validation pre-execution) ──────────────

export interface VerificationIssue {
	readonly document: string
	readonly severity: 'error' | 'warning'
	readonly issue: string
}

// ─── Public façade ──────────────────────────────────────────────

export interface DeclarativePolicySet {
	evaluate(request: AuthorizationRequest): EvaluationResult
	load(bundle: PolicyBundle): void
	exportBundle(): PolicyBundle
	verify(bundle?: PolicyBundle): readonly VerificationIssue[]
	readonly evaluatorName: string
}

// ─── Pattern matchers ───────────────────────────────────────────

function matchesPattern(pattern: MatchPattern | undefined, value: string | undefined): boolean {
	if (pattern === undefined) return true
	if (value === undefined) return false
	if (typeof pattern === 'string') return pattern === value
	if ('in' in pattern) return pattern.in.includes(value)
	try {
		return new RegExp(pattern.regex).test(value)
	} catch {
		return false
	}
}

function subjectMatches(
	selectors: readonly SubjectSelector[] | undefined,
	principal: AuthorizationRequest['principal'],
): boolean {
	if (!selectors || selectors.length === 0) return true
	return selectors.some((s) => s.type === principal.type && matchesPattern(s.match, principal.id))
}

function actionMatches(
	selectors: readonly ActionSelector[],
	action: AuthorizationRequest['action'],
): boolean {
	if (selectors.length === 0) return false
	return selectors.some((s) => s.type === action.type && matchesPattern(s.target, action.target))
}

function resourceMatches(
	selectors: readonly ResourceSelector[] | undefined,
	resource: AuthorizationRequest['resource'],
): boolean {
	if (!selectors || selectors.length === 0) return true
	if (!resource) return false
	return selectors.some((s) => s.kind === resource.kind && matchesPattern(s.id, resource.id))
}

// ─── Condition evaluation (the 8 operators) ─────────────────────

function getCtxField(
	ctx: Readonly<Record<string, string | number | boolean>> | undefined,
	field: string,
): string | number | boolean | undefined {
	if (!ctx) return undefined
	return Object.prototype.hasOwnProperty.call(ctx, field) ? ctx[field] : undefined
}

function evalNumericComparison(
	op: 'gt' | 'lt' | 'gte' | 'lte',
	a: string | number | boolean,
	b: string | number | boolean,
): boolean {
	if (typeof a !== 'number' || typeof b !== 'number') return false
	switch (op) {
		case 'gt':
			return a > b
		case 'lt':
			return a < b
		case 'gte':
			return a >= b
		case 'lte':
			return a <= b
	}
}

function evalCondition(expr: ConditionExpression, ctx: AuthorizationRequest['context']): boolean {
	const value = getCtxField(ctx, expr.field)
	if (value === undefined) return false

	switch (expr.op) {
		case 'eq':
			return value === expr.value
		case 'ne':
			return value !== expr.value
		case 'gt':
		case 'lt':
		case 'gte':
		case 'lte':
			return evalNumericComparison(expr.op, value, expr.value)
		case 'in':
			return (typeof value === 'string' || typeof value === 'number') && expr.values.includes(value)
		case 'matches':
			if (typeof value !== 'string') return false
			try {
				return new RegExp(expr.regex).test(value)
			} catch {
				return false
			}
	}
}

// ─── Single-document match ──────────────────────────────────────

function documentMatches(doc: PolicyDocument, request: AuthorizationRequest): boolean {
	if (!subjectMatches(doc.spec.subjects, request.principal)) return false
	if (!actionMatches(doc.spec.actions, request.action)) return false
	if (!resourceMatches(doc.spec.resources, request.resource)) return false
	if (doc.spec.when && !evalCondition(doc.spec.when, request.context)) return false
	return true
}

// ─── Built-in evaluator ─────────────────────────────────────────

export function createBuiltinEvaluator(): PolicyEvaluator {
	return {
		name: 'builtin',
		evaluate(bundle: PolicyBundle, request: AuthorizationRequest): EvaluationResult {
			const sorted = [...bundle.documents].sort(
				(a, b) => (b.spec.priority ?? 0) - (a.spec.priority ?? 0),
			)

			for (const doc of sorted) {
				if (doc.spec.effect === 'deny' && documentMatches(doc, request)) {
					return {
						decision: 'deny',
						reason: `Denied by policy "${doc.metadata.name}"`,
						matchedPolicy: doc.metadata.name,
					}
				}
			}

			for (const doc of sorted) {
				if (doc.spec.effect === 'allow' && documentMatches(doc, request)) {
					return {
						decision: 'allow',
						reason: `Allowed by policy "${doc.metadata.name}"`,
						matchedPolicy: doc.metadata.name,
					}
				}
			}

			return {
				decision: bundle.defaultEffect,
				reason: `No matching policy; defaultEffect=${bundle.defaultEffect}`,
			}
		},
	}
}

// ─── Verification (pre-execution sanity checks) ─────────────────

function verifyRegex(source: string, docName: string, where: string): VerificationIssue | null {
	try {
		new RegExp(source)
	} catch (err) {
		return {
			document: docName,
			severity: 'error',
			issue: `${where}: invalid regex "${source}" — ${err instanceof Error ? err.message : String(err)}`,
		}
	}
	if (!source.startsWith('^') && !source.endsWith('$')) {
		return {
			document: docName,
			severity: 'warning',
			issue: `${where}: regex "${source}" is not anchored (^…$); may match unexpected substrings`,
		}
	}
	return null
}

function checkPattern(pattern: MatchPattern, docName: string, where: string): VerificationIssue[] {
	if (typeof pattern === 'string' || 'in' in pattern) return []
	const issue = verifyRegex(pattern.regex, docName, where)
	return issue ? [issue] : []
}

function checkDocumentDuplicates(documents: readonly PolicyDocument[]): VerificationIssue[] {
	const seen = new Map<string, number>()
	for (const doc of documents) {
		seen.set(doc.metadata.name, (seen.get(doc.metadata.name) ?? 0) + 1)
	}
	const issues: VerificationIssue[] = []
	for (const [name, count] of seen) {
		if (count > 1) {
			issues.push({
				document: name,
				severity: 'error',
				issue: `Duplicate policy name "${name}" (appears ${count} times)`,
			})
		}
	}
	return issues
}

function checkSingleDocument(doc: PolicyDocument): VerificationIssue[] {
	const issues: VerificationIssue[] = []
	const name = doc.metadata.name

	if (doc.spec.actions.length === 0) {
		issues.push({
			document: name,
			severity: 'error',
			issue: 'spec.actions must contain at least one ActionSelector',
		})
	}

	for (const subj of doc.spec.subjects ?? []) {
		issues.push(...checkPattern(subj.match, name, `subjects[${subj.type}]`))
	}
	for (const act of doc.spec.actions) {
		if (act.target !== undefined) {
			issues.push(...checkPattern(act.target, name, `actions[${act.type}].target`))
		}
	}
	for (const res of doc.spec.resources ?? []) {
		issues.push(...checkPattern(res.id, name, `resources[${res.kind}].id`))
	}

	if (doc.spec.when?.op === 'matches') {
		const r = verifyRegex(doc.spec.when.regex, name, 'when.matches')
		if (r) issues.push(r)
	}

	return issues
}

export function verifyBundle(bundle: PolicyBundle): readonly VerificationIssue[] {
	const issues: VerificationIssue[] = []
	for (const doc of bundle.documents) {
		issues.push(...checkSingleDocument(doc))
	}
	issues.push(...checkDocumentDuplicates(bundle.documents))
	return issues
}

// ─── Public factory ─────────────────────────────────────────────

export interface DeclarativePolicySetConfig {
	readonly bundle: PolicyBundle
	readonly evaluator?: PolicyEvaluator
	/**
	 * If true (default), throws on `error`-level verification issues at
	 * construction. Set false for permissive mode (warnings only).
	 */
	readonly strict?: boolean
}

export function createDeclarativePolicySet(
	config: DeclarativePolicySetConfig,
): DeclarativePolicySet {
	const evaluator = config.evaluator ?? createBuiltinEvaluator()
	let currentBundle: PolicyBundle = config.bundle

	function validate(b: PolicyBundle): void {
		const issues = verifyBundle(b)
		const errors = issues.filter((i) => i.severity === 'error')
		if (errors.length > 0 && config.strict !== false) {
			throw ElsiumError.validation(
				`PolicyBundle has ${errors.length} verification error(s): ${errors
					.map((e) => `[${e.document}] ${e.issue}`)
					.join('; ')}`,
			)
		}
	}

	validate(currentBundle)

	return {
		evaluatorName: evaluator.name,

		evaluate(request: AuthorizationRequest): EvaluationResult {
			return evaluator.evaluate(currentBundle, request)
		},

		load(bundle: PolicyBundle): void {
			validate(bundle)
			currentBundle = bundle
		},

		exportBundle(): PolicyBundle {
			return {
				apiVersion: currentBundle.apiVersion,
				defaultEffect: currentBundle.defaultEffect,
				documents: [...currentBundle.documents],
			}
		},

		verify(bundle?: PolicyBundle): readonly VerificationIssue[] {
			return verifyBundle(bundle ?? currentBundle)
		},
	}
}

// ─── Middleware adapter (gateway-side enforcement) ──────────────

/**
 * Translate a MiddlewareContext into an AuthorizationRequest for the
 * declarative policy set. Users supply the action/resource shape; the
 * principal is derived from ctx.tenant / ctx.metadata.
 */
export interface DeclarativePolicyMiddlewareConfig {
	policySet: DeclarativePolicySet
	deriveAction: (ctx: MiddlewareContext) => AuthorizationRequest['action']
	deriveResource?: (ctx: MiddlewareContext) => AuthorizationRequest['resource']
	deriveContext?: (ctx: MiddlewareContext) => AuthorizationRequest['context']
	derivePrincipal?: (ctx: MiddlewareContext) => AuthorizationRequest['principal']
}

function defaultPrincipal(ctx: MiddlewareContext): AuthorizationRequest['principal'] {
	if (ctx.tenant?.tenantId) return { type: 'tenant', id: ctx.tenant.tenantId }
	const user = ctx.metadata.userId
	if (typeof user === 'string' && user.length > 0) return { type: 'user', id: user }
	const agent = ctx.metadata.agentName
	if (typeof agent === 'string' && agent.length > 0) return { type: 'agent', id: agent }
	return { type: 'role', id: 'anonymous' }
}

export function declarativePolicyMiddleware(config: DeclarativePolicyMiddlewareConfig): Middleware {
	const derivePrincipal = config.derivePrincipal ?? defaultPrincipal
	return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
		const request: AuthorizationRequest = {
			principal: derivePrincipal(ctx),
			action: config.deriveAction(ctx),
			resource: config.deriveResource?.(ctx),
			context: config.deriveContext?.(ctx),
		}
		const result = config.policySet.evaluate(request)
		if (result.decision === 'deny') {
			throw ElsiumError.validation(`Policy denied: ${result.reason}`)
		}
		return next(ctx)
	}
}
