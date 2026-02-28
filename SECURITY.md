# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ElsiumAI, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email security@elsium.ai with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Scope

This policy covers all packages in the `@elsium-ai/*` namespace:

- `@elsium-ai/core`
- `@elsium-ai/gateway`
- `@elsium-ai/agents`
- `@elsium-ai/tools`
- `@elsium-ai/rag`
- `@elsium-ai/workflows`
- `@elsium-ai/observe`
- `@elsium-ai/app`
- `@elsium-ai/testing`
- `@elsium-ai/cli`

## Best Practices

When using ElsiumAI:

- Never commit API keys to source control. Use environment variables.
- Use the built-in `env()` helper which throws on missing keys.
- Enable rate limiting when exposing agents via HTTP.
- Use input validators in agent guardrails to prevent prompt injection.
- Review tool definitions carefully — tools execute arbitrary code.
