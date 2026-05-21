/**
 * MigrationOrchestrator.ts
 *
 * Coordinates full migration of all agentic capabilities (rules, skills, MCP, hooks)
 * from a source IDE to a target IDE.
 */

import { IDE } from './RuleModel';
import { RuleScanner } from './RuleScanner';
import { SkillScanner } from './SkillScanner';
import { McpScanner } from './McpScanner';
import { HooksScanner } from './HooksScanner';
import { convertRuleToResult, writeConversionResult } from './RuleConverterCore';
import { SkillConverter } from './SkillConverter';
import { McpConverter } from './McpConverter';
import { HooksConverter } from './HooksConverter';

export interface MigrationReport {
    rulesMigratedCount: number;
    skillsMigratedCount: number;
    mcpMigrated: boolean;
    hooksMigrated: boolean;
    writtenPaths: string[];
    errors: string[];
}

export class MigrationOrchestrator {
    private ruleScanner = new RuleScanner();
    private skillScanner = new SkillScanner();
    private mcpScanner = new McpScanner();
    private hooksScanner = new HooksScanner();

    private skillConverter = new SkillConverter();
    private mcpConverter = new McpConverter();
    private hooksConverter = new HooksConverter();

    constructor() {}

    /**
     * Perform full capability migration from fromIde to toIde.
     */
    public async migrateAll(
        fromIde: IDE,
        toIde: IDE,
        rootPath: string
    ): Promise<MigrationReport> {
        const report: MigrationReport = {
            rulesMigratedCount: 0,
            skillsMigratedCount: 0,
            mcpMigrated: false,
            hooksMigrated: false,
            writtenPaths: [],
            errors: [],
        };

        if (fromIde === toIde) {
            report.errors.push('Source and target formats are identical.');
            return report;
        }

        // 1. Migrate Rules
        try {
            const allRules = await this.ruleScanner.scanDirectory(rootPath);
            const sourceRules = allRules.filter(r => r.ide === fromIde);

            for (let i = 0; i < sourceRules.length; i++) {
                const rule = sourceRules[i];
                try {
                    const result = convertRuleToResult(rule, toIde, rootPath);
                    const written = writeConversionResult(result, i === 0);
                    report.rulesMigratedCount++;
                    report.writtenPaths.push(written);
                } catch (e: any) {
                    report.errors.push(`Rule conversion failed for "${rule.name}": ${e.message || e}`);
                }
            }
        } catch (e: any) {
            report.errors.push(`Failed scanning/converting rules: ${e.message || e}`);
        }

        // 2. Migrate Skills
        try {
            const allSkills = await this.skillScanner.scanDirectory(rootPath);
            const sourceSkills = allSkills.filter(s => s.ide === fromIde);

            for (let i = 0; i < sourceSkills.length; i++) {
                const skill = sourceSkills[i];
                try {
                    const result = this.skillConverter.convertSkill(skill, toIde, rootPath);
                    const written = this.skillConverter.executeConversion(result, i === 0);
                    report.skillsMigratedCount++;
                    report.writtenPaths.push(written);
                } catch (e: any) {
                    report.errors.push(`Skill conversion failed for "${skill.folderName}": ${e.message || e}`);
                }
            }
        } catch (e: any) {
            report.errors.push(`Failed scanning/converting skills: ${e.message || e}`);
        }

        // 3. Migrate MCP Configurations
        const mcpSupportedTargets: IDE[] = ['agy', 'antigravity', 'claude-code', 'cursor', 'windsurf', 'gemini-cli'];
        if (mcpSupportedTargets.includes(toIde)) {
            try {
                const allMcp = await this.mcpScanner.scanDirectory(rootPath);
                const sourceMcp = allMcp.find(m => m.ide === fromIde);

                if (sourceMcp) {
                    try {
                        const result = this.mcpConverter.convertConfig(sourceMcp, toIde, rootPath);
                        const written = this.mcpConverter.executeConversion(result);
                        report.mcpMigrated = true;
                        report.writtenPaths.push(written);
                    } catch (e: any) {
                        report.errors.push(`MCP migration failed: ${e.message || e}`);
                    }
                }
            } catch (e: any) {
                report.errors.push(`Failed scanning/converting MCP config: ${e.message || e}`);
            }
        }

        // 4. Migrate Hooks
        const hooksSupportedTargets: IDE[] = ['agy', 'antigravity', 'claude-code', 'windsurf', 'copilot'];
        if (hooksSupportedTargets.includes(toIde)) {
            try {
                const allHooks = await this.hooksScanner.scanDirectory(rootPath);
                const sourceHooks = allHooks.find(h => h.ide === fromIde);

                if (sourceHooks) {
                    try {
                        const result = this.hooksConverter.convertConfig(sourceHooks, toIde, rootPath);
                        const written = this.hooksConverter.executeConversion(result);
                        report.hooksMigrated = true;
                        report.writtenPaths.push(written);
                    } catch (e: any) {
                        report.errors.push(`Hooks migration failed: ${e.message || e}`);
                    }
                }
            } catch (e: any) {
                report.errors.push(`Failed scanning/converting hooks config: ${e.message || e}`);
            }
        }

        // Deduplicate written paths
        report.writtenPaths = Array.from(new Set(report.writtenPaths));

        return report;
    }
}
