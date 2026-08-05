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

## Supply-Chain Controls

This repository defends its own source, not only the code it ships.

### Automated checks

| Control | Where it runs | What it catches |
|---|---|---|
| `bun run scan:security` | `pre-commit` hook (staged files) and the `Security Scan` CI job (whole tree) | Source-level tampering — see the detector table below |
| CodeQL (`security-extended`) | Pull requests, pushes to `main`, weekly schedule | Injection, path traversal, unsafe deserialization and similar classes |
| `bun audit` | `Audit` CI job | Known advisories in the dependency tree |
| Dependabot | Weekly, plus security updates | Outdated and vulnerable dependencies, including pinned GitHub Actions |
| Secret scanning + push protection | GitHub, on every push | Credentials committed or pushed, blocked before they land |

The `Security Scan` job **gates every other CI job** and runs *before*
dependencies are installed. Installing or building a tampered tree is what
executes it, so the scan has to happen first. The scanner depends only on Node
builtins for exactly this reason.

### What the scanner detects

| Detector | Rationale |
|---|---|
| `hidden-payload` | Code pushed off-screen behind a run of padding whitespace. A real payload was hidden this way in a config file — committed unnoticed, executed on every build, invisible in review. |
| `obfuscated-payload` | Byte signatures of known obfuscated loaders: char-shuffle deobfuscators, `require` aliased onto a global, `eval(atob(...))`. |
| `bidi-control` | Bidirectional and invisible Unicode (Trojan Source, [CVE-2021-42574](https://nvd.nist.gov/vuln/detail/CVE-2021-42574)) — source that renders differently than it executes. |
| `install-hook` | `preinstall` / `install` / `postinstall` in a publishable package. These run on every consumer machine at install time; no package in this repo ships one. |
| `anomalous-line` | Very long lines that also match obfuscation heuristics. Generated and minified output is excluded. |

The scanner is dependency-free and portable — copy `scripts/security-scan.ts`
into another repository and wire it to `pre-commit` and CI the same way.

### If the scanner fires

1. **Do not build or run the tree.** Building is what detonates this class of payload.
2. `git diff` the reported file and line.
3. If it is a real injection, find the commit that introduced it
   (`git log -S '<signature>' -- <file>`) and check whether the author and
   committer metadata agree — a mismatch in timezone or identity indicates the
   commit did not originate where it claims.
4. Treat every credential exposed to a CI build since that commit as compromised.

## Best Practices

When using ElsiumAI:

- Never commit API keys to source control. Use environment variables.
- Use the built-in `env()` helper which throws on missing keys.
- Enable rate limiting when exposing agents via HTTP.
- Use input validators in agent guardrails to prevent prompt injection.
- Review tool definitions carefully — tools execute arbitrary code.
