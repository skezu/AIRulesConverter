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

    private getNodesForRules(rules: Rule[], currentPath: string, ide?: IDE, category?: string): RuleTreeItem[] {
        const nodes: RuleTreeItem[] = [];
        const directRules = new Map<string, Rule>();
        const subFolders = new Map<string, Rule[]>();

        rules.forEach(rule => {
            let relativeName = rule.name;
            let ruleCurrentPath = currentPath;

            // Handle Kiro specs specially where the category 'specs' implies a top-level folder structure already.
            // The `currentPath` needs to be adjusted based on the `rule.name` to correctly identify direct children.
            if (ide === 'kiro' && category === 'specs' && currentPath === '' && relativeName.includes('/')) {
                const firstSlashIndex = relativeName.indexOf('/');
                const topLevelFolderName = relativeName.substring(0, firstSlashIndex);
                if (ruleCurrentPath !== topLevelFolderName) {
                    // This rule starts with a top-level folder, treat it as a subfolder context
                    if (!subFolders.has(topLevelFolderName)) {
                        subFolders.set(topLevelFolderName, []);
                    }
                    subFolders.get(topLevelFolderName)!.push(rule);
                    return;
                }
            }


            if (ruleCurrentPath) {
                const pathPrefix = ruleCurrentPath.endsWith('/') ? ruleCurrentPath : `${ruleCurrentPath}/`;
                if (relativeName.startsWith(pathPrefix)) {
                    relativeName = relativeName.substring(pathPrefix.length);
                } else {
                    return; // This rule does not belong to the currentPath
                }
            }

            const parts = relativeName.split('/');
            if (parts.length === 1) {
                directRules.set(rule.name, rule);
            } else {
                const folderName = parts[0];
                if (!subFolders.has(folderName)) {
                    subFolders.set(folderName, []);
                }
                subFolders.get(folderName)!.push(rule);
            }
        });

        // Add virtual folders
        for (const [folderName, folderRules] of subFolders.entries()) {
            const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
            nodes.push(new RuleTreeItem(
                folderName,
                vscode.TreeItemCollapsibleState.Collapsed,
                'virtual-folder',
                ide,
                undefined,
                newPath // Store the full path for the virtual folder
            ));
        }

        // Add direct rules
        for (const [ruleName, rule] of directRules.entries()) {
            nodes.push(new RuleTreeItem(
                ruleName.split('/').pop()!,
                vscode.TreeItemCollapsibleState.None,
                'rule',
                ide,
                rule,
                currentPath
            ));
        }

        return nodes.sort((a, b) => {
            if (a.type === 'virtual-folder' && b.type !== 'virtual-folder') {
                return -1;
            }
            if (a.type !== 'virtual-folder' && b.type === 'virtual-folder') {
                return 1;
            }
            return a.label.localeCompare(b.label);
        });
    }

    async getChildren(element?: RuleTreeItem): Promise<RuleTreeItem[]> {
        if (!element) {
            // Root level: Group by IDE
            this.rules = await this.scanner.scanWorkspace();
            const ides: IDE[] = ['cursor', 'windsurf', 'kiro', 'antigravity'];
            return ides.map(ide => new RuleTreeItem(ide, vscode.TreeItemCollapsibleState.Collapsed, 'ide'));
        } else if (element.type === 'ide') {
            // Second level: Categories or Rules directly?
            const ideRules = this.rules.filter(r => r.ide === element.label);
            const categories = new Set(ideRules.map(r => r.category).filter(c => c !== undefined));

            if (categories.size > 1) {
                return Array.from(categories).map(cat =>
                    new RuleTreeItem(cat!, vscode.TreeItemCollapsibleState.Collapsed, 'category', element.label as IDE)
                );
            } else {
                return this.getNodesForRules(ideRules, '', element.label as IDE);
            }
        } else if (element.type === 'category') {
            // Third level: Rules within a category
            const categoryRules = this.rules.filter(r => r.ide === element.ide && r.category === element.label);
            return this.getNodesForRules(categoryRules, '', element.ide, element.label);
        } else if (element.type === 'virtual-folder') {
            const ide = element.ide;
            const category = element.rule?.category; // Virtual folders don't have a rule, so this might be undefined.
            // parentLabel stores the full path for virtual folders
            const fullVirtualFolderPath = element.parentLabel;

            const filteredRules = this.rules.filter(r => {
                const rulePath = r.name.replace(/\\/g, '/');
                return r.ide === ide &&
                    (category ? r.category === category : true) &&
                    rulePath.startsWith(fullVirtualFolderPath + '/');
            });
            return this.getNodesForRules(filteredRules, fullVirtualFolderPath, ide, category);
        }

        return [];
    }
}

export class RuleTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'ide' | 'category' | 'rule' | 'virtual-folder',
        public readonly ide?: IDE,
        public readonly rule?: Rule,
        public readonly parentLabel: string = '' // For virtual folders, to reconstruct full path
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
        } else if (type === 'category') {
            this.contextValue = 'category';
            this.iconPath = new vscode.ThemeIcon('symbol-folder');
        } else if (type === 'virtual-folder') {
            this.contextValue = 'virtual-folder';
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}
