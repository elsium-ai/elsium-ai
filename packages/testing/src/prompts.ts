export interface PromptDefinition {
	name: string
	version: string
	content: string
	variables: string[]
	metadata?: Record<string, unknown>
}

export interface PromptDiff {
	name: string
	fromVersion: string
	toVersion: string
	changes: DiffLine[]
}

export interface DiffLine {
	type: 'added' | 'removed' | 'unchanged'
	lineNumber: number
	content: string
}

export interface PromptRegistry {
	register(name: string, prompt: PromptDefinition): void
	get(name: string, version?: string): PromptDefinition | undefined
	getLatest(name: string): PromptDefinition | undefined
	list(): Array<{ name: string; versions: string[] }>
	diff(name: string, fromVersion: string, toVersion: string): PromptDiff | null
	render(name: string, variables: Record<string, string>, version?: string): string
	getVersions(name: string): string[]
}

export function definePrompt(config: PromptDefinition): PromptDefinition {
	return { ...config }
}

export function createPromptRegistry(): PromptRegistry {
	const store = new Map<string, Map<string, PromptDefinition>>()

	function compareVersions(a: string, b: string): number {
		const aParts = a.split('.').map(Number)
		const bParts = b.split('.').map(Number)

		for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
			const aVal = aParts[i] ?? 0
			const bVal = bParts[i] ?? 0
			if (aVal !== bVal) return aVal - bVal
		}
		return 0
	}

	return {
		register(name: string, prompt: PromptDefinition): void {
			if (!store.has(name)) {
				store.set(name, new Map())
			}
			const versions = store.get(name)
			if (versions) {
				versions.set(prompt.version, prompt)
			}
		},

		get(name: string, version?: string): PromptDefinition | undefined {
			const versions = store.get(name)
			if (!versions) return undefined

			if (version) return versions.get(version)
			return this.getLatest(name)
		},

		getLatest(name: string): PromptDefinition | undefined {
			const versions = store.get(name)
			if (!versions || versions.size === 0) return undefined

			const sorted = [...versions.keys()].sort(compareVersions)
			return versions.get(sorted[sorted.length - 1])
		},

		list(): Array<{ name: string; versions: string[] }> {
			const result: Array<{ name: string; versions: string[] }> = []
			for (const [name, versions] of store) {
				result.push({
					name,
					versions: [...versions.keys()].sort(compareVersions),
				})
			}
			return result
		},

		getVersions(name: string): string[] {
			const versions = store.get(name)
			if (!versions) return []
			return [...versions.keys()].sort(compareVersions)
		},

		diff(name: string, fromVersion: string, toVersion: string): PromptDiff | null {
			const versions = store.get(name)
			if (!versions) return null

			const from = versions.get(fromVersion)
			const to = versions.get(toVersion)
			if (!from || !to) return null

			const fromLines = from.content.split('\n')
			const toLines = to.content.split('\n')

			const changes: DiffLine[] = []
			const maxLen = Math.max(fromLines.length, toLines.length)

			for (let i = 0; i < maxLen; i++) {
				const fromLine = fromLines[i]
				const toLine = toLines[i]

				if (fromLine === undefined) {
					changes.push({ type: 'added', lineNumber: i + 1, content: toLine })
				} else if (toLine === undefined) {
					changes.push({ type: 'removed', lineNumber: i + 1, content: fromLine })
				} else if (fromLine !== toLine) {
					changes.push({ type: 'removed', lineNumber: i + 1, content: fromLine })
					changes.push({ type: 'added', lineNumber: i + 1, content: toLine })
				} else {
					changes.push({ type: 'unchanged', lineNumber: i + 1, content: fromLine })
				}
			}

			return { name, fromVersion, toVersion, changes }
		},

		render(name: string, variables: Record<string, string>, version?: string): string {
			const prompt = this.get(name, version)
			if (!prompt) {
				throw new Error(`Prompt "${name}" not found${version ? ` (version ${version})` : ''}`)
			}

			let rendered = prompt.content
			for (const [key, value] of Object.entries(variables)) {
				rendered = rendered.replaceAll(`{{${key}}}`, value)
			}

			return rendered
		},
	}
}
