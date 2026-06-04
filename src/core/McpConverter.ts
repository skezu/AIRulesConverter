/**
 * McpConverter.ts
 *
 * Converts MCP configurations between different formats, translating remote URLs
 * and merging server definitions into target files.
 */

import * as path from 'path';
import * as fs from 'fs';
import { McpConfig, McpServer } from './AgentCapability';
import { IDE } from './RuleModel';
import { getGlobalMcpConfigPath } from './GlobalPathResolver';

export interface McpConversionResult {
    targetIde: IDE;
    filePath: string;
    /** Converted servers dictionary */
    servers: Record<string, McpServer>;
}

export class McpConverter {
    constructor() {}

    /**
     * Convert MCP configuration to target format.
     */
    public convertConfig(
        config: McpConfig,
        targetIde: IDE,
        rootPath: string,
        scope: 'project' | 'global' = 'project'
    ): McpConversionResult {
        const filePath = this.getTargetFilePath(targetIde, rootPath, scope);
        const convertedServers: Record<string, McpServer> = {};

        for (const [name, server] of Object.entries(config.servers)) {
            convertedServers[name] = this.convertServer(server, targetIde);
        }

        return {
            targetIde,
            filePath,
            servers: convertedServers,
        };
    }

    /**
     * Execute the conversion (read target, merge, write target).
     */
    public executeConversion(result: McpConversionResult): string {
        const { targetIde, filePath, servers } = result;

        // Ensure parent directory exists
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        let existingContent: any = {};
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                existingContent = JSON.parse(raw) || {};
            } catch (e) {
                console.warn(`[McpConverter] Could not parse existing config at ${filePath}, overwriting.`, e);
            }
        }

        // Merge servers
        if (targetIde === 'gemini-cli') {
            // Embedded inside settings.json
            const existingServers = existingContent.mcpServers || {};
            existingContent.mcpServers = {
                ...existingServers,
                ...servers,
            };
        } else {
            // Separate config wrapper { "mcpServers": { ... } }
            const existingServers = existingContent.mcpServers || {};
            existingContent.mcpServers = {
                ...existingServers,
                ...servers,
            };
        }

        fs.writeFileSync(filePath, JSON.stringify(existingContent, null, 2) + '\n', 'utf-8');
        return filePath;
    }

    private convertServer(server: McpServer, targetIde: IDE): McpServer {
        const converted = { ...server } as any;

        // Canonicalise Gemini's HTTP field (`httpUrl`) back to `url` first, so the
        // remote-URL field rewrites below operate on a single source of truth.
        if ('httpUrl' in converted && !('url' in converted)) {
            converted.url = converted.httpUrl;
            delete converted.httpUrl;
        }

        // Antigravity, agy AND Windsurf use 'serverUrl' instead of 'url' for remote servers.
        // (Windsurf docs: remote MCP servers are declared with `serverUrl`/`headers`.)
        const usesServerUrl =
            targetIde === 'agy' || targetIde === 'antigravity' || targetIde === 'windsurf';

        if (usesServerUrl) {
            if ('url' in converted && !('serverUrl' in converted)) {
                converted.serverUrl = converted.url;
                delete converted.url;
            }
        } else {
            if ('serverUrl' in converted && !('url' in converted)) {
                converted.url = converted.serverUrl;
                delete converted.serverUrl;
            }
        }

        // Gemini CLI distinguishes HTTP/streamable servers (`httpUrl`) from SSE (`url`).
        // Map remote HTTP servers onto `httpUrl`; SSE/unknown remotes keep `url`.
        if (targetIde === 'gemini-cli') {
            const type = String(converted.type ?? '').toLowerCase();
            const isHttp = type === 'http' || type === 'streamable-http';
            if (isHttp && 'url' in converted && !('httpUrl' in converted)) {
                converted.httpUrl = converted.url;
                delete converted.url;
            }
        }

        return converted as McpServer;
    }

    private getTargetFilePath(targetIde: IDE, rootPath: string, scope: 'project' | 'global' = 'project'): string {
        if (scope === 'global') {
            const globalPath = getGlobalMcpConfigPath(targetIde);
            if (globalPath) {
                return globalPath;
            }
            throw new Error(`MCP global configuration is not supported for target: ${targetIde}`);
        }
        switch (targetIde) {
            case 'agy':
                // Preferred plural workspace path; the singular '.agent/' is deprecated.
                return path.join(rootPath, '.agents', 'mcp_config.json');
            case 'antigravity':
                return path.join(rootPath, '.agents', 'mcp_config.json');
            case 'claude-code':
                return path.join(rootPath, '.mcp.json');
            case 'cursor':
                return path.join(rootPath, '.cursor', 'mcp.json');
            case 'windsurf':
                return path.join(rootPath, '.windsurf', 'mcp_config.json');
            case 'gemini-cli':
                return path.join(rootPath, '.gemini', 'settings.json');
            default:
                throw new Error(`MCP configuration is not supported for target: ${targetIde}`);
        }
    }
}
