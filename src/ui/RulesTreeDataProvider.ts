import * as vscode from 'vscode';
import { RuleScanner } from '../core/RuleScanner';
import { SkillScanner } from '../core/SkillScanner';
import { McpScanner } from '../core/McpScanner';
import { HooksScanner } from '../core/HooksScanner';
import { Rule, IDE } from '../core/RuleModel';
import { Skill, McpConfig, HooksConfig } from '../core/AgentCapability';
import * as path from 'path';

/** Icon and display name config for each format. */
const IDE_CONFIG: Record<IDE, { icon: string; displayName: string }> = {
    'cursor':      { icon: 'circle-filled',      displayName: 'Cursor' },
    'windsurf':    { icon: 'zap',               displayName: 'Windsurf' },
    'kiro':        { icon: 'beaker',            displayName: 'Kiro' },
    'antigravity': { icon: 'rocket',            displayName: 'Antigravity (legacy)' },
    'agy':         { icon: 'terminal',          displayName: 'Antigravity CLI (agy)' },
    'claude-code': { icon: 'comment-discussion', displayName: 'Claude Code' },
    'gemini-cli':  { icon: 'sparkle',           displayName: 'Gemini CLI' },
    'copilot':     { icon: 'github',            displayName: 'GitHub Copilot' },
};

const ALL_IDES: IDE[] = [
    'cursor',
    'windsurf',
    'kiro',
    'antigravity',
    'agy',
    'claude-code',
    'gemini-cli',
    'copilot',
];

