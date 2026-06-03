/**
 * SkillConverter.ts
 *
 * Handles conversion and migration of skills between IDE formats.
 */

import * as path from 'path';
import * as fs from 'fs';
import { Skill } from './AgentCapability';
import { Rule, IDE } from './RuleModel';
import { convertRuleToResult, writeConversionResult } from './RuleConverterCore';

export interface SkillConversionResult {
    skillName: string;
    targetIde: IDE;
    // For native skills (copying folder structure/symlinks)
    sourceFolderPath?: string;
    targetFolderPath?: string;
    isSymlink?: boolean;
    realPath?: string;
    additionalFiles?: string[];
    // For flattened rule conversion (writing to file)
    ruleResult?: {
        filePath: string;
        content: string;
        appendMode: boolean;
    };
}

// Maps each IDE to the relative path of its skills directory (no trailing slash).
const IDE_SKILLS_DIR_MAP: Record<IDE, string> = {
    'agy':         path.join('.agents', 'skill'),
    'antigravity': path.join('.agents', 'skill'),
    'claude-code': path.join('.claude',  'skills'),
    'cursor':      path.join('.cursor',  'skills'),
    'windsurf':    path.join('.windsurf','skills'),
    'kiro':        path.join('.kiro',    'skills'),
    'gemini-cli':  path.join('.gemini',  'skills'),
    'copilot':     path.join('.github',  'skills'),
};

export class SkillConverter {
    constructor() {}

    /**
     * Convert a Skill to the target format.
     */
    public convertSkill(
        skill: Skill,
        targetIde: IDE,
        rootPath: string
    ): SkillConversionResult {
        const skillsDir = IDE_SKILLS_DIR_MAP[targetIde];
        if (!skillsDir) {
            throw new Error(`Unknown target format for skill conversion: ${targetIde}`);
        }

        const targetFolderPath = path.join(rootPath, skillsDir, skill.folderName);

        return {
            skillName: skill.folderName,
            targetIde,
            sourceFolderPath: skill.folderPath,
            targetFolderPath,
            isSymlink: skill.isSymlinked,
            realPath: skill.realPath,
            additionalFiles: skill.additionalFiles,
        };
    }

    /**
     * Execute the skill conversion (writing/copying).
     */
    public executeConversion(
        result: SkillConversionResult,
        isFirstInBatch: boolean = true
    ): string {
        const { targetIde, targetFolderPath, sourceFolderPath, isSymlink, realPath, ruleResult } = result;

        if (targetFolderPath && sourceFolderPath) {
            // Native capability: folder migration / symlink recreation
            if (fs.existsSync(targetFolderPath)) {
                // Delete existing folder/link to prevent overlap
                this.deleteFolderRecursive(targetFolderPath);
            }

            fs.mkdirSync(path.dirname(targetFolderPath), { recursive: true });

            if (isSymlink && realPath) {
                // Recreate symlink/junction
                try {
                    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
                    fs.symlinkSync(realPath, targetFolderPath, linkType);
                    return targetFolderPath;
                } catch (e) {
                    console.warn(`[SkillConverter] Failed to recreate symlink, falling back to copy.`, e);
                }
            }

            // Standard or fallback recursive copy
            this.copyDirRecursive(realPath || sourceFolderPath, targetFolderPath);
            return targetFolderPath;
        } else if (ruleResult) {
            // Flattened rule format
            return writeConversionResult(ruleResult, isFirstInBatch);
        }

        throw new Error('Invalid skill conversion result');
    }

    private copyDirRecursive(src: string, dest: string): void {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isSymbolicLink()) {
                try {
                    const target = fs.readlinkSync(srcPath);
                    fs.symlinkSync(target, destPath);
                } catch {
                    // Fallback to real path stat and copy
                    try {
                        const resolvedSrc = fs.realpathSync(srcPath);
                        if (fs.statSync(resolvedSrc).isDirectory()) {
                            this.copyDirRecursive(resolvedSrc, destPath);
                        } else {
                            fs.copyFileSync(resolvedSrc, destPath);
                        }
                    } catch {}
                }
            } else if (entry.isDirectory()) {
                this.copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    private deleteFolderRecursive(folderPath: string): void {
        if (!fs.existsSync(folderPath)) {
            return;
        }

        try {
            // Check if it's a symbolic link/junction first
            const stat = fs.lstatSync(folderPath);
            if (stat.isSymbolicLink()) {
                fs.unlinkSync(folderPath);
                return;
            }
        } catch {}

        const entries = fs.readdirSync(folderPath);
        for (const entry of entries) {
            const curPath = path.join(folderPath, entry);
            let isDir = false;
            try {
                const stat = fs.lstatSync(curPath);
                if (stat.isSymbolicLink()) {
                    fs.unlinkSync(curPath);
                    continue;
                }
                isDir = stat.isDirectory();
            } catch {
                continue;
            }

            if (isDir) {
                this.deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        }
        fs.rmdirSync(folderPath);
    }

    public deleteSkill(skill: Skill): void {
        this.deleteFolderRecursive(skill.folderPath);
    }
}
