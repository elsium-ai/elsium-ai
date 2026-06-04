const SAFE_ENV_KEYS = [
	'PATH',
	'HOME',
	'TMPDIR',
	'TMP',
	'TEMP',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TZ',
	'NODE_ENV',
	'SystemRoot',
	'SYSTEMROOT',
	'windir',
	'ComSpec',
	'PATHEXT',
	'NUMBER_OF_PROCESSORS',
	'PROCESSOR_ARCHITECTURE',
] as const

export function buildSandboxEnv(passthrough?: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {}
	for (const key of SAFE_ENV_KEYS) {
		const value = process.env[key]
		if (typeof value === 'string') env[key] = value
	}
	if (passthrough) {
		for (const key of Object.keys(passthrough)) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
			const value = passthrough[key]
			if (typeof value === 'string') env[key] = value
		}
	}
	return env
}
