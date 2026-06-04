export default function envProbe() {
	return {
		secret: process.env.ELSIUM_TEST_SECRET ?? null,
		passthrough: process.env.ELSIUM_TEST_PASSTHROUGH ?? null,
		hasPath: typeof process.env.PATH === 'string',
	}
}
