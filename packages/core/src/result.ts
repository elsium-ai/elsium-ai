export type Result<T, E = Error> = Ok<T> | Err<E>

export interface Ok<T> {
	readonly ok: true
	readonly value: T
}

export interface Err<E> {
	readonly ok: false
	readonly error: E
}

export function ok<T>(value: T): Ok<T> {
	return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
	return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
	return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
	return !result.ok
}

export function unwrap<T, E>(result: Result<T, E>): T {
	if (result.ok) return result.value
	throw result.error instanceof Error ? result.error : new Error(String(result.error))
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
	return result.ok ? result.value : fallback
}

export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
	try {
		return ok(await fn())
	} catch (e) {
		return err(e instanceof Error ? e : new Error(String(e)))
	}
}

export function tryCatchSync<T>(fn: () => T): Result<T, Error> {
	try {
		return ok(fn())
	} catch (e) {
		return err(e instanceof Error ? e : new Error(String(e)))
	}
}
