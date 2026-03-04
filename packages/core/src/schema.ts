import type { z } from 'zod'
import { createLogger } from './logger'

const log = createLogger()

function zodDefKind(def: Record<string, unknown>): string | undefined {
	return typeof def.type === 'string' ? (def.type as string) : (def.typeName as string | undefined)
}

function zodObjectToJsonSchema(
	schema: Record<string, unknown>,
	convert: (s: z.ZodType) => Record<string, unknown>,
): Record<string, unknown> {
	const shape =
		typeof schema.shape === 'function'
			? (schema.shape as () => Record<string, unknown>)()
			: (schema.shape as Record<string, unknown>)
	const properties: Record<string, unknown> = {}
	const required: string[] = []

	for (const [key, value] of Object.entries(shape)) {
		const fieldSchema = value as z.ZodType
		properties[key] = convert(fieldSchema)
		const fieldDef = fieldSchema._def as Record<string, unknown>
		const fieldKind = zodDefKind(fieldDef)
		if (
			fieldKind !== 'optional' &&
			fieldKind !== 'ZodOptional' &&
			fieldKind !== 'default' &&
			fieldKind !== 'ZodDefault'
		) {
			required.push(key)
		}
		if (fieldDef.description) {
			;(properties[key] as Record<string, unknown>).description = fieldDef.description
		}
	}

	return { type: 'object', properties, required }
}

/**
 * Converts a Zod schema to JSON Schema.
 * Uses Zod's internal `_def` property — the standard community pattern
 * since Zod does not expose a public schema introspection API.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
	if (!('_def' in schema)) return { type: 'object' }

	const def = schema._def as Record<string, unknown>
	const kind = zodDefKind(def)

	switch (kind) {
		case 'object':
		case 'ZodObject':
			return zodObjectToJsonSchema(def, zodToJsonSchema)
		case 'string':
		case 'ZodString':
			return { type: 'string' }
		case 'number':
		case 'ZodNumber':
			return { type: 'number' }
		case 'boolean':
		case 'ZodBoolean':
			return { type: 'boolean' }
		case 'array':
		case 'ZodArray':
			return {
				type: 'array',
				items: zodToJsonSchema((def.element ?? def.type) as z.ZodType),
			}
		case 'enum':
		case 'ZodEnum': {
			const values =
				(def.values as string[]) ??
				(def.entries ? Object.values(def.entries as Record<string, string>) : [])
			return { type: 'string', enum: values }
		}
		case 'optional':
		case 'ZodOptional':
			return zodToJsonSchema(def.innerType as z.ZodType)
		case 'default':
		case 'ZodDefault':
			return zodToJsonSchema(def.innerType as z.ZodType)
		case 'nullable':
		case 'ZodNullable': {
			const inner = zodToJsonSchema(def.innerType as z.ZodType)
			return { ...inner, nullable: true }
		}
		case 'ZodLiteral':
			return { type: typeof def.value, const: def.value }
		case 'ZodUnion': {
			const options = (def.options as z.ZodType[]).map(zodToJsonSchema)
			return { anyOf: options }
		}
		case 'ZodRecord':
			return {
				type: 'object',
				additionalProperties: def.valueType
					? zodToJsonSchema(def.valueType as z.ZodType)
					: { type: 'string' },
			}
		case 'ZodTuple': {
			const items = ((def.items as z.ZodType[]) ?? []).map(zodToJsonSchema)
			return { type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length }
		}
		case 'ZodDate':
			return { type: 'string', format: 'date-time' }
		default:
			log.warn(`zodToJsonSchema: unsupported type ${kind}, defaulting to string`)
			return { type: 'string' }
	}
}
