# AI Rules Converter

VS Code extension + standalone CLI that converts AI coding rules between Cursor, Windsurf, Kiro, Antigravity/agy, Claude Code, Gemini CLI, and GitHub Copilot formats.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.x (strict mode) |
| Runtime | Node.js, VS Code extension API |
| Build | esbuild (bundles to `out/`) |
| YAML parsing | js-yaml |

## Build & Run

```sh
npm run build     # compile once
npm run watch     # compile on change
npm run package   # minified production build
npm run cli       # run CLI directly from out/
```

## Project Structure

```
src/
  extension.ts          # VS Code extension entry — registers commands & tree view
  cli/index.ts          # Standalone CLI entry — arg parsing, command dispatch
  core/
    RuleModel.ts        # Types: Rule, IDE, RuleMetadata
    RuleScanner.ts      # Discovers rule files for each IDE format
    RuleConverterCore.ts # Platform-agnostic conversion logic (no vscode imports)
    RuleConverter.ts    # VS Code wrapper around RuleConverterCore
    SkillScanner.ts / SkillConverter.ts   # agy/antigravity skills
    McpScanner.ts / McpConverter.ts       # MCP server config conversion
    HooksScanner.ts / HooksConverter.ts   # Event hooks conversion
    MigrationOrchestrator.ts              # Coordinates full IDE-to-IDE migration
    AgentCapability.ts  # Shared capability types
  ui/
    RulesTreeDataProvider.ts  # VS Code sidebar tree view
```

## Supported Formats

`cursor` | `windsurf` | `kiro` | `antigravity` | `agy` | `claude-code` | `gemini-cli` | `copilot`

## Architecture Pattern

**IO separation**: `convertRuleToResult()` returns a `ConversionResult` (pure data, no side effects). `writeConversionResult()` does the actual disk write. Keep this boundary — it enables dry-run mode and testability.

**Flat-file formats** (claude-code, gemini-cli): multiple rules append as `## {name}\n\n{content}` sections into a single file. Use `appendMode: true` and the `isFirstInBatch` flag to truncate on first write.

**Metadata normalisation**: `normaliseMetadata()` in `RuleConverterCore.ts` converts between per-IDE trigger/inclusion/globs semantics before building target content.

## Conventions

- TypeScript strict mode — no `any` unless bridging external YAML/JSON
- Class-based scanners and converters; pure functions for content builders
- Errors surfaced via try/catch aggregated into report objects (`MigrationReport`)
- Commit style: `type: description` (feat, fix, chore, docs, release)
- No linting or test runner configured yet

## Common Tasks

| Task | How |
|------|-----|
| Add a new IDE format | Add to `IDE` union in `RuleModel.ts`, add scanner logic, add case in `convertRuleToResult()` switch |
| Test the CLI | `npm run build && node out/cli.js scan` |
| Package the extension | `npm run package` → produces `.vsix` |
| Debug in VS Code | Use `.vscode/launch.json` — "Run Extension" config |
