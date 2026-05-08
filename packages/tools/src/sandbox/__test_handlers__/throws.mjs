export default async function throws(input) {
	const err = new TypeError(`fixture error for input: ${JSON.stringify(input)}`)
	err.code = 'FIXTURE_ERROR'
	throw err
}
