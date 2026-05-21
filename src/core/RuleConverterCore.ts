/**
 * RuleConverterCore.ts
 *
 * Platform-agnostic conversion logic. No 'vscode' imports — can be used
 * from both the VS Code extension and the standalone CLI.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Rule, IDE, RuleMetadata } from './RuleModel';

export interface ConversionResult {
    /** Absolute path to the file that was (or would be) written. */
    filePath: string;
    /** The final content to write. */
    content: string;
    /**
     * For flat-file formats (claude-code, gemini-cli), multiple rules may map
     * to the same output file. This flag indicates the file should be APPENDED
     * rather than overwritten.
     */
    appendMode: boolean;
}

// ---------------------------------------------------------------------------
// Metadata normalisation helpers
// ---------------------------------------------------------------------------

function normaliseMetadata(rule: Rule): RuleMetadata {
    const m = { ...rule.metadata } as any;

    // Normalise alwaysApply from trigger / inclusion
    if (m.alwaysApply === undefined) {
        if (m.trigger === 'always_on' || m.inclusion === 'always') {
            m.alwaysApply = true;
        } else {
            m.alwaysApply = false;
        }
    }

    // Normalise globs — coerce string to array (YAML can parse 'globs: *.js' as a string)
    if (m.globs !== undefined) {
        if (typeof m.globs === 'string') {
            m.globs = [m.globs];
        }
    } else {
        if (m.fileMatch && Array.isArray(m.fileMatch)) {
            m.globs = m.fileMatch;
        } else if (typeof m.fileMatch === 'string') {
            m.globs = [m.fileMatch];
        } else if (m.fileMatchPattern) {
            m.globs = Array.isArray(m.fileMatchPattern)
                ? m.fileMatchPattern
                : [m.fileMatchPattern as string];
        }
    }

    return m as RuleMetadata;
}

// ---------------------------------------------------------------------------
// Per-format output path helpers
// ---------------------------------------------------------------------------

function getCursorPath(rootPath: string, rule: Rule): string {
    return path.join(rootPath, '.cursor', 'rules', `${rule.name}.mdc`);
}

function getWindsurfPath(rootPath: string, rule: Rule): string {
    return path.join(rootPath, '.windsurf', 'rules', `${rule.name}.md`);
}

function getAntigravityPath(rootPath: string, rule: Rule): string {
    return path.join(rootPath, '.agent', 'rules', `${rule.name}.md`);
}

function getAgyPath(rootPath: string, rule: Rule): string {
    return path.join(rootPath, '.agents', 'rules', `${rule.name}.md`);
}

function getKiroPath(rootPath: string, rule: Rule, norm: RuleMetadata): string {
    if (norm.alwaysApply || (norm.globs && norm.globs.length > 0)) {
        return path.join(rootPath, '.kiro', 'steering', `${rule.name}.md`);
    }
    return path.join(rootPath, '.kiro', 'specs', `${rule.name}.md`);
}

/** Claude Code uses a single CLAUDE.md at the project root. */
function getClaudeCodePath(rootPath: string): string {
    return path.join(rootPath, 'CLAUDE.md');
}

/** Gemini CLI uses a single GEMINI.md at the project root. */
function getGeminiCliPath(rootPath: string): string {
    return path.join(rootPath, 'GEMINI.md');
}

function getCopilotPath(rootPath: string, rule: Rule, norm: RuleMetadata): string {
    // Always-on or no globs → global instructions file
    if (norm.alwaysApply || (!norm.globs || norm.globs.length === 0)) {
        return path.join(rootPath, '.github', 'copilot-instructions.md');
    }
    // Glob-targeted → per-rule instructions file
    return path.join(rootPath, '.github', 'instructions', `${rule.name}.instructions.md`);
}

// ---------------------------------------------------------------------------
// Per-format content builders
// ---------------------------------------------------------------------------

function buildCursorContent(rule: Rule, norm: RuleMetadata): string {
    const cursorMeta: any = {};
    cursorMeta.alwaysApply = !!(
        norm.alwaysApply || (rule.metadata as any).trigger === 'always_on'
    );
    if (norm.globs && norm.globs.length > 0) {
        cursorMeta.globs = norm.globs;
    }
    if (norm.description) {
        cursorMeta.description = norm.description;
    }
    const frontmatter = yaml.dump(cursorMeta);
    return `---\n${frontmatter}---\n\n${rule.content}`;
}

function buildWindsurfContent(rule: Rule, norm: RuleMetadata): string {
    return buildTriggerContent(rule, norm);
}

function buildAntigravityContent(rule: Rule, norm: RuleMetadata): string {
    return buildTriggerContent(rule, norm);
}

/** Shared builder for Windsurf and Antigravity (both use trigger-based frontmatter). */
function buildTriggerContent(rule: Rule, norm: RuleMetadata): string {
    const targetMeta: any = {};
    if (norm.alwaysApply) {
        targetMeta.trigger = 'always_on';
    } else if (norm.globs && norm.globs.length > 0) {
        targetMeta.trigger = 'glob';
        targetMeta.globs = norm.globs;
    } else if (norm.description) {
        targetMeta.trigger = 'model_decision';
        targetMeta.description = norm.description;
    } else {
        targetMeta.trigger = 'manual';
    }
    const frontmatter = yaml.dump(targetMeta);
    return `---\n${frontmatter}---\n\n${rule.content}`;
}

