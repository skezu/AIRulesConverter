export type IDE = 'cursor' | 'windsurf' | 'kiro' | 'antigravity' | 'agy' | 'claude-code' | 'gemini-cli' | 'copilot';

export interface RuleMetadata {
    description?: string;
    globs?: string[];
    alwaysApply?: boolean;
    // Kiro specific
    inclusion?: 'always' | 'manual' | 'auto' | 'fileMatch';
    fileMatch?: string[];
    fileMatchPattern?: string | string[];
    // Antigravity / Windsurf / agy specific
    trigger?: 'always_on' | 'manual' | 'model_decision' | 'glob';
    // Claude Code targeted-rule frontmatter (.claude/rules/*.md) — globs live under `paths`
    paths?: string[];
    // GitHub Copilot specific
    applyTo?: string;
    // Flat-file CLI formats (Claude Code, Gemini CLI) — the section heading used
    sectionTitle?: string;
    // Scope of the rule for flat-file formats
    scope?: 'global' | 'project' | 'directory';
}

export interface Rule {
    id: string;
    name: string;
    ide: IDE;
    category?: string; // e.g., 'steering', 'specs', 'global', 'rules'
    filePath: string;
    content: string; // The markdown content (without frontmatter for Cursor)
    rawContent: string; // The full file content
    metadata: RuleMetadata;
    /** True if this file was discovered via a symlink */
    isSymlinked?: boolean;
    /** Resolved real path if symlinked */
    realPath?: string;
}
