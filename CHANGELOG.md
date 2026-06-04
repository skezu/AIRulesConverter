# Changelog

All notable changes to the **aix** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-06-05

### Changed
- **Rebranded to aix**: Renamed the extension and CLI binary from `ai-rules-converter` to `aix` for streamlined CLI commands (`npx aix`).
- **Config Output Alignment**: Aligned rule and capability config output with official tool syntax.

## [1.6.0] - 2026-06-03

### Added
- **Global Configuration Scanning**: Added `--global` flag on `scan`, `scan-all`, `convert`, and `migrate` commands to scan user-level configs from the home directory instead of the project root.
- **Claude Plugin Integration**: Added `scan-plugins` command to list installed Claude marketplace plugins with their skills and hook events.
- **Claude Plugin Conversion**: Added `convert-plugin` command to convert a plugin's skills, rules, and hooks to any target IDE format (automatically replacing `${CLAUDE_PLUGIN_ROOT}` in hook commands for portability).
- **Hook Events Support**: Added support for the `UserPromptSubmit` hook event.

### Changed
- **agy Path Corrections**: Updated paths for global (`.gemini/antigravity-cli/skills/`) and shared (`.gemini/skills/`) skills inside agy/antigravity configuration.

## [1.5.2] - 2026-05-21

### Fixed
- **agy Folder Prefix Correction**: Corrected the `agy` (Antigravity CLI) target folder path from `.agents/` to `.agent/` across scanning and migration modules.

### Added
- **Direct Skill & MCP Extension Actions**: Added inline "Convert" and "Delete" actions for individual Agent Skills and MCP Servers directly in the "Detected Rules" VS Code tree view.

## [1.5.1] - 2026-05-21

### Added
- **CLI Detail & Compact Option**: Added `--detail` option and aliases (`--verbose`, `-d`, `-v`) to `scan` and `scan-all` commands.
- **Default Compact View**: Scan commands now default to a clean, compact overview (excluding rule descriptions, skills file details, MCP stdio commands/environments, and hook matcher rules) to maximize readability.

## [1.5.0] - 2026-05-21

### Added
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
- **Standalone CLI tool**: Run `npx aix` from any terminal without VS Code. Supports `scan`, `convert`, and `list-formats` commands with `--dry-run` support.
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