function buildKiroContent(rule: Rule, norm: RuleMetadata): string {
    const kiroMeta: any = {};
    if (norm.alwaysApply) {
        kiroMeta.inclusion = 'always';
    } else if (norm.globs && norm.globs.length > 0) {
        kiroMeta.inclusion = 'fileMatch';
        kiroMeta.fileMatchPattern =
            norm.globs.length === 1 ? norm.globs[0] : norm.globs;
        if (norm.description) {
            kiroMeta.description = norm.description;
        }
    } else {
        kiroMeta.inclusion = 'manual';
    }
    const frontmatter = yaml.dump(kiroMeta);
    return `---\n${frontmatter}---\n\n${rule.content}`;
}

/**
 * For Claude Code / Gemini CLI: produce a `## {title}\n\n{content}` section.
 * These sections will be appended to the flat file.
 */
function buildFlatFileSection(rule: Rule): string {
    const title = rule.metadata.sectionTitle || rule.name;
    return `## ${title}\n\n${rule.content.trim()}\n`;
}

function buildCopilotContent(rule: Rule, norm: RuleMetadata): string {
    if (norm.alwaysApply || !norm.globs || norm.globs.length === 0) {
        // Global instructions — no frontmatter, just markdown
        return rule.content.trim() + '\n';
    }
    // Targeted instructions — frontmatter with applyTo
    const applyTo = norm.globs.join(',');
    const frontmatter = `applyTo: '${applyTo}'`;
    return `---\n${frontmatter}\n---\n\n${rule.content.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Avoid-overwrite helper
// ---------------------------------------------------------------------------

function avoidOverwrite(filePath: string): string {
    if (!fs.existsSync(filePath)) {
        return filePath;
    }
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    return path.join(dir, `${base}_converted${ext}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a single rule to the target format.
 *
 * Returns a ConversionResult describing what should be written. The caller is
 * responsible for actually writing the file (so this function can be used in
 * dry-run mode and tested without touching the filesystem).
 */
export function convertRuleToResult(
    rule: Rule,
    targetIde: IDE,
    rootPath: string
): ConversionResult {
    const norm = normaliseMetadata(rule);
    let content = '';
    let filePath = '';
    let appendMode = false;

    switch (targetIde) {
        case 'cursor':
            content = buildCursorContent(rule, norm);
            filePath = avoidOverwrite(getCursorPath(rootPath, rule));
            break;

        case 'windsurf':
            content = buildWindsurfContent(rule, norm);
            filePath = avoidOverwrite(getWindsurfPath(rootPath, rule));
            break;

        case 'antigravity':
            content = buildAntigravityContent(rule, norm);
            filePath = avoidOverwrite(getAntigravityPath(rootPath, rule));
            break;

        case 'agy':
            content = buildAntigravityContent(rule, norm);
            filePath = avoidOverwrite(getAgyPath(rootPath, rule));
            break;

        case 'kiro':
            content = buildKiroContent(rule, norm);
            filePath = avoidOverwrite(getKiroPath(rootPath, rule, norm));
            break;

        case 'claude-code':
            if (norm.alwaysApply || !norm.globs || norm.globs.length === 0) {
                content = buildFlatFileSection(rule);
                filePath = getClaudeCodePath(rootPath);
                appendMode = true; // multiple rules → same file
            } else {
                content = buildCursorContent(rule, norm);
                filePath = avoidOverwrite(path.join(rootPath, '.claude', 'rules', `${rule.name}.md`));
                appendMode = false;
            }
            break;

        case 'gemini-cli':
            content = buildFlatFileSection(rule);
            filePath = getGeminiCliPath(rootPath);
            appendMode = true;
            break;

        case 'copilot':
            content = buildCopilotContent(rule, norm);
            filePath = avoidOverwrite(getCopilotPath(rootPath, rule, norm));
            break;

        default:
            throw new Error(`Unknown target format: ${targetIde}`);
    }

    return { filePath, content, appendMode };
}

/**
 * Write a ConversionResult to disk, creating parent directories as needed.
 *
 * For flat-file formats (claude-code, gemini-cli) with appendMode=true:
 *   - First rule: creates or replaces file with a header comment
 *   - Subsequent rules: appends the section
 *
 * Returns the final path that was written.
 */
export function writeConversionResult(
    result: ConversionResult,
    isFirstInBatch: boolean = true
): string {
    const { filePath, content, appendMode } = result;

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (appendMode) {
        if (isFirstInBatch && fs.existsSync(filePath)) {
            // Truncate the file for the first rule in a new batch conversion
            fs.writeFileSync(filePath, '', 'utf-8');
        }
        fs.appendFileSync(filePath, content + '\n', 'utf-8');
    } else {
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    return filePath;
}

/**
 * Convenience: convert AND write a single rule.
 * Returns the path written, or undefined if conversion failed.
 */
export function convertAndWrite(
    rule: Rule,
    targetIde: IDE,
    rootPath: string,
    isFirstInBatch: boolean = true
): string | undefined {
    try {
        const result = convertRuleToResult(rule, targetIde, rootPath);
        return writeConversionResult(result, isFirstInBatch);
    } catch (e) {
        console.error(`[RuleConverterCore] Failed to convert rule "${rule.name}":`, e);
        return undefined;
    }
}

/**
 * Delete a rule file from disk.
 */
export function deleteRuleFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    } else {
        throw new Error(`File not found: ${filePath}`);
    }
}
