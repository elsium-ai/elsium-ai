import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodToJsonSchema } from './index'

// ─── zodToJsonSchema ────────────────────────────────────────────

describe('zodToJsonSchema', () => {
	it('converts ZodObject with properties and required fields', () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		})

		const result = zodToJsonSchema(schema)

		expect(result.type).toBe('object')
		expect(result.properties).toEqual({
			name: { type: 'string' },
			age: { type: 'number' },
		})
		expect(result.required).toEqual(['name', 'age'])
	})

	it('converts ZodString', () => {
		const schema = z.string()
		const result = zodToJsonSchema(schema)
		expect(result).toEqual({ type: 'string' })
	})

	it('converts ZodNumber', () => {
		const schema = z.number()
		const result = zodToJsonSchema(schema)
		expect(result).toEqual({ type: 'number' })
	})

	it('converts ZodBoolean', () => {
		const schema = z.boolean()
		const result = zodToJsonSchema(schema)
		expect(result).toEqual({ type: 'boolean' })
	})

	it('converts ZodArray', () => {
		const schema = z.array(z.string())
		const result = zodToJsonSchema(schema)

		expect(result.type).toBe('array')
		expect(result.items).toEqual({ type: 'string' })
	})

	it('converts ZodEnum', () => {
		const schema = z.enum(['red', 'green', 'blue'])
		const result = zodToJsonSchema(schema)

		expect(result.type).toBe('string')
		expect(result.enum).toEqual(['red', 'green', 'blue'])
	})

	it('converts ZodOptional — unwraps inner type', () => {
		const schema = z.string().optional()
		const result = zodToJsonSchema(schema)

		expect(result).toEqual({ type: 'string' })
	})

	it('excludes optional fields from required in ZodObject', () => {
		const schema = z.object({
			name: z.string(),
			nickname: z.string().optional(),
		})

		const result = zodToJsonSchema(schema)

		expect(result.required).toEqual(['name'])
		expect((result.properties as Record<string, unknown>).nickname).toEqual({
			type: 'string',
		})
	})

	it('converts ZodDefault — unwraps inner type', () => {
		const schema = z.string().default('hello')
		const result = zodToJsonSchema(schema)

		expect(result).toEqual({ type: 'string' })
	})

	it('excludes default fields from required in ZodObject', () => {
		const schema = z.object({
			name: z.string(),
			role: z.string().default('user'),
		})

		const result = zodToJsonSchema(schema)

		expect(result.required).toEqual(['name'])
	})

	it('converts ZodNullable — adds nullable: true', () => {
		const schema = z.string().nullable()
		const result = zodToJsonSchema(schema)

		expect(result).toEqual({ type: 'string', nullable: true })
	})

	it('converts ZodLiteral', () => {
		const schema = z.literal('active')
		const result = zodToJsonSchema(schema)

		expect(result.type).toBe('string')
		expect(result.const).toBe('active')
	})

	it('converts ZodLiteral with number', () => {
		const schema = z.literal(42)
		const result = zodToJsonSchema(schema)

		expect(result.type).toBe('number')
		expect(result.const).toBe(42)
	})

	it('converts ZodUnion', () => {
		const schema = z.union([z.string(), z.number()])
		const result = zodToJsonSchema(schema)

		expect(result.anyOf).toEqual([{ type: 'string' }, { type: 'number' }])
	})

	it('converts ZodRecord', () => {
		const schema = z.record(z.number())
		const result = zodToJsonSchema(schema)

		expect(result.type).toBe('object')
		expect(result.additionalProperties).toEqual({ type: 'number' })
	})

	it('converts ZodTuple', () => {
		const schema = z.tuple([z.string(), z.number()])
		const result = zodToJsonSchema(schema)

		expect(result.type).toBe('array')
		expect(result.prefixItems).toEqual([{ type: 'string' }, { type: 'number' }])
		expect(result.minItems).toBe(2)
		expect(result.maxItems).toBe(2)
	})

	it('converts ZodDate', () => {
		const schema = z.date()
		const result = zodToJsonSchema(schema)

		expect(result).toEqual({ type: 'string', format: 'date-time' })
	})

	it('passes through description from field definitions', () => {
		const schema = z.object({
			name: z.string().describe('The user name'),
			age: z.number().describe('Age in years'),
		})

		const result = zodToJsonSchema(schema)
		const props = result.properties as Record<string, Record<string, unknown>>

		expect(props.name.description).toBe('The user name')
		expect(props.age.description).toBe('Age in years')
	})

	it('handles nested ZodObject', () => {
		const schema = z.object({
			address: z.object({
				street: z.string(),
				city: z.string(),
			}),
		})

		const result = zodToJsonSchema(schema)
		const props = result.properties as Record<string, Record<string, unknown>>

		expect(props.address.type).toBe('object')
		expect(props.address.required).toEqual(['street', 'city'])
		expect(props.address.properties).toEqual({
			street: { type: 'string' },
			city: { type: 'string' },
		})
	})

	it('returns { type: "object" } for schema without _def', () => {
		const fakeSchema = {} as z.ZodType
		const result = zodToJsonSchema(fakeSchema)
		expect(result).toEqual({ type: 'object' })
	})
})
