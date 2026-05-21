import * as vscode from 'vscode';
import { RulesTreeDataProvider, RuleTreeItem } from './ui/RulesTreeDataProvider';
import { Rule, IDE } from './core/RuleModel';
import { RuleConverter } from './core/RuleConverter';
import { SkillConverter } from './core/SkillConverter';
import { McpConverter } from './core/McpConverter';
import { MigrationOrchestrator } from './core/MigrationOrchestrator';
import * as path from 'path';
import * as fs from 'fs';

/** Human-readable labels for each format in QuickPick. */
const FORMAT_ITEMS: { label: string; description: string; value: IDE }[] = [
    { label: 'cursor',      description: '.cursor/rules/*.mdc',                      value: 'cursor' },
    { label: 'windsurf',    description: '.windsurf/rules/*.md',                     value: 'windsurf' },
    { label: 'kiro',        description: '.kiro/steering/*.md or .kiro/specs/*.md',  value: 'kiro' },
    { label: 'antigravity', description: '.agent/rules/*.md',                        value: 'antigravity' },
    { label: 'agy',         description: '.agent/rules/*.md (Antigravity CLI)',     value: 'agy' },
    { label: 'claude-code', description: 'CLAUDE.md (sections per rule)',            value: 'claude-code' },
    { label: 'gemini-cli',  description: 'GEMINI.md (sections per rule)',            value: 'gemini-cli' },
    { label: 'copilot',     description: '.github/copilot-instructions.md or .github/instructions/', value: 'copilot' },
];

