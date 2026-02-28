import { describe, expect, it } from 'vitest'
import { createPromptRegistry, definePrompt } from './prompts'

describe('Prompt as Code', () => {
	describe('definePrompt', () => {
		it('should create a prompt definition', () => {
			const prompt = definePrompt({
				name: 'test',
				version: '1.0.0',
				content: 'Hello {{name}}!',
				variables: ['name'],
			})

			expect(prompt.name).toBe('test')
			expect(prompt.version).toBe('1.0.0')
			expect(prompt.variables).toContain('name')
		})
	})

	describe('createPromptRegistry', () => {
		it('should register and retrieve prompts', () => {
			const registry = createPromptRegistry()

			registry.register(
				'greeting',
				definePrompt({
					name: 'greeting',
					version: '1.0.0',
					content: 'Hello {{name}}!',
					variables: ['name'],
				}),
			)

			const prompt = registry.get('greeting', '1.0.0')
			expect(prompt).toBeDefined()
			expect(prompt?.content).toBe('Hello {{name}}!')
		})

		it('should get latest version', () => {
			const registry = createPromptRegistry()

			registry.register(
				'test',
				definePrompt({
					name: 'test',
					version: '1.0.0',
					content: 'v1',
					variables: [],
				}),
			)

			registry.register(
				'test',
				definePrompt({
					name: 'test',
					version: '2.0.0',
					content: 'v2',
					variables: [],
				}),
			)

			const latest = registry.getLatest('test')
			expect(latest?.version).toBe('2.0.0')
			expect(latest?.content).toBe('v2')
		})

		it('should list all prompts', () => {
			const registry = createPromptRegistry()

			registry.register(
				'a',
				definePrompt({ name: 'a', version: '1.0.0', content: '', variables: [] }),
			)
			registry.register(
				'b',
				definePrompt({ name: 'b', version: '1.0.0', content: '', variables: [] }),
			)

			const list = registry.list()
			expect(list).toHaveLength(2)
			expect(list.map((p) => p.name)).toContain('a')
			expect(list.map((p) => p.name)).toContain('b')
		})

		it('should get versions for a prompt', () => {
			const registry = createPromptRegistry()

			registry.register(
				'test',
				definePrompt({ name: 'test', version: '1.0.0', content: 'v1', variables: [] }),
			)
			registry.register(
				'test',
				definePrompt({ name: 'test', version: '1.1.0', content: 'v1.1', variables: [] }),
			)

			const versions = registry.getVersions('test')
			expect(versions).toEqual(['1.0.0', '1.1.0'])
		})

		it('should diff two versions', () => {
			const registry = createPromptRegistry()

			registry.register(
				'classifier',
				definePrompt({
					name: 'classifier',
					version: '1.0.0',
					content: 'Classify this text into: {{categories}}\n\nText: {{input}}',
					variables: ['categories', 'input'],
				}),
			)

			registry.register(
				'classifier',
				definePrompt({
					name: 'classifier',
					version: '1.1.0',
					content:
						'You are a text classifier. Categories: {{categories}}\n\nClassify: {{input}}\nRespond with JSON.',
					variables: ['categories', 'input'],
				}),
			)

			const diff = registry.diff('classifier', '1.0.0', '1.1.0')
			expect(diff).not.toBeNull()
			expect(diff?.fromVersion).toBe('1.0.0')
			expect(diff?.toVersion).toBe('1.1.0')
			expect(diff?.changes.some((c) => c.type === 'added')).toBe(true)
			expect(diff?.changes.some((c) => c.type === 'removed')).toBe(true)
		})

		it('should return null for non-existent diff', () => {
			const registry = createPromptRegistry()
			expect(registry.diff('nonexistent', '1.0.0', '2.0.0')).toBeNull()
		})

		it('should render templates', () => {
			const registry = createPromptRegistry()

			registry.register(
				'greeting',
				definePrompt({
					name: 'greeting',
					version: '1.0.0',
					content: 'Hello {{name}}, welcome to {{place}}!',
					variables: ['name', 'place'],
				}),
			)

			const rendered = registry.render('greeting', {
				name: 'Alice',
				place: 'Wonderland',
			})

			expect(rendered).toBe('Hello Alice, welcome to Wonderland!')
		})

		it('should render specific version', () => {
			const registry = createPromptRegistry()

			registry.register(
				'test',
				definePrompt({
					name: 'test',
					version: '1.0.0',
					content: 'v1: {{x}}',
					variables: ['x'],
				}),
			)
			registry.register(
				'test',
				definePrompt({
					name: 'test',
					version: '2.0.0',
					content: 'v2: {{x}}',
					variables: ['x'],
				}),
			)

			const r1 = registry.render('test', { x: 'val' }, '1.0.0')
			const r2 = registry.render('test', { x: 'val' }, '2.0.0')

			expect(r1).toBe('v1: val')
			expect(r2).toBe('v2: val')
		})

		it('should throw on unknown prompt render', () => {
			const registry = createPromptRegistry()

			expect(() => registry.render('missing', {})).toThrow('Prompt "missing" not found')
		})
	})
})
