import type { Context, Next } from 'hono'

export type Permission =
	| 'model:use'
	| 'model:use:*'
	| `model:use:${string}`
	| 'agent:execute'
	| 'agent:execute:*'
	| `agent:execute:${string}`
	| 'tool:call'
	| 'tool:call:*'
	| `tool:call:${string}`
	| 'config:read'
	| 'config:write'
	| 'audit:read'
	| 'audit:write'

export interface Role {
	name: string
	permissions: Permission[]
	inherits?: string[]
}

export interface RBACConfig {
	roles: Role[]
	defaultRole?: string
	roleExtractor?: (c: Context) => string | undefined
	trustRoleHeader?: boolean
}

export interface RBAC {
	hasPermission(role: string, permission: Permission): boolean
	middleware(required: Permission): (c: Context, next: Next) => Promise<Response | undefined>
	getRolePermissions(role: string): Permission[]
}

const BUILT_IN_ROLES: Role[] = [
	{
		name: 'admin',
		permissions: [
			'model:use:*',
			'agent:execute:*',
			'tool:call:*',
			'config:read',
			'config:write',
			'audit:read',
			'audit:write',
		],
	},
	{
		name: 'operator',
		permissions: ['model:use:*', 'agent:execute:*', 'tool:call:*', 'config:read', 'audit:read'],
	},
	{
		name: 'user',
		permissions: ['model:use', 'agent:execute', 'tool:call'],
	},
	{
		name: 'viewer',
		permissions: ['config:read', 'audit:read'],
	},
]

function matchPermission(granted: Permission, required: Permission): boolean {
	if (granted === required) return true

	// Wildcard matching: model:use:* matches model:use:gpt-4o
	if (granted.endsWith(':*')) {
		const prefix = granted.slice(0, -1) // Remove the *
		return required.startsWith(prefix) || required === granted.slice(0, -2) // model:use:* also grants model:use
	}

	return false
}

export function createRBAC(config: RBACConfig): RBAC {
	const roleMap = new Map<string, Role>()

	// Register built-in roles first (can be overridden)
	for (const role of BUILT_IN_ROLES) {
		roleMap.set(role.name, role)
	}

	// Register user-defined roles (override built-ins)
	for (const role of config.roles) {
		roleMap.set(role.name, role)
	}

	function flattenPermissions(roleName: string, visited = new Set<string>()): Permission[] {
		if (visited.has(roleName)) return [] // Prevent circular inheritance
		visited.add(roleName)

		const role = roleMap.get(roleName)
		if (!role) return []

		const permissions = [...role.permissions]

		if (role.inherits) {
			for (const parent of role.inherits) {
				permissions.push(...flattenPermissions(parent, visited))
			}
		}

		return permissions
	}

	return {
		hasPermission(roleName: string, permission: Permission): boolean {
			const permissions = flattenPermissions(roleName)
			return permissions.some((p) => matchPermission(p, permission))
		},

		getRolePermissions(roleName: string): Permission[] {
			return [...new Set(flattenPermissions(roleName))]
		},

		middleware(required: Permission) {
			return async (c: Context, next: Next): Promise<Response | undefined> => {
				const extractor =
					config.roleExtractor ??
					((ctx: Context) => {
						if (config.trustRoleHeader) {
							return ctx.req.header('X-Role') ?? config.defaultRole ?? 'viewer'
						}
						return config.defaultRole ?? 'viewer'
					})

				const roleName = extractor(c)

				if (!roleName) {
					return c.json({ error: 'No role assigned' }, 403)
				}

				if (!roleMap.has(roleName)) {
					return c.json({ error: `Unknown role: ${roleName}` }, 403)
				}

				const hasAccess = flattenPermissions(roleName).some((p) => matchPermission(p, required))

				if (!hasAccess) {
					return c.json({ error: `Insufficient permissions. Required: ${required}` }, 403)
				}

				await next()
			}
		},
	}
}
