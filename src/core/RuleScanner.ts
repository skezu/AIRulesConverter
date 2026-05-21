/**
 * RuleScanner.ts
 *
 * Scans the workspace for AI rule files in all supported formats.
 *
 * NOTE: This file has NO 'vscode' import at the top level.
 * The VS Code extension wrapper (RuleScannerExtension) in extension.ts
 * calls scanDirectory() after resolving workspace folders via vscode APIs.
 * This keeps the core scanner platform-agnostic and usable from the CLI.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Rule, IDE, RuleMetadata } from './RuleModel';

export class RuleScanner {
    constructor() { }

    /**
     * Scan the VS Code workspace. Requires vscode APIs — only call this from
     * the extension context. Uses dynamic require so the CLI bundle can still
     * import RuleScanner without crashing at load time.
     */
    public async scanWorkspace(): Promise<Rule[]> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vscode = require('vscode');
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const rules: Rule[] = [];
        for (const folder of workspaceFolders) {
            const rootPath = folder.uri.fsPath;
            rules.push(...(await this.scanDirectory(rootPath)));
        }
        return rules;
    }

    /**
     * Scan a specific directory. No VS Code APIs — usable from both the
     * extension and the standalone CLI.
     */
    public async scanDirectory(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        rules.push(...(await this.scanCursorRules(rootPath)));
        rules.push(...(await this.scanWindsurfRules(rootPath)));
        rules.push(...(await this.scanKiroRules(rootPath)));
        rules.push(...(await this.scanAntigravityRules(rootPath)));
        rules.push(...(await this.scanAgyRules(rootPath)));
        rules.push(...(await this.scanClaudeCodeRules(rootPath)));
        rules.push(...(await this.scanGeminiCliRules(rootPath)));
        rules.push(...(await this.scanCopilotRules(rootPath)));
        return rules;
    }

    private async findFilesInDir(dirPath: string, extension: string, baseDir: string, visited: Set<string> = new Set()): Promise<string[]> {
        let filesFound: string[] = [];
        
        let resolvedDirPath;
        try {
            if (!fs.existsSync(dirPath)) {
                return [];
            }
            resolvedDirPath = fs.realpathSync(dirPath);
        } catch {
            return [];
        }

        if (visited.has(resolvedDirPath)) {
            return [];
        }
        visited.add(resolvedDirPath);

        try {
            const entries = fs.readdirSync(dirPath);
            for (const name of entries) {
                const fullPath = path.join(dirPath, name);
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
                    filesFound = filesFound.concat(await this.findFilesInDir(fullPath, extension, baseDir, visited));
                } else if (isFile && name.endsWith(extension)) {
                    filesFound.push(fullPath);
                }
            }
        } catch (e) {
            console.error(`[RuleScanner] Error listing directory ${dirPath}`, e);
        }
        return filesFound;
    }

    private async scanCursorRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        const rulesDir = path.join(rootPath, '.cursor', 'rules');

        // Scan for both .mdc and .md files (Cursor supports both formats)
        const mdcFiles = await this.findFilesInDir(rulesDir, '.mdc', rulesDir);
        const mdFiles = await this.findFilesInDir(rulesDir, '.md', rulesDir);
        const allFiles = [...mdcFiles, ...mdFiles];

        for (const filePath of allFiles) {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);

            const relativePath = path.relative(rulesDir, filePath);
            // Remove both .mdc and .md extensions
            const ruleName = relativePath.replace(/\.(mdc|md)$/, '').replace(/\\/g, '/'); // Use '/' for rule names
            const ruleId = `cursor-${ruleName}`;

            rules.push({
                id: ruleId,
                name: ruleName,
                ide: 'cursor',
                category: 'rules',
                filePath,
                content,
                rawContent,
                metadata
            });
        }
        return rules;
    }

    private async scanWindsurfRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        // Check global .windsurfrules
        const globalRulePath = path.join(rootPath, '.windsurfrules');
        if (fs.existsSync(globalRulePath)) {
            const rawContent = fs.readFileSync(globalRulePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);
            rules.push({
                id: 'windsurf-global',
                name: 'Global Rules',
                ide: 'windsurf',
                category: 'global',
                filePath: globalRulePath,
                content,
                rawContent,
                metadata
            });
        }

        // Check .windsurf/rules/
        const rulesDir = path.join(rootPath, '.windsurf', 'rules');
        const files = await this.findFilesInDir(rulesDir, '.md', rulesDir);

        for (const filePath of files) {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);

            const relativePath = path.relative(rulesDir, filePath);
            const ruleName = relativePath.replace('.md', '').replace(/\\/g, '/');
            const ruleId = `windsurf-${ruleName}`;

            rules.push({
                id: ruleId,
                name: ruleName,
                ide: 'windsurf',
                category: 'rules',
                filePath,
                content,
                rawContent,
                metadata
            });
        }
        return rules;
    }

    private async scanKiroRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        // Steering
        const steeringDir = path.join(rootPath, '.kiro', 'steering');
        const steeringFiles = await this.findFilesInDir(steeringDir, '.md', steeringDir);

        for (const filePath of steeringFiles) {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);
            // Merge parsed metadata with default Kiro metadata
            const mergedMetadata = { inclusion: 'always' as const, ...metadata };

            const relativePath = path.relative(steeringDir, filePath);
            const ruleName = relativePath.replace('.md', '').replace(/\\/g, '/');
            const ruleId = `kiro-steering-${ruleName}`;

            rules.push({
                id: ruleId,
                name: ruleName,
                ide: 'kiro',
                category: 'steering',
                filePath,
                content,
                rawContent,
                metadata: mergedMetadata
            });
        }

        // Specs
        const specsDir = path.join(rootPath, '.kiro', 'specs');
        const specFiles = await this.findFilesInDir(specsDir, '.md', specsDir);

        for (const filePath of specFiles) {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);
            const mergedMetadata = { inclusion: 'manual' as const, ...metadata };

            const relativePath = path.relative(specsDir, filePath);
            const ruleName = relativePath.replace('.md', '').replace(/\\/g, '/');
            const ruleId = `kiro-spec-${ruleName}`;

            rules.push({
                id: ruleId,
                name: ruleName,
                ide: 'kiro',
                category: 'specs',
                filePath,
                content,
                rawContent,
                metadata: mergedMetadata
            });
        }
        return rules;
    }

    private async scanAntigravityRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        const rulesDir = path.join(rootPath, '.agent', 'rules');

        let dirExists = false;
        try {
            dirExists = fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory();
        } catch {}
        if (!dirExists) {
            return rules;
        }

        const files = await this.findFilesInDir(rulesDir, '.md', rulesDir);

        for (const filePath of files) {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);

            const relativePath = path.relative(rulesDir, filePath);
            const ruleName = relativePath.replace('.md', '').replace(/\\/g, '/');
            const ruleId = `antigravity-${ruleName}`;

            const symlinkInfo = this.getSymlinkInfo(filePath, rootPath);

            rules.push({
                id: ruleId,
                name: ruleName,
                ide: 'antigravity',
                category: 'rules',
                filePath,
                content,
                rawContent,
                metadata,
                isSymlinked: symlinkInfo.isSymlinked,
                realPath: symlinkInfo.realPath
            });
        }
        return rules;
    }

    private async scanAgyRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        const rulesDir = path.join(rootPath, '.agent', 'rules');

        let dirExists = false;
        try {
            dirExists = fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory();
        } catch {}
        if (!dirExists) {
            return rules;
        }

        const files = await this.findFilesInDir(rulesDir, '.md', rulesDir);

        for (const filePath of files) {
            try {
                const rawContent = fs.readFileSync(filePath, 'utf-8');
                const { content, metadata } = this.parseFrontmatter(rawContent);

                const relativePath = path.relative(rulesDir, filePath);
                const ruleName = relativePath.replace('.md', '').replace(/\\/g, '/');
                const ruleId = `agy-${ruleName}`;

                const symlinkInfo = this.getSymlinkInfo(filePath, rootPath);

                rules.push({
                    id: ruleId,
                    name: ruleName,
                    ide: 'agy',
                    category: 'rules',
                    filePath,
                    content,
                    rawContent,
                    metadata,
                    isSymlinked: symlinkInfo.isSymlinked,
                    realPath: symlinkInfo.realPath
                });
            } catch (e) {
                console.error(`[RuleScanner] Error scanning agy rule at ${filePath}`, e);
            }
        }
        return rules;
    }

    private getSymlinkInfo(filePath: string, rootPath: string): { isSymlinked: boolean; realPath: string } {
        let current = filePath;
        let isSymlinked = false;
        let realPath = filePath;
        try {
            realPath = fs.realpathSync(filePath);
        } catch {}

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

    /**
     * Claude Code: scan CLAUDE.md and .claude/CLAUDE.md.
     * Split by level-2 headings (## Title) into individual rules.
     * If no headings found, treat the entire file as one rule.
     */
    private async scanClaudeCodeRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        const candidates = [
            path.join(rootPath, 'CLAUDE.md'),
            path.join(rootPath, '.claude', 'CLAUDE.md'),
        ];

        for (const filePath of candidates) {
            if (!fs.existsSync(filePath)) {
                continue;
            }
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const sections = this.splitByH2Headings(rawContent);

            if (sections.length === 0) {
                continue;
            }

            const isSubdir = filePath.includes('.claude');
            const category = isSubdir ? 'project (.claude)' : 'project';

            for (const section of sections) {
                const ruleId = `claude-code-${section.title.toLowerCase().replace(/\s+/g, '-')}`;
                rules.push({
                    id: ruleId,
                    name: section.title,
                    ide: 'claude-code',
                    category,
                    filePath,
                    content: section.content,
                    rawContent: section.rawSection,
                    metadata: {
                        sectionTitle: section.title,
                        alwaysApply: true,
                        scope: 'project',
                    },
                });
            }
        }

        // Scan .claude/rules/*.md
        const rulesDir = path.join(rootPath, '.claude', 'rules');
        if (fs.existsSync(rulesDir)) {
            const files = await this.findFilesInDir(rulesDir, '.md', rulesDir);
            for (const filePath of files) {
                try {
                    const rawContent = fs.readFileSync(filePath, 'utf-8');
                    const { content, metadata } = this.parseFrontmatter(rawContent);

                    const relativePath = path.relative(rulesDir, filePath);
                    const ruleName = relativePath.replace('.md', '').replace(/\\/g, '/');
                    const ruleId = `claude-code-rule-${ruleName}`;

                    rules.push({
                        id: ruleId,
                        name: ruleName,
                        ide: 'claude-code',
                        category: 'rules',
                        filePath,
                        content,
                        rawContent,
                        metadata: {
                            ...metadata,
                            scope: 'project'
                        }
                    });
                } catch (e) {
                    console.error(`[RuleScanner] Error scanning Claude Code rule at ${filePath}`, e);
                }
            }
        }

        return rules;
    }

    /**
     * Gemini CLI: scan GEMINI.md at the project root.
     * Split by level-2 headings into individual rules.
     */
    private async scanGeminiCliRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        const filePath = path.join(rootPath, 'GEMINI.md');

        if (!fs.existsSync(filePath)) {
            return rules;
        }

        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const sections = this.splitByH2Headings(rawContent);

        for (const section of sections) {
            const ruleId = `gemini-cli-${section.title.toLowerCase().replace(/\s+/g, '-')}`;
            rules.push({
                id: ruleId,
                name: section.title,
                ide: 'gemini-cli',
                category: 'project',
                filePath,
                content: section.content,
                rawContent: section.rawSection,
                metadata: {
                    sectionTitle: section.title,
                    alwaysApply: true,
                    scope: 'project',
                },
            });
        }

        return rules;
    }

    /**
     * GitHub Copilot: scan:
     *   - .github/copilot-instructions.md (global, no frontmatter)
     *   - .github/instructions/*.instructions.md (targeted, applyTo frontmatter)
     */
    private async scanCopilotRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];

        // Global instructions file
        const globalPath = path.join(rootPath, '.github', 'copilot-instructions.md');
        if (fs.existsSync(globalPath)) {
            const rawContent = fs.readFileSync(globalPath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);
            rules.push({
                id: 'copilot-global',
                name: 'copilot-instructions',
                ide: 'copilot',
                category: 'global',
                filePath: globalPath,
                content,
                rawContent,
                metadata: { ...metadata, alwaysApply: true, scope: 'project' },
            });
        }

        // Targeted instructions files (.github/instructions/)
        const instructionsDir = path.join(rootPath, '.github', 'instructions');
        const files = await this.findFilesInDir(instructionsDir, '.md', instructionsDir);

        for (const filePath of files) {
            if (!filePath.endsWith('.instructions.md')) {
                continue;
            }
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);

            const relativePath = path.relative(instructionsDir, filePath);
            const ruleName = relativePath.replace('.instructions.md', '').replace(/\\/g, '/');
            const ruleId = `copilot-${ruleName}`;

            // If applyTo is in metadata, parse it into globs
            const parsedMeta: RuleMetadata = { ...metadata };
            if ((metadata as any).applyTo && !parsedMeta.globs) {
                const applyToStr = (metadata as any).applyTo as string;
                parsedMeta.globs = applyToStr.split(',').map((g: string) => g.trim());
            }

            rules.push({
                id: ruleId,
                name: ruleName,
                ide: 'copilot',
                category: 'instructions',
                filePath,
                content,
                rawContent,
                metadata: parsedMeta,
            });
        }

        return rules;
    }

    // ---------------------------------------------------------------------------
    // Helper: split a markdown file by level-2 headings
    // ---------------------------------------------------------------------------

    private splitByH2Headings(content: string): Array<{
        title: string;
        content: string;
        rawSection: string;
    }> {
        const lines = content.split(/\r?\n/);
        const sections: Array<{ title: string; content: string; rawSection: string }> = [];

        let currentTitle: string | null = null;
        let currentLines: string[] = [];

        const flush = () => {
            if (currentTitle !== null) {
                const sectionContent = currentLines.join('\n').trim();
                if (sectionContent) {
                    sections.push({
                        title: currentTitle,
                        content: sectionContent,
                        rawSection: `## ${currentTitle}\n\n${sectionContent}`,
                    });
                }
            }
        };

        for (const line of lines) {
            const h2Match = line.match(/^##\s+(.+)$/);
            if (h2Match) {
                flush();
                currentTitle = h2Match[1].trim();
                currentLines = [];
            } else {
                currentLines.push(line);
            }
        }
        flush();

        // If no H2 headings found, treat whole file as one rule
        if (sections.length === 0 && content.trim()) {
            const h1Match = content.match(/^#\s+(.+)$/m);
            const title = h1Match ? h1Match[1].trim() : 'Rules';
            sections.push({
                title,
                content: content.trim(),
                rawSection: content.trim(),
            });
        }

        return sections;
    }

    // ---------------------------------------------------------------------------
    // Helper: parse YAML frontmatter
    // ---------------------------------------------------------------------------

    private parseFrontmatter(content: string): { content: string; metadata: RuleMetadata } {
        // More robust regex that explicitly handles CRLF and LF
        const match = content.match(/^---[ \t]*(?:\r?\n)([\s\S]*?)(?:\r?\n)---[ \t]*(?:\r?\n)?([\s\S]*)$/);
        if (match) {
            try {
                let yamlContent = match[1];

                // Preprocess YAML to quote unquoted glob patterns
                yamlContent = yamlContent.replace(
                    /^(\s*(?:globs|fileMatch|fileMatchPattern|applyTo):\s*)(\*[^\s'"]*|\?[^\s'"]*|\[[^\]]*\][^\s'"]*)$/gm,
                    (match, prefix, value) => `${prefix}"${value}"`
                );

                const metadata = yaml.load(yamlContent) as RuleMetadata;
                const parsedContent = match[2].trim();
                // Successfully parsed
                return { content: parsedContent, metadata };
            } catch (e) {
                console.error('[RuleScanner] Failed to parse frontmatter YAML', e);
                const parsedContent = match[2].trim();
                return { content: parsedContent, metadata: {} };
            }
        } else {
            // No frontmatter present — treat whole content as body
        }
        return { content, metadata: {} };
    }
}
