import { ElsiumError } from '@elsium-ai/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
	calculatorTool,
	createToolkit,
	currentTimeTool,
	defineTool,
	formatToolResult,
	formatToolResultAsText,
	httpFetchTool,
	jsonParseTool,
} from './index'

// ─── defineTool ──────────────────────────────────────────────────

describe('defineTool', () => {
	const greetTool = defineTool({
		name: 'greet',
		description: 'Greet a person',
		input: z.object({
			name: z.string(),
			formal: z.boolean().optional(),
		}),
		output: z.object({
			greeting: z.string(),
		}),
		handler: async ({ name, formal }) => ({
			greeting: formal ? `Good day, ${name}.` : `Hey ${name}!`,
		}),
	})

	it('executes with valid input', async () => {
		const result = await greetTool.execute({ name: 'Alice' })
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ greeting: 'Hey Alice!' })
		expect(result.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('executes with optional params', async () => {
		const result = await greetTool.execute({ name: 'Bob', formal: true })
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ greeting: 'Good day, Bob.' })
	})

	it('fails on invalid input', async () => {
		const result = await greetTool.execute({ name: 123 })
		expect(result.success).toBe(false)
		expect(result.error).toContain('Invalid input')
	})

	it('fails on missing required fields', async () => {
		const result = await greetTool.execute({})
		expect(result.success).toBe(false)
		expect(result.error).toContain('Invalid input')
	})

	it('catches handler errors', async () => {
		const failTool = defineTool({
			name: 'fail',
			description: 'Always fails',
			input: z.object({}),
			handler: async () => {
				throw new Error('boom')
			},
		})

		const result = await failTool.execute({})
		expect(result.success).toBe(false)
		expect(result.error).toBe('boom')
	})

	it('validates output schema', async () => {
		const badOutputTool = defineTool({
			name: 'bad_output',
			description: 'Returns bad output',
			input: z.object({}),
			output: z.object({ count: z.number() }),
			handler: async () => ({ count: 'not a number' }) as unknown as { count: number },
		})

		const result = await badOutputTool.execute({})
		expect(result.success).toBe(false)
		expect(result.error).toContain('Invalid output')
	})

	it('generates tool definition', () => {
		const def = greetTool.toDefinition()
		expect(def.name).toBe('greet')
		expect(def.description).toBe('Greet a person')
		expect(def.inputSchema).toEqual({
			type: 'object',
			properties: {
				name: { type: 'string' },
				formal: { type: 'boolean' },
			},
			required: ['name'],
		})
	})

	it('accepts "parameters" as alias for "input"', async () => {
		const tool = defineTool({
			name: 'params_tool',
			description: 'Uses parameters key',
			parameters: z.object({ value: z.number() }),
			handler: async ({ value }) => ({ doubled: value * 2 }),
		})

		const result = await tool.execute({ value: 5 })
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ doubled: 10 })
	})

	it('throws if neither input nor parameters is provided', () => {
		expect(() =>
			defineTool({
				name: 'no_schema',
				description: 'Missing schema',
				handler: async () => ({}),
			} as never),
		).toThrow('requires an input schema')
	})

	it('respects timeout', async () => {
		const slowTool = defineTool({
			name: 'slow',
			description: 'Slow tool',
			input: z.object({}),
			timeoutMs: 50,
			handler: async () => {
				await new Promise((r) => setTimeout(r, 200))
				return {}
			},
		})

		const result = await slowTool.execute({})
		expect(result.success).toBe(false)
		expect(result.error).toContain('timed out')
	})
})

// ─── Toolkit ─────────────────────────────────────────────────────

