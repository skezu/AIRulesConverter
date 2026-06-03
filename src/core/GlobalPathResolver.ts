import * as os from 'os';
import * as path from 'path';

/**
 * Returns the directory that serves as the "global root" for AI tool configs.
 * All existing scanners accept rootPath — passing globalRoot makes them
 * scan the user-level (global) configs instead of the project-level ones.
 *
 * IDE → global path (relative to homedir):
 *   cursor:      ~/.cursor/rules/
 *   windsurf:    ~/.windsurf/rules/
 *   claude-code: ~/.claude/CLAUDE.md and ~/.mcp.json
 *   gemini-cli:  ~/.gemini/settings.json
 *   agy:         ~/.agent/rules/
 */
export function getGlobalRoot(): string {
    return os.homedir();
}

/** Default plugins directory for Claude Code marketplace plugins. */
export function getPluginsDir(): string {
    return path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
}
