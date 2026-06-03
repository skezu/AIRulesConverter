/**
 * AgentCapability.ts
 *
 * Data models for agentic capabilities beyond rules:
 *   - Skills (structured instruction packages)
 *   - MCP server configurations
 *   - Hook configurations
 */

import { IDE } from './RuleModel';

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export interface SkillMetadata {
    name?: string;
    description?: string;
    license?: string;
    version?: string;
    author?: string;
    [key: string]: any;
}

export interface Skill {
    id: string;
    /** Folder name (e.g. 'code-review') */
    folderName: string;
    /** Display name from metadata or folder name */
    name: string;
    description?: string;
    /** IDE/tool this skill was scanned from */
    ide: IDE;
    /** Category: 'workspace' | 'plugin' */
    category: 'workspace' | 'plugin';
    /** Absolute path to the SKILL.md file */
    skillFilePath: string;
    /** Absolute path to the skill folder */
    folderPath: string;
    /** Full content of SKILL.md (raw) */
    rawContent: string;
    /** Content of SKILL.md without frontmatter */
    content: string;
    /** Parsed frontmatter */
    metadata: SkillMetadata;
    /** True if discovered via symlink */
    isSymlinked?: boolean;
    realPath?: string;
    /** Additional files in the skill folder (e.g. assets, sub-prompts) */
    additionalFiles?: string[];
}

// ---------------------------------------------------------------------------
// MCP Servers
// ---------------------------------------------------------------------------

export interface McpServerLocal {
    type?: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
    [key: string]: any;
}

export interface McpServerRemote {
    /** Used by Claude Code, Cursor, Windsurf, Gemini CLI */
    url?: string;
    /** Used by Antigravity / agy for remote servers */
    serverUrl?: string;
    type?: 'sse' | 'streamable-http' | 'http';
    headers?: Record<string, string>;
    [key: string]: any;
}

export type McpServer = McpServerLocal | McpServerRemote;

export interface McpConfig {
    ide: IDE;
    /** Absolute path to the config file */
    filePath: string;
    /** Raw servers map: server name → server config */
    servers: Record<string, McpServer>;
    /** Whether to apply globally (user-level) or project-level */
    scope: 'project' | 'global';
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface HookCommand {
    type: 'command' | 'http' | 'mcp_tool' | 'prompt' | 'agent';
    command?: string;
    url?: string;
    /** Script or shell command */
    show_output?: boolean;
    timeout?: number;
    [key: string]: any;
}

export interface HookEntry {
    /** Tool name matcher — e.g. "Bash", "Write|Edit", "*" */
    matcher?: string;
    hooks: HookCommand[];
    /** Enabled flag — defaults to true */
    enabled?: boolean;
}

/**
 * Normalised hook event names (mapped from tool-specific names during conversion).
 * These match Claude Code's naming convention as the canonical form.
 */
export type HookEvent =
    | 'PreToolUse'
    | 'PostToolUse'
    | 'SessionStart'
    | 'Stop'
    | 'Notification'
    | 'PermissionRequest'
    | 'UserPromptSubmit';

export interface HooksConfig {
    ide: IDE;
    /** Absolute path to the hooks config file */
    filePath: string;
    scope: 'project' | 'global';
    /**
     * Normalised hook events. Each event maps to an array of HookEntries.
     * For Windsurf, internal events are mapped to canonical names.
     */
    events: Partial<Record<HookEvent, HookEntry[]>>;
    /**
     * Raw content preserved for formats that wrap hooks in a named group
     * (Antigravity / agy) — the group name is stored here.
     */
    groupName?: string;
}

// ---------------------------------------------------------------------------
// Claude Plugins
// ---------------------------------------------------------------------------

export interface PluginHookCommand {
    type: string;
    command?: string;
    timeout?: number;
    statusMessage?: string;
    [key: string]: any;
}

export interface PluginHookEntry {
    hooks: PluginHookCommand[];
    matcher?: string;
}

export interface ClaudePlugin {
    /** Plugin identifier (directory name under marketplaces/) */
    name: string;
    description: string;
    author?: { name: string; url?: string };
    /** Absolute path to the plugin root folder */
    pluginDir: string;
    /** Absolute path to .claude-plugin/plugin.json */
    manifestPath: string;
    /** Skills found inside the plugin dir */
    skills: Skill[];
    /** Hooks from plugin.json "hooks" key, keyed by HookEvent */
    hooks: Partial<Record<HookEvent, PluginHookEntry[]>>;
    /** Raw plugin.json content */
    rawManifest: Record<string, any>;
}
