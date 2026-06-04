/**
 * PluginMigrator.ts
 *
 * Bidirectional plugin-bundle conversion between Claude Code and Antigravity.
 *
 * Source layouts
 * --------------
 * Claude Code plugin (under ~/.claude/plugins/marketplaces/<name>/):
 *   .claude-plugin/plugin.json   manifest (name, description, author, inline "hooks")
 *   skills/<skill>/SKILL.md       (or <skill>/SKILL.md at the plugin root)
 *   agents/*.md                   optional
 *   rules/*.md                    optional
 *   .mcp.json                     optional (or "mcpServers" key in plugin.json)
 *   hooks/, scripts/, commands/   optional support dirs referenced by hooks
 *
 * Antigravity plugin (under ~/.gemini/antigravity-cli/plugins/<name>/):
 *   plugin.json                   manifest (name, description, author)
 *   mcp_config.json               optional MCP servers
 *   hooks.json                    optional event hooks (grouped format)
 *   skills/<skill>/SKILL.md       optional
 *   agents/*.md                   optional
 *   rules/*.md                    optional
 *
 * The conversion is mostly structural: relocate the manifest, split/merge hooks
 * (inline vs hooks.json), rename the MCP config, and copy skills/agents/rules
 * verbatim (SKILL.md + markdown are compatible across the two ecosystems).
 */

import * as path from 'path';
import * as fs from 'fs';
import {
    PluginBundle,
    PluginFormat,
    HookEvent,
    HookEntry,
    McpServer,
} from './AgentCapability';
import {
    getPluginsDir,
    getAntigravityPluginsDir,
} from './GlobalPathResolver';

export interface PluginMigrationReport {
    pluginName: string;
    fromFormat: PluginFormat;
    toFormat: PluginFormat;
    outputDir: string;
    skillsConverted: number;
    agentsConverted: number;
    rulesConverted: number;
    mcpServersConverted: number;
    hookEventsConverted: number;
    writtenPaths: string[];
    warnings: string[];
    errors: string[];
    /** Plan-only (no files written) when true. */
    dryRun: boolean;
}

const KNOWN_HOOK_EVENTS: HookEvent[] = [
    'PreToolUse', 'PostToolUse', 'SessionStart', 'Stop',
    'Notification', 'PermissionRequest', 'UserPromptSubmit',
];

export class PluginMigrator {
    /** Normalise an IDE id to the plugin format family. agy and antigravity share the Antigravity CLI. */
    public static toPluginFormat(ide: string): PluginFormat | null {
        if (ide === 'claude-code') { return 'claude-code'; }
        if (ide === 'antigravity' || ide === 'agy') { return 'antigravity'; }
        return null;
    }

    /** Default global output directory for a converted bundle of the given target format. */
    public static defaultOutputDir(target: PluginFormat, pluginName: string): string {
        return target === 'claude-code'
            ? path.join(getPluginsDir(), pluginName)            // ~/.claude/plugins/marketplaces/<name>
            : path.join(getAntigravityPluginsDir(), pluginName); // ~/.gemini/antigravity-cli/plugins/<name>
    }

    // -----------------------------------------------------------------------
    // Locating source plugins
    // -----------------------------------------------------------------------

    /**
     * Resolve the source plugin directory for a given format + name.
     * For claude-code, searches the marketplaces tree for a matching plugin.
     * Returns null if not found.
     */
    public findSourceDir(format: PluginFormat, pluginName: string, searchRoot?: string): string | null {
        if (format === 'antigravity') {
            const dir = path.join(searchRoot ?? getAntigravityPluginsDir(), pluginName);
            return this.isAntigravityPluginDir(dir) ? dir : null;
        }
        // claude-code: a marketplace contains one or more plugin dirs with .claude-plugin/plugin.json
        const root = searchRoot ?? getPluginsDir();
        if (!fs.existsSync(root)) { return null; }

        // Direct match: <root>/<name>/.claude-plugin/plugin.json
        const direct = path.join(root, pluginName);
        if (this.isClaudePluginDir(direct)) { return direct; }

        // Otherwise walk marketplaces for a plugin whose manifest name matches.
        for (const entry of this.safeReaddir(root)) {
            const marketplaceDir = path.join(root, entry);
            if (!this.isDir(marketplaceDir)) { continue; }

            // Marketplace root may itself be a plugin.
            if (this.isClaudePluginDir(marketplaceDir) && this.readManifestName(path.join(marketplaceDir, '.claude-plugin', 'plugin.json')) === pluginName) {
                return marketplaceDir;
            }
            // Plugins nested one level under the marketplace.
            for (const sub of this.safeReaddir(marketplaceDir)) {
                const pluginDir = path.join(marketplaceDir, sub);
                if (this.isClaudePluginDir(pluginDir)) {
                    const name = this.readManifestName(path.join(pluginDir, '.claude-plugin', 'plugin.json')) ?? sub;
                    if (name === pluginName || sub === pluginName) { return pluginDir; }
                }
            }
        }
        return null;
    }

