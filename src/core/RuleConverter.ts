import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Rule, IDE, RuleMetadata } from './RuleModel';

export class RuleConverter {
    constructor() { }

    public async convertRule(rule: Rule, targetIde: IDE): Promise<void> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(rule.filePath));
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Could not determine workspace folder for rule.');
            return;
        }
        const rootPath = workspaceFolder.uri.fsPath;

        let newContent = rule.content;
        let newPath = '';
        let newMetadata: RuleMetadata = { ...rule.metadata };

        // --- 1. Metadata Normalization (Source -> Intermediate) ---
        // We try to infer standard properties (alwaysApply, globs) from source-specific ones if missing
        const sourceMeta = rule.metadata as any;

        // Normalize 'alwaysApply'
        if (newMetadata.alwaysApply === undefined) {
            if (sourceMeta.trigger === 'always_on' || sourceMeta.inclusion === 'always') {
                newMetadata.alwaysApply = true;
            } else {
                newMetadata.alwaysApply = false;
            }
        }

        // Normalize 'globs'
        if (!newMetadata.globs) {
            if (sourceMeta.fileMatch) {
                newMetadata.globs = sourceMeta.fileMatch;
            } else if (sourceMeta.trigger === 'glob' && sourceMeta.globs) {
                newMetadata.globs = sourceMeta.globs;
            }
        }

        // --- 2. Target-Specific Logic ---

        if (targetIde === 'cursor') {
            // Target: Cursor (.mdc)
            const cursorMeta: any = {}; // Use any to allow flexible property assignment

            // Logic:
            // 1. Trigger -> Always Apply
            // Only true if explicitly always_on
            if (sourceMeta.trigger === 'always_on' || sourceMeta.inclusion === 'always' || sourceMeta.alwaysApply === true) {
                cursorMeta.alwaysApply = true;
            } else {
                cursorMeta.alwaysApply = false;
            }

            // 2. Preserve other attributes (globs, description)
            if (newMetadata.globs && newMetadata.globs.length > 0) {
                cursorMeta.globs = newMetadata.globs;
            }
            if (newMetadata.description) {
                cursorMeta.description = newMetadata.description;
            }

            // Construct Content
            const frontmatter = yaml.dump(cursorMeta);
            newContent = `---\n${frontmatter}---\n\n${rule.content}`;

            // Path
            const fileName = path.basename(rule.filePath, path.extname(rule.filePath));
            newPath = path.join(rootPath, '.cursor', 'rules', `${fileName}.mdc`);

        } else if (targetIde === 'windsurf' || targetIde === 'antigravity') {
            // Target: Windsurf OR Antigravity (Both use Frontmatter with triggers)
            const targetMeta: any = {};

            // Logic: Map alwaysApply/globs/description back to 'trigger'
            if (newMetadata.alwaysApply) {
                targetMeta.trigger = 'always_on';
            } else if (newMetadata.globs && newMetadata.globs.length > 0) {
                targetMeta.trigger = 'glob';
                targetMeta.globs = newMetadata.globs;
            } else if (newMetadata.description) {
                targetMeta.trigger = 'model_decision';
                targetMeta.description = newMetadata.description;
            } else {
                targetMeta.trigger = 'manual';
            }

            const frontmatter = yaml.dump(targetMeta);
            newContent = `---\n${frontmatter}---\n\n${rule.content}`;

            const fileName = path.basename(rule.filePath, path.extname(rule.filePath));
            const folder = targetIde === 'windsurf' ? '.windsurf' : '.agent';
            newPath = path.join(rootPath, folder, 'rules', `${fileName}.md`);

        } else if (targetIde === 'kiro') {
            // Target: Kiro (Steering vs Specs)
            const fileName = path.basename(rule.filePath, path.extname(rule.filePath));

            const kiroMeta: any = {};
            if (newMetadata.alwaysApply) {
                kiroMeta.inclusion = 'always';
                newPath = path.join(rootPath, '.kiro', 'steering', `${fileName}.md`);
            } else if (newMetadata.globs && newMetadata.globs.length > 0) {
                kiroMeta.inclusion = 'fileMatch';
                // User example showed a string for fileMatchPattern, but globs is array. 
                // If single glob, use string, else array? Or always array?
                // Let's use the raw globs value.
                kiroMeta.fileMatchPattern = newMetadata.globs.length === 1 ? newMetadata.globs[0] : newMetadata.globs;

                if (newMetadata.description) {
                    kiroMeta.description = newMetadata.description;
                }

                newPath = path.join(rootPath, '.kiro', 'steering', `${fileName}.md`);
            } else {
                kiroMeta.inclusion = 'manual';
                newPath = path.join(rootPath, '.kiro', 'specs', 'converted', `${fileName}.md`);
            }

            // Write frontmatter for Kiro too
            const frontmatter = yaml.dump(kiroMeta);
            newContent = `---\n${frontmatter}---\n\n${rule.content}`;
        }

        // --- 3. Write File (Avoid Overwrite) ---
        if (fs.existsSync(newPath)) {
            const dir = path.dirname(newPath);
            const ext = path.extname(newPath);
            const base = path.basename(newPath, ext);
            newPath = path.join(dir, `${base}_converted${ext}`);
        }

        // Ensure directory exists
        fs.mkdirSync(path.dirname(newPath), { recursive: true });

        fs.writeFileSync(newPath, newContent, 'utf-8');
        vscode.window.showInformationMessage(`Rule converted to ${targetIde}: ${path.basename(newPath)}`);
    }

    public async deleteRule(rule: Rule): Promise<void> {
        if (fs.existsSync(rule.filePath)) {
            fs.unlinkSync(rule.filePath);
            vscode.window.showInformationMessage(`Rule deleted: ${rule.name}`);
        } else {
            vscode.window.showErrorMessage(`File not found: ${rule.filePath}`);
        }
    }
}
