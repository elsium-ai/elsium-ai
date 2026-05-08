export default async function slow(input) {
	const ms = typeof input?.ms === 'number' ? input.ms : 60_000
	await new Promise((resolve) => setTimeout(resolve, ms))
	return { ranFor: ms }
}
