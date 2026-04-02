---
description: Analyze git changes, determine optimal commit strategy, craft Conventional Commits messages, and commit changes autonomously
---

Please perform the following steps carefully to create high-quality git commits:

1. Run `git status` to examine the current repository state, including staged, unstaged, and untracked files.

2. Inspect the detailed changes:
   - Staged changes: review the full `git diff --staged`
   - Unstaged changes: review the full `git diff`
   - Untracked files: list and review their contents if relevant

3. Deeply analyze the purpose, impact, and nature of all changes in the codebase, including staged, unstaged, and untracked files.

4. Determine the optimal commit strategy based on the analysis:
    - Identify logical groups of changes (e.g., by feature, bug fix, refactor, documentation). Changes should be grouped if they are cohesive and achieve a single purpose.
    - When grouping changes, prefer separating documentation-only updates (use `docs:`) from code/behavior changes.
   - Decide whether to:
     - Commit staged changes as-is if they form a complete, logical unit.
     - Stage additional unstaged/untracked changes that belong to the same logical group as staged changes.
     - Split changes into multiple commits if they represent distinct logical units (e.g., one for feat, one for fix).
     - Stage and commit unstaged changes separately if no staged changes exist but changes are ready.
     - Ignore or recommend ignoring irrelevant changes (e.g., temporary files).
   - Prioritize small, atomic commits that are easy to review and revert.
   - If no changes are ready or logical to commit, inform the user and suggest actions (e.g., staging specific files).

 5. For each identified commit group:
    - Stage the relevant files if not already staged (using `git add <files>` or `git add -A` if appropriate).
    - Craft a detailed commit message that **strictly** follows the Conventional Commits specification (v1.0.0).

      Before writing the message, carefully read and internalize the complete specification:  
      https://www.conventionalcommits.org/en/v1.0.0/#specification

      Key guidelines from the spec:
      - Format: `<type>[optional scope]: <description>`
      - Subject line: imperative mood (e.g. "add", "fix", "update"), **no leading capital**, ≤50–72 characters
      - Optional body: explain **what** changed and **why** (not how), wrap at 72 characters
      - Optional footer: BREAKING CHANGE notices, issue references (e.g. Closes #123), etc.

      **Recommended types and when to use them** (based on the spec and common conventions like Angular):
      - `feat:`     – Introduces a **new feature** noticeable to **end-users** (correlates to MINOR in SemVer).
      - `fix:`      – Patches a **bug** noticeable to **end-users** (correlates to PATCH in SemVer).
      - `docs:`     – **Documentation only** changes. Use this for:
        - Updates to README, CHANGELOG, CONTRIBUTING, API docs, wiki pages, etc.
        - Adding/fixing/updating inline code comments, docstrings, JSDoc, godoc, annotations, etc.
        - Improving examples, tutorials, or usage guides.
      - `style:`    – Changes that do **not** affect code behavior (formatting, whitespace, semicolons, quotes, etc.).
      - `refactor:` – Code restructuring that **neither** fixes a bug **nor** adds a feature (improves readability, maintainability, no observable behavior change).
      - `perf:`     – Performance improvements (observable speed/memory gains).
      - `test:`     – Adding or correcting tests (no production code change).
      - `build:`    – Changes affecting build system, external dependencies, or toolchain (npm, webpack, Docker, etc.).
      - `ci:`       – Changes to CI/CD configuration & scripts (GitHub Actions, Travis, etc.).
      - `chore:`    – Maintenance tasks or changes that **do not** modify src/test/docs files (e.g. .gitignore updates, script tweaks, dependency bumps with no code impact).
      - `revert:`   – Reverts a previous commit (include footer referencing the reverted SHA).

      **Important distinctions**:
      - Use `docs:` (not `refactor:`) for adding/fixing comments or docstrings — they are considered documentation.
      - Use `docs:` only when changes are **exclusively** or **primarily** documentation-related.
      - Reserve `feat:` and `fix:` for changes that affect **end-user** experience or public API behavior.
      - For internal-only improvements (developer experience, non-user-facing), prefer `refactor:`, `chore:`, `perf:`, etc.
      - If multiple aspects exist, prefer **smaller, atomic commits** with one clear type each.

      Analyze the project context (CLI, library, web app, etc.) to choose the most appropriate type/scope. Make messages clear, professional, and valuable for changelogs, release notes, and future readers.

    - Commit the staged changes with the crafted message using `git commit -m "<message>"` (include body and footer in the message if needed, using newlines).

6. If multiple commits are needed, perform them sequentially, restaging as necessary after each commit.

7. After all commits, run `git status` again to confirm the repository state and summarize: 'Committed X changes as [type(scope)]: [short description]' for each commit.

8. If any changes were not committed (e.g., not ready or irrelevant), explain why and suggest next steps.

Prioritize accuracy, completeness, and adherence to the Conventional Commits standard. Make decisions autonomously based on best practices for clean commit history.