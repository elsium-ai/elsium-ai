export default async function closureAttempt() {
	const referenceFromHostOrUndefined =
		typeof globalThis.__elsium_test_secret === 'undefined' ? null : globalThis.__elsium_test_secret
	return {
		hostSecretVisible: referenceFromHostOrUndefined !== null,
		hostSecretValue: referenceFromHostOrUndefined,
	}
}
