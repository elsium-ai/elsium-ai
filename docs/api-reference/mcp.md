# elsium-ai/mcp

Model Context Protocol bridge for connecting ElsiumAI with MCP-compatible tool servers and exposing ElsiumAI tools as MCP servers.

```ts
import { createMCPClient, createMCPServer } from '@elsium-ai/mcp'
```

---

## Client

| Export | Signature | Description |
|---|---|---|
| `createMCPClient` | `createMCPClient(config: MCPClientConfig): MCPClient` | Create an MCP client to connect to an external tool server |

### MCPClientConfig

`MCPClientConfig` is a discriminated union over the `transport` field, with one variant per transport. `createMCPClient` selects the implementation based on `transport`.

```ts
type MCPClientConfig = MCPClientStdioConfig | MCPClientHttpConfig
```

**MCPClientStdioConfig** — connect to a server spawned as a child process:

```ts
interface MCPClientStdioConfig {
  name: string            // Client identifier
  transport: 'stdio'      // Transport discriminant
  command: string         // Command to spawn the server process
  args?: string[]         // Command arguments
  env?: Record<string, string>  // Environment variables for the process
  timeoutMs?: number      // Request timeout (default: 30000)
}
```

**MCPClientHttpConfig** — connect to a server over HTTP JSON-RPC:

```ts
interface MCPClientHttpConfig {
  name: string            // Client identifier
  transport: 'http'       // Transport discriminant
  url: string             // Server endpoint URL
  headers?: Record<string, string>  // Extra headers sent with every request
  timeoutMs?: number      // Request timeout (default: 30000)
}
```

### MCPClient Interface

```ts
interface MCPClient {
  connect(): Promise<void>
  disconnect(): Promise<void>
  listTools(): Promise<MCPToolInfo[]>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  toElsiumTools(): Promise<Tool[]>
  listResources(): Promise<MCPResource[]>
  readResource(uri: string): Promise<MCPResourceContent[]>
  listPrompts(): Promise<MCPPrompt[]>
  getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptMessage[]>
  readonly connected: boolean
}
```

| Method | Description |
|---|---|
| `listResources()` | List resources exposed by the server (`resources/list`) |
| `readResource(uri)` | Read the contents of a resource by URI (`resources/read`) |
| `listPrompts()` | List prompt templates exposed by the server (`prompts/list`) |
| `getPrompt(name, args?)` | Resolve a prompt template into messages, substituting `args` (`prompts/get`) |

### MCPToolInfo

```ts
interface MCPToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
```

### Example

```ts
import { createMCPClient } from '@elsium-ai/mcp'

const client = createMCPClient({
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  timeoutMs: 5000,
})

await client.connect()

// List available tools
const tools = await client.listTools()
// => [{ name: 'read_file', description: '...', inputSchema: {...} }, ...]

// Call a tool directly
const content = await client.callTool('read_file', { path: '/tmp/data.txt' })

// Convert to ElsiumAI tools for use with agents
const elsiumTools = await client.toElsiumTools()

await client.disconnect()
```

### Using MCP Tools with Agents

`toElsiumTools()` converts MCP tools into ElsiumAI `Tool[]` format, making them compatible with the agent system.

```ts
import { createMCPClient } from '@elsium-ai/mcp'
import { defineAgent } from '@elsium-ai/agents'

const client = createMCPClient({
  name: 'tools-server',
  transport: 'stdio',
  command: 'node',
  args: ['./my-mcp-server.js'],
})

await client.connect()
const tools = await client.toElsiumTools()

const agent = defineAgent({
  name: 'tool-user',
  system: 'Use the available tools to help the user.',
  provider: 'anthropic',
  apiKey: '...',
  tools,
})

const result = await agent.run('Read the contents of /tmp/config.json')
await client.disconnect()
```

### Resources & Prompts

Beyond tools, an MCP server may expose **resources** (readable data sources identified by URI) and **prompts** (named, parameterized message templates).