    private isClaudePluginDir(dir: string): boolean {
        return fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'));
    }

    private isAntigravityPluginDir(dir: string): boolean {
        return fs.existsSync(path.join(dir, 'plugin.json'));
    }

    // -----------------------------------------------------------------------
    // Loading -> PluginBundle
    // -----------------------------------------------------------------------

    public loadBundle(format: PluginFormat, sourceDir: string): PluginBundle {
        return format === 'claude-code'
            ? this.loadClaudePlugin(sourceDir)
            : this.loadAntigravityPlugin(sourceDir);
    }

    private loadClaudePlugin(dir: string): PluginBundle {
        const manifestPath = path.join(dir, '.claude-plugin', 'plugin.json');
        const manifest = this.readJson(manifestPath) ?? {};

        // Hooks live inline in the manifest. Their shape already matches HookEntry.
        const hooks = this.normaliseEvents(manifest.hooks ?? {});

        // MCP: prefer .mcp.json, fall back to a manifest "mcpServers" key.
        let mcpServers: Record<string, McpServer> = {};
        const dotMcp = this.readJson(path.join(dir, '.mcp.json'));
        if (dotMcp && typeof dotMcp === 'object' && dotMcp.mcpServers) {
            mcpServers = dotMcp.mcpServers;
        } else if (manifest.mcpServers && typeof manifest.mcpServers === 'object') {
            mcpServers = manifest.mcpServers;
        }

        // Skills: either <dir>/skills/<skill>/SKILL.md or <dir>/<skill>/SKILL.md at the root.
        const skillDirs = this.collectSkillDirs(dir);

        return {
            name: manifest.name ?? path.basename(dir),
            description: manifest.description ?? '',
            author: manifest.author,
            sourceFormat: 'claude-code',
            sourceDir: dir,
            rawManifest: manifest,
            hooks,
            mcpServers,
            skillDirs,
            agentsDir: this.dirIfExists(path.join(dir, 'agents')),
            rulesDir: this.dirIfExists(path.join(dir, 'rules')),
            supportDirs: ['hooks', 'scripts', 'commands']
                .map(d => path.join(dir, d))
                .filter(p => this.isDir(p)),
        };
    }

    private loadAntigravityPlugin(dir: string): PluginBundle {
        const manifest = this.readJson(path.join(dir, 'plugin.json')) ?? {};

        // Hooks: grouped format { "<group>": { "EventName": [...] } } in hooks.json.
        const hooks = this.parseGroupedHooks(this.readJson(path.join(dir, 'hooks.json')));

        // MCP: mcp_config.json with a mcpServers key or a flat server map.
        const mcpServers = this.parseMcpServers(this.readJson(path.join(dir, 'mcp_config.json')));

        const skillDirs = this.collectSkillDirs(dir);

        return {
            name: manifest.name ?? path.basename(dir),
            description: manifest.description ?? '',
            author: manifest.author,
            sourceFormat: 'antigravity',
            sourceDir: dir,
            rawManifest: manifest,
            hooks,
            mcpServers,
            skillDirs,
            agentsDir: this.dirIfExists(path.join(dir, 'agents')),
            rulesDir: this.dirIfExists(path.join(dir, 'rules')),
            supportDirs: ['hooks', 'scripts']
                .map(d => path.join(dir, d))
                .filter(p => this.isDir(p)),
        };
    }

    // -----------------------------------------------------------------------
    // Writing PluginBundle -> target format
    // -----------------------------------------------------------------------

    public migrate(
        bundle: PluginBundle,
        target: PluginFormat,
        outDir: string,
        opts: { dryRun?: boolean } = {}
    ): PluginMigrationReport {
        const report: PluginMigrationReport = {
            pluginName: bundle.name,
            fromFormat: bundle.sourceFormat,
            toFormat: target,
            outputDir: outDir,
            skillsConverted: 0,
            agentsConverted: 0,
            rulesConverted: 0,
            mcpServersConverted: 0,
            hookEventsConverted: 0,
            writtenPaths: [],
            warnings: [],
            errors: [],
            dryRun: Boolean(opts.dryRun),
        };

        if (bundle.sourceFormat === target) {
            report.errors.push(`Source and target format are both '${target}' — nothing to convert.`);
            return report;
        }

        // Warn about hook variable portability — scripts are copied alongside, but
        // the runtime root variable name differs between ecosystems.
        if (Object.keys(bundle.hooks).length > 0 && this.hooksReferencePluginRoot(bundle)) {
            report.warnings.push(
                'Hook commands reference ${CLAUDE_PLUGIN_ROOT}; support scripts were copied into the bundle, ' +
                'but verify the target CLI exposes an equivalent plugin-root variable.'
            );
        }

        if (target === 'claude-code') {
            this.writeClaudePlugin(bundle, outDir, report);
        } else {
            this.writeAntigravityPlugin(bundle, outDir, report);
        }

        report.writtenPaths = Array.from(new Set(report.writtenPaths));
        return report;
    }

