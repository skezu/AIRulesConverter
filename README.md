# AI Rules Converter

**AI Rules Converter** is a VS Code extension and standalone CLI tool designed to streamline the management of AI coding rules. It allows you to easily convert rule definitions between various AI-assisted IDE and CLI formats, ensuring your coding standards are consistent across all your tools.

## Supported Formats

| Format | Files | Trigger/Apply |
|---|---|---|
| **Cursor** | `.cursor/rules/*.mdc` | `alwaysApply`, `globs`, `description` frontmatter |
| **Windsurf** | `.windsurf/rules/*.md` | `trigger: always_on\|glob\|model_decision\|manual` |
| **Kiro** | `.kiro/steering/*.md`, `.kiro/specs/` | `inclusion: always\|fileMatch\|manual` |
| **Antigravity (legacy)** | `.agent/rules/*.md` | `trigger: always_on\|glob\|model_decision\|manual` |
| **Antigravity CLI (agy)** | `.agent/rules/*.md` | `trigger: always_on\|glob\|model_decision\|manual` |
| **Claude Code** | `CLAUDE.md`, `.claude/CLAUDE.md` | Flat markdown with `## Section` headings |
| **Gemini CLI** | `GEMINI.md` | Flat markdown with `## Section` headings |
| **GitHub Copilot** | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `applyTo` glob frontmatter |

## Features

-   **Full Agentic Migrations**: Seamlessly migrate all capabilities — rules, skills (including symlinks), MCP servers, and event lifecycle hooks — between formats.
-   **Multi-Format Support**: Convert rules and capabilities between all 8 supported formats.
-   **Automatic Detection**: Automatically detects rules, skills, MCPs, and event hooks in your workspace.
-   **One-Click Conversion**: Convert rules directly from the "Detected Rules" side panel.
-   **Bulk Conversion**: Convert entire folders or all rules for a given format at once.
-   **Rule Management**: Delete obsolete or incorrect rules directly from the extension view.
-   **Live Updates**: The view automatically refreshes when changes are made.
-   **Standalone CLI**: Use from the terminal without VS Code — great for CI/CD pipelines.

## VS Code Extension Usage

1.  **Open the Rules Converter View**: Click on the ruler icon in the Activity Bar to open the "Rules Converter" side panel.
2.  **View Detected Rules & Capabilities**: The extension will scan your workspace and list all detected rules, skills, MCP servers, and event hooks, grouped by format.
3.  **Migrate Workspace Capabilities**:
    -   Click the **Migrate Workspace** icon (🔄) in the panel toolbar.
    -   Select the source format to migrate FROM.
    -   Select the target format to migrate TO.
    -   All rules, skills, MCP configs, and hooks will be migrated/merged.
4.  **Convert a Rule**:
    -   Hover over a rule in the list.
    -   Click the "Convert Rule" icon (or right-click and select "Convert Rule").
    -   Select the target format from the quick pick list.
5.  **Convert All Rules** in a folder/format:
    -   Hover over an IDE group or subfolder.
    -   Click the "Convert All Rules" (⇄) icon.
6.  **Delete a Rule**:
    -   Hover over a rule in the list.
    -   Click the trash icon to remove it.

## Standalone CLI Usage

The CLI is available via `npx` without any installation:

```bash
# List all detected rules in the current directory
npx ai-rules-converter scan

# List all detected agent capabilities (rules, skills, MCPs, hooks) in the workspace
npx ai-rules-converter scan-all

# Migrate all capabilities (rules, skills, MCP, hooks) from Antigravity to the new agy format
npx ai-rules-converter migrate --from antigravity --to agy

# Convert all Cursor rules to Claude Code format
npx ai-rules-converter convert --from cursor --to claude-code

# Convert rules in a specific project
npx ai-rules-converter convert --from antigravity --to gemini-cli --root ./my-project

# Preview migration without writing files
npx ai-rules-converter migrate --from cursor --to agy --dry-run

# List all supported formats
npx ai-rules-converter list-formats
```

### CLI Options

| Option | Description |
|---|---|
| `--root <path>` | Workspace root directory (default: current directory) |
| `--from <format>` | Source format (required for `convert`) |
| `--to <format>` | Target format (required for `convert`) |
| `--format <format>` | Filter format (for `scan` command) |
| `--detail`, `-d` | Show extra details (descriptions, commands, matchers) in scan commands |
| `--verbose`, `-v` | Show extra details (alias for `--detail`) |
| `--dry-run` | Preview output without writing files |

## Flat-File Format Notes (Claude Code & Gemini CLI)

Claude Code and Gemini CLI use a **single flat Markdown file** (`CLAUDE.md` / `GEMINI.md`) rather than one file per rule. The converter handles this automatically:

- **Scanning**: Splits the file by `## Heading` sections — each becomes a separate rule in the tree view.
- **Converting TO** Claude Code/Gemini CLI: Rules are written as `## {rule name}` sections, concatenated into the flat file.
- **Converting multiple rules**: The file is freshly written for the first rule, then subsequent rules are appended.

## Known Issues

-   Ensure your rule files are valid Markdown before converting.
-   For Claude Code/Gemini CLI formats, very long rules may exceed token limits recommended by those tools (~500 tokens per file).

## Release Notes

| Version | Changes |
|---|---|
| 1.5.1 | Added compact scan default view. Added `--detail` / `--verbose` (and short forms `-d` / `-v`) flags to show description and config details in `scan` and `scan-all`. |
| 1.5.0 | Fully integrated the multi-IDE capability matrix (rules, skills directory, MCP configs, hooks) across both CLI and VS Code extension UI. |
| 1.4.0 | Full Agentic Capabilities migration: Rules, Skills, MCP Servers, and Event Hooks. Supported new Go-based `agy` (Antigravity CLI) format. Windows directory junction creation support for symlinked skills. New commands `scan-all` and `migrate` (CLI & VS Code UI). |
| 1.3.0 | Claude Code, Gemini CLI, GitHub Copilot support. Standalone CLI (`npx ai-rules-converter`). Platform-agnostic core refactor. |
| 1.2.0 | Recursive folder actions (convert/delete) and root folder support. |
| 1.1.0 | Recursive subfolder scanning. |
| 1.0.1 | Icon update. |
| 1.0.0 | Production release. |
| 0.0.3 | Added extension icon and README documentation. |
| 0.0.2 | Added support for deleting rules.<br>Improved rule detection and refresh logic. |
| 0.0.1 | Initial release with basic conversion support. |

---

**Enjoy using AI Rules Converter!**