```ts
// Resources
const resources = await client.listResources()
// => [{ uri: 'file:///docs/readme.md', name: 'README', mimeType: 'text/markdown' }, ...]

const contents = await client.readResource('file:///docs/readme.md')
// => [{ uri: 'file:///docs/readme.md', mimeType: 'text/markdown', text: '# ...' }]

// Prompts
const prompts = await client.listPrompts()
// => [{ name: 'summarize', description: '...', arguments: [{ name: 'topic', required: true }] }]

const messages = await client.getPrompt('summarize', { topic: 'quarterly results' })
// => [{ role: 'user', content: { type: 'text', text: 'Summarize quarterly results' } }]
```

---

## Server

| Export | Signature | Description |
|---|---|---|
| `createMCPServer` | `createMCPServer(config: MCPServerConfig): MCPServer` | Create a stdio MCP server that exposes ElsiumAI tools |

### MCPServerConfig

```ts
interface MCPServerConfig {
  name: string                       // Server name
  version?: string                   // Server version
  tools: Tool[]                      // ElsiumAI tools to expose via MCP
  resources?: MCPResourceHandler[]   // Resources to expose via MCP
  prompts?: MCPPromptHandler[]       // Prompt templates to expose via MCP
}
```

When `resources` or `prompts` are provided, the server advertises the corresponding capabilities during `initialize` and serves `resources/list`, `resources/read`, `prompts/list`, and `prompts/get` requests.

### MCPResourceHandler

```ts
interface MCPResourceHandler {
  uri: string           // Unique resource identifier
  name: string          // Human-readable name
  description?: string  // Resource description
  mimeType?: string     // MIME type of the content
  read: () => Promise<string | { text?: string; blob?: string }>
}
```

`read()` may return a plain string (treated as `text`) or an object with `text` and/or base64 `blob` content.

### MCPPromptHandler

```ts
interface MCPPromptHandler {
  name: string                       // Unique prompt name
  description?: string               // Prompt description
  arguments?: MCPPromptArgument[]    // Declared template arguments
  get: (args?: Record<string, string>) => Promise<MCPPromptMessage[]>
}
```

### MCPServer Interface

```ts
interface MCPServer {
  start(): Promise<void>
  stop(): void
  readonly running: boolean
}
```

### Example

```ts
import { createMCPServer } from '@elsium-ai/mcp'
import { defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

const calculator = defineTool({
  name: 'calculate',
  description: 'Evaluate a math expression',
  parameters: z.object({
    expression: z.string().describe('Math expression to evaluate'),
  }),
  handler: async ({ expression }) => {
    return { result: eval(expression) }
  },
})

const server = createMCPServer({
  name: 'math-tools',
  version: '1.0.0',
  tools: [calculator],
})

await server.start()
// Server now listens on stdin/stdout for MCP JSON-RPC messages
```

### Exposing Resources & Prompts

```ts
const server = createMCPServer({
  name: 'docs-server',
  tools: [],
  resources: [
    {
      uri: 'file:///docs/readme.md',
      name: 'README',
      mimeType: 'text/markdown',
      read: async () => '# Project docs\n...',
    },
  ],
  prompts: [
    {
      name: 'summarize',
      description: 'Summarize a topic',
      arguments: [{ name: 'topic', required: true }],
      get: async (args) => [
        {
          role: 'user',
          content: { type: 'text', text: `Summarize ${args?.topic}` },
        },
      ],
    },
  ],
})

await server.start()
```

---

## HTTP Handler

| Export | Signature | Description |
|---|---|---|
| `createMCPHttpHandler` | `createMCPHttpHandler(config: MCPHttpHandlerConfig): MCPHttpHandler` | Create a transport-agnostic request handler that serves the MCP protocol over HTTP JSON-RPC |

`createMCPHttpHandler` returns a function that maps a standard `Request` to a `Response`, so it can be mounted in any runtime that speaks the web Fetch API (edge functions, Bun, Deno, Node with an adapter, etc.). It exposes the same tools, resources, and prompts as the stdio server but does not manage a process lifecycle.

### MCPHttpHandlerConfig

```ts
interface MCPHttpHandlerConfig {
  name: string                       // Server name
  version?: string                   // Server version
  tools: Tool[]                      // ElsiumAI tools to expose via MCP
  resources?: MCPResourceHandler[]   // Resources to expose via MCP
  prompts?: MCPPromptHandler[]       // Prompt templates to expose via MCP
}
```

