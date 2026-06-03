import * as path from 'path';
import * as fs from 'fs';
import { ClaudePlugin, HooksConfig } from './AgentCapability';
import { IDE } from './RuleModel';
import { SkillConverter } from './SkillConverter';
import { HooksConverter } from './HooksConverter';
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

        // 2. Convert rules from the plugin dir
        // If the plugin ships native-format rules for the target IDE, copy them directly.
        // Otherwise convert from claude-code (CLAUDE.md sections) to the target.
        try {
            const ruleScanner = new RuleScanner();
            const pluginRules = (await ruleScanner.scanDirectory(plugin.pluginDir))
                .filter(r => r.ide === 'claude-code' || r.ide === targetIde);

            for (let i = 0; i < pluginRules.length; i++) {
                const rule = pluginRules[i];
                try {
                    if (rule.ide === targetIde) {
                        // Rule already in target format — copy relative structure
                        const destPath = path.join(workspaceRoot, path.relative(plugin.pluginDir, rule.filePath));
                        fs.mkdirSync(path.dirname(destPath), { recursive: true });
                        fs.copyFileSync(rule.filePath, destPath);
                        report.rulesConverted++;
                        report.writtenPaths.push(destPath);
                    } else {
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
        const hooksEventCount = Object.keys(plugin.hooks).length;
        if (hooksEventCount > 0) {
            const hooksSupportedTargets: IDE[] = ['agy', 'antigravity', 'claude-code', 'windsurf', 'copilot'];
            if (hooksSupportedTargets.includes(targetIde)) {
                try {
                    const hooksConverter = new HooksConverter();
                    // Replace ${CLAUDE_PLUGIN_ROOT} with the absolute plugin dir so
                    // the converted hook commands work outside Claude Code.
                    const resolvedEvents = this.resolvePluginRootVar(plugin.hooks, plugin.pluginDir);
                    const sourceConfig: HooksConfig = {
                        ide: 'claude-code',
                        filePath: plugin.manifestPath,
                        scope: 'project',
                        groupName: `plugin-${plugin.name}`,
                        events: resolvedEvents as HooksConfig['events'],
                    };
                    const result = hooksConverter.convertConfig(sourceConfig, targetIde, workspaceRoot);
                    const written = hooksConverter.executeConversion(result);
                    report.hooksMigrated = true;
                    report.writtenPaths.push(written);
                } catch (e: any) {
                    report.errors.push(`Hooks conversion: ${e.message || e}`);
                }
            }
        }

        report.writtenPaths = Array.from(new Set(report.writtenPaths));
        return report;
    }

    /**
     * Replace ${CLAUDE_PLUGIN_ROOT} with the actual absolute plugin directory path
     * so converted hook commands work in IDEs that don't set this variable.
     */
    private resolvePluginRootVar(
        hooks: ClaudePlugin['hooks'],
        pluginDir: string
    ): ClaudePlugin['hooks'] {
        const resolved: ClaudePlugin['hooks'] = {};
        for (const [event, entries] of Object.entries(hooks)) {
            if (!entries) { continue; }
            resolved[event as keyof typeof hooks] = entries.map(entry => ({
                ...entry,
                hooks: entry.hooks.map(hook => ({
                    ...hook,
                    command: hook.command
                        ? hook.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginDir)
                        : hook.command,
                })),
            }));
        }
        return resolved;
    }
}
