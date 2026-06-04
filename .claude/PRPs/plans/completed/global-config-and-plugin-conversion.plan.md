# Plan: Global Config + Claude Plugin Conversion

## Summary

Extend the scanner/converter pipeline to handle two new sources beyond workspace-level directories: (1) user-level ("global") IDE configs living under `os.homedir()`, and (2) Claude Code marketplace plugins living under `~/.claude/plugins/marketplaces/`. Both features reuse every existing scanner and converter — the global feature is a root-path change; the plugin feature adds one new scanner and one new converter that delegate to existing infrastructure.

## User Story

As a developer who uses multiple AI tools, I want to scan my global IDE configs and installed Claude plugins so that I can migrate or reuse my entire setup (rules, skills, MCP, hooks) across tools without manually hunting files.

## Problem → Solution

- All scanners currently accept a `rootPath` that is always the workspace root → project-scoped only.
- Claude plugins install rich multi-format assets into `~/.claude/plugins/marketplaces/` but there is no way to surface or convert them.
- **Solution**: add `--global` to existing CLI commands (passes `os.homedir()` as rootPath); add a new `convert-plugin` CLI command backed by `PluginScanner` + `PluginConverter`; add `ClaudePlugin` model to `AgentCapability.ts`.

## Metadata

- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 5 new + 3 modified

---

## UX Design

### Before

```
npx ai-rules-converter scan
  → scans only current working directory (project-level)

No way to surface global rules or installed Claude plugins.
```

### After

