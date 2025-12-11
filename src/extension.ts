import * as vscode from 'vscode';
import { RulesTreeDataProvider, RuleTreeItem } from './ui/RulesTreeDataProvider';
import { Rule, IDE } from './core/RuleModel';
import { RuleConverter } from './core/RuleConverter';
import * as path from 'path';

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

            const target = await vscode.window.showQuickPick(['cursor', 'windsurf', 'kiro', 'antigravity'], {
                placeHolder: 'Select target IDE format'
            });

            if (target) {
                const converter = new RuleConverter();
                const newPath = await converter.convertRule(rule, target as IDE);
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

            const target = await vscode.window.showQuickPick(['cursor', 'windsurf', 'kiro', 'antigravity'], {
                placeHolder: 'Select target IDE format for all rules'
            });

            if (target) {
                const rules = rulesProvider.getRules();
                // If folderPath is empty, we convert all rules for that IDE

                const rulesToConvert = rules.filter(r => {
                    if (r.ide !== sourceIde) {
                        return false;
                    }
                    if (folderPath) {
                        // Check if rule is within the selected folder
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
                    title: `Converting rules...`,
                    cancellable: false
                }, async (progress) => {
                    const increment = 100 / rulesToConvert.length;
                    for (const rule of rulesToConvert) {
                        progress.report({ message: `Converting ${rule.name}...` });
                        await converter.convertRule(rule, target as IDE);
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
                            // strictly starts with folderPath + '/'
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
                    title: `Deleting rules...`,
                    cancellable: false
                }, async (progress) => {
                    const increment = 100 / rulesToDelete.length;
                    for (const rule of rulesToDelete) {
                        progress.report({ message: `Deleting ${rule.name}...` });
                        await converter.deleteRule(rule);
                        count++;
                        progress.report({ increment });
                    }
                });
                vscode.window.showInformationMessage(`Deleted ${count} rules.`);
                rulesProvider.refresh();
            }
        })
    );
}

export function deactivate() { }
