/**
 * PluginInventory.ts
 *
 * A lightweight, unified listing of *installed* plugins across both plugin
 * ecosystems — Claude Code and Antigravity — used by the single unified scan
 * (the `scan` command and the interactive menu) so plugins appear alongside
 * rules / skills / MCP / hooks instead of in a separate command.
 *
 * "Installed" means actually installed/enabled, NOT merely present in a cloned
 * marketplace catalog:
 *   - Claude Code: read ~/.claude/plugins/installed_plugins.json (the ledger)
 *     and resolve each entry's `installPath` (under ~/.claude/plugins/cache/...).
 *   - Antigravity: every dir under ~/.gemini/antigravity-cli/plugins (presence
 *     in that dir == installed; there is no catalog/cache split).
 *
 * Counts (skills/hooks/MCP) come from PluginMigrator's bundle loader, which is
 * cheap (it lists folders and reads small manifests, not every file).
 */

import * as path from 'path';
import * as fs from 'fs';
import { IDE } from './RuleModel';
import { PluginFormat } from './AgentCapability';
import { PluginMigrator } from './PluginMigrator';
import { getAntigravityPluginsDir, getInstalledPluginsFile } from './GlobalPathResolver';

export interface ScannedPlugin {
    name: string;
    description: string;
    author?: string;
    /** Plugin ecosystem this came from. */
    format: PluginFormat;
    /** IDE id the plugin is grouped under in a scan (claude-code / antigravity). */
    ide: IDE;
    /** Absolute path to the installed plugin's directory. */
    sourceDir: string;
    skillsCount: number;
    hookEventsCount: number;
    mcpCount: number;
    /** Install scope (Claude Code): 'user' (global) or 'local' (per-project). */
    scope?: 'user' | 'local';
    /** Project path for a 'local'-scope install. */
    projectPath?: string;
    /** Installed version (or pinned commit). */
    version?: string;
}

export interface PluginInventoryOptions {
    /** Override the Claude installed-plugins ledger path (defaults to the global one). */
    installedPluginsFile?: string;
    /** Override the Antigravity plugins dir (defaults to the global one). */
    antigravityDir?: string;
}

/** One resolved entry from the Claude installed-plugins ledger. */
export interface InstalledClaudePlugin {
    /** Plugin id (the part before '@' in the ledger key). */
    name: string;
    /** Marketplace id (the part after '@'). */
    marketplace: string;
    installPath: string;
    scope?: 'user' | 'local';
    projectPath?: string;
    version?: string;
}

/** List every *installed* plugin across both ecosystems, with capability counts. */
export function scanInstalledPlugins(opts: PluginInventoryOptions = {}): ScannedPlugin[] {
    const migrator = new PluginMigrator();
    const out: ScannedPlugin[] = [];

    // --- Claude Code (installed ledger) ---
    for (const installed of getInstalledClaudePlugins(opts.installedPluginsFile)) {
        try {
            const bundle = migrator.loadBundle('claude-code', installed.installPath);
            const s = toScanned(bundle, 'claude-code', 'claude-code');
            s.scope = installed.scope;
            s.projectPath = installed.projectPath;
            s.version = installed.version;
            // Prefer the ledger's plugin id when the manifest omits a name.
            if (!bundle.name) { s.name = installed.name; }
            out.push(s);
        } catch { /* skip unreadable install */ }
    }

    // --- Antigravity (presence in the plugins dir == installed) ---
    const agDir = opts.antigravityDir ?? getAntigravityPluginsDir();
    for (const dir of antigravityPluginDirs(agDir)) {
        try {
            out.push(toScanned(migrator.loadBundle('antigravity', dir), 'antigravity', 'antigravity'));
        } catch { /* skip unparseable plugin */ }
    }

    return out;
}

/**
 * Parse the Claude installed-plugins ledger and resolve each plugin to a single
 * representative install (preferring user/global scope), keeping only those whose
 * install directory actually exists on disk.
 */
export function getInstalledClaudePlugins(installedPluginsFile?: string): InstalledClaudePlugin[] {
    const file = installedPluginsFile ?? getInstalledPluginsFile();
    if (!fs.existsSync(file)) { return []; }

    let parsed: any;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return [];
    }
    const plugins = parsed?.plugins;
    if (!plugins || typeof plugins !== 'object') { return []; }

    const result: InstalledClaudePlugin[] = [];
    for (const [key, recordsRaw] of Object.entries(plugins)) {
        const records = Array.isArray(recordsRaw) ? recordsRaw : [recordsRaw];
        if (records.length === 0) { continue; }

        // Prefer a user-scope (global) install; otherwise take the first record.
        const record = (records.find((r: any) => r?.scope === 'user') ?? records[0]) as any;
        const installPath = record?.installPath;
        if (typeof installPath !== 'string' || !fs.existsSync(installPath)) { continue; }

        const atIdx = key.lastIndexOf('@');
        const name = atIdx > 0 ? key.slice(0, atIdx) : key;
        const marketplace = atIdx > 0 ? key.slice(atIdx + 1) : '';

        result.push({
            name,
            marketplace,
            installPath,
            scope: record?.scope,
            projectPath: record?.projectPath,
            version: record?.version,
        });
    }
    return result;
}

function toScanned(
    bundle: ReturnType<PluginMigrator['loadBundle']>,
    format: PluginFormat,
    ide: IDE,
): ScannedPlugin {
    return {
        name: bundle.name,
        description: bundle.description,
        author: bundle.author?.name,
        format,
        ide,
        sourceDir: bundle.sourceDir,
        skillsCount: bundle.skillDirs.length,
        hookEventsCount: Object.keys(bundle.hooks).length,
        mcpCount: Object.keys(bundle.mcpServers).length,
    };
}

/** Direct child dirs of the Antigravity plugins dir that contain a plugin.json. */
function antigravityPluginDirs(dir: string): string[] {
    if (!fs.existsSync(dir)) { return []; }
    const dirs: string[] = [];
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { return []; }
    for (const entry of entries) {
        const pluginDir = path.join(dir, entry);
        try {
            if (!fs.statSync(pluginDir).isDirectory()) { continue; }
        } catch { continue; }
        if (fs.existsSync(path.join(pluginDir, 'plugin.json'))) { dirs.push(pluginDir); }
    }
    return dirs;
}