```
npx ai-rules-converter scan --global
  → scans ~/.cursor/rules/, ~/.windsurf/rules/, ~/.claude/CLAUDE.md, etc.

npx ai-rules-converter convert --from claude-code --to cursor --global
  → converts global claude-code rules → ~/.cursor/rules/

npx ai-rules-converter scan-plugins
  → lists all installed Claude marketplace plugins + their capabilities

npx ai-rules-converter convert-plugin --plugin caveman --to cursor
  → copies/converts caveman plugin assets into current workspace .cursor/
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| `scan` | workspace root only | adds `--global` flag | existing command; flag changes rootPath to os.homedir() |
| `scan-all` | workspace root only | adds `--global` flag | same pattern |
| `convert` | workspace root only | adds `--global` flag | global means source AND dest are under os.homedir() |
| `migrate` | workspace root only | adds `--global` flag | same |
| CLI help | no mention of global | shows --global flag | update printHelp() |
| — | — | `scan-plugins` command | new; lists plugins in ~/.claude/plugins/marketplaces/ |
| — | — | `convert-plugin` command | new; --plugin <name> --to <format> [--root] |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/cli/index.ts` | 81-108 | arg parsing pattern; how to add --global |
| P0 | `src/cli/index.ts` | 145-180 | printHelp() — must be updated |
| P0 | `src/core/RuleScanner.ts` | 45-56 | scanDirectory() — already accepts rootPath; global reuse |
| P0 | `src/core/McpScanner.ts` | 37-95 | scanDirectory() pattern; defines targets with relativePaths |
| P0 | `src/core/MigrationOrchestrator.ts` | 42-150 | migrateAll() orchestration pattern to mirror in PluginConverter |
| P0 | `src/core/AgentCapability.ts` | all | existing types; ClaudePlugin interface goes here |
| P1 | `src/core/SkillScanner.ts` | 39-50 | scanDirectory() / scanSkillsForIde() pattern |
| P1 | `src/core/SkillConverter.ts` | 41-108 | convertSkill() / executeConversion() pattern to mirror |
| P2 | `src/core/HooksScanner.ts` | 38-86 | scanDirectory() pattern for hooks |
| P2 | `~/.claude/plugins/marketplaces/caveman/.claude-plugin/plugin.json` | all | real plugin.json schema |
| P2 | `~/.claude/plugins/marketplaces/caveman/.claude-plugin/marketplace.json` | all | real marketplace.json schema |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: src/core/RuleScanner.ts:17, McpScanner.ts:12, SkillScanner.ts:14
// Class-based scanners, PascalCase.
export class PluginScanner { constructor() {} }
export class PluginConverter { constructor() {} }
// Methods: scanDirectory(), convertX(), executeConversion()
```

### ERROR_HANDLING
```typescript
// SOURCE: src/core/MigrationOrchestrator.ts:66-78
try {
    const result = convertRuleToResult(rule, toIde, rootPath);
    const written = writeConversionResult(result, i === 0);
    report.rulesMigratedCount++;
} catch (e: any) {
    report.errors.push(`Rule conversion failed for "${rule.name}": ${e.message || e}`);
}
// Pattern: try/catch per item, push to report.errors[], never throw through orchestrator.
```

### SCANNER_PATTERN
```typescript
// SOURCE: src/core/McpScanner.ts:37-95
public async scanDirectory(rootPath: string): Promise<McpConfig[]> {
    const configs: McpConfig[] = [];
    const targets: { ide: IDE; relativePath: string; ... }[] = [ ... ];
    for (const target of targets) {
        const filePath = path.join(rootPath, target.relativePath);
        if (fs.existsSync(filePath)) {
            try { ... configs.push({ ... }); }
            catch (e) { console.error(`[McpScanner] ...`, e); }
        }
    }
    return configs;
}
// Pattern: return typed array, guard with existsSync, log errors but never throw.
```

### CONVERTER_PATTERN
```typescript
// SOURCE: src/core/SkillConverter.ts:47-68
public convertSkill(skill: Skill, targetIde: IDE, rootPath: string): SkillConversionResult {
    const destDir = IDE_DIR_MAP[targetIde];
    if (!destDir) { throw new Error(`Unknown target format: ${targetIde}`); }
    const targetFolderPath = path.join(rootPath, destDir, 'skills', skill.folderName);
    return { skillName: skill.folderName, targetIde, sourceFolderPath: skill.folderPath, targetFolderPath, ... };
}
// Pattern: pure conversion returns result object; executeConversion() writes to disk.
```

### IO_SEPARATION
```typescript
// SOURCE: src/core/RuleConverterCore.ts:216-280
// convertRuleToResult() → pure, returns ConversionResult (no FS side effects)
// writeConversionResult() → performs FS writes
// CRITICAL: maintain this boundary for dry-run support.
```

### CLI_COMMAND_PATTERN
```typescript
// SOURCE: src/cli/index.ts:191-247 (cmdScan)
async function cmdScanPlugins(args: Record<string, string | boolean>): Promise<void> {
    const pluginsDir = args['plugins-dir']
        ? path.resolve(String(args['plugins-dir']))
        : path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
    // ... scanner call, grouped output
}
// Pattern: resolve paths, guard existsSync, color-coded console output, process.exit(1) on error.
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/core/AgentCapability.ts` | UPDATE | Add `ClaudePlugin`, `PluginSkill`, `PluginHooks` interfaces |
| `src/core/GlobalPathResolver.ts` | CREATE | Single place for `getGlobalRoot()` and per-IDE global path docs |
| `src/core/PluginScanner.ts` | CREATE | Scans `~/.claude/plugins/marketplaces/` for installed plugins |
| `src/core/PluginConverter.ts` | CREATE | Converts plugin assets to target IDE, wraps existing converters |
| `src/cli/index.ts` | UPDATE | Add `--global` to scan/convert/migrate; add scan-plugins + convert-plugin commands |
| `src/extension.ts` | UPDATE (minimal) | Expose "Scan Global" and "Convert Plugin" commands — low priority, can defer |

## NOT Building

- VS Code tree-view UI for global configs (deferred — CLI first)
- Plugin marketplace browser or download capability
- Modifying `~/.claude/settings.json` `enabledPlugins` key
- Converting TO plugin format (plugin packaging)
- Kiro or Copilot global config support (no known global path convention)

---

## Step-by-Step Tasks

### Task 1: Add ClaudePlugin types to AgentCapability.ts

- **ACTION**: Add three new interfaces to the bottom of `src/core/AgentCapability.ts`
- **IMPLEMENT**:
```typescript
// ---------------------------------------------------------------------------
// Claude Plugins
// ---------------------------------------------------------------------------

