# Changelog

All notable changes to the "AI Rules Converter" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-05-21

### Added
- **CLI Detail & Compact Option**: Added `--detail` option and aliases (`--verbose`, `-d`, `-v`) to `scan` and `scan-all` commands.
- **Default Compact View**: Scan commands now default to a clean, compact overview (excluding rule descriptions, skills file details, MCP stdio commands/environments, and hook matcher rules) to maximize readability.
- **Unified Multi-IDE Capability Matrix**: Fully integrated native skills directory scanning/migration, Claude Code targeted rules (`.claude/rules/*.md`), and GitHub Copilot hooks (.github/hooks/*.json) across both the VS Code extension and the standalone CLI.

## [1.4.0] - 2026-05-21

### Added
- **Full Agentic Migration Orchestration**: Multi-domain migration support including Rules, Agent Skills (recursively scanning `SKILL.md` frontmatter and metadata), MCP Server configurations, and Event lifecycle Hooks.
- **Antigravity CLI (agy) support**: Full support for the new Go-based `agy` tool, which uses `.agents/rules/`, `.agents/skills/`, `.agents/mcp_config.json`, and `.agents/hooks.json`.
- **Symlinked Skills Support**: Detects and follows symbolic links/junctions inside `.agent/skills/` and `.agents/skills/` recursively.
- **Windows Junction Support**: Auto-creates Windows junctions for symlinked skills to bypass Administrator privilege requirement on Windows systems.
- **New CLI Commands**:
  - `scan-all` command to inspect all detected workspace capabilities across all IDEs and CLI formats.
  - `migrate` command to perform multi-domain agentic capacity migrations with dry-run support.
- **New VS Code UI Command**: Added a "Migrate Workspace Capabilities" button (🔄) to perform full capability migrations across the workspace directly.

## [1.3.0] - 2026-05-21

### Added
- **Claude Code support**: Detect and convert to/from `CLAUDE.md` and `.claude/CLAUDE.md`. Rules are stored as `## Heading` sections in the flat file and split automatically when scanning.
- **Gemini CLI support**: Detect and convert to/from `GEMINI.md`. Same flat-file section approach as Claude Code.
- **GitHub Copilot support**: Detect and convert to/from `.github/copilot-instructions.md` (global) and `.github/instructions/*.instructions.md` (targeted rules with `applyTo` frontmatter).
- **Standalone CLI tool**: Run `npx ai-rules-converter` from any terminal without VS Code. Supports `scan`, `convert`, and `list-formats` commands with `--dry-run` support.
- **Platform-agnostic core** (`RuleConverterCore.ts`): Extraction of pure conversion logic — no VS Code API dependencies — enabling CLI usage.
- **Improved tree view**: IDE nodes now only appear if rules are detected; each has a unique icon and human-readable label.

## [1.2.0] - 2025-12-11

### Added
- **Recursive Folder Actions**: Support for converting and deleting entire folders and their subdirectories.
- **Root Folder Support**: Added "Convert All" and "Delete" actions to root IDE folders (e.g., .cursor).
- **Confirmation Dialogs**: Added safety warnings when deleting folders.

## [1.1.0] - 2025-12-09

### Added
- **Recursive subfolder scanning**: Rules are now detected recursively in all subdirectories (e.g., `.cursor/rules/subfolder/rule.md`)
- Improved rule discovery for complex project structures

## [1.0.2] - 2025-12-01

### Changed
- Updated extension logo

## [1.0.1] - Previous Release

### Added
- Initial release features
- Convert AI coding rules between Cursor, Windsurf, Kiro, and Antigravity formats
- Automatic detection of rules files in workspace
- Tree view for managing detected rules
- Convert and delete rule commands
