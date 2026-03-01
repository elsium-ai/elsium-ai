# @elsium-ai/app

App bootstrap, HTTP server, and API routes for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/app.svg)](https://www.npmjs.com/package/@elsium-ai/app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/app @elsium-ai/core
```

## What's Inside

- **HTTP Server** — Built-in server with route definitions
- **CORS** — Configurable cross-origin resource sharing
- **Auth** — Authentication middleware
- **Rate Limiting** — Request rate limiting per client
- **RBAC** — Role-based access control with inheritance and wildcard matching

## Usage

```typescript
import { createApp, createRBAC } from '@elsium-ai/app'

const rbac = createRBAC({
  roles: [
    { name: 'viewer', permissions: ['model:read:*'] },
    { name: 'analyst', permissions: ['model:use:gpt-4o-mini'], inherits: ['viewer'] },
    { name: 'admin', permissions: ['*'], inherits: ['analyst'] },
  ],
})

const app = createApp({
  port: 3000,
  cors: { origins: ['http://localhost:5173'] },
  rateLimit: { windowMs: 60_000, max: 100 },
})
```

## Part of ElsiumAI

This package is the app layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
