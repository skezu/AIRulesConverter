/**
 * AI Rules Converter — Standalone CLI
 *
 * Usage:
 *   npx ai-rules-converter <command> [options]
 *
 * Commands:
 *   scan    [--root <path>] [--format <ide>]   List detected rules
 *   convert --from <ide> --to <ide> [--root <path>] [--dry-run]
 *   list-formats                               List all supported formats
 *
 * Examples:
 *   npx ai-rules-converter scan
 *   npx ai-rules-converter scan --format cursor
 *   npx ai-rules-converter convert --from cursor --to claude-code
 *   npx ai-rules-converter convert --from antigravity --to gemini-cli --root ./my-project
 *   npx ai-rules-converter convert --from cursor --to copilot --dry-run
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RuleScanner } from '../core/RuleScanner';
import { SkillScanner } from '../core/SkillScanner';
import { McpScanner } from '../core/McpScanner';
import { HooksScanner } from '../core/HooksScanner';
import { MigrationOrchestrator } from '../core/MigrationOrchestrator';
import { convertRuleToResult, writeConversionResult } from '../core/RuleConverterCore';
import { IDE } from '../core/RuleModel';
import { getGlobalRoot, getPluginsDir } from '../core/GlobalPathResolver';
import { PluginScanner } from '../core/PluginScanner';
import { PluginConverter } from '../core/PluginConverter';

// ---------------------------------------------------------------------------
// Supported formats
// ---------------------------------------------------------------------------

const SUPPORTED_FORMATS: { id: IDE; description: string; paths: string[] }[] = [
    {
        id: 'cursor',
        description: 'Cursor IDE',
        paths: ['.cursor/rules/*.mdc', '.cursor/rules/*.md'],
    },
    {
        id: 'windsurf',
        description: 'Windsurf IDE',
        paths: ['.windsurf/rules/*.md', '.windsurfrules'],
    },
    {
        id: 'kiro',
        description: 'Kiro IDE',
        paths: ['.kiro/steering/*.md', '.kiro/specs/'],
    },
    {
        id: 'antigravity',
        description: 'Antigravity CLI (Gemini)',
        paths: ['.agent/rules/*.md'],
    },
    {
        id: 'agy',
        description: 'Antigravity CLI (agy)',
        paths: ['.agent/rules/*.md', '.agent/skills/', '.agent/mcp_config.json', '.agent/hooks.json'],
    },
    {
        id: 'claude-code',
        description: 'Claude Code CLI (Anthropic)',
        paths: ['CLAUDE.md', '.claude/CLAUDE.md'],
    },
    {
        id: 'gemini-cli',
        description: 'Gemini CLI (Google)',
        paths: ['GEMINI.md'],
    },
    {
        id: 'copilot',
        description: 'GitHub Copilot',
        paths: ['.github/copilot-instructions.md', '.github/instructions/*.instructions.md'],
    },
];

// ---------------------------------------------------------------------------
// Argument parsing helpers
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const args: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('-')) {
                args[key] = next;
                i++;
            } else {
                args[key] = true;
            }
        } else if (arg.startsWith('-') && arg.length > 1) {
            const key = arg.slice(1);
            const next = argv[i + 1];
            if (next && !next.startsWith('-')) {
                args[key] = next;
                i++;
            } else {
                args[key] = true;
            }
        } else if (!args['_command']) {
            args['_command'] = arg;
        }
    }
    return args;
}

function isValidIDE(value: string): value is IDE {
    return SUPPORTED_FORMATS.some(f => f.id === value);
}

function isDetailView(args: Record<string, string | boolean>): boolean {
    return !!(args['detail'] || args['verbose'] || args['d'] || args['v']);
}

// ---------------------------------------------------------------------------
// Colour output (basic ANSI, no dependencies)
// ---------------------------------------------------------------------------

const c = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    cyan:   '\x1b[36m',
    red:    '\x1b[31m',
    blue:   '\x1b[34m',
    magenta:'\x1b[35m',
};

function color(str: string, ...codes: string[]): string {
    if (!process.stdout.isTTY) {
        return str;
    }
    return codes.join('') + str + c.reset;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function printHelp(): void {
    console.log(`
${color('AI Rules Converter CLI', c.bold, c.cyan)}  v1.5.2

${color('Usage:', c.bold)}
  npx ai-rules-converter <command> [options]

${color('Commands:', c.bold)}
  ${color('scan', c.green)}            List detected rules in the workspace
  ${color('scan-all', c.green)}        List all detected capabilities (rules, skills, MCP, hooks)
  ${color('convert', c.green)}         Convert rules from one format to another
  ${color('migrate', c.green)}         Migrate ALL capabilities from one format to another
  ${color('scan-plugins', c.green)}    List installed Claude Code marketplace plugins
  ${color('convert-plugin', c.green)}  Convert a Claude plugin's assets to another IDE format
  ${color('list-formats', c.green)}    Show all supported formats

${color('Options:', c.bold)}
  --root <path>        Workspace root directory (default: current directory)
  --from <format>      Source format for conversion/migration
  --to   <format>      Target format for conversion/migration
  --format <fmt>       Filter by format (for scan command)
  --global, -g         Scan/convert global (user-level) configs under $HOME
  --detail, -d         Show details (e.g. descriptions, files, commands) in scan commands
  --verbose, -v        Show details (alias for --detail)
  --dry-run            Print what would be written without writing any files
  --plugin <name>      Plugin name for convert-plugin command
  --plugins-dir <dir>  Override Claude plugins directory (default: ~/.claude/plugins/marketplaces)

${color('Supported formats:', c.bold)}
${SUPPORTED_FORMATS.map(f => `  ${color(f.id.padEnd(14), c.yellow)} ${color(f.description, c.dim)}`).join('\n')}

${color('Examples:', c.bold)}
  npx ai-rules-converter scan
  npx ai-rules-converter scan --global
  npx ai-rules-converter scan-all
  npx ai-rules-converter convert --from cursor --to claude-code
  npx ai-rules-converter convert --from cursor --to claude-code --global
  npx ai-rules-converter migrate --from antigravity --to agy
  npx ai-rules-converter migrate --from antigravity --to agy --root ./my-project
  npx ai-rules-converter scan-plugins
  npx ai-rules-converter scan-plugins --detail
  npx ai-rules-converter convert-plugin --plugin caveman --to cursor
  npx ai-rules-converter convert-plugin --plugin caveman --to windsurf --root ./my-project
`);
}

function cmdListFormats(): void {
    console.log(`\n${color('Supported Formats', c.bold, c.cyan)}\n`);
    for (const fmt of SUPPORTED_FORMATS) {
        console.log(`  ${color(fmt.id.padEnd(14), c.yellow)} ${fmt.description}`);
        for (const p of fmt.paths) {
            console.log(`  ${' '.repeat(14)} ${color(p, c.dim)}`);
        }
        console.log();
    }
}

async function cmdScan(args: Record<string, string | boolean>): Promise<void> {
    const isGlobal = Boolean(args['global'] || args['g']);
    const rootPath = isGlobal ? getGlobalRoot() : path.resolve(String(args['root'] ?? '.'));
    const formatFilter = args['format'] ? String(args['format']) : undefined;
    const isDetail = isDetailView(args);

    if (!fs.existsSync(rootPath)) {
        console.error(color(`Error: Root path does not exist: ${rootPath}`, c.red));
        process.exit(1);
    }

    const scopeLabel = isGlobal ? color(' [global]', c.magenta) : '';
    console.log(`\n${color('Scanning', c.bold)} ${color(rootPath, c.cyan)}${scopeLabel}\n`);

    const scanner = new RuleScanner();
    let rules = await scanner.scanDirectory(rootPath);

    if (formatFilter) {
        if (!isValidIDE(formatFilter)) {
            console.error(color(`Error: Unknown format '${formatFilter}'. Use list-formats to see valid options.`, c.red));
            process.exit(1);
        }
        rules = rules.filter(r => r.ide === formatFilter);
    }

    if (rules.length === 0) {
        console.log(color('No rules found.', c.dim));
        return;
    }

    // Group by IDE
    const grouped = new Map<string, typeof rules>();
    for (const rule of rules) {
        if (!grouped.has(rule.ide)) {
            grouped.set(rule.ide, []);
        }
        grouped.get(rule.ide)!.push(rule);
    }

    for (const [ide, ideRules] of grouped.entries()) {
        const fmt = SUPPORTED_FORMATS.find(f => f.id === ide);
        console.log(`${color(fmt?.description ?? ide, c.bold, c.blue)} ${color(`(${ideRules.length} rule${ideRules.length === 1 ? '' : 's'})`, c.dim)}`);
        for (const rule of ideRules) {
            const trigger = (rule.metadata as any).trigger ?? (rule.metadata.alwaysApply ? 'always_on' : 'manual');
            const rawGlobs = rule.metadata.globs;
            const globsArr = rawGlobs
                ? (Array.isArray(rawGlobs) ? rawGlobs : [rawGlobs])
                : [];
            const globs = globsArr.length > 0 ? ` [${globsArr.join(', ')}]` : '';
            console.log(`  ${color('◆', c.cyan)} ${rule.name}${color(globs, c.dim)}  ${color(trigger, c.yellow)}`);
            if (isDetail && rule.metadata.description) {
                console.log(`      ${color(rule.metadata.description, c.dim)}`);
            }
        }
        console.log();
    }

    console.log(color(`Total: ${rules.length} rule${rules.length === 1 ? '' : 's'}`, c.bold));
}

async function cmdConvert(args: Record<string, string | boolean>): Promise<void> {
    const isGlobal = Boolean(args['global'] || args['g']);
    const rootPath = isGlobal ? getGlobalRoot() : path.resolve(String(args['root'] ?? '.'));
    const fromFmt = String(args['from'] ?? '');
    const toFmt   = String(args['to']   ?? '');
    const dryRun  = Boolean(args['dry-run']);

    if (!fromFmt || !isValidIDE(fromFmt)) {
        console.error(color(`Error: --from must be a valid format. Got: '${fromFmt}'`, c.red));
        console.error(`Run 'npx ai-rules-converter list-formats' to see available formats.`);
        process.exit(1);
    }

    if (!toFmt || !isValidIDE(toFmt)) {
        console.error(color(`Error: --to must be a valid format. Got: '${toFmt}'`, c.red));
        console.error(`Run 'npx ai-rules-converter list-formats' to see available formats.`);
        process.exit(1);
    }

    if (!fs.existsSync(rootPath)) {
        console.error(color(`Error: Root path does not exist: ${rootPath}`, c.red));
        process.exit(1);
    }

    console.log(`\n${color('Converting', c.bold)} ${color(fromFmt, c.yellow)} → ${color(toFmt, c.green)}  ${color(dryRun ? '[DRY RUN]' : '', c.magenta)}`);
    console.log(`${color('Root:', c.dim)} ${rootPath}\n`);

    const scanner = new RuleScanner();
    const allRules = await scanner.scanDirectory(rootPath);
    const rules = allRules.filter(r => r.ide === fromFmt);

    if (rules.length === 0) {
        console.log(color(`No '${fromFmt}' rules found in ${rootPath}`, c.dim));
        return;
    }

    let successCount = 0;
    let errorCount   = 0;

    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        try {
            const result = convertRuleToResult(rule, toFmt as IDE, rootPath);

            if (dryRun) {
                console.log(`  ${color('[DRY RUN]', c.magenta)} ${rule.name}`);
                console.log(`    ${color('→', c.dim)} ${result.filePath}${result.appendMode ? color(' (append)', c.dim) : ''}`);
            } else {
                const writtenPath = writeConversionResult(result, i === 0);
                const relPath = path.relative(rootPath, writtenPath);
                console.log(`  ${color('✓', c.green)} ${rule.name}  ${color('→', c.dim)} ${relPath}${result.appendMode ? color(' (appended)', c.dim) : ''}`);
                successCount++;
            }
        } catch (e: any) {
            console.error(`  ${color('✗', c.red)} ${rule.name}: ${e?.message ?? e}`);
            errorCount++;
        }
    }

    if (!dryRun) {
        console.log(`\n${color(`Done: ${successCount} converted, ${errorCount} errors.`, c.bold)}`);
    } else {
        console.log(`\n${color(`Dry run complete. ${rules.length} rule(s) would be converted.`, c.bold)}`);
    }
}

async function cmdScanAll(args: Record<string, string | boolean>): Promise<void> {
    const isGlobal = Boolean(args['global'] || args['g']);
    const rootPath = isGlobal ? getGlobalRoot() : path.resolve(String(args['root'] ?? '.'));
    const isDetail = isDetailView(args);

    if (!fs.existsSync(rootPath)) {
        console.error(color(`Error: Root path does not exist: ${rootPath}`, c.red));
        process.exit(1);
    }

    const scopeLabel = isGlobal ? color(' [global]', c.magenta) : '';
    console.log(`\n${color('Scanning All Capabilities in', c.bold)} ${color(rootPath, c.cyan)}${scopeLabel}\n`);

    const ruleScanner = new RuleScanner();
    const rules = await ruleScanner.scanDirectory(rootPath);

    const skillScanner = new SkillScanner();
    const skills = await skillScanner.scanDirectory(rootPath);

    const mcpScanner = new McpScanner();
    const mcps = await mcpScanner.scanDirectory(rootPath);

    const hooksScanner = new HooksScanner();
    const hooks = await hooksScanner.scanDirectory(rootPath);

    const detectedIdes = new Set([
        ...rules.map(r => r.ide),
        ...skills.map(s => s.ide),
        ...mcps.map(m => m.ide),
        ...hooks.map(h => h.ide),
    ]);

    if (detectedIdes.size === 0) {
        console.log(color('No agentic capabilities detected.', c.dim));
        return;
    }

    for (const ide of SUPPORTED_FORMATS.map(f => f.id)) {
        if (!detectedIdes.has(ide)) {
            continue;
        }

        const fmt = SUPPORTED_FORMATS.find(f => f.id === ide);
        console.log(`${color(fmt?.description ?? ide, c.bold, c.blue)} ${color(`(${ide})`, c.dim)}`);

        // Rules
        const ideRules = rules.filter(r => r.ide === ide);
        if (ideRules.length > 0) {
            console.log(`  ${color('Rules:', c.bold, c.yellow)} (${ideRules.length})`);
            for (const rule of ideRules) {
                const trigger = (rule.metadata as any).trigger ?? (rule.metadata.alwaysApply ? 'always_on' : 'manual');
                const rawGlobs = rule.metadata.globs;
                const globsArr = rawGlobs
                    ? (Array.isArray(rawGlobs) ? rawGlobs : [rawGlobs])
                    : [];
                const globs = globsArr.length > 0 ? ` [${globsArr.join(', ')}]` : '';
                console.log(`    ${color('◆', c.cyan)} ${rule.name}${color(globs, c.dim)}  ${color(trigger, c.yellow)}`);
                if (isDetail && rule.metadata.description) {
                    console.log(`      ${color(rule.metadata.description, c.dim)}`);
                }
            }
        }

        // Skills
        const ideSkills = skills.filter(s => s.ide === ide);
        if (ideSkills.length > 0) {
            console.log(`  ${color('Skills:', c.bold, c.yellow)} (${ideSkills.length})`);
            for (const skill of ideSkills) {
                console.log(`    ${color('◆', c.cyan)} ${skill.name} ${color(`(${skill.folderName})`, c.dim)}`);
                if (isDetail) {
                    if (skill.description) {
                        console.log(`      ${color(skill.description, c.dim)}`);
                    }
                    if (skill.additionalFiles && skill.additionalFiles.length > 0) {
                        console.log(`      ${color('Files:', c.dim)} ${skill.additionalFiles.join(', ')}`);
                    }
                }
            }
        }

        // MCP Configuration
        const ideMcp = mcps.find(m => m.ide === ide);
        if (ideMcp) {
            console.log(`  ${color('MCP Servers:', c.bold, c.yellow)}`);
            for (const serverName of Object.keys(ideMcp.servers)) {
                const server = ideMcp.servers[serverName];
                const typeLabel = (server as any).command ? 'stdio' : ((server as any).url || (server as any).serverUrl ? 'remote' : 'mcp');
                console.log(`    ${color('◆', c.cyan)} ${serverName} ${color(`(${typeLabel})`, c.dim)}`);
                if (isDetail) {
                    if ((server as any).command) {
                        const cmdStr = [(server as any).command, ...((server as any).args || [])].join(' ');
                        console.log(`      ${color('Command:', c.dim)} ${cmdStr}`);
                        if ((server as any).env) {
                            console.log(`      ${color('Env:', c.dim)} ${JSON.stringify((server as any).env)}`);
                        }
                    } else if ((server as any).url || (server as any).serverUrl) {
                        console.log(`      ${color('URL:', c.dim)} ${(server as any).url || (server as any).serverUrl}`);
                    }
                }
            }
        }

        // Hooks Configuration
        const ideHooks = hooks.find(h => h.ide === ide);
        if (ideHooks) {
            console.log(`  ${color('Event Hooks:', c.bold, c.yellow)}`);
            for (const eventName of Object.keys(ideHooks.events)) {
                const entries = ideHooks.events[eventName as any] || [];
                console.log(`    ${color('◆', c.cyan)} ${eventName} ${color(`(${entries.length} hook(s))`, c.dim)}`);
                if (isDetail) {
                    for (const entry of entries) {
                        const matcher = entry.matcher ? ` [${entry.matcher}]` : '';
                        console.log(`      ${color('Matcher:', c.dim)}${matcher}`);
                        for (const hk of entry.hooks) {
                            const cmd = hk.command || hk.script || hk.url || '';
                            console.log(`        ${color('-', c.dim)} ${color(hk.type, c.yellow)}: ${cmd}`);
                        }
                    }
                }
            }
        }

        console.log();
    }
}

async function cmdMigrate(args: Record<string, string | boolean>): Promise<void> {
    const isGlobal = Boolean(args['global'] || args['g']);
    const rootPath = isGlobal ? getGlobalRoot() : path.resolve(String(args['root'] ?? '.'));
    const fromFmt = String(args['from'] ?? '');
    const toFmt   = String(args['to']   ?? '');
    const dryRun  = Boolean(args['dry-run']);

    if (!fromFmt || !isValidIDE(fromFmt)) {
        console.error(color(`Error: --from must be a valid format. Got: '${fromFmt}'`, c.red));
        console.error(`Run 'npx ai-rules-converter list-formats' to see available formats.`);
        process.exit(1);
    }

    if (!toFmt || !isValidIDE(toFmt)) {
        console.error(color(`Error: --to must be a valid format. Got: '${toFmt}'`, c.red));
        console.error(`Run 'npx ai-rules-converter list-formats' to see available formats.`);
        process.exit(1);
    }

    if (!fs.existsSync(rootPath)) {
        console.error(color(`Error: Root path does not exist: ${rootPath}`, c.red));
        process.exit(1);
    }

    console.log(`\n${color('Migrating Agentic Capabilities', c.bold)} ${color(fromFmt, c.yellow)} → ${color(toFmt, c.green)}  ${color(dryRun ? '[DRY RUN]' : '', c.magenta)}`);
    console.log(`${color('Root:', c.dim)} ${rootPath}\n`);

    if (dryRun) {
        const ruleScanner = new RuleScanner();
        const allRules = await ruleScanner.scanDirectory(rootPath);
        const rules = allRules.filter(r => r.ide === fromFmt);

        const skillScanner = new SkillScanner();
        const allSkills = await skillScanner.scanDirectory(rootPath);
        const skills = allSkills.filter(s => s.ide === fromFmt);

        const mcpScanner = new McpScanner();
        const allMcp = await mcpScanner.scanDirectory(rootPath);
        const mcp = allMcp.find(m => m.ide === fromFmt);

        const hooksScanner = new HooksScanner();
        const allHooks = await hooksScanner.scanDirectory(rootPath);
        const hooks = allHooks.find(h => h.ide === fromFmt);

        console.log(`[DRY RUN] Would migrate:`);
        console.log(`  - ${rules.length} rules`);
        console.log(`  - ${skills.length} skills`);
        console.log(`  - MCP config: ${mcp ? 'Yes' : 'No'}`);
        console.log(`  - Hooks config: ${hooks ? 'Yes' : 'No'}`);
        return;
    }

    const orchestrator = new MigrationOrchestrator();
    const report = await orchestrator.migrateAll(fromFmt as IDE, toFmt as IDE, rootPath);

    if (report.errors && report.errors.length > 0) {
        console.error(color(`\nWarnings/Errors occurred during migration:`, c.yellow));
        for (const err of report.errors) {
            console.error(`  - ${color(err, c.red)}`);
        }
    }

    console.log(`\n${color('Migration Results:', c.bold, c.cyan)}`);
    console.log(`  Rules migrated:  ${color(String(report.rulesMigratedCount), c.green)}`);
    console.log(`  Skills migrated: ${color(String(report.skillsMigratedCount), c.green)}`);
    console.log(`  MCP migrated:    ${color(report.mcpMigrated ? 'Yes' : 'No', report.mcpMigrated ? c.green : c.dim)}`);
    console.log(`  Hooks migrated:  ${color(report.hooksMigrated ? 'Yes' : 'No', report.hooksMigrated ? c.green : c.dim)}`);

    if (report.writtenPaths.length > 0) {
        console.log(`\n${color('Written files:', c.dim)}`);
        for (const wp of report.writtenPaths) {
            console.log(`  - ${path.relative(rootPath, wp)}`);
        }
    }
}

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
            if (isDetail) {
                for (const event of Object.keys(plugin.hooks)) {
                    console.log(`    ${color('◆', c.cyan)} ${event}`);
                }
            }
        }
        console.log();
    }
    console.log(color(`Total: ${plugins.length} plugin(s)`, c.bold));
}

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
        console.error(`Run 'npx ai-rules-converter list-formats' to see available formats.`);
        process.exit(1);
    }

    const pluginDir = path.join(pluginsDir, pluginName);
    if (!fs.existsSync(pluginDir)) {
        console.error(color(`Error: Plugin '${pluginName}' not found at ${pluginDir}`, c.red));
        process.exit(1);
    }

    console.log(`\n${color('Converting Plugin', c.bold)} ${color(pluginName, c.yellow)} → ${color(toFmt, c.green)}  ${color(dryRun ? '[DRY RUN]' : '', c.magenta)}`);
    console.log(`${color('Root:', c.dim)} ${rootPath}\n`);

    const scanner = new PluginScanner();
    const plugins = await scanner.scanPlugins(pluginsDir);
    const plugin = plugins.find(p => p.name === pluginName);

    if (!plugin) {
        console.error(color(`Error: Could not parse plugin '${pluginName}'.`, c.red));
        process.exit(1);
    }

    if (dryRun) {
        const hookCount = Object.keys(plugin.hooks).length;
        console.log(`  ${color('[DRY RUN]', c.magenta)} Would convert:`);
        console.log(`    ${color('Skills:', c.yellow)} ${plugin.skills.length}`);
        console.log(`    ${color('Hook events:', c.yellow)} ${hookCount}`);
        return;
    }

    const converter = new PluginConverter();
    const report = await converter.convertPlugin(plugin, toFmt as IDE, rootPath);

    if (report.errors.length > 0) {
        console.error(color(`\nWarnings/Errors:`, c.yellow));
        for (const err of report.errors) {
            console.error(`  ${color('✗', c.red)} ${err}`);
        }
    }

    console.log(`\n${color('Done:', c.bold)} ${color(String(report.skillsConverted), c.green)} skill(s), ${color(String(report.rulesConverted), c.green)} rule(s), hooks: ${color(report.hooksMigrated ? 'yes' : 'no', report.hooksMigrated ? c.green : c.dim)}`);

    if (report.writtenPaths.length > 0) {
        console.log(`\n${color('Written files:', c.dim)}`);
        for (const wp of report.writtenPaths) {
            console.log(`  ${color('✓', c.green)} ${path.relative(rootPath, wp)}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const argv = process.argv.slice(2);

    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        printHelp();
        return;
    }

    const args = parseArgs(argv);
    const command = String(args['_command'] ?? '');

    switch (command) {
        case 'scan':
            await cmdScan(args);
            break;
        case 'scan-all':
            await cmdScanAll(args);
            break;
        case 'convert':
            await cmdConvert(args);
            break;
        case 'migrate':
            await cmdMigrate(args);
            break;
        case 'scan-plugins':
            await cmdScanPlugins(args);
            break;
        case 'convert-plugin':
            await cmdConvertPlugin(args);
            break;
        case 'list-formats':
            cmdListFormats();
            break;
        default:
            console.error(color(`Unknown command: '${command}'`, c.red));
            printHelp();
            process.exit(1);
    }
}

main().catch(err => {
    console.error(color(`Fatal error: ${err?.message ?? err}`, c.red));
    process.exit(1);
});
