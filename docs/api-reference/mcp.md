# elsium-ai/mcp

Model Context Protocol bridge for connecting ElsiumAI with MCP-compatible tool servers and exposing ElsiumAI tools as MCP servers.

```ts
import { createMCPClient, createMCPServer } from 'elsium-ai/mcp'
```

---

## Client

| Export | Signature | Description |
|---|---|---|
| `createMCPClient` | `createMCPClient(config: MCPClientConfig): MCPClient` | Create an MCP client to connect to an external tool server |

### MCPClientConfig

```ts
interface MCPClientConfig {
  name: string            // Client identifier
  transport: 'stdio'      // Transport type
  command: string         // Command to spawn the server process
  args?: string[]         // Command arguments
  env?: Record<string, string>  // Environment variables for the process
  timeoutMs?: number      // Connection timeout
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
  readonly connected: boolean
}
```

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
import { createMCPClient } from 'elsium-ai/mcp'

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
import { createMCPClient } from 'elsium-ai/mcp'
import { createAgent } from 'elsium-ai/agents'
import { gateway } from 'elsium-ai/gateway'

const client = createMCPClient({
  name: 'tools-server',
  transport: 'stdio',
  command: 'node',
  args: ['./my-mcp-server.js'],
})

await client.connect()
const tools = await client.toElsiumTools()

const agent = createAgent({
  name: 'tool-user',
  gateway: gateway({ provider: 'anthropic', apiKey: '...' }),
  tools,
})

const result = await agent.run('Read the contents of /tmp/config.json')
await client.disconnect()
```

---

## Server

| Export | Signature | Description |
|---|---|---|
| `createMCPServer` | `createMCPServer(config: MCPServerConfig): MCPServer` | Create a stdio MCP server that exposes ElsiumAI tools |

### MCPServerConfig

```ts
interface MCPServerConfig {
  name: string          // Server name
  version?: string      // Server version
  tools: Tool[]         // ElsiumAI tools to expose via MCP
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
import { createMCPServer } from 'elsium-ai/mcp'
import { defineTool } from 'elsium-ai/tools'
import { z } from 'zod'

const calculator = defineTool({
  name: 'calculate',
  description: 'Evaluate a math expression',
  parameters: z.object({
    expression: z.string().describe('Math expression to evaluate'),
  }),
  execute: async ({ expression }) => {
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

---

## Types

| Export | Description |
|---|---|
| `MCPClient` | Client interface: `connect`, `disconnect`, `listTools`, `callTool`, `toElsiumTools`, `connected` |
| `MCPClientConfig` | Client config: `name`, `transport`, `command`, `args?`, `env?`, `timeoutMs?` |
| `MCPToolInfo` | Tool info returned by `listTools`: `name`, `description`, `inputSchema` |
| `MCPServer` | Server interface: `start`, `stop`, `running` |
| `MCPServerConfig` | Server config: `name`, `version?`, `tools` |
