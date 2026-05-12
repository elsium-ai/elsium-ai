const handlerPath = process.env.ELS_HANDLER_PATH
if (!handlerPath) throw new Error('ELS_HANDLER_PATH env var is required')

let handlerPromise = null

async function loadHandler() {
	if (!handlerPromise) {
		handlerPromise = (async () => {
			const mod = await import(handlerPath)
			const fn = (mod && (mod.default || mod.handler)) || null
			if (typeof fn !== 'function') {
				throw new Error(
					`Sandbox handler module must export a default function or a named "handler" function: ${handlerPath}`,
				)
			}
			return fn
		})().catch((err) => {
			handlerPromise = null
			throw err
		})
	}
	return handlerPromise
}

process.on('message', async (msg) => {
	if (!msg || msg.type !== 'invoke') return
	try {
		const handler = await loadHandler()
		const result = await handler(msg.input)
		process.send({
			type: 'result',
			invocationId: msg.invocationId,
			success: true,
			data: result,
		})
	} catch (err) {
		process.send({
			type: 'result',
			invocationId: msg.invocationId,
			success: false,
			error: {
				name: err?.name || 'Error',
				message: err?.message || String(err),
				stack: err?.stack,
			},
		})
	}
})
