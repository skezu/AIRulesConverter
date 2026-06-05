import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ClaudePlugin, PluginHookEntry, PluginHookCommand, Skill, SkillMetadata } from './AgentCapability';
import { HookEvent } from './AgentCapability';
import { getPluginsDir } from './GlobalPathResolver';

export class PluginScanner {
    constructor() {}

    public async scanPlugins(pluginsDir?: string): Promise<ClaudePlugin[]> {
        const dir = pluginsDir ?? getPluginsDir();
        const plugins: ClaudePlugin[] = [];

        if (!fs.existsSync(dir)) {
            return plugins;
        }

        const seen = new Set<string>();
        for (const pluginDir of this.findPluginRoots(dir)) {
            let key: string;
            try { key = fs.realpathSync(pluginDir); } catch { key = pluginDir; }
            if (seen.has(key)) { continue; }
            seen.add(key);

            const plugin = await this.loadPlugin(pluginDir);
            if (plugin) { plugins.push(plugin); }
        }

        return plugins;
    }

    /**
     * Recursively locate plugin roots — directories containing
     * `.claude-plugin/plugin.json` — anywhere under the plugins/marketplaces tree.
     *
     * Claude Code stores plugins in two shapes under ~/.claude/plugins/marketplaces:
     *   - single-plugin marketplace:  <marketplace>/.claude-plugin/plugin.json
     *   - multi-plugin marketplace:   <marketplace>/.claude-plugin/marketplace.json
     *       + <marketplace>/plugins/<name>/.claude-plugin/plugin.json
     *       + <marketplace>/external_plugins/<name>/.claude-plugin/plugin.json
     *
     * Recursing for the manifest covers both shapes without hard-coding subdir
     * names, and reflects exactly which plugins are present on disk (a marketplace
     * catalog can list hundreds of plugins that were never downloaded). The old
     * "direct children only" logic silently missed every multi-plugin marketplace.
     */
    public findPluginRoots(root: string, maxDepth = 6): string[] {
        const roots: string[] = [];
        const skip = new Set(['.git', 'node_modules', '.claude-plugin']);

        const walk = (dir: string, depth: number): void => {
            if (depth > maxDepth) { return; }
            if (fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) {
                roots.push(dir);
                return; // a plugin's own subdirs are not separate plugins
            }
            let entries: fs.Dirent[];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                if (skip.has(entry.name)) { continue; }
                const child = path.join(dir, entry.name);
                try { if (!fs.statSync(child).isDirectory()) { continue; } } catch { continue; }
                walk(child, depth + 1);
            }
        };

        walk(root, 0);
        return roots;
    }

    /** Load a specific set of plugin directories (e.g. resolved installed-plugin paths). */
    public async scanPluginDirs(pluginDirs: string[]): Promise<ClaudePlugin[]> {
        const plugins: ClaudePlugin[] = [];
        for (const dir of pluginDirs) {
            const plugin = await this.loadPlugin(dir);
            if (plugin) { plugins.push(plugin); }
        }
        return plugins;
    }

    private async loadPlugin(pluginDir: string): Promise<ClaudePlugin | null> {
        const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
        try {
            const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const name = raw.name ?? path.basename(pluginDir);
            const hooks = this.parsePluginHooks(raw.hooks ?? {});
            const skills = await this.scanPluginRootSkills(pluginDir, name);

            return {
                name,
                description: raw.description ?? '',
                author: raw.author,
                pluginDir,
                manifestPath,
                skills,
                hooks,
                rawManifest: raw,
            };
        } catch (e) {
            console.error(`[PluginScanner] Failed to parse plugin at ${pluginDir}`, e);
            return null;
        }
    }

    /**
     * Scan a plugin's `skills/` directory for skill folders (each containing a
     * SKILL.md). Claude Code plugins auto-discover skills under
     * {pluginDir}/skills/{skillName}/SKILL.md — NOT {pluginDir}/{skillName}/.
     * (The previous one-level-up assumption found zero skills for every plugin
     * that follows the documented layout, e.g. everything-claude-code's 142.)
     */
    private async scanPluginRootSkills(pluginDir: string, pluginName: string): Promise<Skill[]> {
        const skills: Skill[] = [];
        const skillsDir = path.join(pluginDir, 'skills');

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        } catch {
            return skills; // no skills/ directory — normal for many plugins
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) { continue; }

            const folderPath = path.join(skillsDir, entry.name);
            const skillFilePath = path.join(folderPath, 'SKILL.md');

            if (!fs.existsSync(skillFilePath)) { continue; }

            try {
                const rawContent = fs.readFileSync(skillFilePath, 'utf-8');
                const { content, metadata } = this.parseFrontmatter(rawContent);

                const folderName = entry.name;
                const name = metadata.name || folderName;
                const description = metadata.description || '';

                const additionalFiles = this.collectAdditionalFiles(folderPath, folderPath);

                skills.push({
                    id: `plugin-${pluginName}-skill-${folderName}`,
                    folderName,
                    name,
                    description,
                    ide: 'claude-code',
                    category: 'plugin',
                    skillFilePath,
                    folderPath,
                    rawContent,
                    content,
                    metadata,
                    additionalFiles,
                });
            } catch (e) {
                console.error(`[PluginScanner] Error reading skill at ${skillFilePath}`, e);
            }
        }

        return skills;
    }

    private collectAdditionalFiles(dirPath: string, skillFolderPath: string): string[] {
        const files: string[] = [];
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                let isDir = false;
                let isFile = false;
                try {
                    const stat = fs.statSync(fullPath);
                    isDir = stat.isDirectory();
                    isFile = stat.isFile();
                } catch { continue; }

                if (isDir) {
                    files.push(...this.collectAdditionalFiles(fullPath, skillFolderPath));
                } else if (isFile && entry.name !== 'SKILL.md') {
                    files.push(path.relative(skillFolderPath, fullPath).replace(/\\/g, '/'));
                }
            }
        } catch (e) {
            console.error('[PluginScanner] Error collecting files', e);
        }
        return files;
    }

    private parseFrontmatter(content: string): { content: string; metadata: SkillMetadata } {
        const match = content.match(/^---[ \t]*(?:\r?\n)([\s\S]*?)(?:\r?\n)---[ \t]*(?:\r?\n)?([\s\S]*)$/);
        if (match) {
            const parsedContent = match[2].trim();
            try {
                const metadata = yaml.load(match[1]) as SkillMetadata;
                return { content: parsedContent, metadata: metadata || {} };
            } catch {
                return { content: parsedContent, metadata: {} };
            }
        }
        return { content, metadata: {} };
    }

    private parsePluginHooks(raw: Record<string, any>): Partial<Record<HookEvent, PluginHookEntry[]>> {
        const result: Partial<Record<HookEvent, PluginHookEntry[]>> = {};
        for (const [event, entries] of Object.entries(raw)) {
            if (Array.isArray(entries)) {
                result[event as HookEvent] = entries as PluginHookEntry[];
            }
        }
        return result;
    }
}
