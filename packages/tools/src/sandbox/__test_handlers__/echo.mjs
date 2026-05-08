export default async function echo(input) {
	return { received: input, ranAt: Date.now() }
}