export interface PluginHookCommand {
    type: string;
    command?: string;
    timeout?: number;
    statusMessage?: string;
    [key: string]: any;
}

export interface PluginHookEntry {
    hooks: PluginHookCommand[];
    matcher?: string;
}

export interface ClaudePlugin {
    /** Plugin identifier (directory name under marketplaces/) */
    name: string;
    description: string;
    author?: { name: string; url?: string };
    /** Absolute path to the plugin root folder */
    pluginDir: string;
    /** Absolute path to .claude-plugin/plugin.json */
    manifestPath: string;
    /** Skills found inside the plugin dir (via existing SkillScanner logic) */
    skills: Skill[];
    /** Hooks from plugin.json "hooks" key, keyed by HookEvent */
    hooks: Partial<Record<HookEvent, PluginHookEntry[]>>;
    /** Raw plugin.json content */
    rawManifest: Record<string, any>;
}
```
- **MIRROR**: existing type style in `AgentCapability.ts`
- **IMPORTS**: `Skill`, `HookEvent` are already in scope in that file
- **GOTCHA**: `PluginHookEntry[]` is similar to `HookEntry[]` but plugin.json uses a slightly different shape (no `matcher` at root level, just `{ hooks: [...] }`). Keep separate to avoid breaking existing HooksConfig consumers.
- **VALIDATE**: `npx tsc --noEmit` zero errors after adding interfaces

---

### Task 2: Create GlobalPathResolver.ts

- **ACTION**: Create `src/core/GlobalPathResolver.ts`
- **IMPLEMENT**:
```typescript
import * as os from 'os';
import * as path from 'path';

/**
 * Returns the directory that serves as the "global root" for AI tool configs.
 * All existing scanners accept rootPath — passing globalRoot makes them
 * scan the user-level (global) configs instead of the project-level ones.
 *
 * For most IDEs the global root IS os.homedir():
 *   cursor:      ~/.cursor/rules/          → rootPath=~, scans .cursor/rules/
 *   windsurf:    ~/.windsurf/rules/        → rootPath=~, scans .windsurf/rules/
 *   claude-code: ~/.claude/CLAUDE.md       → rootPath=~, scans .claude/CLAUDE.md
 *   gemini-cli:  ~/.gemini/settings.json   → rootPath=~, scans .gemini/settings.json
 *   agy:         ~/.agent/rules/           → rootPath=~, scans .agent/rules/
 */
export function getGlobalRoot(): string {
    return os.homedir();
}

/** Default plugins directory for Claude Code marketplace plugins. */
export function getPluginsDir(): string {
    return path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
}
```
- **MIRROR**: no existing pattern — pure utility, no class wrapper needed (functions suffice)
- **IMPORTS**: `os`, `path` (Node built-ins)
- **GOTCHA**: Do NOT import `vscode` here — must remain CLI-compatible
- **VALIDATE**: `npx tsc --noEmit` zero errors

---

### Task 3: Create PluginScanner.ts

- **ACTION**: Create `src/core/PluginScanner.ts`
- **IMPLEMENT**: Class that scans `~/.claude/plugins/marketplaces/` and for each plugin dir:
  1. Reads `.claude-plugin/plugin.json` for metadata and hooks
  2. Uses existing `SkillScanner.scanDirectory(pluginDir)` to find skills inside the plugin
  3. Returns `ClaudePlugin[]`

```typescript
import * as path from 'path';
import * as fs from 'fs';
import { ClaudePlugin, PluginHookEntry } from './AgentCapability';
import { HookEvent } from './AgentCapability';
import { SkillScanner } from './SkillScanner';
import { getPluginsDir } from './GlobalPathResolver';

