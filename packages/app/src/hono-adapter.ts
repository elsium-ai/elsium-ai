import type { StreamEvent } from '@elsium-ai/core'
import { serve } from '@hono/node-server'
import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { ServerAdapter } from './adapter'
import { formatSSE, sseHeaders } from './sse'

export const honoAdapter: ServerAdapter<Hono> = {
	create() {
		return new Hono()
	},

	createSubRouter() {
		return new Hono()
	},

	use(app, handler) {
		app.use('*', (c: Context, next: Next) => {
			const result = handler(c, next)
			return result as ReturnType<typeof handler>
		})
	},

	get(app, path, handler) {
		app.get(path, (c: Context) => {
			return handler(c) as Response | Promise<Response>
		})
	},

	post(app, path, handler) {
		app.post(path, (c: Context) => {
			return handler(c) as Response | Promise<Response>
		})
	},

	onError(app, handler) {
		app.onError((err: Error, c: Context) => {
			return handler(err, c)
		})
	},

	notFound(app, handler) {
		app.notFound((c: Context) => {
			return handler(c)
		})
	},

	route(app, path, router) {
		app.route(path, router)
	},

	json(c, data, status) {
		return (c as Context).json(data, status)
	},

	body(c, data, status) {
		return (c as Context).body(data, status as 200 | 400 | 401 | 403 | 404 | 413 | 429 | 500)
	},

	header(c, name) {
		return (c as Context).req.header(name)
	},

	setHeader(c, name, value) {
		;(c as Context).res.headers.set(name, value)
	},

	method(c) {
		return (c as Context).req.method
	},

	path(c) {
		return (c as Context).req.path
	},

	bodyText(c) {
		return (c as Context).req.text()
	},

	set(c, key, value) {
		;(c as Context).set(key, value)
	},

	getContext(c, key) {
		return (c as Context).get(key)
	},

	res(c) {
		return (c as Context).res
	},

	setRes(c, res) {
		;(c as Context).res = res as Response & { status: number; headers: Headers }
	},

	getStatus(c) {
		return (c as Context).res.status
	},

	streamResponse(c, source) {
		const ctx = c as Context
		const headers = sseHeaders()
		for (const [key, value] of Object.entries(headers)) {
			ctx.header(key, value)
		}

		return stream(ctx, async (s) => {
			try {
				for await (const event of source) {
					const sseData = formatSSE('message', event)
					await s.write(sseData)
				}
			} catch (err) {
				const errorEvent: StreamEvent = {
					type: 'error',
					error: err instanceof Error ? err : new Error(String(err)),
				}
				const sseData = formatSSE('error', {
					type: 'error',
					message: errorEvent.error.message,
				})
				await s.write(sseData)
			}
		})
	},

	listen(app, port, hostname) {
		const server = serve({ fetch: app.fetch, port, hostname })
		return {
			port,
			close: () => {
				server.close()
			},
		}
	},
}
