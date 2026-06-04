import * as os from 'os';
import * as path from 'path';
import { IDE } from './RuleModel';

/**
 * Returns the directory that serves as the "global root" for AI tool configs.
 * All existing scanners accept rootPath — passing globalRoot makes them
 * scan the user-level (global) configs instead of the project-level ones.
 *
 * IDE → global path (relative to homedir):
 *   cursor:      ~/.cursor/rules/, ~/.cursor/mcp.json
 *   windsurf:    ~/.codeium/windsurf/memories/global_rules.md, ~/.codeium/windsurf/mcp_config.json
 *   claude-code: ~/.claude/CLAUDE.md, and MCP in ~/.claude.json (NOT ~/.mcp.json)
 *   gemini-cli:  ~/.gemini/settings.json, ~/.gemini/GEMINI.md
 *   agy / antigravity: ~/.gemini/GEMINI.md (rules), ~/.gemini/antigravity/mcp_config.json (MCP)
 */
export function getGlobalRoot(): string {
    return os.homedir();
}

/**
 * Real user-level (global) MCP config file for an IDE, per the official docs.
 * Returns null for IDEs whose global MCP surface is not modelled.
 * NB: these are absolute paths under $HOME — they intentionally bypass the
 * naive "swap rootPath for homedir" scheme, which produced non-existent paths.
 */
export function getGlobalMcpConfigPath(ide: IDE): string | null {
    const home = os.homedir();
    switch (ide) {
        case 'claude-code':
            // Claude Code reads user/local MCP from ~/.claude.json, never ~/.mcp.json.
            return path.join(home, '.claude.json');
        case 'cursor':
            return path.join(home, '.cursor', 'mcp.json');
        case 'windsurf':
            return path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
        case 'gemini-cli':
            return path.join(home, '.gemini', 'settings.json');
        case 'agy':
        case 'antigravity':
            // Official global MCP path has NO '-cli' segment (unlike skills/plugins).
            return getAntigravityGlobalMcpConfig();
        default:
            return null;
    }
}

/**
 * Real user-level (global) target for an IDE's RULES, per the official docs.
 *  - `flat`: a single markdown file rules are appended into.
 *  - `dir`:  a directory that holds one file per rule.
 *  - null:   the IDE has no file-based global rules surface (e.g. Cursor = UI only).
 */
export function getGlobalRulesTarget(ide: IDE): { type: 'flat' | 'dir'; path: string } | null {
    const home = os.homedir();
    switch (ide) {
        case 'claude-code':
            return { type: 'flat', path: path.join(home, '.claude', 'CLAUDE.md') };
        case 'gemini-cli':
            return { type: 'flat', path: path.join(home, '.gemini', 'GEMINI.md') };
        case 'antigravity':
        case 'agy':
            // Antigravity shares ~/.gemini/GEMINI.md with Gemini CLI for global rules.
            return { type: 'flat', path: path.join(home, '.gemini', 'GEMINI.md') };
        case 'windsurf':
            return { type: 'flat', path: path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md') };
        case 'copilot':
            return { type: 'flat', path: path.join(home, '.copilot', 'copilot-instructions.md') };
        case 'kiro':
            return { type: 'dir', path: path.join(home, '.kiro', 'steering') };
        case 'cursor':
            // Cursor user rules live in UI Settings — no global file to write.
            return null;
        default:
            return null;
    }
}

/** Real user-level (global) SKILLS directory for an IDE, or null if unsupported. */
export function getGlobalSkillsDir(ide: IDE): string | null {
    const home = os.homedir();
    switch (ide) {
        case 'claude-code':
            return path.join(home, '.claude', 'skills');
        case 'cursor':
            return path.join(home, '.cursor', 'skills');
        case 'gemini-cli':
            return path.join(home, '.gemini', 'skills');
        case 'copilot':
            return path.join(home, '.copilot', 'skills');
        case 'windsurf':
            return path.join(home, '.codeium', 'windsurf', 'skills');
        case 'antigravity':
        case 'agy':
            // Skills DO live under 'antigravity-cli' (unlike MCP, which drops '-cli').
            return getAntigravityGlobalSkillsDir();
        default:
            return null;
    }
}

/** Real user-level (global) HOOKS file for an IDE, or null if unsupported. */
export function getGlobalHooksFile(ide: IDE): string | null {
    const home = os.homedir();
    switch (ide) {
        case 'claude-code':
            return path.join(home, '.claude', 'settings.json');
        case 'windsurf':
            return path.join(home, '.codeium', 'windsurf', 'hooks.json');
        case 'copilot':
            return path.join(home, '.copilot', 'hooks', 'hooks.json');
        case 'antigravity':
        case 'agy':
            return path.join(home, '.gemini', 'antigravity-cli', 'hooks.json');
        default:
            return null;
    }
}

/** Default plugins directory for Claude Code marketplace plugins. */
export function getPluginsDir(): string {
    return path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
}

/** Root of the Claude Code plugins area (~/.claude/plugins). */
export function getClaudePluginsRootDir(): string {
    return path.join(os.homedir(), '.claude', 'plugins');
}

/** Antigravity CLI plugins directory (~/.gemini/antigravity-cli/plugins). */
export function getAntigravityPluginsDir(): string {
    return path.join(os.homedir(), '.gemini', 'antigravity-cli', 'plugins');
}

/** Antigravity CLI global shared skills directory (~/.gemini/antigravity-cli/skills). */
export function getAntigravityGlobalSkillsDir(): string {
    return path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills');
}

/**
 * Antigravity global MCP config file (~/.gemini/antigravity/mcp_config.json).
 * Note: MCP lives under `antigravity/` (no `-cli`), unlike skills/plugins which
 * live under `antigravity-cli/`. This matches the official Antigravity docs.
 */
export function getAntigravityGlobalMcpConfig(): string {
    return path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');
}