export class PluginScanner {
    constructor() {}

    public async scanPlugins(pluginsDir?: string): Promise<ClaudePlugin[]> {
        const dir = pluginsDir ?? getPluginsDir();
        const plugins: ClaudePlugin[] = [];

        if (!fs.existsSync(dir)) {
            return plugins;
        }

        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch (e) {
            console.error(`[PluginScanner] Cannot read plugins dir: ${dir}`, e);
            return plugins;
        }

        for (const entry of entries) {
            const pluginDir = path.join(dir, entry);
            try {
                const stat = fs.statSync(pluginDir);
                if (!stat.isDirectory()) continue;
            } catch { continue; }

            const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
            if (!fs.existsSync(manifestPath)) continue;

            try {
                const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                const hooks = this.parsePluginHooks(raw.hooks ?? {});

                // Reuse existing SkillScanner to find skills inside this plugin dir
                const skillScanner = new SkillScanner();
                const skills = await skillScanner.scanDirectory(pluginDir);

                plugins.push({
                    name: raw.name ?? entry,
                    description: raw.description ?? '',
                    author: raw.author,
                    pluginDir,
                    manifestPath,
                    skills,
                    hooks,
                    rawManifest: raw,
                });
            } catch (e) {
                console.error(`[PluginScanner] Failed to parse plugin at ${pluginDir}`, e);
            }
        }

        return plugins;
    }

    private parsePluginHooks(
        raw: Record<string, any>
    ): Partial<Record<HookEvent, PluginHookEntry[]>> {
        const result: Partial<Record<HookEvent, PluginHookEntry[]>> = {};
        const knownEvents: HookEvent[] = [
            'PreToolUse', 'PostToolUse', 'SessionStart', 'Stop',
            'Notification', 'PermissionRequest',
            // plugin.json also uses UserPromptSubmit — treat as extension
        ];
        for (const [event, entries] of Object.entries(raw)) {
            if (Array.isArray(entries)) {
                // Accept both known HookEvent names and plugin-specific names
                result[event as HookEvent] = entries as PluginHookEntry[];
            }
        }
        return result;
    }
}
```
- **MIRROR**: `McpScanner.scanDirectory()` pattern (guard existsSync, log errors, never throw)
- **IMPORTS**: `path`, `fs`, `ClaudePlugin`, `HookEvent`, `PluginHookEntry`, `SkillScanner`, `getPluginsDir`
- **GOTCHA**: `SkillScanner.scanDirectory(pluginDir)` will scan all skill folders inside the plugin — a plugin may have `caveman/SKILL.md`, `caveman-compress/SKILL.md` etc. at the plugin root level (not under `.claude/skills/`). This works because `SkillScanner.scanSkillsForIde()` looks at `{rootPath}/.claude/skills/` — which will be empty for a plugin. BUT the skills are in `{pluginDir}/caveman/SKILL.md`. The existing scanner does NOT find these because it looks for `{dir}/skills/{folder}/SKILL.md`.

  **Solution**: In `PluginScanner`, directly scan the plugin root for folders containing `SKILL.md`:
```typescript
private async scanPluginRootSkills(pluginDir: string, pluginName: string): Promise<Skill[]> {
    const skills: Skill[] = [];
    try {
        const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillFilePath = path.join(pluginDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFilePath)) {
                const rawContent = fs.readFileSync(skillFilePath, 'utf-8');
                // parse frontmatter inline (copy logic from SkillScanner.parseFrontmatter)
                // ...push Skill to skills
            }
        }
    } catch (e) {
        console.error('[PluginScanner] Error scanning root skills', e);
    }
    return skills;
}
```
  Use `scanPluginRootSkills` instead of `skillScanner.scanDirectory()` in `scanPlugins()`.
- **VALIDATE**: `node out/cli.js scan-plugins` lists caveman plugin with its skills

---

### Task 4: Create PluginConverter.ts

- **ACTION**: Create `src/core/PluginConverter.ts`
- **IMPLEMENT**: Converts a `ClaudePlugin`'s assets (skills, hooks, rules) to a target IDE in a workspace root.

```typescript
import * as path from 'path';
import * as fs from 'fs';
import { ClaudePlugin } from './AgentCapability';
import { IDE } from './RuleModel';
import { SkillConverter } from './SkillConverter';
import { HooksConverter } from './HooksConverter';
import { HooksConfig } from './AgentCapability';
import { RuleScanner } from './RuleScanner';
import { convertRuleToResult, writeConversionResult } from './RuleConverterCore';

