# Research: licensing, billing, CI cost

Not legal advice. A lawyer reviews all of this before any commercial launch.

## License: PolyForm Shield 1.0.0 (D19)

The owner's goal: **anyone may use it, including at work, but only the author may commercialise it, permanently.**

| License | Use at work | Others may sell / compete | Only the author sells | Verdict |
|---|---|---|---|---|
| MIT / Apache-2.0 | ✅ | ✅ allowed | ❌ | Rejected |
| FSL (Functional Source License) | ✅ | ❌ for 2 years, then each version becomes Apache/MIT | Only temporarily | Rejected (not permanent) |
| PolyForm Noncommercial | ❌ | ❌ | ✅ | Rejected (bans use at work, which hurts adoption) |
| **PolyForm Shield** | ✅ | ❌ | ✅ | **Chosen** |

**Consequences:**
- The project is "source-available", not "open source" in the OSI sense.
- Outside contributions need a CLA.
- `LICENSE.md` carries a `Licensor Line of Business:` line so the license's "Discontinued Products" exception can't reopen a paused product line.
- Shield has no SPDX identifier; manifests use `LicenseRef-PolyForm-Shield-1.0.0`.
- Loomwright was relicensed to match (vikashruhilgit/loomwright#289). Versions released while its manifests said MIT stay MIT. Its PyPI package `vikashruhil-mysql-mcp` stays MIT.

## Billing

- **Personal build: Claude subscription** (D15), with the shared weekly cap handled as in D17.
- **Commercial build: API key first** (D16). The Agent SDK overview says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." SDK use falls under Anthropic's Commercial Terms.
- **Branding:** "Wright, powered by Claude" is allowed; not "Claude Code", and no Claude Code-style visuals.

Source: [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)

## GitHub Actions cost (D20)

From [GitHub Actions billing docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions):
- **Free** on public repos using standard GitHub-hosted runners.
- **Free** on self-hosted runners, on any repo.
- **Private repos:** 2,000 free minutes/month on GitHub Free, 3,000 on Pro. macOS runners cost $0.062/min vs $0.006/min on Linux.

**Separate from Actions minutes:** the `claude-review` CI job uses the Claude subscription token, so it costs weekly cap, not minutes.
