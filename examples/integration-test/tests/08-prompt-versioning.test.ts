import { createPromptRegistry, definePrompt } from '@elsium-ai/testing'
/**
 * Test 08: Prompt Versioning
 * Verifies: createPromptRegistry, definePrompt
 */
import { describe, expect, it } from 'vitest'

describe('08 — Prompt Versioning', () => {
	it('definePrompt returns a PromptDefinition', () => {
		const prompt = definePrompt({
			name: 'greeting',
			version: '1.0.0',
			content: 'Hello, {{name}}!',
			variables: ['name'],
		})

		expect(prompt.name).toBe('greeting')
		expect(prompt.version).toBe('1.0.0')
		expect(prompt.content).toBe('Hello, {{name}}!')
		expect(prompt.variables).toEqual(['name'])
	})

	it('registry registers and retrieves prompts', () => {
		const registry = createPromptRegistry()

		const v1 = definePrompt({
			name: 'greet',
			version: '1.0.0',
			content: 'Hi {{name}}',
			variables: ['name'],
		})

		const v2 = definePrompt({
			name: 'greet',
			version: '2.0.0',
			content: 'Hello {{name}}, welcome!',
			variables: ['name'],
		})

		registry.register('greet', v1)
		registry.register('greet', v2)

		expect(registry.get('greet', '1.0.0')).toEqual(v1)
		expect(registry.get('greet', '2.0.0')).toEqual(v2)
		expect(registry.getLatest('greet')).toEqual(v2)
	})

	it('registry.list() shows all prompts', () => {
		const registry = createPromptRegistry()

		registry.register(
			'a',
			definePrompt({
				name: 'a',
				version: '1.0.0',
				content: 'A',
				variables: [],
			}),
		)

		registry.register(
			'b',
			definePrompt({
				name: 'b',
				version: '1.0.0',
				content: 'B',
				variables: [],
			}),
		)

		const list = registry.list()
		expect(list).toHaveLength(2)
	})

	it('registry.render() substitutes variables', () => {
		const registry = createPromptRegistry()

		registry.register(
			'tmpl',
			definePrompt({
				name: 'tmpl',
				version: '1.0.0',
				content: 'Hello {{name}}, you are {{role}}.',
				variables: ['name', 'role'],
			}),
		)

		const rendered = registry.render('tmpl', { name: 'Alice', role: 'admin' })
		expect(rendered).toBe('Hello Alice, you are admin.')
	})

	it('registry.diff() compares prompt versions', () => {
		const registry = createPromptRegistry()

		registry.register(
			'd',
			definePrompt({
				name: 'd',
				version: '1.0.0',
				content: 'Hello world',
				variables: [],
			}),
		)

		registry.register(
			'd',
			definePrompt({
				name: 'd',
				version: '2.0.0',
				content: 'Hello universe',
				variables: [],
			}),
		)

		const diff = registry.diff('d', '1.0.0', '2.0.0')
		expect(diff).not.toBeNull()
		expect(diff?.changes.length).toBeGreaterThan(0)
	})

	it('registry.getVersions() returns all versions', () => {
		const registry = createPromptRegistry()

		registry.register(
			'v',
			definePrompt({
				name: 'v',
				version: '1.0.0',
				content: 'a',
				variables: [],
			}),
		)
		registry.register(
			'v',
			definePrompt({
				name: 'v',
				version: '1.1.0',
				content: 'b',
				variables: [],
			}),
		)

		const versions = registry.getVersions('v')
		expect(versions).toContain('1.0.0')
		expect(versions).toContain('1.1.0')
	})
})