export class RulesTreeDataProvider implements vscode.TreeDataProvider<RuleTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RuleTreeItem | undefined | null | void> = new vscode.EventEmitter<RuleTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RuleTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private scanner: RuleScanner;
    private skillScanner: SkillScanner;
    private mcpScanner: McpScanner;
    private hooksScanner: HooksScanner;

    private rules: Rule[] = [];
    private skills: Skill[] = [];
    private mcps: McpConfig[] = [];
    private hooks: HooksConfig[] = [];

    constructor() {
        this.scanner = new RuleScanner();
        this.skillScanner = new SkillScanner();
        this.mcpScanner = new McpScanner();
        this.hooksScanner = new HooksScanner();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public getRules(): Rule[] {
        return this.rules;
    }

    public getSkills(): Skill[] {
        return this.skills;
    }

    public getMcps(): McpConfig[] {
        return this.mcps;
    }

    public getHooks(): HooksConfig[] {
        return this.hooks;
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

            // Handle Kiro specs specially
            if (ide === 'kiro' && category === 'specs' && currentPath === '' && relativeName.includes('/')) {
                const firstSlashIndex = relativeName.indexOf('/');
                const topLevelFolderName = relativeName.substring(0, firstSlashIndex);
                if (ruleCurrentPath !== topLevelFolderName) {
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
                    return;
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
                newPath
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
            if (a.type === 'virtual-folder' && b.type !== 'virtual-folder') return -1;
            if (a.type !== 'virtual-folder' && b.type === 'virtual-folder') return 1;
            return a.label.localeCompare(b.label);
        });
    }

    async getChildren(element?: RuleTreeItem): Promise<RuleTreeItem[]> {
        if (!element) {
            // Root level: Group by IDE — only show IDEs that have at least one capability
            this.rules = await this.scanner.scanWorkspace();
            this.skills = await this.skillScanner.scanWorkspace();
            this.mcps = await this.mcpScanner.scanWorkspace();
            this.hooks = await this.hooksScanner.scanWorkspace();

            const detectedIdes = new Set([
                ...this.rules.map(r => r.ide),
                ...this.skills.map(s => s.ide),
                ...this.mcps.map(m => m.ide),
                ...this.hooks.map(h => h.ide),
            ]);

            return ALL_IDES
                .filter(ide => detectedIdes.has(ide))
                .map(ide => {
                    const config = IDE_CONFIG[ide];
                    return new RuleTreeItem(
                        config.displayName,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'ide',
                        ide
                    );
                });
        } else if (element.type === 'ide') {
            // Second level: Capability Domains (Rules, Skills, MCP Servers, Event Hooks)
            const nodes: RuleTreeItem[] = [];
            const ide = element.ide as IDE;

            const ideRules = this.rules.filter(r => r.ide === ide);
            if (ideRules.length > 0) {
                nodes.push(new RuleTreeItem('Rules', vscode.TreeItemCollapsibleState.Collapsed, 'capability-group', ide));
            }

            const ideSkills = this.skills.filter(s => s.ide === ide);
            if (ideSkills.length > 0) {
                nodes.push(new RuleTreeItem('Skills', vscode.TreeItemCollapsibleState.Collapsed, 'capability-group', ide));
            }

            const ideMcp = this.mcps.find(m => m.ide === ide);
            if (ideMcp) {
                nodes.push(new RuleTreeItem('MCP Servers', vscode.TreeItemCollapsibleState.Collapsed, 'capability-group', ide));
            }

            const ideHooks = this.hooks.find(h => h.ide === ide);
            if (ideHooks) {
                nodes.push(new RuleTreeItem('Event Hooks', vscode.TreeItemCollapsibleState.Collapsed, 'capability-group', ide));
            }

            return nodes;
        } else if (element.type === 'capability-group') {
            const ide = element.ide as IDE;
            const groupName = element.label;

            if (groupName === 'Rules') {
                const ideRules = this.rules.filter(r => r.ide === ide);
                const categories = new Set(ideRules.map(r => r.category).filter(c => c !== undefined));

                if (categories.size > 1) {
                    return Array.from(categories).map(cat =>
                        new RuleTreeItem(cat!, vscode.TreeItemCollapsibleState.Collapsed, 'category', ide)
                    );
                } else {
                    return this.getNodesForRules(ideRules, '', ide);
                }
            } else if (groupName === 'Skills') {
                const ideSkills = this.skills.filter(s => s.ide === ide);
                return ideSkills.map(skill => {
                    const item = new RuleTreeItem(
                        skill.name,
                        vscode.TreeItemCollapsibleState.None,
                        'skill',
                        ide,
                        { filePath: skill.skillFilePath } as any
                    );
                    item.description = skill.description;
                    item.skill = skill;
                    return item;
                });
            } else if (groupName === 'MCP Servers') {
                const ideMcp = this.mcps.find(m => m.ide === ide);
                if (ideMcp) {
                    return Object.keys(ideMcp.servers).map(serverName => {
                        const server = ideMcp.servers[serverName] as any;
                        const typeLabel = server.command ? 'stdio' : (server.url || server.serverUrl ? 'remote' : 'mcp');
                        const item = new RuleTreeItem(
                            serverName,
                            vscode.TreeItemCollapsibleState.None,
                            'mcp',
                            ide,
                            { filePath: ideMcp.filePath } as any
                        );
                        item.description = `(${typeLabel})`;
                        item.mcpServer = {
                            name: serverName,
                            config: server,
                            filePath: ideMcp.filePath
                        };
                        return item;
                    });
                }
            } else if (groupName === 'Event Hooks') {
                const ideHooks = this.hooks.find(h => h.ide === ide);
                if (ideHooks) {
                    return Object.keys(ideHooks.events).map(eventName => {
                        const entries = ideHooks.events[eventName as any] || [];
                        const item = new RuleTreeItem(
                            eventName,
                            vscode.TreeItemCollapsibleState.None,
                            'hook',
                            ide,
                            { filePath: ideHooks.filePath } as any
                        );
                        item.description = `${entries.length} hook(s)`;
                        return item;
                    });
                }
            }
        } else if (element.type === 'category') {
            const categoryRules = this.rules.filter(r => r.ide === element.ide && r.category === element.label);
            return this.getNodesForRules(categoryRules, '', element.ide, element.label);
        } else if (element.type === 'virtual-folder') {
            const ide = element.ide;
            const category = element.rule?.category;
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
    public skill?: Skill;
    public mcpServer?: { name: string; config: McpServer; filePath: string };

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'ide' | 'capability-group' | 'category' | 'rule' | 'virtual-folder' | 'skill' | 'mcp' | 'hook',
        public readonly ide?: IDE,
        public readonly rule?: Rule,
        public readonly parentLabel: string = ''
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
        } else if (type === 'skill') {
            this.command = {
                command: 'rulesConverter.openRule',
                title: 'Open Skill File',
                arguments: [this.rule]
            };
            this.contextValue = 'skill';
            this.iconPath = new vscode.ThemeIcon('extensions');
        } else if (type === 'mcp') {
            this.command = {
                command: 'rulesConverter.openRule',
                title: 'Open MCP Config',
                arguments: [this.rule]
            };
            this.contextValue = 'mcp';
            this.iconPath = new vscode.ThemeIcon('server');
        } else if (type === 'hook') {
            this.command = {
                command: 'rulesConverter.openRule',
                title: 'Open Hooks Config',
                arguments: [this.rule]
            };
            this.contextValue = 'hook';
            this.iconPath = new vscode.ThemeIcon('pulse');
        } else if (type === 'ide') {
            this.contextValue = 'ide';
            const config = ide ? IDE_CONFIG[ide] : null;
            this.iconPath = new vscode.ThemeIcon(config?.icon ?? 'folder');
            if (ide && config) {
                this.description = `(${ide})`;
            }
        } else if (type === 'capability-group') {
            this.contextValue = 'capability-group';
            if (label === 'Rules') this.iconPath = new vscode.ThemeIcon('checklist');
            else if (label === 'Skills') this.iconPath = new vscode.ThemeIcon('tools');
            else if (label === 'MCP Servers') this.iconPath = new vscode.ThemeIcon('plug');
            else if (label === 'Event Hooks') this.iconPath = new vscode.ThemeIcon('magnet');
        } else if (type === 'category') {
            this.contextValue = 'category';
            this.iconPath = new vscode.ThemeIcon('symbol-folder');
        } else if (type === 'virtual-folder') {
            this.contextValue = 'virtual-folder';
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}
