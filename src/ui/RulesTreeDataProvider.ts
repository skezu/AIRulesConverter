import * as vscode from 'vscode';
import { RuleScanner } from '../core/RuleScanner';
import { Rule, IDE } from '../core/RuleModel';
import * as path from 'path';

export class RulesTreeDataProvider implements vscode.TreeDataProvider<RuleTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RuleTreeItem | undefined | null | void> = new vscode.EventEmitter<RuleTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RuleTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private scanner: RuleScanner;
    private rules: Rule[] = [];

    constructor() {
        this.scanner = new RuleScanner();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: RuleTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: RuleTreeItem): Promise<RuleTreeItem[]> {
        if (!element) {
            // Root level: Group by IDE
            this.rules = await this.scanner.scanWorkspace();
            const ides: IDE[] = ['cursor', 'windsurf', 'kiro', 'antigravity'];
            return ides.map(ide => new RuleTreeItem(ide, vscode.TreeItemCollapsibleState.Collapsed, 'ide'));
        } else if (element.type === 'ide') {
            // Second level: Categories or Rules directly?
            // Let's group by category if available, otherwise list rules
            const ideRules = this.rules.filter(r => r.ide === element.label);

            // Check if we have multiple categories
            const categories = new Set(ideRules.map(r => r.category).filter(c => c !== undefined));

            if (categories.size > 1) {
                return Array.from(categories).map(cat =>
                    new RuleTreeItem(cat!, vscode.TreeItemCollapsibleState.Collapsed, 'category', element.label as IDE)
                );
            } else {
                // Just list rules
                return ideRules.map(rule =>
                    new RuleTreeItem(rule.name, vscode.TreeItemCollapsibleState.None, 'rule', rule.ide, rule)
                );
            }
        } else if (element.type === 'category') {
            // Third level: Rules within a category
            const categoryRules = this.rules.filter(r => r.ide === element.ide && r.category === element.label);
            return categoryRules.map(rule =>
                new RuleTreeItem(rule.name, vscode.TreeItemCollapsibleState.None, 'rule', rule.ide, rule)
            );
        }

        return [];
    }
}

export class RuleTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'ide' | 'category' | 'rule',
        public readonly ide?: IDE,
        public readonly rule?: Rule
    ) {
        super(label, collapsibleState);
        this.tooltip = this.label;

        if (type === 'rule') {
            this.command = {
                command: 'rulesConverter.openRule',
                title: 'Open Rule',
                arguments: [this.rule]
            };
            this.contextValue = 'rule';
            this.iconPath = new vscode.ThemeIcon('file-code');
        } else if (type === 'ide') {
            this.contextValue = 'ide';
            // You could add custom icons for each IDE here
            this.iconPath = new vscode.ThemeIcon('folder');
        } else {
            this.contextValue = 'category';
            this.iconPath = new vscode.ThemeIcon('symbol-folder');
        }
    }
}
