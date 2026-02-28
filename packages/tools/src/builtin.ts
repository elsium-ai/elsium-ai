import { z } from 'zod'
import { defineTool } from './define'

// C3 fix: Block requests to private/internal networks
const BLOCKED_HOSTS =
	/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1\]|\[fd[0-9a-f]{2}:)/i

function validateUrl(urlString: string): void {
	const parsed = new URL(urlString)
	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new Error(`Blocked protocol: ${parsed.protocol}`)
	}
	if (BLOCKED_HOSTS.test(parsed.hostname)) {
		throw new Error('Requests to private/internal networks are not allowed')
	}
}

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
		validateUrl(url)

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

// C1 fix: Safe math expression parser — no new Function() / eval
const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
	sqrt: Math.sqrt,
	abs: Math.abs,
	round: Math.round,
	floor: Math.floor,
	ceil: Math.ceil,
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	log2: Math.log2,
	log10: Math.log10,
	log: Math.log,
	exp: Math.exp,
	pow: Math.pow,
	min: Math.min,
	max: Math.max,
}

const MATH_CONSTANTS: Record<string, number> = {
	PI: Math.PI,
	E: Math.E,
}

interface Token {
	type: 'number' | 'op' | 'lparen' | 'rparen' | 'func' | 'const' | 'comma'
	value: string
}

function readNumber(expr: string, start: number): { token: Token; next: number } {
	let num = ''
	let i = start
	while (i < expr.length && /[0-9.eE]/.test(expr[i])) {
		num += expr[i++]
	}
	return { token: { type: 'number', value: num }, next: i }
}

function readIdentifier(expr: string, start: number): { token: Token; next: number } {
	let name = ''
	let i = start
	while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
		name += expr[i++]
	}
	if (name in MATH_FUNCTIONS) {
		return { token: { type: 'func', value: name }, next: i }
	}
	if (name in MATH_CONSTANTS) {
		return { token: { type: 'const', value: name }, next: i }
	}
	throw new Error(`Unknown identifier: ${name}`)
}

function readOperator(expr: string, start: number): { token: Token; next: number } {
	if (expr[start] === '*' && expr[start + 1] === '*') {
		return { token: { type: 'op', value: '**' }, next: start + 2 }
	}
	return { token: { type: 'op', value: expr[start] }, next: start + 1 }
}

function tokenize(expr: string): Token[] {
	const tokens: Token[] = []
	let i = 0
	while (i < expr.length) {
		if (/\s/.test(expr[i])) {
			i++
			continue
		}
		if (/[0-9.]/.test(expr[i])) {
			const result = readNumber(expr, i)
			tokens.push(result.token)
			i = result.next
			continue
		}
		if (/[a-zA-Z_]/.test(expr[i])) {
			const result = readIdentifier(expr, i)
			tokens.push(result.token)
			i = result.next
			continue
		}
		if ('+-*/%'.includes(expr[i])) {
			const result = readOperator(expr, i)
			tokens.push(result.token)
			i = result.next
			continue
		}
		if (expr[i] === '(') {
			tokens.push({ type: 'lparen', value: '(' })
			i++
			continue
		}
		if (expr[i] === ')') {
			tokens.push({ type: 'rparen', value: ')' })
			i++
			continue
		}
		if (expr[i] === ',') {
			tokens.push({ type: 'comma', value: ',' })
			i++
			continue
		}
		throw new Error(`Unexpected character: ${expr[i]}`)
	}
	return tokens
}

function parseExpression(tokens: Token[], pos: { i: number }): number {
	let left = parseTerm(tokens, pos)
	while (
		pos.i < tokens.length &&
		tokens[pos.i]?.type === 'op' &&
		'+-'.includes(tokens[pos.i].value)
	) {
		const op = tokens[pos.i++].value
		const right = parseTerm(tokens, pos)
		left = op === '+' ? left + right : left - right
	}
	return left
}

function parseTerm(tokens: Token[], pos: { i: number }): number {
	let left = parseExponent(tokens, pos)
	while (
		pos.i < tokens.length &&
		tokens[pos.i]?.type === 'op' &&
		'*/%'.includes(tokens[pos.i].value)
	) {
		const op = tokens[pos.i++].value
		const right = parseExponent(tokens, pos)
		if (op === '*') left *= right
		else if (op === '/') left /= right
		else left %= right
	}
	return left
}

function parseExponent(tokens: Token[], pos: { i: number }): number {
	let base = parseUnary(tokens, pos)
	while (pos.i < tokens.length && tokens[pos.i]?.type === 'op' && tokens[pos.i].value === '**') {
		pos.i++
		const exp = parseUnary(tokens, pos)
		base = base ** exp
	}
	return base
}

function parseUnary(tokens: Token[], pos: { i: number }): number {
	if (pos.i < tokens.length && tokens[pos.i]?.type === 'op' && tokens[pos.i].value === '-') {
		pos.i++
		return -parseUnary(tokens, pos)
	}
	if (pos.i < tokens.length && tokens[pos.i]?.type === 'op' && tokens[pos.i].value === '+') {
		pos.i++
		return parseUnary(tokens, pos)
	}
	return parseAtom(tokens, pos)
}

function parseNumberAtom(token: Token, pos: { i: number }): number {
	pos.i++
	const val = Number(token.value)
	if (!Number.isFinite(val)) throw new Error(`Invalid number: ${token.value}`)
	return val
}

function parseFuncCall(token: Token, tokens: Token[], pos: { i: number }): number {
	const fn = MATH_FUNCTIONS[token.value]
	pos.i++
	if (tokens[pos.i]?.type !== 'lparen') throw new Error(`Expected ( after ${token.value}`)
	pos.i++ // skip (
	const args: number[] = []
	if (tokens[pos.i]?.type !== 'rparen') {
		args.push(parseExpression(tokens, pos))
		while (tokens[pos.i]?.type === 'comma') {
			pos.i++
			args.push(parseExpression(tokens, pos))
		}
	}
	if (tokens[pos.i]?.type !== 'rparen') throw new Error(`Expected ) after ${token.value} arguments`)
	pos.i++ // skip )
	return fn(...args)
}

function parseParenExpr(tokens: Token[], pos: { i: number }): number {
	pos.i++
	const val = parseExpression(tokens, pos)
	if (tokens[pos.i]?.type !== 'rparen') throw new Error('Mismatched parentheses')
	pos.i++
	return val
}

function parseAtom(tokens: Token[], pos: { i: number }): number {
	const token = tokens[pos.i]
	if (!token) throw new Error('Unexpected end of expression')

	if (token.type === 'number') return parseNumberAtom(token, pos)

	if (token.type === 'const') {
		pos.i++
		return MATH_CONSTANTS[token.value]
	}

	if (token.type === 'func') return parseFuncCall(token, tokens, pos)

	if (token.type === 'lparen') return parseParenExpr(tokens, pos)

	throw new Error(`Unexpected token: ${token.value}`)
}

function safeEval(expr: string): number {
	const tokens = tokenize(expr)
	if (tokens.length === 0) throw new Error('Empty expression')
	const pos = { i: 0 }
	const result = parseExpression(tokens, pos)
	if (pos.i < tokens.length) throw new Error(`Unexpected token: ${tokens[pos.i].value}`)
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
		const parsed = JSON.parse(json, (key, value) => {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined
			return value
		})

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