describe('createToolkit', () => {
	const toolA = defineTool({
		name: 'tool_a',
		description: 'Tool A',
		input: z.object({ x: z.number() }),
		handler: async ({ x }) => ({ doubled: x * 2 }),
	})

	const toolB = defineTool({
		name: 'tool_b',
		description: 'Tool B',
		input: z.object({ msg: z.string() }),
		handler: async ({ msg }) => ({ upper: msg.toUpperCase() }),
	})

	const kit = createToolkit('test-kit', [toolA, toolB])

	it('finds tools by name', () => {
		expect(kit.getTool('tool_a')).toBeDefined()
		expect(kit.getTool('tool_b')).toBeDefined()
		expect(kit.getTool('nonexistent')).toBeUndefined()
	})

	it('executes tools by name', async () => {
		const result = await kit.execute('tool_a', { x: 5 })
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ doubled: 10 })
	})

	it('returns error for unknown tool', async () => {
		const result = await kit.execute('unknown', {})
		expect(result.success).toBe(false)
		expect(result.error).toContain('not found')
	})

	it('generates all definitions', () => {
		const defs = kit.toDefinitions()
		expect(defs).toHaveLength(2)
		expect(defs.map((d) => d.name)).toEqual(['tool_a', 'tool_b'])
	})

	it('throws CONFIG_ERROR for duplicate tool names', () => {
		const dupTool = defineTool({
			name: 'tool_a',
			description: 'Duplicate of tool_a',
			input: z.object({}),
			handler: async () => ({}),
		})

		expect(() => createToolkit('dup-kit', [toolA, dupTool])).toThrow(ElsiumError)
		expect(() => createToolkit('dup-kit', [toolA, dupTool])).toThrow('Duplicate tool name "tool_a"')
	})
})

// ─── Format ──────────────────────────────────────────────────────

describe('formatToolResult', () => {
	it('formats success result', () => {
		const result = formatToolResult({
			success: true,
			data: { answer: 42 },
			toolCallId: 'tc_1',
			durationMs: 10,
		})

		expect(result.toolCallId).toBe('tc_1')
		expect(result.isError).toBeUndefined()
		expect(JSON.parse(result.content)).toEqual({ answer: 42 })
	})

	it('formats error result', () => {
		const result = formatToolResult({
			success: false,
			error: 'Something broke',
			toolCallId: 'tc_2',
			durationMs: 5,
		})

		expect(result.toolCallId).toBe('tc_2')
		expect(result.isError).toBe(true)
		expect(result.content).toContain('Something broke')
	})

	it('formats string data directly', () => {
		const result = formatToolResult({
			success: true,
			data: 'plain text',
			toolCallId: 'tc_3',
			durationMs: 0,
		})
		expect(result.content).toBe('plain text')
	})
})

describe('formatToolResultAsText', () => {
	it('returns data as text', () => {
		expect(
			formatToolResultAsText({ success: true, data: { x: 1 }, toolCallId: 'tc', durationMs: 0 }),
		).toContain('"x": 1')
	})

	it('returns error as text', () => {
		expect(
			formatToolResultAsText({ success: false, error: 'fail', toolCallId: 'tc', durationMs: 0 }),
		).toContain('[Tool Error] fail')
	})
})

// ─── Built-in Tools ──────────────────────────────────────────────

describe('calculatorTool', () => {
	it('evaluates basic arithmetic', async () => {
		const result = await calculatorTool.execute({ expression: '2 + 3 * 4' })
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ result: 14 })
	})

	it('evaluates Math functions', async () => {
		const result = await calculatorTool.execute({ expression: 'sqrt(16)' })
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ result: 4 })
	})

	it('evaluates PI', async () => {
		const result = await calculatorTool.execute({ expression: 'PI * 2' })
		expect(result.success).toBe(true)
		expect((result.data as { result: number }).result).toBeCloseTo(6.283, 2)
	})

	it('handles invalid expressions', async () => {
		const result = await calculatorTool.execute({ expression: 'undefined + 1' })
		expect(result.success).toBe(false)
	})
})

describe('jsonParseTool', () => {
	it('parses JSON', async () => {
		const result = await jsonParseTool.execute({
			json: '{"name": "Alice", "age": 30}',
		})
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ value: { name: 'Alice', age: 30 } })
	})

	it('extracts nested values', async () => {
		const result = await jsonParseTool.execute({
			json: '{"data": {"items": [{"id": 1}]}}',
			path: 'data.items.0.id',
		})
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ value: 1 })
	})

	it('returns undefined for missing paths', async () => {
		const result = await jsonParseTool.execute({
			json: '{"a": 1}',
			path: 'b.c',
		})
		expect(result.success).toBe(true)
		expect(result.data).toEqual({ value: undefined })
	})
})

