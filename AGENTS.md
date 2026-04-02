# Package Manager

ALWAYS use Bun. NEVER npm (volta npm is broken on this machine anyway). Commands: `bun install`, `bun add`, `bun remove`, `bun run`, `bun test`.

# Release Workflow

For the full release workflow, see [Release Command](.opencode/command/release.md).

- Version bump auto-determined from conventional commits
- Publish to npm automated via CI on version bump detection (not tag-based)
- CI pipeline: push to main -> CI runs -> CI passes -> publish.yml triggers -> detects version change -> creates GitHub release + publishes to npm

NEVER ask user for release notes content. CI auto-generates them from commits.

## CI Pipeline Quirks

**Devenv CI always fails** due to missing Firefox binary in Nix store. This is a pre-existing infrastructure issue on both upstream (shekohex/opencode-pty) and this fork. Ignore Devenv CI failures when evaluating CI status. The 5 main jobs (typecheck, lint, format, test, test:e2e) are the ones that matter.

**Publish workflow requires CI success.** The `publish.yml` workflow triggers on `workflow_run` completion of `CI` workflow with `conclusion == 'success'`. Since Devenv CI fails, the overall CI conclusion is `failure`, so publish never auto-triggers. MUST use manual dispatch: `gh workflow run publish.yml`

**Trusted publishing via OIDC.** npm publish uses GitHub Actions OIDC tokens (no `NPM_TOKEN` secret needed). Configured on npmjs.com for `JosXa/opencode-pty` repo, `publish.yml` workflow.

**npm CLI is broken via volta.** Use `bun publish` or find the node npm-cli.js directly if you need to publish locally. But prefer CI publishing.

## Recovery: Tag Pushed While CI Failing

MUST delete tag immediately:
```
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
```

# Pre-Commit Lint Check

MUST run `bun format` (biome) before any git commit.

**Behavior:**
1. Warnings in files YOU modified this session -> MUST fix before committing
2. Warnings ONLY in files you did NOT touch (pre-existing issues) -> ask user
3. Commit only after all warnings in your modified files are resolved

Compare biome output against `git diff --name-only` to determine which files you touched.

# Build

This package ships pre-compiled JS via `dist/`. The `prepublishOnly` script runs `bun build:prod` which does `bun clean && bun build:plugin && vite build --mode production`.

The `clean` script uses `rm -rf` which fails on Windows. Use PowerShell `Remove-Item` instead if cleaning locally.