    private writeClaudePlugin(bundle: PluginBundle, outDir: string, report: PluginMigrationReport): void {
        const manifest: Record<string, any> = {
            name: bundle.name,
            description: bundle.description,
        };
        if (bundle.author) { manifest.author = bundle.author; }
        // Claude Code keeps hooks inline in the manifest.
        if (Object.keys(bundle.hooks).length > 0) {
            manifest.hooks = bundle.hooks;
            report.hookEventsConverted = Object.keys(bundle.hooks).length;
        }

        const manifestPath = path.join(outDir, '.claude-plugin', 'plugin.json');
        this.writeJson(manifestPath, manifest, report);

        // MCP -> .mcp.json
        if (Object.keys(bundle.mcpServers).length > 0) {
            this.writeJson(path.join(outDir, '.mcp.json'), { mcpServers: bundle.mcpServers }, report);
            report.mcpServersConverted = Object.keys(bundle.mcpServers).length;
        }

        this.copyContent(bundle, outDir, report);
    }

    private writeAntigravityPlugin(bundle: PluginBundle, outDir: string, report: PluginMigrationReport): void {
        const manifest: Record<string, any> = {
            name: bundle.name,
            description: bundle.description,
        };
        if (bundle.author) { manifest.author = bundle.author; }
        // Antigravity keeps the manifest hook-free; hooks go to hooks.json.
        this.writeJson(path.join(outDir, 'plugin.json'), manifest, report);

        // Hooks -> hooks.json (grouped under the plugin name)
        if (Object.keys(bundle.hooks).length > 0) {
            const grouped = { [`${bundle.name}-hooks`]: bundle.hooks };
            this.writeJson(path.join(outDir, 'hooks.json'), grouped, report);
            report.hookEventsConverted = Object.keys(bundle.hooks).length;
        }

        // MCP -> mcp_config.json
        if (Object.keys(bundle.mcpServers).length > 0) {
            this.writeJson(path.join(outDir, 'mcp_config.json'), { mcpServers: bundle.mcpServers }, report);
            report.mcpServersConverted = Object.keys(bundle.mcpServers).length;
        }

        this.copyContent(bundle, outDir, report);
    }

