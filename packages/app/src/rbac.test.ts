import { describe, expect, it } from 'vitest'
import { createRBAC } from './rbac'

describe('RBAC', () => {
	it('creates RBAC with custom roles', () => {
		const rbac = createRBAC({
			roles: [{ name: 'custom', permissions: ['model:use'] }],
		})
		expect(rbac.hasPermission('custom', 'model:use')).toBe(true)
	})

	it('admin has all permissions via wildcard', () => {
		const rbac = createRBAC({ roles: [] })
		expect(rbac.hasPermission('admin', 'model:use')).toBe(true)
		expect(rbac.hasPermission('admin', 'model:use:gpt-4o')).toBe(true)
		expect(rbac.hasPermission('admin', 'config:write')).toBe(true)
		expect(rbac.hasPermission('admin', 'audit:read')).toBe(true)
	})

	it('viewer has read-only permissions', () => {
		const rbac = createRBAC({ roles: [] })
		expect(rbac.hasPermission('viewer', 'config:read')).toBe(true)
		expect(rbac.hasPermission('viewer', 'config:write')).toBe(false)
		expect(rbac.hasPermission('viewer', 'audit:read')).toBe(true)
		expect(rbac.hasPermission('viewer', 'audit:write')).toBe(false)
	})

	it('user has basic permissions', () => {
		const rbac = createRBAC({ roles: [] })
		expect(rbac.hasPermission('user', 'model:use')).toBe(true)
		expect(rbac.hasPermission('user', 'agent:execute')).toBe(true)
		expect(rbac.hasPermission('user', 'config:write')).toBe(false)
	})

	it('supports role inheritance', () => {
		const rbac = createRBAC({
			roles: [
				{ name: 'base', permissions: ['config:read'] },
				{ name: 'extended', permissions: ['config:write'], inherits: ['base'] },
			],
		})
		expect(rbac.hasPermission('extended', 'config:read')).toBe(true)
		expect(rbac.hasPermission('extended', 'config:write')).toBe(true)
		expect(rbac.hasPermission('base', 'config:write')).toBe(false)
	})

	it('handles circular inheritance safely', () => {
		const rbac = createRBAC({
			roles: [
				{ name: 'a', permissions: ['config:read'], inherits: ['b'] },
				{ name: 'b', permissions: ['config:write'], inherits: ['a'] },
			],
		})
		// Should not hang or throw
		expect(rbac.hasPermission('a', 'config:read')).toBe(true)
		expect(rbac.hasPermission('a', 'config:write')).toBe(true)
	})

	it('wildcard permission matches specific', () => {
		const rbac = createRBAC({
			roles: [{ name: 'test', permissions: ['model:use:*'] }],
		})
		expect(rbac.hasPermission('test', 'model:use:gpt-4o')).toBe(true)
		expect(rbac.hasPermission('test', 'model:use:claude')).toBe(true)
		expect(rbac.hasPermission('test', 'model:use')).toBe(true)
		expect(rbac.hasPermission('test', 'agent:execute')).toBe(false)
	})

	it('returns false for unknown roles', () => {
		const rbac = createRBAC({ roles: [] })
		expect(rbac.hasPermission('nonexistent', 'config:read')).toBe(false)
	})

	it('getRolePermissions returns flattened permissions', () => {
		const rbac = createRBAC({
			roles: [
				{ name: 'base', permissions: ['config:read'] },
				{ name: 'ext', permissions: ['config:write'], inherits: ['base'] },
			],
		})
		const perms = rbac.getRolePermissions('ext')
		expect(perms).toContain('config:write')
		expect(perms).toContain('config:read')
	})

	it('custom roles override built-in roles', () => {
		const rbac = createRBAC({
			roles: [
				{ name: 'admin', permissions: ['config:read'] }, // Override admin with limited perms
			],
		})
		expect(rbac.hasPermission('admin', 'config:read')).toBe(true)
		expect(rbac.hasPermission('admin', 'config:write')).toBe(false)
	})

	it('middleware is a function', () => {
		const rbac = createRBAC({ roles: [] })
		const mw = rbac.middleware('config:read')
		expect(typeof mw).toBe('function')
	})
})
