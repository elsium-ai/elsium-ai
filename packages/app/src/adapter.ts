import type { ElsiumStream } from '@elsium-ai/core'

export type NextHandler = () => Promise<void>

export type MiddlewareHandler = (
	c: unknown,
	next: NextHandler,
) => Response | void | Promise<Response | void>

export type RouteHandler = (c: unknown) => Response | Promise<Response>

export interface ServerAdapter<TInstance = unknown> {
	create(): TInstance
	createSubRouter(): TInstance
	use(app: TInstance, handler: MiddlewareHandler): void
	get(app: TInstance, path: string, handler: RouteHandler): void
	post(app: TInstance, path: string, handler: RouteHandler): void
	onError(app: TInstance, handler: (err: Error, c: unknown) => Response): void
	notFound(app: TInstance, handler: (c: unknown) => Response): void
	route(app: TInstance, path: string, router: TInstance): void

	json(c: unknown, data: unknown, status?: number): Response
	body(c: unknown, data: unknown, status: number): Response
	header(c: unknown, name: string): string | undefined
	setHeader(c: unknown, name: string, value: string): void
	method(c: unknown): string
	path(c: unknown): string
	bodyText(c: unknown): Promise<string>
	set(c: unknown, key: string, value: unknown): void
	getContext(c: unknown, key: string): unknown
	res(c: unknown): Response
	setRes(c: unknown, res: Response): void
	getStatus(c: unknown): number

	streamResponse(c: unknown, source: ElsiumStream | AsyncIterable<unknown>): Response

	listen(app: TInstance, port: number, hostname: string): { port: number; close: () => void }
}
