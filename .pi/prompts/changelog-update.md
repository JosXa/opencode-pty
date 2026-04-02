---
description: Analyzes recent git commits, curates notable user-facing changes, and updates/merges them into the [Unreleased] section of CHANGELOG.md following Keep a Changelog guidelines.
---
Follow these steps to curate and update only the [Unreleased] section of CHANGELOG.md based on recent git history.

Key guidelines from Keep a Changelog[](https://keepachangelog.com/en/1.1.0/):

- Use human-readable, curated entries — never dump raw commit messages.
- Group related commits into concise, clear bullet points.
- Rephrase for end-user clarity (avoid internal developer jargon).
- Only include notable changes that affect users (behavior, features, UI, API, performance, security, etc.).
- Standard sections: Added, Changed, Deprecated, Removed, Fixed, Security.
- Omit any empty sections.
- Always maintain an [Unreleased] section at the top for upcoming changes.
- Do not create dated release sections or perform any version bumping.

Steps:

1. Read the current CHANGELOG.md: @CHANGELOG.md

2. Identify the latest released version (to know the range of new commits):
   !git describe --tags --abbrev=0 2>/dev/null || echo "0.0.0"
   Let last_version = the output (strip any leading 'v' if present).

3. Fetch commits since the last release (including bodies for context):
   !git log v${last_version}..HEAD --pretty=format:"%H%n%s%n%b%n---COMMIT_END---"

   If no commits, respond: "No changes since last release. No changelog update needed."

4. Analyze the commits for user-impacting changes:
   - Prefer Conventional Commits prefixes as guides:
     - feat: or feat!: → Added (new features)
     - fix: → Fixed (bug fixes)
     - perf: → Changed (performance improvements)
     - docs: → Added or Changed only if user-visible
     - refactor:, style:, test:, chore:, ci:, build: → ignore unless they have clear user impact
   - Look for breaking changes (e.g., BREAKING CHANGE: footers or obvious removals) → place in Changed, Removed, or Deprecated as appropriate.
   - For non-conventional commits, intelligently judge based on content and user impact.
   - Always ignore purely internal noise: whitespace fixes, merge commits, minor refactors, test/CI additions, comment-only changes, etc.

5. Curate entries:
   - Group similar/related commits into single bullets.
   - Rephrase clearly and concisely for end users (e.g., "Add support for dark mode with new settings toggle" instead of raw commit titles).
   - Include scopes if helpful (e.g., "(API)" or "(UI)").
   - If $ARGUMENTS is provided, treat it as manual overrides/additions — insert the specified entries directly into the appropriate sections.

6. Update CHANGELOG.md:
   - Preserve all existing content exactly.
   - Ensure an [Unreleased] section exists at the top (after the main header).
   - Add the new curated bullets under the correct sections.
   - Merge thoughtfully with any existing [Unreleased] entries (avoid duplicates; combine similar items).
   - Omit any sections that end up empty.

7. Edit CHANGELOG.md with the curated updates.

8. Respond with a concise summary, e.g.:
   "Updated CHANGELOG.md [Unreleased] section:
   - Added: 3 new features
   - Fixed: 2 bugs
   - Changed: 1 performance improvement"

Do not output the full updated CHANGELOG.md content.
Ensure all entries are accurate, user-focused, and strictly follow Keep a Changelog style.