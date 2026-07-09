# Workspace Rules

## Agent behavior guidelines
- **Check past audit history first:** Before suggesting any security patches or codebase refactorings, you MUST read the [.agents/resolved_issues.md](file:///c:/Users/matia/Desktop/chetrend/.agents/resolved_issues.md) log. If a security vulnerability or design choice is already listed there, do not report it or suggest modifications for it.
- **Maintain architectural clean state:** Align all recommendations with the specifications in `GEMINI.md` (inmutable state updates, DOM diffing, guest window limits, SQLite busy timeout configuration).
