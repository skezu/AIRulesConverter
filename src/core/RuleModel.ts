export type IDE = 'cursor' | 'windsurf' | 'kiro' | 'antigravity';

export interface RuleMetadata {
    description?: string;
    globs?: string[];
    alwaysApply?: boolean;
    // Kiro specific
    inclusion?: 'always' | 'manual' | 'auto';
    fileMatch?: string[];
    // Antigravity specific
    trigger?: 'always_on' | 'manual' | 'model_decision' | 'glob';
}

export interface Rule {
    id: string;
    name: string;
    ide: IDE;
    category?: string; // e.g., 'steering', 'specs', 'global'
    filePath: string;
    content: string; // The markdown content (without frontmatter for Cursor)
    rawContent: string; // The full file content
    metadata: RuleMetadata;
}