async function pickTargetFormat(): Promise<IDE | undefined> {
    const picked = await vscode.window.showQuickPick(
        FORMAT_ITEMS.map(f => ({ label: f.label, description: f.description, _value: f.value })),
        { placeHolder: 'Select target format' }
    );
    return picked ? picked._value : undefined;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('RulesConverter is now active!');

    const rulesProvider = new RulesTreeDataProvider();
    vscode.window.registerTreeDataProvider('detected-rules', rulesProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('rulesConverter.refresh', () => rulesProvider.refresh()),

        vscode.commands.registerCommand('rulesConverter.openRule', (rule: Rule) => {
            if (rule && rule.filePath) {
                vscode.workspace.openTextDocument(rule.filePath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        }),

        vscode.commands.registerCommand('rulesConverter.convertRule', async (item: Rule | RuleTreeItem) => {
            if (item instanceof RuleTreeItem && item.type === 'skill' && item.skill) {
                const skill = item.skill;
                const target = await pickTargetFormat();
                if (!target) return;

                const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(skill.skillFilePath));
                if (!workspaceFolder) {
                    vscode.window.showErrorMessage('Could not determine workspace folder for skill.');
                    return;
                }
                const rootPath = workspaceFolder.uri.fsPath;

                try {
                    const skillConverter = new SkillConverter();
                    const result = skillConverter.convertSkill(skill, target, rootPath);
                    const writtenPath = skillConverter.executeConversion(result, true);
                    vscode.window.showInformationMessage(`Skill converted to ${target}: ${path.basename(writtenPath)}`);
                    rulesProvider.refresh();
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to convert skill: ${e.message || e}`);
                }
                return;
            }

            if (item instanceof RuleTreeItem && item.type === 'mcp' && item.mcpServer) {
                const mcpServer = item.mcpServer;
                const target = await pickTargetFormat();
                if (!target) return;

                const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mcpServer.filePath));
                if (!workspaceFolder) {
                    vscode.window.showErrorMessage('Could not determine workspace folder for MCP server.');
                    return;
                }
                const rootPath = workspaceFolder.uri.fsPath;

                const mcpSupportedTargets: IDE[] = ['agy', 'antigravity', 'claude-code', 'cursor', 'windsurf', 'gemini-cli'];
                if (!mcpSupportedTargets.includes(target)) {
                    vscode.window.showErrorMessage(`MCP configuration is not supported for target: ${target}`);
                    return;
                }

                try {
                    const mcpConverter = new McpConverter();
                    const sourceIde = item.ide!;
                    const tempConfig = {
                        ide: sourceIde,
                        filePath: mcpServer.filePath,
                        servers: {
                            [mcpServer.name]: mcpServer.config
                        },
                        scope: 'project' as const
                    };
                    const result = mcpConverter.convertConfig(tempConfig, target, rootPath);
                    const writtenPath = mcpConverter.executeConversion(result);
                    vscode.window.showInformationMessage(`MCP Server '${mcpServer.name}' converted to ${target}: ${path.basename(writtenPath)}`);
                    rulesProvider.refresh();
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to convert MCP server: ${e.message || e}`);
                }
                return;
            }

            let rule: Rule | undefined;
            if (item instanceof RuleTreeItem) {
                rule = item.rule;
            } else {
                rule = item as Rule;
            }

            if (!rule) {
                vscode.window.showErrorMessage('Could not determine rule to convert.');
                return;
            }

            const target = await pickTargetFormat();

            if (target) {
                const converter = new RuleConverter();
                const newPath = await converter.convertRule(rule, target, true);
                if (newPath) {
                    vscode.window.showInformationMessage(`Rule converted to ${target}: ${path.basename(newPath)}`);
                }
                rulesProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('rulesConverter.convertAllRules', async (item: RuleTreeItem) => {
            if (!item) {
                return;
            }

            let sourceIde: IDE | undefined;
            let folderPath = '';

            if (item.type === 'virtual-folder') {
                sourceIde = item.ide;
                folderPath = item.parentLabel;
            } else if (item.type === 'ide') {
                // For root IDE items, the label itself is the IDE
                sourceIde = item.label as IDE;
                folderPath = '';
            } else {
                return;
            }

            const target = await pickTargetFormat();

            if (target) {
                const rules = rulesProvider.getRules();
                const rulesToConvert = rules.filter(r => {
                    if (r.ide !== sourceIde) {
                        return false;
                    }
                    if (folderPath) {
                        return r.name.startsWith(folderPath + '/');
                    }
                    return true;
                });

                if (rulesToConvert.length === 0) {
                    vscode.window.showInformationMessage('No rules found to convert in this folder.');
                    return;
                }

                const converter = new RuleConverter();
                let count = 0;

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Converting ${rulesToConvert.length} rules to ${target}…`,
                    cancellable: false
                }, async (progress) => {
                    const increment = 100 / rulesToConvert.length;
                    for (let i = 0; i < rulesToConvert.length; i++) {
                        const rule = rulesToConvert[i];
                        progress.report({ message: `Converting ${rule.name}…` });
                        // isFirstInBatch=true only for the very first rule, so flat-file formats
                        // (CLAUDE.md, GEMINI.md) are correctly truncated then appended.
                        await converter.convertRule(rule, target, i === 0);
                        count++;
                        progress.report({ increment });
                    }
                });

                vscode.window.showInformationMessage(`Successfully converted ${count} rules to ${target}.`);
                rulesProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('rulesConverter.deleteRule', async (item: Rule | RuleTreeItem) => {
            if (!item) {
                return;
            }

            if (item instanceof RuleTreeItem && item.type === 'skill' && item.skill) {
                const skill = item.skill;
                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete the skill '${skill.name}'? This will delete the folder '${skill.folderPath}' recursively.`,
                    { modal: true },
                    'Delete'
                );

                if (confirm === 'Delete') {
                    try {
                        const skillConverter = new SkillConverter();
                        skillConverter.deleteSkill(skill);
                        vscode.window.showInformationMessage(`Skill '${skill.name}' deleted.`);
                        rulesProvider.refresh();
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to delete skill: ${e.message || e}`);
                    }
                }
                return;
            }

            if (item instanceof RuleTreeItem && item.type === 'mcp' && item.mcpServer) {
                const mcpServer = item.mcpServer;
                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete the MCP server '${mcpServer.name}' from ${item.ide} config?`,
                    { modal: true },
                    'Delete'
                );

                if (confirm === 'Delete') {
                    try {
                        if (fs.existsSync(mcpServer.filePath)) {
                            const raw = fs.readFileSync(mcpServer.filePath, 'utf-8');
                            const content = JSON.parse(raw);
                            if (content && content.mcpServers && content.mcpServers[mcpServer.name]) {
                                delete content.mcpServers[mcpServer.name];
                                fs.writeFileSync(mcpServer.filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
                                vscode.window.showInformationMessage(`MCP server '${mcpServer.name}' deleted.`);
                                rulesProvider.refresh();
                            } else {
                                vscode.window.showErrorMessage(`MCP server '${mcpServer.name}' not found in configuration file.`);
                            }
                        } else {
                            vscode.window.showErrorMessage(`MCP config file not found: ${mcpServer.filePath}`);
                        }
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to delete MCP server: ${e.message || e}`);
                    }
                }
                return;
            }

            let rulesToDelete: Rule[] = [];
            let confirmMessage = '';

            if (item instanceof RuleTreeItem) {
                // It's a TreeItem, check if it's a rule, virtual-folder or ide
                if (item.type === 'rule' && item.rule) {
                    rulesToDelete = [item.rule];
                    confirmMessage = `Are you sure you want to delete '${item.rule.name}'?`;
                } else if (item.type === 'virtual-folder' || item.type === 'ide') {
                    // Recursive delete
                    let sourceIde: IDE | undefined;
                    let folderPath = '';

                    if (item.type === 'virtual-folder') {
                        sourceIde = item.ide;
                        folderPath = item.parentLabel;
                    } else if (item.type === 'ide') {
                        sourceIde = item.label as IDE;
                        folderPath = '';
                    }

                    const rules = rulesProvider.getRules();
                    rulesToDelete = rules.filter(r => {
                        if (r.ide !== sourceIde) {
                            return false;
                        }
                        if (folderPath) {
                            return r.name.startsWith(folderPath + '/');
                        }
                        return true;
                    });

                    if (rulesToDelete.length === 0) {
                        vscode.window.showInformationMessage('No rules found to delete in this folder.');
                        return;
                    }

                    confirmMessage = `Are you sure you want to delete ALL ${rulesToDelete.length} rules in '${item.label}' and its subfolders?`;
                    if (item.type === 'ide') {
                        confirmMessage = `WARNING: Are you sure you want to delete ALL ${rulesToDelete.length} rules for ${item.label}? This is destructive.`;
                    }
                }
            } else {
                // Direct rule object (helper call maybe?)
                rulesToDelete = [item as Rule];
                confirmMessage = `Are you sure you want to delete '${(item as Rule).name}'?`;
            }

            if (rulesToDelete.length === 0) {
                vscode.window.showErrorMessage('Could not determine rules to delete.');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                'Delete'
            );

            if (confirm === 'Delete') {
                const converter = new RuleConverter();
                let count = 0;
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Deleting rules…`,
                    cancellable: false
                }, async (progress) => {
                    const increment = 100 / rulesToDelete.length;
                    for (const rule of rulesToDelete) {
                        progress.report({ message: `Deleting ${rule.name}…` });
                        await converter.deleteRule(rule);
                        count++;
                        progress.report({ increment });
                    }
                });
                vscode.window.showInformationMessage(`Deleted ${count} rules.`);
                rulesProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('rulesConverter.migrateWorkspace', async () => {
            const source = await vscode.window.showQuickPick(
                FORMAT_ITEMS.map(f => ({ label: f.label, description: f.description, _value: f.value })),
                { placeHolder: 'Select source format to migrate FROM' }
            );
            if (!source) {
                return;
            }

            const target = await vscode.window.showQuickPick(
                FORMAT_ITEMS.map(f => ({ label: f.label, description: f.description, _value: f.value })),
                { placeHolder: `Select target format to migrate ${source._value} TO` }
            );
            if (!target) {
                return;
            }

            if (source._value === target._value) {
                vscode.window.showErrorMessage('Source and target formats must be different.');
                return;
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder is open.');
                return;
            }

            let totalRules = 0;
            let totalSkills = 0;
            let mcpMigrated = false;
            let hooksMigrated = false;
            const errors: string[] = [];
            const allWrittenPaths: string[] = [];

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Migrating capabilities from ${source._value} to ${target._value}…`,
                cancellable: false
            }, async (progress) => {
                const orchestrator = new MigrationOrchestrator();
                for (const folder of workspaceFolders) {
                    const rootPath = folder.uri.fsPath;
                    progress.report({ message: `Migrating folder: ${folder.name}…` });
                    try {
                        const report = await orchestrator.migrateAll(source._value, target._value, rootPath);
                        totalRules += report.rulesMigratedCount;
                        totalSkills += report.skillsMigratedCount;
                        if (report.mcpMigrated) {
                            mcpMigrated = true;
                        }
                        if (report.hooksMigrated) {
                            hooksMigrated = true;
                        }
                        if (report.writtenPaths && report.writtenPaths.length > 0) {
                            allWrittenPaths.push(...report.writtenPaths);
                        }
                        if (report.errors && report.errors.length > 0) {
                            errors.push(...report.errors.map(err => `[${folder.name}] ${err}`));
                        }
                    } catch (e: any) {
                        errors.push(`[${folder.name}] ${e.message || e}`);
                    }
                }
            });

            if (errors.length > 0) {
                vscode.window.showWarningMessage(`Migration completed with errors:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...' : ''}`);
            }

            const parts: string[] = [];
            if (totalRules > 0) {
                parts.push(`${totalRules} rule(s)`);
            }
            if (totalSkills > 0) {
                parts.push(`${totalSkills} skill(s)`);
            }
            if (mcpMigrated) {
                parts.push(`MCP configuration`);
            }
            if (hooksMigrated) {
                parts.push(`Event hooks`);
            }

            if (parts.length > 0) {
                vscode.window.showInformationMessage(`Successfully migrated: ${parts.join(', ')} to ${target._value}.`);
            } else {
                vscode.window.showInformationMessage(`No capabilities found to migrate from ${source._value} to ${target._value}.`);
            }

            rulesProvider.refresh();
        })
    );
}

export function deactivate() { }
