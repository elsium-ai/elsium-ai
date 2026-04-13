import { describe, expect, it } from 'vitest'
import { toGitHubAnnotations, toJUnitXML, toMarkdownSummary } from './ci-reporter'
import type { EvalSuiteResult } from './eval'
import type { ConversationResult } from './multi-turn'
import type { RedTeamResult } from './red-team'

const evalResult: EvalSuiteResult = {
	name: 'quality-check',
	total: 3,
	passed: 2,
	failed: 1,
	score: 0.667,
	results: [
		{
			name: 'test-1',
			passed: true,
			score: 1,
			criteria: [{ type: 'contains', passed: true, message: 'Contains "hello"' }],
			input: 'hi',
			output: 'hello world',
			durationMs: 50,
			tags: [],
		},
		{
			name: 'test-2',
			passed: true,
			score: 1,
			criteria: [],
			input: 'bye',
			output: 'goodbye',
			durationMs: 30,
			tags: [],
		},
		{
			name: 'test-3',
			passed: false,
			score: 0,
			criteria: [{ type: 'contains', passed: false, message: 'Does not contain "expected"' }],
			input: 'fail',
			output: 'wrong',
			durationMs: 40,
			tags: [],
		},
	],
	durationMs: 120,
}

const conversationResult: ConversationResult = {
	name: 'chat-flow',
	passed: false,
	turns: [
		{
			turnIndex: 0,
			name: 'greeting',
			input: 'hi',
			output: 'hello',
			toolCalls: [],
			usage: {
				totalInputTokens: 10,
				totalOutputTokens: 5,
				totalTokens: 15,
				totalCost: 0,
				iterations: 1,
			},
			durationMs: 100,
			assertions: [{ type: 'response_contains', passed: true, message: 'Contains "hello"' }],
			passed: true,
		},
		{
			turnIndex: 1,
			name: 'follow-up',
			input: 'search',
			output: 'no results',
			toolCalls: [],
			usage: {
				totalInputTokens: 10,
				totalOutputTokens: 5,
				totalTokens: 15,
				totalCost: 0,
				iterations: 1,
			},
			durationMs: 150,
			assertions: [{ type: 'tool_called', passed: false, message: '"search" was never called' }],
			passed: false,
		},
	],
	totalDurationMs: 250,
	totalTokens: 30,
	totalCost: 0,
	totalToolCalls: 0,
	tags: [],
}

const redTeamResult: RedTeamResult = {
	name: 'security-audit',
	total: 2,
	passed: 1,
	compromised: 1,
	errored: 0,
	results: [
		{
			probe: {
				name: 'safe-probe',
				category: 'jailbreak',
				input: 'x',
				detectCompromise: () => false,
				severity: 'low',
			},
			output: 'refused',
			compromised: false,
			durationMs: 20,
		},
		{
			probe: {
				name: 'vuln-probe',
				category: 'prompt_injection',
				input: 'y',
				detectCompromise: () => true,
				severity: 'high',
			},
			output: 'HACKED',
			compromised: true,
			durationMs: 30,
		},
	],
	multiTurnResults: [],
	byCategory: {
		prompt_injection: { total: 1, compromised: 1 },
		jailbreak: { total: 1, compromised: 0 },
		data_extraction: { total: 0, compromised: 0 },
		persona_override: { total: 0, compromised: 0 },
		instruction_bypass: { total: 0, compromised: 0 },
	},
	score: 0.5,
	durationMs: 50,
}

describe('toJUnitXML', () => {
	it('generates valid XML for eval results', () => {
		const xml = toJUnitXML(evalResult)
		expect(xml).toContain('<?xml version="1.0"')
		expect(xml).toContain('testsuite name="quality-check"')
		expect(xml).toContain('tests="3"')
		expect(xml).toContain('failures="1"')
		expect(xml).toContain('testcase name="test-1"')
		expect(xml).toContain('<failure')
		expect(xml).toContain('Does not contain')
	})

	it('generates valid XML for conversation results', () => {
		const xml = toJUnitXML(conversationResult)
		expect(xml).toContain('testsuite name="chat-flow"')
		expect(xml).toContain('tests="2"')
		expect(xml).toContain('failures="1"')
		expect(xml).toContain('testcase name="greeting"')
		expect(xml).toContain('testcase name="follow-up"')
	})

	it('generates valid XML for red team results', () => {
		const xml = toJUnitXML(redTeamResult)
		expect(xml).toContain('testsuite name="security-audit"')
		expect(xml).toContain('failures="1"')
		expect(xml).toContain('compromised')
	})

	it('escapes XML special characters', () => {
		const result: EvalSuiteResult = {
			...evalResult,
			name: 'test <&> "suite"',
		}
		const xml = toJUnitXML(result)
		expect(xml).toContain('&lt;&amp;&gt;')
		expect(xml).toContain('&quot;suite&quot;')
	})
})

describe('toGitHubAnnotations', () => {
	it('generates error annotations for failures', () => {
		const annotations = toGitHubAnnotations(evalResult)
		expect(annotations).toContain('::error title=quality-check: test-3::')
		expect(annotations).toContain('Does not contain')
	})

	it('generates notice for all-passing suite', () => {
		const passing: EvalSuiteResult = {
			...evalResult,
			failed: 0,
			results: evalResult.results.filter((r) => r.passed),
		}
		const annotations = toGitHubAnnotations(passing)
		expect(annotations).toContain('::notice')
		expect(annotations).toContain('All 2 checks passed')
	})

	it('generates annotations for red team', () => {
		const annotations = toGitHubAnnotations(redTeamResult)
		expect(annotations).toContain('::error')
		expect(annotations).toContain('vuln-probe')
		expect(annotations).toContain('compromised')
	})
})

describe('toMarkdownSummary', () => {
	it('generates markdown table for eval results', () => {
		const md = toMarkdownSummary(evalResult)
		expect(md).toContain('## ')
		expect(md).toContain('quality-check')
		expect(md).toContain('| Status | Test | Duration |')
		expect(md).toContain('test-1')
		expect(md).toContain('2/3 passed')
		expect(md).toContain('Failures')
	})

	it('includes security score for red team', () => {
		const md = toMarkdownSummary(redTeamResult)
		expect(md).toContain('Security Score')
		expect(md).toContain('50.0%')
		expect(md).toContain('1 compromised')
	})

	it('does not show failures section when all pass', () => {
		const passing: EvalSuiteResult = {
			...evalResult,
			failed: 0,
			results: evalResult.results.filter((r) => r.passed),
		}
		const md = toMarkdownSummary(passing)
		expect(md).not.toContain('Failures')
		expect(md).not.toContain('<details>')
	})

	it('generates markdown for conversation results', () => {
		const md = toMarkdownSummary(conversationResult)
		expect(md).toContain('chat-flow')
		expect(md).toContain('greeting')
		expect(md).toContain('follow-up')
		expect(md).toContain('1/2 passed')
	})
})
