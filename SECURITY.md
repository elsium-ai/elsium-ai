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

### Publishing

Releases authenticate to npm through **OIDC trusted publishing**, not a
long-lived token. The `Publish` workflow requests a short-lived credential
using its `id-token: write` permission, so no publish-capable secret is stored
in the repository at all.

This also tracks where npm is heading: from January 2027, 2FA-bypass granular
access tokens lose the ability to publish directly.

Every published package carries [SLSA provenance](https://slsa.dev/provenance/v1),
which ties a tarball on npm back to the exact commit and workflow run that
produced it:

```bash
npm view elsium-ai dist.attestations
```

Release commits are signed, so the signed-commits rule on `main` holds for
automation as well as for people.

**Operator setup** — required once per package, and interactive because npm
demands 2FA:

1. On npmjs.com, for each `@elsium-ai/*` package and `elsium-ai`:
   *Settings → Trusted publishers → GitHub Actions*, with repository
   `elsium-ai/elsium-ai` and workflow `publish.yml`.
2. Generate a signing key for release automation:
   `ssh-keygen -t ed25519 -C "release automation" -f release_signing_key -N ""`
   No passphrase — CI cannot answer a prompt.
3. Register the **public** key on the account that authors release commits
   (*Settings → SSH and GPG keys → New SSH key*, key type **Signing Key**).
4. Add repository secrets `RELEASE_SIGNING_KEY` (the private key) and
   `RELEASE_SIGNING_EMAIL`.

   `RELEASE_SIGNING_EMAIL` **must be an address verified on that account** —
   the `noreply` address is the safe choice:
   `<id>+<username>@users.noreply.github.com`

   This is not cosmetic. A commit signed with a valid key but authored from an
   unrecognised address verifies as `no_user`: signed, yet still not
   "Verified", so a signed-commits rule rejects it exactly as if it had never
   been signed. Confirm with:

   ```bash
   gh api repos/<owner>/<repo>/commits/<sha> --jq .commit.verification
   # { "verified": true, "reason": "valid" }
   ```

5. Delete the `NPM_TOKEN` secret — nothing reads it any more.

Until step 1 is done, publishing fails: there is no token to fall back to, by
design. Until steps 2–4 are done, release commits are unsigned and merging them
needs an admin bypass; the workflow warns rather than failing in that case.

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
