/**
 * interactive.ts — `aimig` with no arguments launches this.
 *
 * A dependency-free, full-screen terminal UI that scans the workspace for
 * agentic capabilities (rules, skills, MCP servers, hooks) across every
 * supported AI tool, then lets you browse the results one tool at a time:
 *
 *   - Left pane  ("navigation"): a list of every detected AI tool. Move the
 *     selection with ↑/↓ (or j/k), Tab, or number keys 1-9.
 *   - Right pane ("window"): the full scan detail for the selected tool only,
 *     scrollable with PgUp/PgDn / Home / End when it overflows.
 *
 * Keys: ↑/↓ or j/k select tool · ←/→ scroll window · r rescan · g toggle
 * global/project scope · q / Esc / Ctrl-C quit.
 *
 * No external deps — raw-mode keypress handling via Node's `readline`, ANSI
 * for drawing. Falls back to a static scan when stdout is not a TTY.
 */

import * as readline from 'readline';
import * as path from 'path';
import { RuleScanner } from '../core/RuleScanner';
import { SkillScanner } from '../core/SkillScanner';
import { McpScanner } from '../core/McpScanner';
import { HooksScanner } from '../core/HooksScanner';
import { getGlobalRoot } from '../core/GlobalPathResolver';
import { IDE, Rule } from '../core/RuleModel';
import { Skill, McpConfig, HooksConfig, HookEntry } from '../core/AgentCapability';

// ---------------------------------------------------------------------------
// ANSI helpers (interactive mode is only entered when stdout.isTTY)
// ---------------------------------------------------------------------------

const c = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    reverse: '\x1b[7m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    cyan:    '\x1b[36m',
    red:     '\x1b[31m',
    blue:    '\x1b[34m',
    magenta: '\x1b[35m',
};

