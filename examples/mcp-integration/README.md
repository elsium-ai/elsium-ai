# MCP Integration Example

Demonstrates bidirectional Model Context Protocol support — consume external MCP servers and expose your own tools as an MCP server.

## Run

```bash
export ANTHROPIC_API_KEY=your-key

# Run as MCP client (connects to an external MCP server)
bun run examples/mcp-integration/index.ts client

# Run as MCP server (exposes tools for external consumers)
bun run examples/mcp-integration/index.ts server
```

## What it demonstrates

- `elsium-ai/mcp` — MCP client and server
- `elsium-ai/agents` — agent with MCP tools
- Stdio and HTTP transports
- Exposing tools as an MCP server for external consumers
