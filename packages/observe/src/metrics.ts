export interface MetricsCollector {
	increment(name: string, value?: number, tags?: Record<string, string>): void
	gauge(name: string, value: number, tags?: Record<string, string>): void
	histogram(name: string, value: number, tags?: Record<string, string>): void
	getMetrics(): MetricEntry[]
	reset(): void
}

export interface MetricEntry {
	name: string
	type: 'counter' | 'gauge' | 'histogram'
	value: number
	tags: Record<string, string>
	timestamp: number
}

export function createMetrics(): MetricsCollector {
	const entries: MetricEntry[] = []
	const counters = new Map<string, number>()
	const gauges = new Map<string, number>()

	function tagKey(name: string, tags?: Record<string, string>): string {
		if (!tags || Object.keys(tags).length === 0) return name
		const sorted = Object.entries(tags)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}=${v}`)
			.join(',')
		return `${name}{${sorted}}`
	}

	return {
		increment(name: string, value = 1, tags?: Record<string, string>) {
			const key = tagKey(name, tags)
			const current = counters.get(key) ?? 0
			counters.set(key, current + value)
			entries.push({
				name,
				type: 'counter',
				value: current + value,
				tags: tags ?? {},
				timestamp: Date.now(),
			})
		},

		gauge(name: string, value: number, tags?: Record<string, string>) {
			const key = tagKey(name, tags)
			gauges.set(key, value)
			entries.push({
				name,
				type: 'gauge',
				value,
				tags: tags ?? {},
				timestamp: Date.now(),
			})
		},

		histogram(name: string, value: number, tags?: Record<string, string>) {
			entries.push({
				name,
				type: 'histogram',
				value,
				tags: tags ?? {},
				timestamp: Date.now(),
			})
		},

		getMetrics(): MetricEntry[] {
			return [...entries]
		},

		reset() {
			entries.length = 0
			counters.clear()
			gauges.clear()
		},
	}
}