### MCPHttpHandler

```ts
type MCPHttpHandler = (request: Request) => Promise<Response>
```

Only `POST` requests are accepted (others return `405`). The request body is parsed as a single JSON-RPC message; malformed JSON returns a `-32700` parse error. Notifications (e.g. `notifications/initialized`) produce a `204 No Content` response.

### Example

```ts
import { createMCPHttpHandler, createMCPClient } from '@elsium-ai/mcp'

const handler = createMCPHttpHandler({
  name: 'math-tools',
  version: '1.0.0',
  tools: [calculator],
})

// Mount in any Fetch-API runtime
export default { fetch: handler }

// ...or pair with an MCP HTTP client
const client = createMCPClient({
  name: 'math-tools',
  transport: 'http',
  url: 'http://localhost:3000/mcp',
})
await client.connect()
```

---

## Types

| Export | Description |
|---|---|
| `MCPClient` | Client interface: tool, resource, and prompt operations plus `connected` |
| `MCPClientConfig` | Discriminated union of `MCPClientStdioConfig` and `MCPClientHttpConfig` |
| `MCPClientStdioConfig` | Stdio client config: `name`, `transport`, `command`, `args?`, `env?`, `timeoutMs?` |
| `MCPClientHttpConfig` | HTTP client config: `name`, `transport`, `url`, `headers?`, `timeoutMs?` |
| `MCPToolInfo` | Tool info returned by `listTools`: `name`, `description`, `inputSchema` |
| `MCPServer` | Server interface: `start`, `stop`, `running` |
| `MCPServerConfig` | Server config: `name`, `version?`, `tools`, `resources?`, `prompts?` |
| `MCPHttpHandler` | HTTP handler function: `(request: Request) => Promise<Response>` |
| `MCPHttpHandlerConfig` | HTTP handler config: `name`, `version?`, `tools`, `resources?`, `prompts?` |
| `MCPResource` | Resource metadata: `uri`, `name`, `description?`, `mimeType?` |
| `MCPResourceContent` | Resource contents: `uri`, `mimeType?`, `text?`, `blob?` |
| `MCPResourceHandler` | Server-side resource definition with a `read()` callback |
| `MCPPrompt` | Prompt metadata: `name`, `description?`, `arguments?` |
| `MCPPromptArgument` | Prompt argument declaration: `name`, `description?`, `required?` |
| `MCPPromptMessage` | Prompt message: `role` (`'user' \| 'assistant'`), `content` (`{ type: 'text'; text: string }`) |
| `MCPPromptHandler` | Server-side prompt definition with a `get()` callback |
| `MCPTransport` | Transport identifier: `'stdio' \| 'http'` |

### Resource & Prompt Types

```ts
interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

interface MCPResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string   // base64-encoded binary content
}

interface MCPPrompt {
  name: string
  description?: string
  arguments?: MCPPromptArgument[]
}

interface MCPPromptArgument {
  name: string
  description?: string
  required?: boolean
}

interface MCPPromptMessage {
  role: 'user' | 'assistant'
  content: { type: 'text'; text: string }
}
```

---

## Capability Guard

Gates `callTool` on a [`CapabilityToken`](./core.md), so an MCP client can only invoke tools the token is authorized to use. Every other method (`connect`, `listTools`, `readResource`, etc.) is passed through unchanged.

### createCapabilityGuardedMCPClient

```ts
createCapabilityGuardedMCPClient(
  client: MCPClient,
  options: CapabilityGuardedMCPOptions,
): MCPClient
```

Wraps an existing `MCPClient`. On each `callTool`, it optionally verifies the token via `options.verifier`, then checks the token's scope against `{ server, tool }` with `canUseMcp`. A denied call throws an `ElsiumError` with code `AUTH_ERROR` and (if provided) invokes `options.onDeny`.

### CapabilityGuardedMCPOptions

| Field | Type | Description |
|---|---|---|
| `token` | `CapabilityToken` | Token authorizing tool calls |
| `server` | `string` | Server name used for scope checks |
| `verifier` | `CapabilityVerifier?` | Optional verifier run before the scope check |
| `onDeny` | `(event: MCPCapabilityDenialEvent) => void?` | Callback fired when a call is denied |

