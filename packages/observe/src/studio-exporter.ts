import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '@elsium-ai/core'
import type { SpanData } from './span'
import type { CostReport, TracerExporter } from './tracer'

const log = createLogger()

export interface StudioExporterConfig {
	dir?: string
}

export interface StudioExporter extends TracerExporter {
	writeXRayEntry(entry: Record<string, unknown>): void
	writeCostReport(report: CostReport): void
}

function ensureDir(dirPath: string): void {
	if (!existsSync(dirPath)) {
		mkdirSync(dirPath, { recursive: true })
	}
}

function safeWriteJSON(filePath: string, data: unknown): void {
	try {
		writeFileSync(filePath, JSON.stringify(data, null, 2))
	} catch (err) {
		log.error('Studio exporter write failed', {
			file: filePath,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

function safeReadJSON<T>(filePath: string, fallback: T): T {
	try {
		if (!existsSync(filePath)) return fallback
		return JSON.parse(readFileSync(filePath, 'utf-8')) as T
	} catch {
		return fallback
	}
}

export function createStudioExporter(config?: StudioExporterConfig): StudioExporter {
	const baseDir = config?.dir ?? '.elsium'
	const tracesDir = join(baseDir, 'traces')
	const xrayFile = join(baseDir, 'xray-history.json')
	const costFile = join(baseDir, 'cost-report.json')

	ensureDir(tracesDir)

	return {
		name: 'studio',

		export(spans: SpanData[]): void {
			for (const span of spans) {
				if (!span.traceId) continue
				const filePath = join(tracesDir, `${span.traceId}.json`)
				safeWriteJSON(filePath, span)
			}
		},

		writeXRayEntry(entry: Record<string, unknown>): void {
			const history = safeReadJSON<Record<string, unknown>[]>(xrayFile, [])
			history.unshift(entry)
			if (history.length > 500) history.length = 500
			safeWriteJSON(xrayFile, history)
		},

		writeCostReport(report: CostReport): void {
			safeWriteJSON(costFile, {
				totalRequests: report.callCount,
				totalTokens: report.totalTokens,
				totalCost: report.totalCost,
				byModel: Object.fromEntries(
					Object.entries(report.byModel).map(([model, data]) => [
						model,
						{ requests: data.calls, tokens: data.tokens, cost: data.cost },
					]),
				),
			})
		},
	}
}
