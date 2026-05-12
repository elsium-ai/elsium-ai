import { describe, expect, it } from 'vitest'
import {
	type JurisdictionPolicy,
	createJurisdictionRouter,
	createPiiClassifier,
} from './pii-routing'

describe('createPiiClassifier', () => {
	it('detects email, phone, ssn', () => {
		const c = createPiiClassifier()
		const matches = c.classify('Contact alice@example.com or call 555-123-4567. SSN 123-45-6789.')
		const classes = matches.map((m) => m.piiClass).sort()
		expect(classes).toContain('email')
		expect(classes).toContain('phone')
		expect(classes).toContain('ssn')
	})

	it('returns empty array on clean text', () => {
		expect(createPiiClassifier().classify('hello world')).toEqual([])
	})

	it('reports start / end indices of matches', () => {
		const c = createPiiClassifier()
		const text = 'Email me at bob@x.com.'
		const m = c.classify(text)
		const email = m.find((x) => x.piiClass === 'email')
		expect(email).toBeDefined()
		if (!email) return
		expect(text.slice(email.start, email.end)).toBe('bob@x.com')
	})

	it('allows custom class registration', () => {
		const c = createPiiClassifier()
		c.register('iban', /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/)
		const m = c.classify('Transfer to DE89370400440532013000 today')
		expect(m.some((x) => x.piiClass === 'iban')).toBe(true)
	})

	it('listing classes includes built-ins + registered', () => {
		const c = createPiiClassifier()
		const before = c.classes
		expect(before).toContain('email')
		c.register('iban', /\biban-\d+\b/)
		expect(c.classes).toContain('iban')
	})
})

describe('createJurisdictionRouter — no PII path', () => {
	const policy: JurisdictionPolicy = {
		byJurisdiction: {
			eu: { classProviders: { '*': ['azure-eu', 'mistral-eu'] } },
			us: { classProviders: { '*': ['openai', 'anthropic'] } },
		},
		default: { classProviders: { '*': ['openai'] } },
	}

	it('uses the * rule when no PII is detected', () => {
		const r = createJurisdictionRouter({ policy })
		const result = r.resolveProviders('hello world', {
			jurisdiction: 'eu',
			candidateProviders: ['azure-eu', 'mistral-eu', 'openai', 'anthropic'],
		})
		expect(result.detectedClasses).toEqual([])
		expect(result.allowedProviders.sort()).toEqual(['azure-eu', 'mistral-eu'].sort())
		expect(result.deniedProviders.sort()).toEqual(['anthropic', 'openai'].sort())
	})

	it('falls back to default when jurisdiction is unknown', () => {
		const r = createJurisdictionRouter({ policy })
		const result = r.resolveProviders('hi', {
			jurisdiction: 'antarctica',
			candidateProviders: ['openai', 'anthropic', 'azure-eu'],
		})
		expect(result.jurisdictionUsed).toBe('default')
		expect(result.allowedProviders).toEqual(['openai'])
	})

	it('with no jurisdiction at all uses default', () => {
		const r = createJurisdictionRouter({ policy })
		const result = r.resolveProviders('text', {
			candidateProviders: ['openai', 'anthropic'],
		})
		expect(result.jurisdictionUsed).toBe('default')
	})
})

describe('createJurisdictionRouter — PII-aware routing', () => {
	const policy: JurisdictionPolicy = {
		byJurisdiction: {
			eu: {
				classProviders: {
					email: ['azure-eu'],
					phone: ['azure-eu', 'mistral-eu'],
					'*': ['azure-eu', 'mistral-eu'],
				},
			},
		},
	}

	it('restricts to providers allowed for ALL detected classes (intersection)', () => {
		const r = createJurisdictionRouter({ policy })
		// Both email AND phone detected → must satisfy both rules.
		// email allows only azure-eu; phone allows azure-eu+mistral-eu.
		// Intersection = ['azure-eu'].
		const result = r.resolveProviders('Contact alice@example.com or 555-123-4567', {
			jurisdiction: 'eu',
			candidateProviders: ['azure-eu', 'mistral-eu', 'openai'],
		})
		expect(result.detectedClasses.sort()).toEqual(['email', 'phone'])
		expect(result.allowedProviders).toEqual(['azure-eu'])
		expect(result.deniedProviders.sort()).toEqual(['mistral-eu', 'openai'].sort())
	})

	it('falls back to * rule when no specific class rule exists', () => {
		const limitedPolicy: JurisdictionPolicy = {
			byJurisdiction: {
				eu: {
					classProviders: {
						// Only '*' rule, no class-specific rules
						'*': ['azure-eu'],
					},
				},
			},
		}
		const r = createJurisdictionRouter({ policy: limitedPolicy })
		const result = r.resolveProviders('alice@example.com', {
			jurisdiction: 'eu',
			candidateProviders: ['azure-eu', 'openai'],
		})
		// email class has no specific rule, but '*' is defined → use '*'
		expect(result.allowedProviders).toEqual(['azure-eu'])
	})

	it('denies all when a class has no rule and no * fallback', () => {
		const noWildcard: JurisdictionPolicy = {
			byJurisdiction: {
				eu: { classProviders: { phone: ['mistral-eu'] } },
			},
		}
		const r = createJurisdictionRouter({ policy: noWildcard })
		// Text contains email (not phone). No 'email' rule, no '*' fallback.
		const result = r.resolveProviders('alice@example.com', {
			jurisdiction: 'eu',
			candidateProviders: ['azure-eu', 'mistral-eu'],
		})
		expect(result.allowedProviders).toEqual([])
		expect(result.deniedProviders.sort()).toEqual(['azure-eu', 'mistral-eu'].sort())
	})

	it('empty candidate list yields empty allowed', () => {
		const r = createJurisdictionRouter({ policy })
		const result = r.resolveProviders('alice@example.com', {
			jurisdiction: 'eu',
			candidateProviders: [],
		})
		expect(result.allowedProviders).toEqual([])
	})
})

describe('createJurisdictionRouter — graceful absence of policy', () => {
	it('with neither default nor jurisdiction rules, allows all candidates', () => {
		const r = createJurisdictionRouter({
			policy: { byJurisdiction: {} },
		})
		const result = r.resolveProviders('alice@example.com', {
			jurisdiction: 'eu',
			candidateProviders: ['openai', 'anthropic'],
		})
		expect(result.jurisdictionUsed).toBe('none')
		expect(result.allowedProviders.sort()).toEqual(['anthropic', 'openai'].sort())
	})
})