    /** Copy skills/agents/rules/support dirs that are identical across both formats. */
    private copyContent(bundle: PluginBundle, outDir: string, report: PluginMigrationReport): void {
        // Skills -> <out>/skills/<basename>/
        for (const skillDir of bundle.skillDirs) {
            const dest = path.join(outDir, 'skills', path.basename(skillDir));
            try {
                if (!report.dryRun) { this.copyDir(skillDir, dest); }
                report.skillsConverted++;
                report.writtenPaths.push(dest);
            } catch (e: any) {
                report.errors.push(`Skill '${path.basename(skillDir)}': ${e?.message ?? e}`);
            }
        }

        // Agents -> <out>/agents/
        if (bundle.agentsDir) {
            const dest = path.join(outDir, 'agents');
            try {
                if (!report.dryRun) { this.copyDir(bundle.agentsDir, dest); }
                report.agentsConverted += this.countFiles(bundle.agentsDir, '.md');
                report.writtenPaths.push(dest);
            } catch (e: any) {
                report.errors.push(`Agents: ${e?.message ?? e}`);
            }
        }

        // Rules -> <out>/rules/
        if (bundle.rulesDir) {
            const dest = path.join(outDir, 'rules');
            try {
                if (!report.dryRun) { this.copyDir(bundle.rulesDir, dest); }
                report.rulesConverted += this.countFiles(bundle.rulesDir, '.md');
                report.writtenPaths.push(dest);
            } catch (e: any) {
                report.errors.push(`Rules: ${e?.message ?? e}`);
            }
        }

        // Support dirs (hooks/, scripts/, commands/) -> <out>/<basename>/
        for (const supportDir of bundle.supportDirs) {
            const dest = path.join(outDir, path.basename(supportDir));
            try {
                if (!report.dryRun) { this.copyDir(supportDir, dest); }
                report.writtenPaths.push(dest);
            } catch (e: any) {
                report.warnings.push(`Support dir '${path.basename(supportDir)}': ${e?.message ?? e}`);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Skills can be at <dir>/skills/<skill>/SKILL.md or <dir>/<skill>/SKILL.md (Claude root layout). */
    private collectSkillDirs(dir: string): string[] {
        const found = new Set<string>();
        const skillsRoot = path.join(dir, 'skills');
        if (this.isDir(skillsRoot)) {
            for (const entry of this.safeReaddir(skillsRoot)) {
                const folder = path.join(skillsRoot, entry);
                if (fs.existsSync(path.join(folder, 'SKILL.md'))) { found.add(folder); }
            }
        }
        // Root-level skill folders (Claude plugins frequently ship skills at the plugin root).
        for (const entry of this.safeReaddir(dir)) {
            if (entry.startsWith('.') || ['skills', 'agents', 'rules', 'hooks', 'scripts', 'commands'].includes(entry)) { continue; }
            const folder = path.join(dir, entry);
            if (this.isDir(folder) && fs.existsSync(path.join(folder, 'SKILL.md'))) { found.add(folder); }
        }
        return Array.from(found);
    }

    private normaliseEvents(raw: Record<string, any>): Partial<Record<HookEvent, HookEntry[]>> {
        const out: Partial<Record<HookEvent, HookEntry[]>> = {};
        for (const [event, entries] of Object.entries(raw ?? {})) {
            if (Array.isArray(entries)) {
                out[event as HookEvent] = entries as HookEntry[];
            }
        }
        return out;
    }

    /** Parse an Antigravity hooks.json (grouped: { "<group>": { "EventName": [...] } }). */
    private parseGroupedHooks(parsed: any): Partial<Record<HookEvent, HookEntry[]>> {
        if (!parsed || typeof parsed !== 'object') { return {}; }
        // Find the first group value that contains known events.
        for (const value of Object.values(parsed)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const keys = Object.keys(value as object);
                if (keys.some(k => KNOWN_HOOK_EVENTS.includes(k as HookEvent))) {
                    return this.normaliseEvents(value as Record<string, any>);
                }
            }
        }
        // Fallback: the root itself may be the events map.
        if (Object.keys(parsed).some(k => KNOWN_HOOK_EVENTS.includes(k as HookEvent))) {
            return this.normaliseEvents(parsed);
        }
        return {};
    }

    private parseMcpServers(parsed: any): Record<string, McpServer> {
        if (!parsed || typeof parsed !== 'object') { return {}; }
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
            return parsed.mcpServers;
        }
        // Flat map where each value looks like a server config.
        const isFlat = Object.values(parsed).every(
            (v: any) => v && typeof v === 'object' && ('command' in v || 'url' in v || 'serverUrl' in v)
        );
        return isFlat ? (parsed as Record<string, McpServer>) : {};
    }

    private hooksReferencePluginRoot(bundle: PluginBundle): boolean {
        for (const entries of Object.values(bundle.hooks)) {
            for (const entry of entries ?? []) {
                for (const hook of entry.hooks ?? []) {
                    if (typeof (hook as any).command === 'string' && (hook as any).command.includes('${CLAUDE_PLUGIN_ROOT}')) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private dirIfExists(p: string): string | undefined {
        return this.isDir(p) ? p : undefined;
    }

    private isDir(p: string): boolean {
        try { return fs.statSync(p).isDirectory(); } catch { return false; }
    }

    private safeReaddir(p: string): string[] {
        try { return fs.readdirSync(p); } catch { return []; }
    }

    private readJson(p: string): any {
        if (!fs.existsSync(p)) { return null; }
        try {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        } catch {
            // Tolerant pass for JSONC-ish configs (comments / trailing commas).
            try {
                const stripped = fs.readFileSync(p, 'utf-8')
                    .replace(/\/\/[^\n]*/g, '')
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .replace(/,(\s*[}\]])/g, '$1');
                return JSON.parse(stripped);
            } catch {
                return null;
            }
        }
    }

    private readManifestName(p: string): string | null {
        const json = this.readJson(p);
        return json && typeof json.name === 'string' ? json.name : null;
    }

    private writeJson(filePath: string, data: any, report: PluginMigrationReport): void {
        if (!report.dryRun) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        }
        report.writtenPaths.push(filePath);
    }

    private countFiles(dir: string, ext: string): number {
        let n = 0;
        for (const entry of this.safeReaddir(dir)) {
            const full = path.join(dir, entry);
            if (this.isDir(full)) { n += this.countFiles(full, ext); }
            else if (entry.endsWith(ext)) { n++; }
        }
        return n;
    }

    /** Recursive directory copy (skips VCS metadata). */
    private copyDir(src: string, dest: string): void {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            if (entry.name === '.git' || entry.name === 'node_modules') { continue; }
            const s = path.join(src, entry.name);
            const d = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this.copyDir(s, d);
            } else if (entry.isFile()) {
                fs.mkdirSync(path.dirname(d), { recursive: true });
                fs.copyFileSync(s, d);
            }
        }
    }
}
