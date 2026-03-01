# @elsium-ai/mcp

Model Context Protocol (MCP) support for [ElsiumAI](https://github.com/elsium-ai/elsium-ai) — bidirectional client and server bridge.

[![npm](https://img.shields.io/npm/v/@elsium-ai/mcp.svg)](https://www.npmjs.com/package/@elsium-ai/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/mcp @elsium-ai/core
```

## What's Inside

- **MCP Client** — Connect to external MCP servers and use their tools
- **MCP Server** — Expose ElsiumAI tools and resources via MCP protocol
- **Bidirectional Bridge** — Full duplex communication between client and server

## Usage

```typescript
import { createMCPClient, createMCPServer } from '@elsium-ai/mcp'

// Client — connect to an MCP server
const client = createMCPClient({ url: 'http://localhost:3001/mcp' })
const tools = await client.listTools()

// Server — expose tools via MCP
const server = createMCPServer({
  tools: myToolkit.tools,
  resources: myResources,
})
```

## Part of ElsiumAI

This package is the MCP layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
