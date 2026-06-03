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

        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch (e) {
            console.error(`[PluginScanner] Cannot read plugins dir: ${dir}`, e);
            return plugins;
        }

        for (const entry of entries) {
            const pluginDir = path.join(dir, entry);
            try {
                const stat = fs.statSync(pluginDir);
                if (!stat.isDirectory()) { continue; }
            } catch { continue; }

            const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
            if (!fs.existsSync(manifestPath)) { continue; }

            try {
                const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                const hooks = this.parsePluginHooks(raw.hooks ?? {});
                const skills = await this.scanPluginRootSkills(pluginDir, raw.name ?? entry);

                plugins.push({
                    name: raw.name ?? entry,
                    description: raw.description ?? '',
                    author: raw.author,
                    pluginDir,
                    manifestPath,
                    skills,
                    hooks,
                    rawManifest: raw,
                });
            } catch (e) {
                console.error(`[PluginScanner] Failed to parse plugin at ${pluginDir}`, e);
            }
        }

        return plugins;
    }

    /**
     * Scan the plugin root directory for folders that contain a SKILL.md file.
     * Plugins store skills at {pluginDir}/{skillName}/SKILL.md, not under
     * .{ide}/skills/ like workspace skills. This method handles that layout.
     */
    private async scanPluginRootSkills(pluginDir: string, pluginName: string): Promise<Skill[]> {
        const skills: Skill[] = [];

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(pluginDir, { withFileTypes: true });
        } catch (e) {
            console.error(`[PluginScanner] Error reading plugin dir ${pluginDir}`, e);
            return skills;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) { continue; }

            const folderPath = path.join(pluginDir, entry.name);
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
