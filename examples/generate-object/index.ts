/**
 * Example: generateObject — typed structured outputs
 *
 * Three flavors:
 *   1. gateway.generateObject({ schema })           — typed method on a gateway instance
 *   2. generateObject({ provider, apiKey, schema }) — standalone one-shot
 *   3. gateway.extract(schema, input)               — convenience wrapper with auto-retry
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/generate-object/index.ts
 */

import { env } from '@elsium-ai/core'
import { gateway, generateObject } from '@elsium-ai/gateway'
import { z } from 'zod'

const provider = (process.env.PROVIDER ?? 'anthropic') as 'anthropic' | 'openai' | 'google'
const apiKeyEnv =
	provider === 'openai'
		? 'OPENAI_API_KEY'
		: provider === 'google'
			? 'GOOGLE_API_KEY'
			: 'ANTHROPIC_API_KEY'
const apiKey = env(apiKeyEnv)

// ─── 1. Gateway method ──────────────────────────────────────────

const llm = gateway({ provider, apiKey })

const PlanetSchema = z.object({
	name: z.string(),
	distanceFromSunKm: z.number(),
	moons: z.array(z.string()),
})

console.log('\n[1] gateway.generateObject')
const planet = await llm.generateObject({
	messages: [{ role: 'user', content: 'Describe Mars.' }],
	schema: PlanetSchema,
})
console.log('  name:', planet.object.name)
console.log('  moons:', planet.object.moons.join(', '))

// ─── 2. Standalone one-shot ─────────────────────────────────────

console.log('\n[2] generateObject standalone')
const SentimentSchema = z.object({
	sentiment: z.enum(['positive', 'negative', 'neutral']),
	confidence: z.number(),
})
const sentiment = await generateObject({
	provider,
	apiKey,
	schema: SentimentSchema,
	prompt: 'Analyze sentiment: "This product changed my life."',
})
console.log('  sentiment:', sentiment.object.sentiment)
console.log('  confidence:', sentiment.object.confidence)

// ─── 3. Extract with auto-retry ─────────────────────────────────

console.log('\n[3] gateway.extract — auto-retries on schema mismatch')
const ContactSchema = z.object({
	name: z.string(),
	email: z.string().email(),
	role: z.string(),
})
const contact = await llm.extract(
	ContactSchema,
	'Reach out to Jane Smith (jane@acme.com), she is VP of Engineering.',
)
console.log('  contact:', contact)