describe('currentTimeTool', () => {
	it('returns current time', async () => {
		const result = await currentTimeTool.execute({})
		expect(result.success).toBe(true)
		const data = result.data as { iso: string; unix: number; timezone: string }
		expect(data.timezone).toBe('UTC')
		expect(data.unix).toBeGreaterThan(0)
	})
})

// ─── httpFetchTool ───────────────────────────────────────────────

describe('httpFetchTool', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('fetches a URL and returns status, body, and contentType', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			status: 200,
			text: async () => '<html><body>Hello</body></html>',
			headers: new Headers({ 'content-type': 'text/html' }),
		})

		const result = await httpFetchTool.execute({ url: 'https://example.com' })
		expect(result.success).toBe(true)

		const data = result.data as { status: number; body: string; contentType: string }
		expect(data.status).toBe(200)
		expect(data.body).toContain('Hello')
		expect(data.contentType).toBe('text/html')
	})

	it('passes safe custom headers and strips sensitive ones', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			status: 200,
			text: async () => '{"ok": true}',
			headers: new Headers({ 'content-type': 'application/json' }),
		})

		const result = await httpFetchTool.execute({
			url: 'https://api.example.com/data',
			headers: { 'X-Custom': 'value', Authorization: 'Bearer secret', Cookie: 'session=abc' },
		})

		expect(result.success).toBe(true)

		const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
		expect(fetchCall[1].headers['X-Custom']).toBe('value')
		expect(fetchCall[1].headers.Authorization).toBeUndefined()
		expect(fetchCall[1].headers.Cookie).toBeUndefined()
	})

	it('truncates large response bodies', async () => {
		const longBody = 'x'.repeat(60_000)

		globalThis.fetch = vi.fn().mockResolvedValue({
			status: 200,
			text: async () => longBody,
			headers: new Headers({ 'content-type': 'text/plain' }),
		})

		const result = await httpFetchTool.execute({ url: 'https://example.com/large' })
		expect(result.success).toBe(true)

		const data = result.data as { body: string }
		expect(data.body.length).toBeLessThan(longBody.length)
		expect(data.body).toContain('...[truncated]')
	})

	it('handles missing content-type header', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			status: 200,
			text: async () => 'plain text',
			headers: new Headers(),
		})

		const result = await httpFetchTool.execute({ url: 'https://example.com' })
		expect(result.success).toBe(true)

		const data = result.data as { contentType: string }
		expect(data.contentType).toBe('text/plain')
	})

	it('generates correct tool definition', () => {
		const def = httpFetchTool.toDefinition()
		expect(def.name).toBe('http_fetch')
		expect(def.description).toContain('Fetch content from a URL')
		expect(def.inputSchema).toBeDefined()
	})

	it('blocks requests to localhost', async () => {
		const result = await httpFetchTool.execute({ url: 'https://localhost/secret' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('private/internal')
	})

	it('blocks requests to 127.x.x.x', async () => {
		const result = await httpFetchTool.execute({ url: 'https://127.0.0.1/secret' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('private/internal')
	})

	it('blocks requests to 10.x.x.x', async () => {
		const result = await httpFetchTool.execute({ url: 'https://10.0.0.1/data' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('private/internal')
	})

	it('blocks requests to 192.168.x.x', async () => {
		const result = await httpFetchTool.execute({ url: 'https://192.168.1.1/admin' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('private/internal')
	})

	it('blocks requests to IPv6 loopback ::1', async () => {
		const result = await httpFetchTool.execute({ url: 'https://[::1]/secret' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('private/internal')
	})

	it('blocks requests to IPv6 link-local fe80:', async () => {
		const result = await httpFetchTool.execute({ url: 'https://[fe80::1]/data' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('private/internal')
	})

	it('blocks requests to IPv6 ULA fc/fd addresses', async () => {
		const result1 = await httpFetchTool.execute({ url: 'https://[fd12::1]/data' })
		expect(result1.success).toBe(false)
		expect(result1.error).toContain('private/internal')

		const result2 = await httpFetchTool.execute({ url: 'https://[fc00::1]/data' })
		expect(result2.success).toBe(false)
		expect(result2.error).toContain('private/internal')
	})

	it('blocks non-http protocols', async () => {
		const result = await httpFetchTool.execute({ url: 'file:///etc/passwd' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('Blocked protocol')
	})
})
