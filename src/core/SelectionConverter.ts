/**
 * SelectionConverter.ts
 *
 * Selective, capability-level conversion: convert an arbitrary subset of a
 * source tool's rules / skills / MCP servers / hook events to a target format,
 * at project or global scope. This is the "execute" side used by the
 * interactive UI (and usable headless / in tests via `dryRun`).
 *
 * It composes the existing per-capability converters; it does NOT re-scan —
 * callers pass the already-scanned source capabilities so the UI and the
 * converter operate on exactly the same data.
 */

import { IDE, Rule } from './RuleModel';
import { Skill, McpConfig, HooksConfig } from './AgentCapability';
import { convertRuleToResult, writeConversionResult } from './RuleConverterCore';
import { SkillConverter } from './SkillConverter';
import { McpConverter } from './McpConverter';
import { HooksConverter } from './HooksConverter';
import { PluginMigrator } from './PluginMigrator';
import { ScannedPlugin } from './PluginInventory';
import {
    getGlobalRulesTarget,
    getGlobalSkillsDir,
    getGlobalMcpConfigPath,
    getGlobalHooksFile,
} from './GlobalPathResolver';

export type CapabilityKind = 'rule' | 'skill' | 'mcp' | 'hooks' | 'plugin';

/** Targets that support MCP / hooks conversion (others have no equivalent surface). */
export const MCP_TARGETS: IDE[] = ['agy', 'antigravity', 'claude-code', 'cursor', 'windsurf', 'gemini-cli'];
export const HOOKS_TARGETS: IDE[] = ['agy', 'antigravity', 'claude-code', 'windsurf', 'copilot'];

/**
 * Which item ids to convert per kind. An `undefined` set for a kind means
 * "convert all items of that kind"; an empty set means "convert none".
 *  - rules:  Rule.id
 *  - skills: Skill.id
 *  - mcp:    server name (key in McpConfig.servers)
 *  - hooks:  canonical event name (key in HooksConfig.events)
 */
export interface ConversionSelection {
    ruleIds?: Set<string>;
    skillIds?: Set<string>;
    mcpServerNames?: Set<string>;
    hookEventNames?: Set<string>;
    /** Plugin names (ScannedPlugin.name) to convert as whole bundles. */
    pluginNames?: Set<string>;
}

export interface ConversionItemOutcome {
    kind: CapabilityKind;
    name: string;
    ok: boolean;
    writtenPath?: string;
    error?: string;
}

export interface SelectionConversionReport {
    fromIde: IDE;
    toIde: IDE;
    scope: 'project' | 'global';
    dryRun: boolean;
    outcomes: ConversionItemOutcome[];
    writtenPaths: string[];
    successCount: number;
    errorCount: number;
}

export interface ConvertSelectionInput {
    fromIde: IDE;
    toIde: IDE;
    rootPath: string;
    scope: 'project' | 'global';
    rules: Rule[];
    skills: Skill[];
    mcp?: McpConfig;
    hooks?: HooksConfig;
    plugins?: ScannedPlugin[];
    /** Omit to convert everything; provide to restrict to specific items. */
    selection?: ConversionSelection;
    dryRun?: boolean;
}

/** Is a capability kind convertible to the given target at the given scope? */
export function isKindSupported(kind: CapabilityKind, toIde: IDE, scope: 'project' | 'global'): boolean {
    switch (kind) {
        case 'rule':
            return scope === 'global' ? getGlobalRulesTarget(toIde) !== null : true;
        case 'skill':
            return scope === 'global' ? getGlobalSkillsDir(toIde) !== null : true;
        case 'mcp':
            return MCP_TARGETS.includes(toIde) && (scope === 'global' ? getGlobalMcpConfigPath(toIde) !== null : true);
        case 'hooks':
            return HOOKS_TARGETS.includes(toIde) && (scope === 'global' ? getGlobalHooksFile(toIde) !== null : true);
        case 'plugin':
            // Plugin bundles only convert between the two plugin ecosystems; scope is irrelevant.
            return PluginMigrator.toPluginFormat(toIde) !== null;
        default:
            return false;
    }
}

function included(set: Set<string> | undefined, id: string): boolean {
    return set === undefined || set.has(id);
}

/**
 * Convert the selected subset of capabilities from `fromIde` to `toIde`.
 * Each item is converted independently; a failure on one item is recorded as an
 * error outcome and does not abort the others.
 */