export interface PluginConversionReport {
    pluginName: string;
    skillsConverted: number;
    rulesConverted: number;
    hooksMigrated: boolean;
    writtenPaths: string[];
    errors: string[];
}

export class PluginConverter {
    private skillConverter = new SkillConverter();

    public async convertPlugin(
        plugin: ClaudePlugin,
        targetIde: IDE,
        workspaceRoot: string
    ): Promise<PluginConversionReport> {
        const report: PluginConversionReport = {
            pluginName: plugin.name,
            skillsConverted: 0,
            rulesConverted: 0,
            hooksMigrated: false,
            writtenPaths: [],
            errors: [],
        };

        // 1. Convert skills
        for (let i = 0; i < plugin.skills.length; i++) {
            const skill = plugin.skills[i];
            try {
                const result = this.skillConverter.convertSkill(skill, targetIde, workspaceRoot);
                const written = this.skillConverter.executeConversion(result, i === 0);
                report.skillsConverted++;
                report.writtenPaths.push(written);
            } catch (e: any) {
                report.errors.push(`Skill '${skill.folderName}': ${e.message || e}`);
            }
        }

        // 2. Convert rules that the plugin ships in the target IDE's native format
        // (e.g. plugin has .cursor/rules/ — copy directly for cursor target)
        // OR convert from the plugin's source format (claude-code skills → target)
        try {
            const ruleScanner = new RuleScanner();
            const pluginRules = (await ruleScanner.scanDirectory(plugin.pluginDir))
                .filter(r => r.ide === 'claude-code' || r.ide === targetIde);

            for (let i = 0; i < pluginRules.length; i++) {
                const rule = pluginRules[i];
                try {
                    // If rule is already in targetIde format, copy as-is
                    if (rule.ide === targetIde) {
                        const destPath = path.join(workspaceRoot, path.relative(plugin.pluginDir, rule.filePath));
                        fs.mkdirSync(path.dirname(destPath), { recursive: true });
                        fs.copyFileSync(rule.filePath, destPath);
                        report.rulesConverted++;
                        report.writtenPaths.push(destPath);
                    } else {
                        // Convert from source IDE format
                        const result = convertRuleToResult(rule, targetIde, workspaceRoot);
                        const written = writeConversionResult(result, i === 0);
                        report.rulesConverted++;
                        report.writtenPaths.push(written);
                    }
                } catch (e: any) {
                    report.errors.push(`Rule '${rule.name}': ${e.message || e}`);
                }
            }
        } catch (e: any) {
            report.errors.push(`Rule scan failed: ${e.message || e}`);
        }

        // 3. Convert hooks from plugin.json → target IDE hooks config
        if (Object.keys(plugin.hooks).length > 0) {
            try {
                const hooksConverter = new HooksConverter();
                // Normalize plugin hooks into HooksConfig shape
                const sourceConfig: HooksConfig = {
                    ide: 'claude-code',
                    filePath: plugin.manifestPath,
                    scope: 'project',
                    events: plugin.hooks as any,
                };
                const hooksSupportedTargets: IDE[] = ['agy', 'antigravity', 'claude-code', 'windsurf', 'copilot'];
                if (hooksSupportedTargets.includes(targetIde)) {
                    const result = hooksConverter.convertConfig(sourceConfig, targetIde, workspaceRoot);
                    const written = hooksConverter.executeConversion(result);
                    report.hooksMigrated = true;
                    report.writtenPaths.push(written);
                }
            } catch (e: any) {
                report.errors.push(`Hooks conversion: ${e.message || e}`);
            }
        }

        report.writtenPaths = Array.from(new Set(report.writtenPaths));
        return report;
    }
}
```
- **MIRROR**: `MigrationOrchestrator.migrateAll()` pattern exactly
- **IMPORTS**: all from existing core modules; no new dependencies
- **GOTCHA**: `${CLAUDE_PLUGIN_ROOT}` variable in hook commands — this is a Claude Code runtime variable and won't work verbatim in other IDEs. When converting hooks, replace `${CLAUDE_PLUGIN_ROOT}` with the absolute plugin dir path for portability.
- **VALIDATE**: `node out/cli.js convert-plugin --plugin caveman --to cursor` creates `.cursor/skills/caveman/SKILL.md`

---

### Task 5: Update CLI — add --global flag and new commands

- **ACTION**: Update `src/cli/index.ts`
- **IMPLEMENT**:

**5a. Add `import * as os from 'os'` at top** (join existing imports).

**5b. Add `import { getGlobalRoot, getPluginsDir } from '../core/GlobalPathResolver'`**.

**5c. Add `import { PluginScanner } from '../core/PluginScanner'`**.

**5d. Add `import { PluginConverter } from '../core/PluginConverter'`**.

**5e. Modify `cmdScan`, `cmdScanAll`, `cmdConvert`, `cmdMigrate`** — replace:
```typescript
const rootPath = path.resolve(String(args['root'] ?? '.'));
```
with:
```typescript
const isGlobal = Boolean(args['global'] || args['g']);
const rootPath = isGlobal ? getGlobalRoot() : path.resolve(String(args['root'] ?? '.'));
```

**5f. Add `cmdScanPlugins`**:
```typescript
async function cmdScanPlugins(args: Record<string, string | boolean>): Promise<void> {
    const pluginsDir = args['plugins-dir']
        ? path.resolve(String(args['plugins-dir']))
        : getPluginsDir();
    const isDetail = isDetailView(args);

    console.log(`\n${color('Scanning Claude Plugins in', c.bold)} ${color(pluginsDir, c.cyan)}\n`);

    if (!fs.existsSync(pluginsDir)) {
        console.log(color('No plugins directory found.', c.dim));
        return;
    }

    const scanner = new PluginScanner();
    const plugins = await scanner.scanPlugins(pluginsDir);

    if (plugins.length === 0) {
        console.log(color('No plugins found.', c.dim));
        return;
    }

    for (const plugin of plugins) {
        console.log(`${color(plugin.name, c.bold, c.blue)}  ${color(plugin.description, c.dim)}`);
        if (plugin.author) {
            console.log(`  ${color('Author:', c.dim)} ${plugin.author.name}`);
        }
        if (plugin.skills.length > 0) {
            console.log(`  ${color('Skills:', c.yellow)} ${plugin.skills.length}`);
            if (isDetail) {
                for (const skill of plugin.skills) {
                    console.log(`    ${color('◆', c.cyan)} ${skill.name}`);
                }
            }
        }
        const hookCount = Object.keys(plugin.hooks).length;
        if (hookCount > 0) {
            console.log(`  ${color('Hook events:', c.yellow)} ${hookCount}`);
        }
        console.log();
    }
    console.log(color(`Total: ${plugins.length} plugin(s)`, c.bold));
}
```

**5g. Add `cmdConvertPlugin`**:
```typescript
async function cmdConvertPlugin(args: Record<string, string | boolean>): Promise<void> {
    const pluginName = String(args['plugin'] ?? '');
    const toFmt = String(args['to'] ?? '');
    const rootPath = path.resolve(String(args['root'] ?? '.'));
    const pluginsDir = args['plugins-dir']
        ? path.resolve(String(args['plugins-dir']))
        : getPluginsDir();
    const dryRun = Boolean(args['dry-run']);

    if (!pluginName) {
        console.error(color('Error: --plugin <name> is required.', c.red));
        process.exit(1);
    }
    if (!toFmt || !isValidIDE(toFmt)) {
        console.error(color(`Error: --to must be a valid format. Got: '${toFmt}'`, c.red));
        process.exit(1);
    }

    const pluginDir = path.join(pluginsDir, pluginName);
    if (!fs.existsSync(pluginDir)) {
        console.error(color(`Error: Plugin '${pluginName}' not found at ${pluginDir}`, c.red));
        process.exit(1);
    }

    console.log(`\n${color('Converting Plugin', c.bold)} ${color(pluginName, c.yellow)} → ${color(toFmt, c.green)}  ${color(dryRun ? '[DRY RUN]' : '', c.magenta)}`);

    const scanner = new PluginScanner();
    const plugins = await scanner.scanPlugins(pluginsDir);
    const plugin = plugins.find(p => p.name === pluginName);

    if (!plugin) {
        console.error(color(`Error: Could not parse plugin '${pluginName}'.`, c.red));
        process.exit(1);
    }

    if (dryRun) {
        console.log(`  [DRY RUN] Would convert ${plugin.skills.length} skill(s) and ${Object.keys(plugin.hooks).length} hook event(s) to ${toFmt}`);
        return;
    }

    const converter = new PluginConverter();
    const report = await converter.convertPlugin(plugin, toFmt as IDE, rootPath);

    if (report.errors.length > 0) {
        for (const err of report.errors) {
            console.error(`  ${color('✗', c.red)} ${err}`);
        }
    }

    console.log(`\n${color('Done:', c.bold)} ${report.skillsConverted} skill(s), ${report.rulesConverted} rule(s), hooks: ${report.hooksMigrated ? 'yes' : 'no'}`);

    if (report.writtenPaths.length > 0) {
        for (const wp of report.writtenPaths) {
            console.log(`  ${color('✓', c.green)} ${path.relative(rootPath, wp)}`);
        }
    }
}
```

**5h. Update `main()` switch**:
```typescript
case 'scan-plugins':
    await cmdScanPlugins(args);
    break;
