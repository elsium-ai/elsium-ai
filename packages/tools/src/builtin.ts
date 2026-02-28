import { z } from 'zod'
import { defineTool } from './define'

export const httpFetchTool = defineTool({
	name: 'http_fetch',
	description: 'Fetch content from a URL via HTTP GET request',
	input: z.object({
		url: z.string().url().describe('The URL to fetch'),
		headers: z.record(z.string()).optional().describe('Optional HTTP headers'),
	}),
	output: z.object({
		status: z.number(),
		body: z.string(),
		contentType: z.string(),
	}),
	timeoutMs: 15_000,
	handler: async ({ url, headers }, context) => {
		const response = await fetch(url, {
			headers,
			signal: context.signal,
		})

		const body = await response.text()
		const contentType = response.headers.get('content-type') ?? 'text/plain'

		return {
			status: response.status,
			body: body.length > 50_000 ? `${body.slice(0, 50_000)}\n...[truncated]` : body,
			contentType,
		}
	},
})

export const calculatorTool = defineTool({
	name: 'calculator',
	description:
		'Evaluate a mathematical expression. Supports basic arithmetic (+, -, *, /, **, %), Math functions (sqrt, abs, round, floor, ceil, sin, cos, tan, log, log2, log10, exp, PI, E).',
	input: z.object({
		expression: z.string().describe('The mathematical expression to evaluate'),
	}),
	output: z.object({
		result: z.number(),
	}),
	handler: async ({ expression }) => {
		const result = safeEval(expression)
		return { result }
	},
})

function safeEval(expr: string): number {
	const sanitized = expr.replace(/[^0-9+\-*/().,%\s a-zA-Z_]/g, '')

	const withMath = sanitized
		.replace(/\bsqrt\b/g, 'Math.sqrt')
		.replace(/\babs\b/g, 'Math.abs')
		.replace(/\bround\b/g, 'Math.round')
		.replace(/\bfloor\b/g, 'Math.floor')
		.replace(/\bceil\b/g, 'Math.ceil')
		.replace(/\bsin\b/g, 'Math.sin')
		.replace(/\bcos\b/g, 'Math.cos')
		.replace(/\btan\b/g, 'Math.tan')
		.replace(/\blog2\b/g, 'Math.log2')
		.replace(/\blog10\b/g, 'Math.log10')
		.replace(/\blog\b/g, 'Math.log')
		.replace(/\bexp\b/g, 'Math.exp')
		.replace(/\bPI\b/g, 'Math.PI')
		.replace(/\bE\b/g, 'Math.E')
		.replace(/\bpow\b/g, 'Math.pow')
		.replace(/\bmin\b/g, 'Math.min')
		.replace(/\bmax\b/g, 'Math.max')

	const fn = new Function(`'use strict'; return (${withMath})`)
	const result = fn()

	if (typeof result !== 'number' || !Number.isFinite(result)) {
		throw new Error(`Expression did not produce a finite number: ${expr}`)
	}

	return result
}

export const jsonParseTool = defineTool({
	name: 'json_parse',
	description: 'Parse a JSON string and extract a value at a given path',
	input: z.object({
		json: z.string().describe('The JSON string to parse'),
		path: z
			.string()
			.optional()
			.describe('Dot-separated path to extract (e.g. "data.items.0.name")'),
	}),
	output: z.object({
		value: z.unknown(),
	}),
	handler: async ({ json, path }) => {
		const parsed = JSON.parse(json)

		if (!path) return { value: parsed }

		let current: unknown = parsed
		for (const key of path.split('.')) {
			if (current == null || typeof current !== 'object') {
				return { value: undefined }
			}
			current = (current as Record<string, unknown>)[key]
		}

		return { value: current }
	},
})

export const currentTimeTool = defineTool({
	name: 'current_time',
	description: 'Get the current date and time in ISO format',
	input: z.object({
		timezone: z
			.string()
			.optional()
			.describe('IANA timezone (e.g. "America/New_York"). Defaults to UTC.'),
	}),
	output: z.object({
		iso: z.string(),
		unix: z.number(),
		timezone: z.string(),
	}),
	handler: async ({ timezone }) => {
		const now = new Date()
		const tz = timezone ?? 'UTC'

		return {
			iso: now.toLocaleString('en-US', { timeZone: tz }),
			unix: Math.floor(now.getTime() / 1000),
			timezone: tz,
		}
	},
})
