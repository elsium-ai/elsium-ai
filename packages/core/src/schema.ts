import type { z } from 'zod'
import { zodToJsonSchema as libZodToJsonSchema } from 'zod-to-json-schema'
import { createLogger } from './logger'

const log = createLogger()

/**
 * Converts a Zod schema to JSON Schema.
 * Uses the zod-to-json-schema library instead of accessing internal _def.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
	if (!('_def' in schema)) return { type: 'object' }

	const result = libZodToJsonSchema(schema, {
		$schema: null,
		ignoreUnknownDefinitions: true,
	}) as Record<string, unknown>

	return postProcess(result)
}

/** Build a clean copy without $schema. */
function cleanResult(result: Record<string, unknown>): Record<string, unknown> {
	const clean: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(result)) {
		if (key !== '$schema' && value !== undefined) {
			clean[key] = value
		}
	}
	return clean
}

/** Convert type arrays to our preferred format. */
function normalizeType(result: Record<string, unknown>): void {
	// Remove additionalProperties: false (added by library for objects)
	// but keep additionalProperties: { type: ... } for ZodRecord
	if (result.additionalProperties === false) {
		result.additionalProperties = undefined
	}

	if (!Array.isArray(result.type)) return

	const types = result.type as string[]
	const hasNull = types.includes('null')
	const nonNull = types.filter((t) => t !== 'null')

	if (hasNull && nonNull.length === 1) {
		result.type = nonNull[0]
		result.nullable = true
	} else if (hasNull && nonNull.length > 1) {
		result.type = nonNull
		result.nullable = true
	} else if (!hasNull && nonNull.length > 1) {
		result.anyOf = nonNull.map((t) => ({ type: t }))
		result.type = undefined
	}
}

/** Unwrap optional pattern and post-process anyOf entries. */
function normalizeAnyOf(
	result: Record<string, unknown>,
	processor: (s: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> | null {
	if (!result.anyOf || !Array.isArray(result.anyOf)) return null

	const anyOf = result.anyOf as Record<string, unknown>[]
	const nonNotEntries = anyOf.filter((e) => !e.not)

	// Detect optional pattern: [{ not: {} }, { type: ... }]
	if (nonNotEntries.length === 1 && anyOf.some((e) => e.not)) {
		return processor(nonNotEntries[0])
	}

	result.anyOf = anyOf.map(processor)
	return null
}

/** Process nested schema structures recursively. */
function processNested(
	result: Record<string, unknown>,
	processor: (s: Record<string, unknown>) => Record<string, unknown>,
): void {
	if (result.properties && typeof result.properties === 'object') {
		const props = result.properties as Record<string, unknown>
		for (const key of Object.keys(props)) {
			props[key] = processor(props[key] as Record<string, unknown>)
		}
	}

	if (result.items && typeof result.items === 'object') {
		if (Array.isArray(result.items)) {
			result.prefixItems = result.items.map((item) => processor(item as Record<string, unknown>))
			result.items = undefined
		} else {
			result.items = processor(result.items as Record<string, unknown>)
		}
	}

	if (result.additionalProperties && typeof result.additionalProperties === 'object') {
		result.additionalProperties = processor(result.additionalProperties as Record<string, unknown>)
	}
}

/**
 * Post-process library output to match the format expected by LLM providers
 * in this codebase (remove $schema, convert nullable format, etc.).
 */
function postProcess(schema: Record<string, unknown>): Record<string, unknown> {
	if (typeof schema !== 'object' || schema === null) return schema

	const result = { ...schema }

	normalizeType(result)

	const unwrapped = normalizeAnyOf(result, postProcess)
	if (unwrapped) return unwrapped

	processNested(result, postProcess)

	return cleanResult(result)
}
