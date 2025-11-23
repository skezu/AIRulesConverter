import * as vscode from 'vscode';
import { RulesTreeDataProvider, RuleTreeItem } from './ui/RulesTreeDataProvider';
import { Rule, IDE } from './core/RuleModel';
import { RuleConverter } from './core/RuleConverter';

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
                await converter.convertRule(rule, target as IDE);
                rulesProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('rulesConverter.deleteRule', async (item: Rule | RuleTreeItem) => {
            let rule: Rule | undefined;
            if (item instanceof RuleTreeItem) {
                rule = item.rule;
            } else {
                rule = item as Rule;
            }

            if (!rule) {
                vscode.window.showErrorMessage('Could not determine rule to delete.');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete '${rule.name}'?`,
                { modal: true },
                'Delete'
            );

            if (confirm === 'Delete') {
                const converter = new RuleConverter();
                await converter.deleteRule(rule);
                rulesProvider.refresh();
            }
        })
    );
}

export function deactivate() { }