function col(str: string, ...codes: string[]): string {
    return codes.join('') + str + c.reset;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Visible (printable) length of a string, ignoring ANSI escape sequences. */
function visibleWidth(s: string): number {
    return s.replace(ANSI_RE, '').length;
}

/** Truncate to `width` visible columns, preserving ANSI sequences and closing them. */
function truncateToWidth(s: string, width: number): string {
    if (width <= 0) { return ''; }
    let out = '';
    let w = 0;
    let i = 0;
    let sawColor = false;
    while (i < s.length) {
        if (s[i] === '\x1b') {
            ANSI_RE.lastIndex = i;
            const m = ANSI_RE.exec(s);
            if (m && m.index === i) {
                out += m[0];
                sawColor = true;
                i += m[0].length;
                continue;
            }
        }
        if (w >= width) { break; }
        out += s[i];
        w++;
        i++;
    }
    if (sawColor) { out += c.reset; }
    return out;
}

/** Pad (or truncate) to exactly `width` visible columns. */
function padToWidth(s: string, width: number): string {
    const w = visibleWidth(s);
    if (w > width) { return truncateToWidth(s, width); }
    return s + ' '.repeat(width - w);
}

// ---------------------------------------------------------------------------
// Scan model
// ---------------------------------------------------------------------------

interface Panel {
    ide: IDE;
    description: string;
    counts: { rules: number; skills: number; mcp: number; hooks: number };
    /** Pre-rendered (coloured, untruncated) detail lines for the right pane. */
    lines: string[];
}

export interface InteractiveOptions {
    rootPath: string;
    isGlobal: boolean;
    /** Ordered list of supported formats (id + human description). */
    formats: { id: IDE; description: string }[];
}

/** Run all four scanners while silencing their console noise (keeps the TUI clean). */
async function scanAll(rootPath: string): Promise<{
    rules: Rule[]; skills: Skill[]; mcps: McpConfig[]; hooks: HooksConfig[];
}> {
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = () => {};
    console.error = () => {};
    try {
        const rules = await new RuleScanner().scanDirectory(rootPath);
        const skills = await new SkillScanner().scanDirectory(rootPath);
        const mcps = await new McpScanner().scanDirectory(rootPath);
        const hooks = await new HooksScanner().scanDirectory(rootPath);
        return { rules, skills, mcps, hooks };
    } finally {
        console.warn = origWarn;
        console.error = origError;
    }
}

function buildPanels(
    formats: { id: IDE; description: string }[],
    data: { rules: Rule[]; skills: Skill[]; mcps: McpConfig[]; hooks: HooksConfig[] },
): Panel[] {
    const { rules, skills, mcps, hooks } = data;
    const detected = new Set<IDE>([
        ...rules.map(r => r.ide),
        ...skills.map(s => s.ide),
        ...mcps.map(m => m.ide),
        ...hooks.map(h => h.ide),
    ]);

    const panels: Panel[] = [];
    for (const fmt of formats) {
        if (!detected.has(fmt.id)) { continue; }

        const ideRules = rules.filter(r => r.ide === fmt.id);
        const ideSkills = skills.filter(s => s.ide === fmt.id);
        const ideMcp = mcps.find(m => m.ide === fmt.id);
        const ideHooks = hooks.find(h => h.ide === fmt.id);

        const mcpCount = ideMcp ? Object.keys(ideMcp.servers).length : 0;
        const hookCount = ideHooks ? Object.keys(ideHooks.events).length : 0;

        panels.push({
            ide: fmt.id,
            description: fmt.description,
            counts: { rules: ideRules.length, skills: ideSkills.length, mcp: mcpCount, hooks: hookCount },
            lines: buildDetailLines(fmt.description, fmt.id, ideRules, ideSkills, ideMcp, ideHooks),
        });
    }
    return panels;
}

function buildDetailLines(
    description: string,
    ide: IDE,
    rules: Rule[],
    skills: Skill[],
    mcp: McpConfig | undefined,
    hooks: HooksConfig | undefined,
): string[] {
    const lines: string[] = [];
    lines.push(col(description, c.bold, c.blue) + ' ' + col(`(${ide})`, c.dim));
    lines.push('');

    // Rules
    if (rules.length > 0) {
        lines.push(col(`Rules (${rules.length})`, c.bold, c.yellow));
        for (const rule of rules) {
            const trigger = (rule.metadata as any).trigger ?? (rule.metadata.alwaysApply ? 'always_on' : 'manual');
            const rawGlobs = rule.metadata.globs;
            const globsArr = rawGlobs ? (Array.isArray(rawGlobs) ? rawGlobs : [rawGlobs]) : [];
            const globs = globsArr.length > 0 ? col(` [${globsArr.join(', ')}]`, c.dim) : '';
            lines.push(`  ${col('◆', c.cyan)} ${rule.name}${globs}  ${col(trigger, c.yellow)}`);
            if (rule.metadata.description) {
                lines.push(`      ${col(rule.metadata.description, c.dim)}`);
            }
        }
        lines.push('');
    }

    // Skills
    if (skills.length > 0) {
        lines.push(col(`Skills (${skills.length})`, c.bold, c.yellow));
        for (const skill of skills) {
            lines.push(`  ${col('◆', c.cyan)} ${skill.name} ${col(`(${skill.folderName})`, c.dim)}`);
            if (skill.description) {
                lines.push(`      ${col(skill.description, c.dim)}`);
            }
            if (skill.additionalFiles && skill.additionalFiles.length > 0) {
                lines.push(`      ${col('Files:', c.dim)} ${skill.additionalFiles.join(', ')}`);
            }
        }
        lines.push('');
    }

    // MCP servers
    if (mcp) {
        const names = Object.keys(mcp.servers);
        lines.push(col(`MCP Servers (${names.length})`, c.bold, c.yellow));
        for (const name of names) {
            const server = mcp.servers[name] as any;
            const typeLabel = server.command ? 'stdio' : (server.url || server.serverUrl ? 'remote' : 'mcp');
            lines.push(`  ${col('◆', c.cyan)} ${name} ${col(`(${typeLabel})`, c.dim)}`);
            if (server.command) {
                const cmdStr = [server.command, ...(server.args || [])].join(' ');
                lines.push(`      ${col('Command:', c.dim)} ${cmdStr}`);
                if (server.env) {
                    lines.push(`      ${col('Env:', c.dim)} ${Object.keys(server.env).join(', ')}`);
                }
            } else if (server.url || server.serverUrl) {
                lines.push(`      ${col('URL:', c.dim)} ${server.url || server.serverUrl}`);
            }
        }
        lines.push('');
    }

    // Hooks
    if (hooks) {
        const eventNames = Object.keys(hooks.events);
        lines.push(col(`Event Hooks (${eventNames.length})`, c.bold, c.yellow));
        for (const eventName of eventNames) {
            const entries: HookEntry[] = (hooks.events as Record<string, HookEntry[]>)[eventName] || [];
            lines.push(`  ${col('◆', c.cyan)} ${eventName} ${col(`(${entries.length} hook(s))`, c.dim)}`);
            for (const entry of entries) {
                const matcher = entry.matcher ? ` [${entry.matcher}]` : '';
                if (matcher) {
                    lines.push(`      ${col('Matcher:', c.dim)}${col(matcher, c.dim)}`);
                }
                for (const hk of entry.hooks || []) {
                    const cmd = hk.command || (hk as any).script || hk.url || '';
                    lines.push(`        ${col('-', c.dim)} ${col(hk.type, c.yellow)}: ${cmd}`);
                }
            }
        }
        lines.push('');
    }

    if (lines.length <= 2) {
        lines.push(col('No capabilities detected for this tool.', c.dim));
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Interactive application
// ---------------------------------------------------------------------------

class InteractiveApp {
    private rootPath: string;
    private isGlobal: boolean;
    private readonly formats: { id: IDE; description: string }[];

    private panels: Panel[] = [];
    private selected = 0;     // index into panels (which tool)
    private scroll = 0;       // vertical scroll offset within the right pane
    private scanning = false;
    private statusMsg = '';

    private resolveDone: (() => void) | null = null;
    private keypressHandler = (str: string, key: readline.Key) => this.onKey(str, key);
    private resizeHandler = () => this.render();

    constructor(opts: InteractiveOptions) {
        this.rootPath = opts.rootPath;
        this.isGlobal = opts.isGlobal;
        this.formats = opts.formats;
    }

    async run(): Promise<void> {
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.on('keypress', this.keypressHandler);
        process.stdout.on('resize', this.resizeHandler);

        process.stdout.write('\x1b[?1049h'); // enter alternate screen buffer
        process.stdout.write('\x1b[?25l');   // hide cursor

        await this.rescan();

        await new Promise<void>(resolve => { this.resolveDone = resolve; });
    }

    private cleanup(): void {
        process.stdin.off('keypress', this.keypressHandler);
        process.stdout.off('resize', this.resizeHandler);
        if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(false); } catch { /* ignore */ }
        }
        process.stdin.pause();
        process.stdout.write('\x1b[?25h');   // show cursor
        process.stdout.write('\x1b[?1049l'); // leave alternate screen buffer
    }

    private quit(): void {
        this.cleanup();
        if (this.resolveDone) { this.resolveDone(); }
    }

    private async rescan(): Promise<void> {
        this.scanning = true;
        this.statusMsg = '';
        this.render();
        try {
            const data = await scanAll(this.rootPath);
            this.panels = buildPanels(this.formats, data);
            if (this.selected >= this.panels.length) {
                this.selected = Math.max(0, this.panels.length - 1);
            }
            this.scroll = 0;
        } catch (e: any) {
            this.statusMsg = col(`Scan error: ${e?.message ?? e}`, c.red);
        } finally {
            this.scanning = false;
            this.render();
        }
    }

    // -- layout geometry --------------------------------------------------

    private get cols(): number { return process.stdout.columns || 100; }
    private get rows(): number { return process.stdout.rows || 30; }
    private get navWidth(): number { return Math.min(30, Math.max(20, Math.floor(this.cols * 0.28))); }
    private get contentWidth(): number { return Math.max(10, this.cols - this.navWidth - 1); }
    /** Body height = total rows minus header (2) and footer (2). */
    private get bodyHeight(): number { return Math.max(3, this.rows - 4); }

    private get currentLines(): string[] {
        return this.panels[this.selected]?.lines ?? [];
    }

    private get maxScroll(): number {
        return Math.max(0, this.currentLines.length - this.bodyHeight);
    }

    // -- key handling -----------------------------------------------------

    private onKey(_str: string, key: readline.Key): void {
        if (!key) { return; }
        const name = key.name;

        if ((key.ctrl && name === 'c') || name === 'q' || name === 'escape') {
            this.quit();
            return;
        }
        if (this.scanning) { return; }

        switch (name) {
            case 'down':
            case 'j':
                this.selectDelta(1);
                break;
            case 'up':
            case 'k':
                this.selectDelta(-1);
                break;
            case 'tab':
                this.selectDelta(key.shift ? -1 : 1);
                break;
            case 'right':
            case 'l':
            case 'pagedown':
            case 'space':
                this.scrollBy(name === 'right' || name === 'l' ? 3 : this.bodyHeight - 1);
                break;
            case 'left':
            case 'h':
            case 'pageup':
                this.scrollBy(name === 'left' || name === 'h' ? -3 : -(this.bodyHeight - 1));
                break;
            case 'home':
                this.scroll = 0;
                this.render();
                break;
            case 'end':
                this.scroll = this.maxScroll;
                this.render();
                break;
            case 'r':
                void this.rescan();
                break;
            case 'g':
                this.toggleScope();
                break;
            default:
                if (name && /^[1-9]$/.test(name)) {
                    const idx = parseInt(name, 10) - 1;
                    if (idx < this.panels.length) {
                        this.selected = idx;
                        this.scroll = 0;
                        this.render();
                    }
                }
                break;
        }
    }

    private selectDelta(delta: number): void {
        if (this.panels.length === 0) { return; }
        this.selected = (this.selected + delta + this.panels.length) % this.panels.length;
        this.scroll = 0;
        this.render();
    }

    private scrollBy(delta: number): void {
        this.scroll = Math.min(this.maxScroll, Math.max(0, this.scroll + delta));
        this.render();
    }

    private toggleScope(): void {
        this.isGlobal = !this.isGlobal;
        this.rootPath = this.isGlobal ? getGlobalRoot() : process.cwd();
        this.selected = 0;
        void this.rescan();
    }

    // -- rendering --------------------------------------------------------

    /** Build the full frame as an array of rows (no cursor control codes). */
    private buildFrameLines(): string[] {
        const cols = this.cols;
        const lines: string[] = [];

        // Header (2 lines)
        const scope = this.isGlobal ? col(' [global]', c.magenta) : col(' [project]', c.dim);
        const title = col('aimig', c.bold, c.cyan) + col('  interactive scan', c.dim) + scope;
        const rootLabel = col(truncateToWidth(this.rootPath, cols - visibleWidth(title) - 3), c.dim);
        lines.push(padToWidth(`${title}  ${rootLabel}`, cols));
        lines.push(col('─'.repeat(cols), c.dim));

        // Body (bodyHeight lines): nav | window
        const navLines = this.buildNavLines();
        const windowLines = this.buildWindowLines();
        const sep = col('│', c.dim);
        for (let i = 0; i < this.bodyHeight; i++) {
            const left = padToWidth(navLines[i] ?? '', this.navWidth);
            const right = truncateToWidth(windowLines[i] ?? '', this.contentWidth);
            lines.push(left + sep + right);
        }

        // Footer (2 lines)
        lines.push(col('─'.repeat(cols), c.dim));
        lines.push(padToWidth(this.buildFooter(), cols));
        return lines;
    }

    /** Test seam: render one frame to a plain string (no terminal control codes). */
    renderFrame(): string {
        return this.buildFrameLines().join('\n');
    }

    private render(): void {
        const lines = this.buildFrameLines();
        // Paint: home cursor, then write each row clearing to EOL, clear below.
        process.stdout.write('\x1b[H');
        process.stdout.write(lines.map(l => l + '\x1b[K').join('\r\n'));
        process.stdout.write('\x1b[J');
    }

    private buildNavLines(): string[] {
        const out: string[] = [];
        out.push(col('AI tools', c.bold));
        out.push('');

        if (this.scanning) {
            out.push(col('scanning…', c.yellow));
            return out;
        }
        if (this.panels.length === 0) {
            out.push(col('none detected', c.dim));
            return out;
        }

        this.panels.forEach((panel, idx) => {
            const isSel = idx === this.selected;
            const num = idx < 9 ? `${idx + 1}` : ' ';
            const counts = this.shortCounts(panel.counts);
            // Build the inner label first, then highlight the whole padded cell.
            const label = ` ${num} ${panel.ide}`;
            const inner = padToWidth(`${label}`, this.navWidth - visibleWidth(counts) - 1)
                + counts + ' ';
            if (isSel) {
                out.push(col(stripAnsi(inner), c.reverse, c.cyan));
            } else {
                out.push(padToWidth(` ${col(num, c.dim)} ${panel.ide} ${col(counts, c.dim)}`, this.navWidth));
            }
        });
        return out;
    }

    private shortCounts(counts: Panel['counts']): string {
        const parts: string[] = [];
        if (counts.rules) { parts.push(`${counts.rules}R`); }
        if (counts.skills) { parts.push(`${counts.skills}S`); }
        if (counts.mcp) { parts.push(`${counts.mcp}M`); }
        if (counts.hooks) { parts.push(`${counts.hooks}H`); }
        return parts.join(' ');
    }

    private buildWindowLines(): string[] {
        if (this.scanning) { return [col('Scanning workspace…', c.yellow)]; }
        if (this.panels.length === 0) {
            return [
                col('No agentic capabilities detected.', c.bold),
                '',
                col(`Root: ${this.rootPath}`, c.dim),
                '',
                col("Press 'g' to toggle global/project scope, 'r' to rescan, 'q' to quit.", c.dim),
            ];
        }
        const all = this.currentLines;
        return all.slice(this.scroll, this.scroll + this.bodyHeight);
    }

    // -- test seams (not used in normal operation) -----------------------

    /** Inject scan results without touching disk (test only). */
    __setStateForTest(panels: Panel[], selected = 0, isGlobal = this.isGlobal): void {
        this.panels = panels;
        this.selected = selected;
        this.scroll = 0;
        this.scanning = false;
        this.isGlobal = isGlobal;
    }

    /** Feed a synthetic keypress (test only). Returns the resulting frame. */
    __keyForTest(name: string, opts: { ctrl?: boolean; shift?: boolean } = {}): string {
        this.onKey('', { name, ctrl: !!opts.ctrl, shift: !!opts.shift } as readline.Key);
        return this.renderFrame();
    }

    get __selected(): number { return this.selected; }
    get __scroll(): number { return this.scroll; }

    private buildFooter(): string {
        if (this.statusMsg) { return this.statusMsg; }
        const nav = col('↑↓/jk', c.cyan) + ' tool  '
            + col('PgUp/PgDn', c.cyan) + ' scroll  '
            + col('1-9', c.cyan) + ' jump  '
            + col('g', c.cyan) + ' scope  '
            + col('r', c.cyan) + ' rescan  '
            + col('q', c.cyan) + ' quit';
        let pos = '';
        if (this.panels.length > 0) {
            const total = this.currentLines.length;
            const end = Math.min(this.scroll + this.bodyHeight, total);
            const scrollInfo = this.maxScroll > 0 ? col(`  lines ${this.scroll + 1}-${end}/${total}`, c.dim) : '';
            pos = col(`  [${this.selected + 1}/${this.panels.length}]`, c.dim) + scrollInfo;
        }
        return nav + pos;
    }
}

function stripAnsi(s: string): string {
    return s.replace(ANSI_RE, '');
}

/**
 * Entry point. Launches the interactive UI when stdout is a TTY; otherwise
 * returns false so the caller can fall back to non-interactive output.
 */
export async function runInteractive(opts: InteractiveOptions): Promise<boolean> {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
        return false;
    }
    const app = new InteractiveApp(opts);
    await app.run();
    return true;
}

/** Internal surface exposed for unit tests only. Not part of the public API. */
export const _internals = {
    InteractiveApp,
    buildPanels,
    buildDetailLines,
    truncateToWidth,
    padToWidth,
    visibleWidth,
};
