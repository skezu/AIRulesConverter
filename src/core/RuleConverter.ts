import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Rule, IDE, RuleMetadata } from './RuleModel';

export class RuleConverter {
    constructor() { }

    public async convertRule(rule: Rule, targetIde: IDE): Promise<string | undefined> {
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
            newPath = path.join(rootPath, '.cursor', 'rules', `${rule.name}.mdc`);

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

            const folder = targetIde === 'windsurf' ? '.windsurf' : '.agent';
            newPath = path.join(rootPath, folder, 'rules', `${rule.name}.md`);

        } else if (targetIde === 'kiro') {
            // Target: Kiro (Steering vs Specs)
            // Target: Kiro (Steering vs Specs)

            const kiroMeta: any = {};
            if (newMetadata.alwaysApply) {
                kiroMeta.inclusion = 'always';
                newPath = path.join(rootPath, '.kiro', 'steering', `${rule.name}.md`);
            } else if (newMetadata.globs && newMetadata.globs.length > 0) {
                kiroMeta.inclusion = 'fileMatch';
                // User example showed a string for fileMatchPattern, but globs is array. 
                // If single glob, use string, else array? Or always array?
                // Let's use the raw globs value.
                kiroMeta.fileMatchPattern = newMetadata.globs.length === 1 ? newMetadata.globs[0] : newMetadata.globs;

                if (newMetadata.description) {
                    kiroMeta.description = newMetadata.description;
                }

                newPath = path.join(rootPath, '.kiro', 'steering', `${rule.name}.md`);
            } else {
                kiroMeta.inclusion = 'manual';
                // For specs, we might want to keep structure or put in 'converted' folder?
                // The current requirement is just to conserve nested subfolders.
                // Kiro specs are usually structured by folders anyway.
                // Let's assume we map the structure directly into .kiro/specs
                newPath = path.join(rootPath, '.kiro', 'specs', `${rule.name}.md`);
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
            // Construct a new filename that preserves the directory structure but appends _converted
            newPath = path.join(dir, `${base}_converted${ext}`);
        }

        // Ensure directory exists
        fs.mkdirSync(path.dirname(newPath), { recursive: true });

        fs.writeFileSync(newPath, newContent, 'utf-8');
        // Log to output channel instead of showing message for every single file if bulk converting?
        // But for single file conversion, we want feedback.
        // We will handle bulk conversion feedback in the command handler.
        // For now, let's keep the message but maybe we can suppress it if we add an option?
        // Simpler: Just make it return the path so caller can count/notify.
        return newPath;
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