export function convertSelection(input: ConvertSelectionInput): SelectionConversionReport {
    const { fromIde, toIde, rootPath, scope, rules, skills, mcp, hooks, plugins, selection, dryRun = false } = input;

    const report: SelectionConversionReport = {
        fromIde, toIde, scope, dryRun,
        outcomes: [],
        writtenPaths: [],
        successCount: 0,
        errorCount: 0,
    };

    if (fromIde === toIde) {
        report.outcomes.push({ kind: 'rule', name: '(all)', ok: false, error: 'Source and target formats are identical.' });
        report.errorCount++;
        return report;
    }

    const push = (o: ConversionItemOutcome) => {
        report.outcomes.push(o);
        if (o.ok) {
            report.successCount++;
            if (o.writtenPath) { report.writtenPaths.push(o.writtenPath); }
        } else {
            report.errorCount++;
        }
    };

    // --- Rules ---
    const selectedRules = rules.filter(r => included(selection?.ruleIds, r.id));
    if (selectedRules.length > 0) {
        if (!isKindSupported('rule', toIde, scope)) {
            for (const r of selectedRules) {
                push({ kind: 'rule', name: r.name, ok: false, error: `Rules not supported for ${toIde} (${scope}).` });
            }
        } else {
            for (let i = 0; i < selectedRules.length; i++) {
                const rule = selectedRules[i];
                try {
                    const result = convertRuleToResult(rule, toIde, rootPath, scope);
                    const written = dryRun ? result.filePath : writeConversionResult(result, i === 0);
                    push({ kind: 'rule', name: rule.name, ok: true, writtenPath: written });
                } catch (e: any) {
                    push({ kind: 'rule', name: rule.name, ok: false, error: e?.message ?? String(e) });
                }
            }
        }
    }

    // --- Skills ---
    const selectedSkills = skills.filter(s => included(selection?.skillIds, s.id));
    if (selectedSkills.length > 0) {
        if (!isKindSupported('skill', toIde, scope)) {
            for (const s of selectedSkills) {
                push({ kind: 'skill', name: s.folderName, ok: false, error: `Skills not supported for ${toIde} (${scope}).` });
            }
        } else {
            const skillConverter = new SkillConverter();
            for (let i = 0; i < selectedSkills.length; i++) {
                const skill = selectedSkills[i];
                try {
                    const result = skillConverter.convertSkill(skill, toIde, rootPath, scope);
                    const written = dryRun ? (result.targetFolderPath ?? '') : skillConverter.executeConversion(result, i === 0);
                    push({ kind: 'skill', name: skill.folderName, ok: true, writtenPath: written });
                } catch (e: any) {
                    push({ kind: 'skill', name: skill.folderName, ok: false, error: e?.message ?? String(e) });
                }
            }
        }
    }

    // --- MCP servers ---
    if (mcp) {
        const allServerNames = Object.keys(mcp.servers);
        const selectedServerNames = allServerNames.filter(n => included(selection?.mcpServerNames, n));
        if (selectedServerNames.length > 0) {
            if (!isKindSupported('mcp', toIde, scope)) {
                for (const name of selectedServerNames) {
                    push({ kind: 'mcp', name, ok: false, error: `MCP not supported for ${toIde} (${scope}).` });
                }
            } else {
                const subConfig: McpConfig = {
                    ...mcp,
                    servers: Object.fromEntries(selectedServerNames.map(n => [n, mcp.servers[n]])),
                };
                try {
                    const mcpConverter = new McpConverter();
                    const result = mcpConverter.convertConfig(subConfig, toIde, rootPath, scope);
                    const written = dryRun ? result.filePath : mcpConverter.executeConversion(result);
                    for (const name of selectedServerNames) {
                        push({ kind: 'mcp', name, ok: true, writtenPath: written });
                    }
                } catch (e: any) {
                    for (const name of selectedServerNames) {
                        push({ kind: 'mcp', name, ok: false, error: e?.message ?? String(e) });
                    }
                }
            }
        }
    }

    // --- Hook events ---
    if (hooks) {
        const allEventNames = Object.keys(hooks.events);
        const selectedEventNames = allEventNames.filter(n => included(selection?.hookEventNames, n));
        if (selectedEventNames.length > 0) {
            if (!isKindSupported('hooks', toIde, scope)) {
                for (const name of selectedEventNames) {
                    push({ kind: 'hooks', name, ok: false, error: `Hooks not supported for ${toIde} (${scope}).` });
                }
            } else {
                const subEvents: HooksConfig['events'] = {};
                for (const name of selectedEventNames) {
                    (subEvents as Record<string, unknown>)[name] = (hooks.events as Record<string, unknown>)[name];
                }
                const subConfig: HooksConfig = { ...hooks, events: subEvents };
                try {
                    const hooksConverter = new HooksConverter();
                    const result = hooksConverter.convertConfig(subConfig, toIde, rootPath, scope);
                    const written = dryRun ? result.filePath : hooksConverter.executeConversion(result);
                    for (const name of selectedEventNames) {
                        push({ kind: 'hooks', name, ok: true, writtenPath: written });
                    }
                } catch (e: any) {
                    for (const name of selectedEventNames) {
                        push({ kind: 'hooks', name, ok: false, error: e?.message ?? String(e) });
                    }
                }
            }
        }
    }

    // --- Plugins (whole-bundle migration between claude-code and antigravity) ---
    if (plugins && plugins.length > 0) {
        const selectedPlugins = plugins.filter(p => included(selection?.pluginNames, p.name));
        if (selectedPlugins.length > 0) {
            const targetFormat = PluginMigrator.toPluginFormat(toIde);
            if (!targetFormat) {
                for (const p of selectedPlugins) {
                    push({ kind: 'plugin', name: p.name, ok: false, error: `Plugins only convert to claude-code or antigravity (not ${toIde}).` });
                }
            } else {
                const migrator = new PluginMigrator();
                for (const p of selectedPlugins) {
                    if (p.format === targetFormat) {
                        push({ kind: 'plugin', name: p.name, ok: false, error: `Already a ${targetFormat} plugin.` });
                        continue;
                    }
                    try {
                        const bundle = migrator.loadBundle(p.format, p.sourceDir);
                        const outDir = PluginMigrator.defaultOutputDir(targetFormat, p.name);
                        const pluginReport = migrator.migrate(bundle, targetFormat, outDir, { dryRun });
                        if (pluginReport.errors.length > 0) {
                            push({ kind: 'plugin', name: p.name, ok: false, error: pluginReport.errors.join('; ') });
                        } else {
                            push({ kind: 'plugin', name: p.name, ok: true, writtenPath: outDir });
                        }
                    } catch (e: any) {
                        push({ kind: 'plugin', name: p.name, ok: false, error: e?.message ?? String(e) });
                    }
                }
            }
        }
    }

    report.writtenPaths = Array.from(new Set(report.writtenPaths));
    return report;
}