case 'convert-plugin':
    await cmdConvertPlugin(args);
    break;
```

**5i. Update `printHelp()`** — add entries for the new commands and the `--global` flag.

- **MIRROR**: All existing cmdX functions, color() calls, process.exit(1) on error pattern
- **IMPORTS**: `os`, `GlobalPathResolver`, `PluginScanner`, `PluginConverter` (all new)
- **GOTCHA**: `parseArgs()` parses `--global` as boolean (since no value follows). Verify `Boolean(args['global'])` works — it does because `parseArgs` sets `args[key] = true` for flags without a value.
- **VALIDATE**: `node out/cli.js scan --global` runs without error; `node out/cli.js scan-plugins` lists caveman

---

## Testing Strategy

### Unit Tests (manual, since no test runner configured)

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| scan --global cursor | os.homedir() with ~/.cursor/rules/ | lists cursor rules | no |
| scan --global | empty homedir | "No rules found." | yes (empty) |
| scan-plugins | real ~/.claude/plugins/marketplaces/ | caveman listed | no |
| scan-plugins --plugins-dir /nonexistent | missing dir | "No plugins directory found." | yes |
| convert-plugin --plugin caveman --to cursor | caveman plugin | skill in .cursor/skills/caveman/ | no |
| convert-plugin --plugin caveman --to cursor --dry-run | caveman plugin | dry run output, no files written | no |
| convert-plugin --plugin nonexistent --to cursor | missing plugin | error + exit 1 | yes |

### Edge Cases Checklist
- [ ] `--global` on a machine where `~/.cursor/rules/` doesn't exist → "No rules found." not crash
- [ ] Plugin with no `.claude-plugin/plugin.json` → silently skipped
- [ ] Plugin with no skills → conversion succeeds with "0 skill(s)"
- [ ] Hook command with `${CLAUDE_PLUGIN_ROOT}` → replaced with absolute path

---

## Validation Commands

### Static Analysis
```bash
npm run build
```
EXPECT: Zero esbuild errors

### Type Check
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors

### CLI Smoke Tests
```bash
node out/cli.js --help
node out/cli.js scan --global
node out/cli.js scan-plugins
node out/cli.js scan-plugins --detail
node out/cli.js convert-plugin --plugin caveman --to cursor --dry-run
node out/cli.js convert-plugin --plugin caveman --to cursor --root /tmp/test-workspace
```

### Manual Validation
- [ ] `scan --global` lists rules/skills from user home dirs
- [ ] `scan-plugins` lists all installed Claude plugins with skill count
- [ ] `convert-plugin --to cursor` creates `.cursor/skills/caveman/SKILL.md` in workspace
- [ ] `convert-plugin --to windsurf` creates `.windsurf/skills/caveman/SKILL.md`
- [ ] `convert-plugin --dry-run` writes zero files

---

## Acceptance Criteria
- [ ] `scan --global` works for cursor, windsurf, claude-code, gemini-cli, agy
- [ ] `scan-plugins` lists installed Claude plugins
- [ ] `convert-plugin --plugin <name> --to <ide>` converts skills and hooks
- [ ] `--dry-run` respected for convert-plugin
- [ ] `${CLAUDE_PLUGIN_ROOT}` replaced in converted hook commands
- [ ] Zero type errors (`npx tsc --noEmit`)
- [ ] Build succeeds (`npm run build`)
- [ ] No regressions in existing `scan`, `convert`, `migrate` commands

## Completion Checklist
- [ ] `AgentCapability.ts` has ClaudePlugin, PluginSkill, PluginHooks types
- [ ] `GlobalPathResolver.ts` created
- [ ] `PluginScanner.ts` created — scans root-level `SKILL.md` folders (not `.claude/skills/`)
- [ ] `PluginConverter.ts` created — wraps existing converters
- [ ] CLI has `--global` on scan/scan-all/convert/migrate
- [ ] CLI has scan-plugins command
- [ ] CLI has convert-plugin command
- [ ] printHelp() updated
- [ ] IO separation maintained (no direct FS writes in scanner/converter result methods)

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SkillScanner not finding plugin-root SKILL.md files | High | Medium | PluginScanner scans root directly (Task 3 GOTCHA) |
| `${CLAUDE_PLUGIN_ROOT}` in hooks breaks converted config | Medium | Low | Replace variable in PluginConverter (Task 4 GOTCHA) |
| Global rootPath collides with project-scoped scan | Low | Low | Document --global is user-home scan; don't mix with --root |
| Plugin may have no .claude-plugin/plugin.json | Medium | None | Silently skip (already handled in Task 3) |

## Notes

- `UserPromptSubmit` is a hook event in plugin.json but not in the existing `HookEvent` union. Adding it would be a small addition to `AgentCapability.ts` — worth doing in Task 1 to avoid silently dropping it.
- The caveman plugin has its skills at `caveman/SKILL.md` (root-level), not in any `.{ide}/skills/` subfolder. Task 3 handles this with `scanPluginRootSkills()`.
- Global MCP for Claude Code lives at `~/.mcp.json`. With `rootPath = os.homedir()`, `McpScanner` already looks for `.mcp.json` relative to rootPath → `~/.mcp.json`. No changes needed to McpScanner. ✓
