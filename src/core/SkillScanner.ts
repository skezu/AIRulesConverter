/**
 * SkillScanner.ts
 *
 * Scans the workspace for agent skills in Antigravity (.agent/skills)
 * and agy (.agent/skills) formats, with symlink awareness.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Skill, SkillMetadata } from './AgentCapability';
import { IDE } from './RuleModel';

export class SkillScanner {
    constructor() {}

    /**
     * Scan workspace folders using VS Code APIs (if in extension context)
     */
    public async scanWorkspace(): Promise<Skill[]> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vscode = require('vscode');
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const skills: Skill[] = [];
        for (const folder of workspaceFolders) {
            const rootPath = folder.uri.fsPath;
            skills.push(...(await this.scanDirectory(rootPath)));
        }
        return skills;
    }

    /**
     * Scan a specific directory (CLI & core compatible)
     */
    public async scanDirectory(rootPath: string): Promise<Skill[]> {
        const skills: Skill[] = [];
        // agy / antigravity: three distinct locations
        //   workspace : {root}/.agents/skill/
        //   global    : {root}/.gemini/antigravity-cli/skills/
        //   shared    : {root}/.gemini/skills/  (shared with gemini-cli)
        skills.push(...(await this.scanSkillsForIde(rootPath, 'agy',         path.join('.agents', 'skill'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'antigravity', path.join('.agents', 'skill'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'agy',         path.join('.gemini', 'antigravity-cli', 'skills'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'antigravity', path.join('.gemini', 'antigravity-cli', 'skills'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'agy',         path.join('.gemini', 'skills'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'antigravity', path.join('.gemini', 'skills'))));
        // other IDEs
        skills.push(...(await this.scanSkillsForIde(rootPath, 'claude-code', path.join('.claude',  'skills'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'cursor',      path.join('.cursor',  'skills'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'windsurf',    path.join('.windsurf','skills'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'kiro',        path.join('.kiro',    'skills'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'gemini-cli',  path.join('.gemini',  'skills'))));
        skills.push(...(await this.scanSkillsForIde(rootPath, 'copilot',     path.join('.github',  'skills'))));
        return skills;
    }

    private async scanSkillsForIde(rootPath: string, ide: IDE, skillsRelPath: string): Promise<Skill[]> {
        const skills: Skill[] = [];
        const skillsDir = path.join(rootPath, skillsRelPath);

        // Check if skills directory exists (or is a symlink pointing to an existing directory)
        if (!this.directoryExistsFollowSymlinks(skillsDir)) {
            return [];
        }

        try {
            const entries = fs.readdirSync(skillsDir);
            for (const entryName of entries) {
                const folderPath = path.join(skillsDir, entryName);
                
                // Get path stats (following symlinks to verify it is a folder)
                let isDir = false;
                try {
                    const stat = fs.statSync(folderPath);
                    isDir = stat.isDirectory();
                } catch {
                    continue;
                }

                if (!isDir) {
                    continue;
                }

                const skillFilePath = path.join(folderPath, 'SKILL.md');
                if (fs.existsSync(skillFilePath)) {
                    const rawContent = fs.readFileSync(skillFilePath, 'utf-8');
                    const { content, metadata } = this.parseFrontmatter(rawContent);

                    // Collect other files in the skill folder
                    const additionalFiles = this.collectAdditionalFiles(folderPath, folderPath);

                    // Check for symlinks
                    const symlinkInfo = this.getSymlinkInfo(folderPath, rootPath);

                    const folderName = entryName;
                    const name = metadata.name || folderName;
                    const description = metadata.description || '';

                    skills.push({
                        id: `${ide}-skill-${folderName}`,
                        folderName,
                        name,
                        description,
                        ide,
                        category: 'workspace',
                        skillFilePath,
                        folderPath,
                        rawContent,
                        content,
                        metadata,
                        isSymlinked: symlinkInfo.isSymlinked,
                        realPath: symlinkInfo.realPath,
                        additionalFiles,
                    });
                }
            }
        } catch (e) {
            console.error(`[SkillScanner] Error scanning skills for ${ide}`, e);
        }

        return skills;
    }

    private directoryExistsFollowSymlinks(dirPath: string): boolean {
        try {
            return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
        } catch {
            return false;
        }
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
                } catch {
                    continue;
                }

                if (isDir) {
                    files.push(...this.collectAdditionalFiles(fullPath, skillFolderPath));
                } else if (isFile && entry.name !== 'SKILL.md') {
                    files.push(path.relative(skillFolderPath, fullPath).replace(/\\/g, '/'));
                }
            }
        } catch (e) {
            console.error('[SkillScanner] Error collecting files', e);
        }
        return files;
    }

    private getSymlinkInfo(filePath: string, rootPath: string): { isSymlinked: boolean; realPath: string } {
        let current = filePath;
        let isSymlinked = false;
        const realPath = fs.realpathSync(filePath);

        while (current && current !== path.dirname(current) && current.startsWith(rootPath)) {
            try {
                const stat = fs.lstatSync(current);
                if (stat.isSymbolicLink()) {
                    isSymlinked = true;
                    break;
                }
            } catch {
                // Ignore stat errors
            }
            current = path.dirname(current);
        }
        return { isSymlinked, realPath };
    }

    private parseFrontmatter(content: string): { content: string; metadata: SkillMetadata } {
        const match = content.match(/^---[ \t]*(?:\r?\n)([\s\S]*?)(?:\r?\n)---[ \t]*(?:\r?\n)?([\s\S]*)$/);
        if (match) {
            const parsedContent = match[2].trim();
            // Tier 1: standard YAML
            try {
                const metadata = yaml.load(match[1]) as SkillMetadata;
                return { content: parsedContent, metadata: metadata || {} };
            } catch {
                // Tier 2: simple key-value fallback for descriptions containing colons
                // (e.g. "description: Use when: X" or "description: Triggers onKeywords: lint")
                const metadata = this.parseSimpleFrontmatter(match[1]);
                if (Object.keys(metadata).length > 0) {
                    return { content: parsedContent, metadata };
                }
                console.warn('[SkillScanner] Could not parse frontmatter, skill loaded without metadata');
                return { content: parsedContent, metadata: {} };
            }
        }
        return { content, metadata: {} };
    }

    // Fallback parser: splits each line on the first colon only, so colons inside
    // description values (e.g. "Triggers onKeywords: lint") are preserved as-is.
    private parseSimpleFrontmatter(raw: string): SkillMetadata {
        const metadata: Record<string, string> = {};
        for (const line of raw.split(/\r?\n/)) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) { continue; }
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim();
            if (key) {
                metadata[key] = value;
            }
        }
        return metadata as SkillMetadata;
    }
}
