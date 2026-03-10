# @elsium-ai/mcp

Model Context Protocol (MCP) support for [ElsiumAI](https://github.com/elsium-ai/elsium-ai) -- bidirectional client and server over stdio transport.

[![npm](https://img.shields.io/npm/v/@elsium-ai/mcp.svg)](https://www.npmjs.com/package/@elsium-ai/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/mcp
```

Peer dependencies `@elsium-ai/core` and `@elsium-ai/tools` are pulled in automatically when you install within the ElsiumAI monorepo. In standalone usage, install them explicitly:

```bash
npm install @elsium-ai/mcp @elsium-ai/core @elsium-ai/tools
```

## What's Inside

| Category | Export | Kind | Description |
| -------- | ------ | ---- | ----------- |
| **Client** | `createMCPClient` | function | Create an MCP client that connects to an external MCP server over stdio |
| | `MCPClient` | interface | Shape of the object returned by `createMCPClient` |
| | `MCPClientConfig` | interface | Configuration for `createMCPClient` |
| | `MCPToolInfo` | interface | Metadata for a single tool reported by an MCP server |
| **Server** | `createMCPServer` | function | Create an MCP server that exposes ElsiumAI tools over stdio |
| | `MCPServer` | interface | Shape of the object returned by `createMCPServer` |
| | `MCPServerConfig` | interface | Configuration for `createMCPServer` |

---

## Client

### `MCPClientConfig`

Configuration object passed to `createMCPClient`.

```typescript
interface MCPClientConfig {
  name: string
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  timeoutMs?: number
}
```

| Property | Type | Required | Default | Description |
| -------- | ---- | -------- | ------- | ----------- |
| `name` | `string` | yes | -- | Logical name for this client connection (used in the protocol handshake) |
| `transport` | `'stdio'` | yes | -- | Transport type. Currently only `'stdio'` is supported |
| `command` | `string` | yes | -- | The command to spawn the MCP server subprocess (e.g. `"npx"`, `"node"`) |
| `args` | `string[]` | no | `[]` | Arguments passed to the spawned command |
| `env` | `Record<string, string>` | no | `{}` | Additional environment variables for the subprocess. `PATH` and `HOME` are inherited automatically |
| `timeoutMs` | `number` | no | `30000` | Timeout in milliseconds for each JSON-RPC request |

### `MCPToolInfo`

Describes a single tool as reported by an MCP server's `tools/list` response.

```typescript
interface MCPToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
```

### `MCPClient`

The interface returned by `createMCPClient`. Provides methods for connecting to an MCP server, discovering its tools, calling them, and converting them into ElsiumAI-compatible `Tool` objects.

```typescript
interface MCPClient {
  connect(): Promise<void>
  disconnect(): Promise<void>
  listTools(): Promise<MCPToolInfo[]>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  toElsiumTools(): Promise<Tool[]>
  readonly connected: boolean
}
```

| Member | Description |
| ------ | ----------- |
| `connected` | Read-only boolean indicating whether the client is currently connected |
| `connect()` | Spawn the subprocess, perform the MCP `initialize` handshake, and send the `notifications/initialized` notification |
| `disconnect()` | Terminate the subprocess, reject all pending requests, and clean up |
| `listTools()` | Send a `tools/list` request and return the available tools |
| `callTool(name, args)` | Invoke a tool on the remote server. Returns the concatenated text content from the response |
| `toElsiumTools()` | List all remote tools and wrap each one as an ElsiumAI `Tool`, ready to be passed to an agent |

### `createMCPClient(config)`

Create a new MCP client. The client does not connect automatically -- call `connect()` before using it.

```typescript
function createMCPClient(config: MCPClientConfig): MCPClient
```

**Parameters**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `config` | `MCPClientConfig` | Client configuration (see above) |

**Returns** -- `MCPClient`

**Example -- connect to an MCP server and list its tools**

```typescript
import { createMCPClient } from '@elsium-ai/mcp'

const client = createMCPClient({
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
})

await client.connect()

const tools = await client.listTools()
console.log(tools)
// [{ name: 'read_file', description: '...', inputSchema: { ... } }, ...]

await client.disconnect()
```

**Example -- call a remote tool directly**

```typescript
import { createMCPClient } from '@elsium-ai/mcp'

const client = createMCPClient({
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
})

await client.connect()

const content = await client.callTool('read_file', { path: '/tmp/hello.txt' })
console.log(content) // file contents as a string

await client.disconnect()
```

**Example -- convert MCP tools into ElsiumAI tools for an agent**

```typescript
import { createMCPClient } from '@elsium-ai/mcp'

const client = createMCPClient({
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
})

await client.connect()

// Each returned Tool has execute() and toDefinition() wired through the MCP client
const elsiumTools = await client.toElsiumTools()

// Pass them to an agent, a toolkit, or call execute() directly
const result = await elsiumTools[0].execute({ path: '/tmp/hello.txt' })
console.log(result)
// { success: true, data: '...', toolCallId: 'tc_...', durationMs: 42 }
```

---

## Server

### `MCPServerConfig`

Configuration object passed to `createMCPServer`.

```typescript
interface MCPServerConfig {
  name: string
  version?: string
  tools: Tool[]
  resources?: MCPResourceHandler[]
  prompts?: MCPPromptHandler[]
}
```

| Property | Type | Required | Default | Description |
| -------- | ---- | -------- | ------- | ----------- |
| `name` | `string` | yes | -- | Server name reported in the `initialize` handshake |
| `version` | `string` | no | `'0.1.0'` | Server version reported in the `initialize` handshake |
| `tools` | `Tool[]` | yes | -- | Array of ElsiumAI `Tool` objects to expose over MCP |
| `resources` | `MCPResourceHandler[]` | no | `[]` | Resource handlers to expose over MCP |
| `prompts` | `MCPPromptHandler[]` | no | `[]` | Prompt handlers to expose over MCP |

### `MCPServer`

The interface returned by `createMCPServer`. The server reads JSON-RPC requests from `stdin` and writes responses to `stdout`, implementing the MCP protocol over stdio transport.

```typescript
interface MCPServer {
  start(): Promise<void>
  stop(): void
  readonly running: boolean
}
```

| Member | Description |
| ------ | ----------- |
| `running` | Read-only boolean indicating whether the server is currently listening for requests |
| `start()` | Begin listening on `stdin` for incoming JSON-RPC messages. Handles `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, and `prompts/get` |
| `stop()` | Stop the server by setting the running flag to false |

### `createMCPServer(config)`

Create a new MCP server that exposes the provided ElsiumAI tools over the MCP protocol.

```typescript
function createMCPServer(config: MCPServerConfig): MCPServer
```

**Parameters**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `config` | `MCPServerConfig` | Server configuration (see above) |

**Returns** -- `MCPServer`

**Example -- expose ElsiumAI tools as an MCP server**

```typescript
import { createMCPServer } from '@elsium-ai/mcp'
import { createTool } from '@elsium-ai/tools'
import { z } from 'zod'

const greet = createTool({
  name: 'greet',
  description: 'Return a greeting for the given name',
  input: z.object({ name: z.string() }),
  execute: async ({ input }) => `Hello, ${input.name}!`,
})

const server = createMCPServer({
  name: 'my-tools',
  version: '1.0.0',
  tools: [greet],
})

await server.start()
```

**Example -- server with resources and prompts**

```typescript
import { createMCPServer } from '@elsium-ai/mcp'
import { createTool } from '@elsium-ai/tools'
import { z } from 'zod'

const greet = createTool({
	name: 'greet',
	description: 'Return a greeting for the given name',
	input: z.object({ name: z.string() }),
	execute: async ({ input }) => `Hello, ${input.name}!`,
})

const server = createMCPServer({
	name: 'my-server',
	version: '1.0.0',
	tools: [greet],
	resources: [
		{
			uri: 'config://app',
			name: 'App Configuration',
			description: 'Current application configuration',
			mimeType: 'application/json',
			read: async () => JSON.stringify({ env: 'production', version: '1.0.0' }),
		},
	],
	prompts: [
		{
			name: 'summarize',
			description: 'Summarize the given text',
			arguments: [
				{ name: 'text', description: 'Text to summarize', required: true },
				{ name: 'style', description: 'Summary style (brief or detailed)', required: false },
			],
			get: async (args) => ({
				messages: [
					{
						role: 'user',
						content: `Summarize the following text in a ${args?.style ?? 'brief'} style:\n\n${args?.text}`,
					},
				],
			}),
		},
	],
})

await server.start()
```

---

## Resources

### `MCPResourceHandler`

Defines a resource that the MCP server can expose. Resources provide read-only data to clients (configuration, files, database records, etc.).

```typescript
interface MCPResourceHandler {
	uri: string
	name: string
	description?: string
	mimeType?: string
	read(): Promise<string>
}
```

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `uri` | `string` | yes | Unique URI identifying the resource (e.g. `'config://app'`, `'file:///data.json'`) |
| `name` | `string` | yes | Human-readable name for the resource |
| `description` | `string` | no | Description of what the resource provides |
| `mimeType` | `string` | no | MIME type of the returned content |
| `read` | `() => Promise<string>` | yes | Async function that returns the resource content as a string |

---

## Prompts

### `MCPPromptHandler`

Defines a prompt template that the MCP server can expose. Prompts allow clients to request pre-built message sequences with optional arguments.

```typescript
interface MCPPromptHandler {
	name: string
	description?: string
	arguments?: MCPPromptArgument[]
	get(args?: Record<string, string>): Promise<{ messages: Array<{ role: string; content: string }> }>
}

interface MCPPromptArgument {
	name: string
	description?: string
	required?: boolean
}
```

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `name` | `string` | yes | Unique name for the prompt |
| `description` | `string` | no | Description of what the prompt does |
| `arguments` | `MCPPromptArgument[]` | no | Arguments the prompt accepts |
| `get` | `(args?) => Promise<{ messages }>` | yes | Async function that returns the prompt's message sequence |

---

## Client Resource and Prompt Methods

The `MCPClient` also supports listing and reading resources and prompts from a connected server:

```typescript
interface MCPClient {
	listResources(): Promise<MCPResourceInfo[]>
	readResource(uri: string): Promise<string>
	listPrompts(): Promise<MCPPromptInfo[]>
	getPrompt(name: string, args?: Record<string, string>): Promise<{ messages: Array<{ role: string; content: string }> }>
}
```

| Method | Description |
| ------ | ----------- |
| `listResources()` | List all resources exposed by the connected MCP server |
| `readResource(uri)` | Read the content of a specific resource by URI |
| `listPrompts()` | List all prompts exposed by the connected MCP server |
| `getPrompt(name, args?)` | Get a prompt's message sequence, optionally passing arguments |

```typescript
import { createMCPClient } from '@elsium-ai/mcp'

const client = createMCPClient({
	name: 'my-client',
	transport: 'stdio',
	command: 'node',
	args: ['./my-mcp-server.js'],
})

await client.connect()

const resources = await client.listResources()
const config = await client.readResource('config://app')

const prompts = await client.listPrompts()
const prompt = await client.getPrompt('summarize', { text: 'Long article...', style: 'brief' })

await client.disconnect()
```

---

## Part of ElsiumAI

This package is the MCP layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