**MCPCapabilityDenialEvent:**

| Field | Type | Description |
|---|---|---|
| `tokenId` | `string` | ID of the denied token |
| `subject` | `string` | Agent subject from the token |
| `server` | `string` | Server name |
| `tool` | `string` | Tool that was denied |
| `reason` | `CapabilityCheckReason \| undefined` | Why the call was denied |
| `detail` | `string?` | Additional detail |

```ts
import { createMCPClient, createCapabilityGuardedMCPClient } from '@elsium-ai/mcp'

const guarded = createCapabilityGuardedMCPClient(
  createMCPClient({ name: 'data-tools', transport: 'http', url: 'http://localhost:3001/mcp' }),
  {
    token,
    server: 'data-tools',
    onDeny: (event) => console.warn('MCP call denied', event),
  },
)

await guarded.connect()
await guarded.callTool('query_db', { sql: 'SELECT 1' }) // throws AUTH_ERROR if not authorized
```

### Types

| Export | Description |
|---|---|
| `CapabilityGuardedMCPOptions` | Guard options: `token`, `server`, `verifier?`, `onDeny?` |
| `MCPCapabilityDenialEvent` | Denial event passed to `onDeny` |

---

## MCP Trust Framework

Security layer for MCP connections: server allowlists, tool filtering, output validation, manifest integrity, and audit logging.

### createTrustedMCPClient

```ts
createTrustedMCPClient(config: MCPClientConfig, trustConfig: MCPTrustConfig): TrustedMCPClient
```

Wraps a standard MCP client with security controls. Rejects connections to servers not in the allowlist, filters tools, validates output sizes, and logs all operations.

**MCPTrustConfig:**

| Field | Type | Description |
|---|---|---|
| `allowedServers` | `AllowedServer[]?` | Server allowlist with transport/URL/command verification |
| `validateToolOutputs` | `boolean?` | Enable output validation |
| `auditLog` | `MCPAuditLogger?` | Logger for all MCP operations |
| `maxToolOutputSize` | `number?` | Max tool output size in bytes (default: 1MB) |

**AllowedServer:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Server name to match |
| `transport` | `'stdio' \| 'http'` | Expected transport type |
| `commandHash` | `string?` | SHA-256 hash of `command:args` for stdio servers |
| `urlPattern` | `string?` | Regex pattern for HTTP server URL |
| `allowedTools` | `string[]?` | Tool whitelist for this server |
| `deniedTools` | `string[]?` | Tool blacklist for this server |

```ts
import { createTrustedMCPClient } from '@elsium-ai/mcp'

const client = createTrustedMCPClient(
  { name: 'data-tools', transport: 'http', url: 'http://localhost:3001/mcp' },
  {
    allowedServers: [
      {
        name: 'data-tools',
        transport: 'http',
        urlPattern: '^http://localhost:3001',
        allowedTools: ['query_db', 'list_tables'],
        deniedTools: ['drop_table'],
      },
    ],
    maxToolOutputSize: 512 * 1024,
    auditLog: { log: (event) => console.log(event) },
  },
)

await client.connect()
const tools = await client.listTools() // only returns allowed tools
```

### Tool Manifests

Generate and verify tool manifests for supply chain integrity:

```ts
const manifest = await client.generateManifest()
// { serverName, tools: [{ name, description, inputSchemaHash }], hash }

const isValid = await client.verifyManifest(manifest)
// false if server tools have changed since manifest was generated
```

### Types

| Export | Description |
|---|---|
| `TrustedMCPClient` | Extended MCPClient with `manifest`, `generateManifest()`, `verifyManifest()` |
| `MCPTrustConfig` | Trust configuration: allowlist, validation, audit |
| `AllowedServer` | Server allowlist entry with tool filtering |
| `MCPAuditLogger` | Audit logger interface |
| `MCPAuditEvent` | Audit event: `type`, `serverName`, `timestamp`, `data` |
| `MCPToolManifest` | Tool manifest with hash for integrity verification |
