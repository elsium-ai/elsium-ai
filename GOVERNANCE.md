# ElsiumAI — Governance

## Open-source commitment

ElsiumAI commits publicly to the following principles:

1. **Single license, all features.** The entire `packages/` tree, including all governance, observability, security, and multi-tenant features, is published under the MIT License. There will not be:
   - An `ee/`, `enterprise/`, or `pro/` directory with separate licensing.
   - A source-available license (BSL, SSPL, Elastic License) replacing or supplementing MIT.
   - Feature gates that hide governance / observability / multi-tenant / approval / policy primitives behind a paid SKU.

2. **No enterprise tier.** If a feature is in `packages/`, it works for everyone under MIT. If we cannot afford to maintain a feature under MIT, we remove it — we do not relicense it.

3. **Framework, not application.** Publishable packages do not ship backend-specific drivers (SQLite, Postgres, Redis, DynamoDB, …). The framework declares **ports** (interfaces like `CostStore`, `ApprovalStore`, `CheckpointStore`) and ships **in-memory reference adapters**. Production durability is the user's call. See `docs/guides/persistent-stores.md`.

4. **Monetization, when it happens, is via separate products.** Acceptable models:
   - **Hosted / managed service** (separate repo, separate license — does not affect OSS code).
   - **Consulting, training, paid support engagements.**
   - **Corporate sponsors** (GitHub Sponsors, Open Collective) without feature trade-offs.

   Unacceptable: "core OSS but `gen_ai.compliance` is enterprise only" or any equivalent dual-licensing fragmentation that gates published-package features by SKU.

## Why this matters

This commitment exists because the framework's strategic position depends on it. Multi-tenant RBAC, signed audit logs, declarative policy, multi-stage approvals, idempotent checkpoints, drift detection, PII jurisdictional routing — these are precisely the features that competing TypeScript frameworks place behind commercial SKUs. ElsiumAI's value proposition is that those primitives are first-class, open, and verifiable.

Relicensing or fragmenting the package surface would invalidate that proposition. We commit not to do it.

## Process

- Changes to this document require a public RFC and a 14-day review window.
- Changes that would weaken the open-source commitment — introducing `ee/`, changing license, gating features in publishable packages by SKU — explicitly require **2/3 supermajority of maintainers with merge rights** AND prior public discussion.
- Commits and PRs targeting `LICENSE`, `GOVERNANCE.md`, or any `package.json` `license` field are protected by branch ruleset requiring manual review by a maintainer who did not author the change.

## Adapters

The framework ships **only in-memory reference adapters** for state-carrying primitives. Third-party adapters (community-published SQLite, Postgres, Redis, etc.) are welcome and encouraged. They are linked from `docs/guides/persistent-stores.md` when stable and community-validated, but they are **not** part of the framework's release surface and follow their own licensing and release cadence.

If the community converges on a particular adapter as the de-facto standard, we will document the linkage but we will **not** absorb it into `@elsium-ai/*` without a public RFC explaining why the agnosticism trade-off was made.

## Versioning

ElsiumAI follows [Semantic Versioning](https://semver.org/) on the public surface (the API exported from each publishable package). The Changesets workflow in `.github/workflows/publish.yml` enforces this — every change that touches `packages/*/src/` requires a changeset that classifies the impact (patch / minor / major).

Pre-1.0, breaking changes are allowed in minor bumps but are always documented in `CHANGELOG.md` with a migration path. Post-1.0, breaking changes require a major bump.

## Code of conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/) version 2.1, mirrored at `CODE_OF_CONDUCT.md`.

---

*Document version: 1.0 — adopted 2026-05-12.*
