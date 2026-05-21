/**
 * McpScanner.ts
 *
 * Scans the workspace for MCP (Model Context Protocol) configurations in all supported formats.
 */

import * as path from 'path';
import * as fs from 'fs';
import { McpConfig, McpServer } from './AgentCapability';
import { IDE } from './RuleModel';

export class McpScanner {
    constructor() {}

    /**
     * Scan workspace folders using VS Code APIs (if in extension context)
     */
    public async scanWorkspace(): Promise<McpConfig[]> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vscode = require('vscode');
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const configs: McpConfig[] = [];
        for (const folder of workspaceFolders) {
            const rootPath = folder.uri.fsPath;
            configs.push(...(await this.scanDirectory(rootPath)));
        }
        return configs;
    }

    /**
     * Scan a specific directory (CLI & core compatible)
     */
    public async scanDirectory(rootPath: string): Promise<McpConfig[]> {
        const configs: McpConfig[] = [];

        // Define search targets
        const targets: { ide: IDE; relativePath: string; extractKey?: string }[] = [
            { ide: 'agy', relativePath: path.join('.agents', 'mcp_config.json') },
            { ide: 'antigravity', relativePath: path.join('.agent', 'mcp_config.json') },
            { ide: 'claude-code', relativePath: '.mcp.json' },
            { ide: 'cursor', relativePath: path.join('.cursor', 'mcp.json') },
            { ide: 'windsurf', relativePath: path.join('.windsurf', 'mcp_config.json') },
            { ide: 'gemini-cli', relativePath: path.join('.gemini', 'settings.json'), extractKey: 'mcpServers' },
        ];

        for (const target of targets) {
            const filePath = path.join(rootPath, target.relativePath);
            if (fs.existsSync(filePath)) {
                try {
                    const raw = fs.readFileSync(filePath, 'utf-8');
                    const parsed = this.parseJsonOrJsonc(raw);
                    let servers: Record<string, McpServer> = {};

                    if (target.extractKey) {
                        // Extract from key (e.g., Gemini settings.json)
                        if (parsed && typeof parsed === 'object' && parsed[target.extractKey]) {
                            servers = parsed[target.extractKey];
                        }
                    } else {
                        // Most files wrapper structure: { "mcpServers": { ... } }
                        if (parsed && typeof parsed === 'object') {
                            if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
                                servers = parsed.mcpServers;
                            } else {
                                // Fallback: flat object structure where keys are server names
                                const isFlatServers = Object.values(parsed).every(
                                    val => val && typeof val === 'object' && (('command' in val) || ('url' in val) || ('serverUrl' in val))
                                );
                                if (isFlatServers) {
                                    servers = parsed as Record<string, McpServer>;
                                }
                            }
                        }
                    }

                    if (Object.keys(servers).length > 0) {
                        configs.push({
                            ide: target.ide,
                            filePath,
                            servers,
                            scope: 'project',
                        });
                    }
                } catch (e) {
                    console.error(`[McpScanner] Failed to parse MCP config at ${filePath}`, e);
                }
            }
        }

        return configs;
    }

    // Tolerant parser: handles JSONC (// line comments, /* block comments */, trailing commas).
    // Trailing commas are the most common cause of parse failures in real-world MCP configs.
    private parseJsonOrJsonc(raw: string): unknown {
        try {
            return JSON.parse(raw);
        } catch {
            const stripped = raw
                .replace(/\/\/[^\n]*/g, '')          // // line comments
                .replace(/\/\*[\s\S]*?\*\//g, '')    // /* block comments */
                .replace(/,(\s*[}\]])/g, '$1');      // trailing commas before } or ]
            return JSON.parse(stripped);
        }
    }
}
