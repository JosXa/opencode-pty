# Release Command

Guide through complete release workflow for @josxa/opencode-pty.

## Usage

`/release` - Analyze commits and automatically bump version (patch/minor/major based on conventional commits)

## Instructions

You are guiding the user through the complete release workflow. Follow these steps EXACTLY:

### Pre-Release Checklist

1. **Verify working directory is clean:**
   - Run `git status` to check for uncommitted changes
   - If there are uncommitted changes, STOP and ask user to commit them first

2. **Verify CI is passing:**
   - Run `gh run list --limit 3`
   - If latest run is not successful (ignore Devenv CI failures, those are pre-existing), STOP and ask user to fix CI first

### Release Steps

Execute these steps IN ORDER:

**Step 1: Determine Version Bump**
- Read current version from `package.json`
- Get commits since last tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
- Analyze commit messages using conventional commits:
  - **MAJOR** (X.0.0): Any commit with `BREAKING CHANGE:` in body OR `!` after type (e.g., `feat!:`, `fix!:`)
  - **MINOR** (X.Y.0): Any commit starting with `feat:` or `feat(scope):`
  - **PATCH** (X.Y.Z): Everything else (`fix:`, `chore:`, `docs:`, `refactor:`, etc.)
- Use the HIGHEST bump level found (major > minor > patch)
- **If MAJOR version bump detected:** STOP and ask user for confirmation before proceeding. Explain which commit(s) triggered the major bump.
- Calculate new version and inform user: "Bumping version: 1.4.1 -> 1.5.0 (minor, new features detected)"
- Use Edit tool to update package.json with new version
- Commit: `git add package.json && git commit -m "chore: bump version to vX.Y.Z"`

**Step 2: Push Version Bump**
- Push to remote: `git push`
- Wait for CI to pass: `gh run list --limit 3`
- The publish workflow (`publish.yml`) auto-triggers on CI completion and detects the version change
- If CI fails, STOP and inform user (see Recovery section)

**Step 3: Monitor Publish**
- The publish workflow automatically:
  1. Detects version bump (compares `package.json` at HEAD vs HEAD^)
  2. Creates a GitHub release with auto-generated notes
  3. Publishes to npm via OIDC trusted publishing (no tokens needed)
- Check publish workflow status: `gh run list --workflow=publish.yml --limit 3`
- Wait for it to complete and verify success

**Step 4: Verify**
- Confirm the GitHub release was created: `gh release list --limit 3`
- Confirm npm publish: run `nu -c 'http get https://registry.npmjs.org/@josxa/opencode-pty | get "dist-tags".latest'`
- Inform user release is complete

### Recovery: Version Bumped While CI Failing

If CI was failing when version bump was pushed, the publish workflow won't trigger (it requires CI success). Fix CI, then either:
- Push another commit to re-trigger CI, or
- Manually trigger: `gh workflow run publish.yml`

If the publish workflow ran but failed:
1. Fix the issue
2. Manually re-trigger: `gh workflow run publish.yml`

If a GitHub release was created but npm publish failed:
1. Delete the release: `gh release delete vX.Y.Z --yes`
2. Delete the tag: `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`
3. Fix the issue and re-trigger

### Important Notes

- Publishing to npm is AUTOMATED via CI on version bump detection
- DO NOT manually publish to npm
- Version format: X.Y.Z (no 'v' prefix in package.json, but 'v' prefix in git tags and releases)
- Repository: https://github.com/JosXa/opencode-pty
- Devenv CI failures (Firefox/Nix issues) are pre-existing and can be ignored when checking CI status

### Error Handling

If ANY step fails:
1. STOP the workflow
2. Inform user of the failure
3. Provide recovery instructions
4. DO NOT proceed to next steps
