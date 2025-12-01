import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Rule, IDE, RuleMetadata } from './RuleModel';

export class RuleScanner {
    constructor() { }

    public async scanWorkspace(): Promise<Rule[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const rules: Rule[] = [];
        for (const folder of workspaceFolders) {
            const rootPath = folder.uri.fsPath;
            rules.push(...(await this.scanCursorRules(rootPath)));
            rules.push(...(await this.scanWindsurfRules(rootPath)));
            rules.push(...(await this.scanKiroRules(rootPath)));
            rules.push(...(await this.scanAntigravityRules(rootPath)));
        }
        return rules;
    }

    private async findFilesInDir(dirPath: string, extension: string, baseDir: string): Promise<string[]> {
        let filesFound: string[] = [];
        if (!fs.existsSync(dirPath)) {
            return [];
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                filesFound = filesFound.concat(await this.findFilesInDir(fullPath, extension, baseDir));
            } else if (entry.isFile() && entry.name.endsWith(extension)) {
                filesFound.push(fullPath);
            }
        }
        return filesFound;
    }

    private async scanCursorRules(rootPath: string): Promise<Rule[]> {
        const rules: Rule[] = [];
        const rulesDir = path.join(rootPath, '.cursor', 'rules');
        const files = await this.findFilesInDir(rulesDir, '.mdc', rulesDir);

        for (const filePath of files) {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);

            const relativePath = path.relative(rulesDir, filePath);
            const ruleName = relativePath.replace('.mdc', '').replace(/\\/g, '/'); // Use '/' for rule names
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
            const pathParts = relativePath.split(path.sep);
            const specFolder = pathParts.length > 1 ? pathParts[0] : ''; // Get the first level folder name
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
        const files = await this.findFilesInDir(rulesDir, '.md', rulesDir);

        for (const filePath of files) {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            const { content, metadata } = this.parseFrontmatter(rawContent);

            const relativePath = path.relative(rulesDir, filePath);
            const ruleName = relativePath.replace('.md', '').replace(/\\/g, '/');
            const ruleId = `antigravity-${ruleName}`;

            rules.push({
                id: ruleId,
                name: ruleName,
                ide: 'antigravity',
                category: 'rules',
                filePath,
                content,
                rawContent,
                metadata
            });
        }
        return rules;
    }

    private parseFrontmatter(content: string): { content: string; metadata: RuleMetadata } {
        // More robust regex that explicitly handles CRLF and LF
        // ^--- : Start with ---
        // [ \t]* : Optional horizontal whitespace
        // (?:\r?\n) : Exactly one newline (CRLF or LF)
        // ([\s\S]*?) : Capture group 1 (lazy) for metadata content
        // (?:\r?\n)--- : Newline followed by ---
        // [ \t]*(?:\r?\n)? : Optional whitespace and newline after closing ---
        // ([\s\S]*) : Capture group 2 (greedy) for the rest of the content
        const match = content.match(/^---[ \t]*(?:\r?\n)([\s\S]*?)(?:\r?\n)---[ \t]*(?:\r?\n)?([\s\S]*)$/);
        if (match) {
            try {
                let yamlContent = match[1];

                // Preprocess YAML to quote unquoted glob patterns
                // This fixes common issues like "globs: *.jsx" which should be "globs: '*.jsx'"
                yamlContent = yamlContent.replace(
                    /^(\s*(?:globs|fileMatch|fileMatchPattern):\s*)(\*[^\s'"]*|\?[^\s'"]*|\[[^\]]*\][^\s'"]*)$/gm,
                    (match, prefix, value) => `${prefix}"${value}"`
                );

                const metadata = yaml.load(yamlContent) as RuleMetadata;
                const parsedContent = match[2].trim();
                console.log('[RuleScanner] Successfully parsed frontmatter:', metadata);
                return { content: parsedContent, metadata };
            } catch (e) {
                console.error('[RuleScanner] Failed to parse frontmatter YAML', e);
                // On error, try to continue with empty metadata but strip the problematic frontmatter
                const parsedContent = match[2].trim();
                return { content: parsedContent, metadata: {} };
            }
        } else {
            console.log('[RuleScanner] No frontmatter found in content');
        }
        return { content, metadata: {} };
    }
}
