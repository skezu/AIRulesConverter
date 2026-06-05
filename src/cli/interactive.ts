/**
 * interactive.ts — `aimig` with no arguments launches this.
 *
 * A dependency-free, full-screen terminal UI that scans the workspace (or the
 * global/user config when toggled) for agentic capabilities — rules, skills,
 * MCP servers, hook events, and installed plugins (Claude Code + Antigravity) —
 * across every supported AI tool, then lets you browse and CONVERT them:
 *
 *   - Left pane  ("navigation"): every detected AI tool, with capability counts.
 *   - Right pane ("window"): the selected tool's capabilities, one tool at a
 *     time. Every rule / skill / MCP server / hook event is an individually
 *     selectable item.
 *
 * Conversion: select any subset (Space) or all (a), press `c`, choose a target
 * format and project/global scope, and the selection is converted. With nothing
 * selected, `c` converts everything for the current tool.
 *
 * Keys (browse):
 *   ←/→            previous / next tool
 *   ↑/↓ or j/k     move item cursor
 *   PgUp/PgDn      scroll a page · Home/End first/last item
 *   Space          toggle-select item · a  select / clear all
 *   c              convert selection (or all) · g  toggle scan scope
 *   r              rescan · q / Ctrl-C  quit
 *
 * No external deps — raw-mode keypress handling via Node's `readline`, ANSI for
 * drawing. Falls back to a static scan when stdout is not a TTY.
 */

import * as readline from 'readline';
import { RuleScanner } from '../core/RuleScanner';
import { SkillScanner } from '../core/SkillScanner';
import { McpScanner } from '../core/McpScanner';
import { HooksScanner } from '../core/HooksScanner';
import { getGlobalRoot } from '../core/GlobalPathResolver';
import { IDE, Rule } from '../core/RuleModel';
import { Skill, McpConfig, HooksConfig, HookEntry } from '../core/AgentCapability';
import { ScannedPlugin, scanInstalledPlugins } from '../core/PluginInventory';
import {
    CapabilityKind,
    ConversionSelection,
    SelectionConversionReport,
    convertSelection,
    isKindSupported,
} from '../core/SelectionConverter';

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

function stripAnsi(s: string): string {
    return s.replace(ANSI_RE, '');
}

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

/** A single selectable capability inside a tool's panel. */
interface PanelItem {
    /** Unique id within the panel (kind-prefixed). */
    id: string;
    kind: CapabilityKind;
    /** Main display line (coloured, no checkbox/cursor). */
    label: string;
    /** Indented sub-lines (coloured, dim). Not selectable. */
    details: string[];
    rule?: Rule;
    skill?: Skill;
    serverName?: string;
    eventName?: string;
    plugin?: ScannedPlugin;
}

interface PanelSection {
    title: string;
    kind: CapabilityKind;
    items: PanelItem[];
}

interface Panel {
    ide: IDE;
    description: string;
    counts: { rules: number; skills: number; mcp: number; hooks: number; plugins: number };
    sections: PanelSection[];
    /** Flattened selectable items in display order. */
    items: PanelItem[];
    // Raw source capabilities (passed straight to the converter).
    rules: Rule[];
    skills: Skill[];
    mcp?: McpConfig;
    hooks?: HooksConfig;
    plugins: ScannedPlugin[];
}

export interface InteractiveOptions {
    /** Project root (used for project-scope scan & conversion). */
    projectRoot: string;
    /** Start scanning the global/user config instead of the project. */
    isGlobal: boolean;
    /** Ordered list of supported formats (id + human description). */
    formats: { id: IDE; description: string }[];
}

/**
 * Run every scanner (rules, skills, MCP, hooks) under `rootPath`, plus the
 * global plugin inventory (Claude Code + Antigravity), silencing scanner console
 * noise so it doesn't corrupt the TUI. Plugins are user-level by nature, so they
 * are always listed from the global plugin dirs regardless of the scan root.
 */
async function scanAll(rootPath: string): Promise<{
    rules: Rule[]; skills: Skill[]; mcps: McpConfig[]; hooks: HooksConfig[]; plugins: ScannedPlugin[];
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
        const plugins = scanInstalledPlugins();
        return { rules, skills, mcps, hooks, plugins };
    } finally {
        console.warn = origWarn;
        console.error = origError;
    }
}

function buildPanels(
    formats: { id: IDE; description: string }[],
    data: { rules: Rule[]; skills: Skill[]; mcps: McpConfig[]; hooks: HooksConfig[]; plugins?: ScannedPlugin[] },
): Panel[] {
    const { rules, skills, mcps, hooks } = data;
    const plugins = data.plugins ?? [];
    const detected = new Set<IDE>([
        ...rules.map(r => r.ide),
        ...skills.map(s => s.ide),
        ...mcps.map(m => m.ide),
        ...hooks.map(h => h.ide),
        ...plugins.map(p => p.ide),
    ]);

    const panels: Panel[] = [];
    for (const fmt of formats) {
        if (!detected.has(fmt.id)) { continue; }

        const ideRules = rules.filter(r => r.ide === fmt.id);
        const ideSkills = skills.filter(s => s.ide === fmt.id);
        const ideMcp = mcps.find(m => m.ide === fmt.id);
        const ideHooks = hooks.find(h => h.ide === fmt.id);
        const idePlugins = plugins.filter(p => p.ide === fmt.id);

        const sections = buildSections(ideRules, ideSkills, ideMcp, ideHooks, idePlugins);
        const items = sections.flatMap(s => s.items);

        panels.push({
            ide: fmt.id,
            description: fmt.description,
            counts: {
                rules: ideRules.length,
                skills: ideSkills.length,
                mcp: ideMcp ? Object.keys(ideMcp.servers).length : 0,
                hooks: ideHooks ? Object.keys(ideHooks.events).length : 0,
                plugins: idePlugins.length,
            },
            sections,
            items,
            rules: ideRules,
            skills: ideSkills,
            mcp: ideMcp,
            hooks: ideHooks,
            plugins: idePlugins,
        });
    }
    return panels;
}

function buildSections(
    rules: Rule[],
    skills: Skill[],
    mcp: McpConfig | undefined,
    hooks: HooksConfig | undefined,
    plugins: ScannedPlugin[] = [],
): PanelSection[] {
    const sections: PanelSection[] = [];

    if (rules.length > 0) {
        sections.push({
            title: `Rules (${rules.length})`,
            kind: 'rule',
            items: rules.map(rule => {
                const trigger = (rule.metadata as any).trigger ?? (rule.metadata.alwaysApply ? 'always_on' : 'manual');
                const rawGlobs = rule.metadata.globs;
                const globsArr = rawGlobs ? (Array.isArray(rawGlobs) ? rawGlobs : [rawGlobs]) : [];
                const globs = globsArr.length > 0 ? col(` [${globsArr.join(', ')}]`, c.dim) : '';
                const details: string[] = [];
                if (rule.metadata.description) { details.push(col(rule.metadata.description, c.dim)); }
                return {
                    id: `rule:${rule.id}`,
                    kind: 'rule' as const,
                    label: `${rule.name}${globs}  ${col(trigger, c.yellow)}`,
                    details,
                    rule,
                };
            }),
        });
    }

    if (skills.length > 0) {
        sections.push({
            title: `Skills (${skills.length})`,
            kind: 'skill',
            items: skills.map(skill => {
                const details: string[] = [];
                if (skill.description) { details.push(col(skill.description, c.dim)); }
                if (skill.additionalFiles && skill.additionalFiles.length > 0) {
                    details.push(`${col('Files:', c.dim)} ${skill.additionalFiles.join(', ')}`);
                }
                return {
                    id: `skill:${skill.id}`,
                    kind: 'skill' as const,
                    label: `${skill.name} ${col(`(${skill.folderName})`, c.dim)}`,
                    details,
                    skill,
                };
            }),
        });
    }

    if (mcp) {
        const names = Object.keys(mcp.servers);
        sections.push({
            title: `MCP Servers (${names.length})`,
            kind: 'mcp',
            items: names.map(name => {
                const server = mcp.servers[name] as any;
                const typeLabel = server.command ? 'stdio' : (server.url || server.serverUrl ? 'remote' : 'mcp');
                const details: string[] = [];
                if (server.command) {
                    details.push(`${col('Command:', c.dim)} ${[server.command, ...(server.args || [])].join(' ')}`);
                    if (server.env) { details.push(`${col('Env:', c.dim)} ${Object.keys(server.env).join(', ')}`); }
                } else if (server.url || server.serverUrl) {
                    details.push(`${col('URL:', c.dim)} ${server.url || server.serverUrl}`);
                }
                return {
                    id: `mcp:${name}`,
                    kind: 'mcp' as const,
                    label: `${name} ${col(`(${typeLabel})`, c.dim)}`,
                    details,
                    serverName: name,
                };
            }),
        });
    }

    if (hooks) {
        const eventNames = Object.keys(hooks.events);
        sections.push({
            title: `Event Hooks (${eventNames.length})`,
            kind: 'hooks',
            items: eventNames.map(eventName => {
                const entries: HookEntry[] = (hooks.events as Record<string, HookEntry[]>)[eventName] || [];
                const details: string[] = [];
                for (const entry of entries) {
                    if (entry.matcher) { details.push(`${col('Matcher:', c.dim)} ${col(entry.matcher, c.dim)}`); }
                    for (const hk of entry.hooks || []) {
                        const cmd = hk.command || (hk as any).script || hk.url || '';
                        details.push(`${col('-', c.dim)} ${col(hk.type, c.yellow)}: ${cmd}`);
                    }
                }
                return {
                    id: `hooks:${eventName}`,
                    kind: 'hooks' as const,
                    label: `${eventName} ${col(`(${entries.length} hook(s))`, c.dim)}`,
                    details,
                    eventName,
                };
            }),
        });
    }

    if (plugins.length > 0) {
        sections.push({
            title: `Plugins (${plugins.length})`,
            kind: 'plugin',
            items: plugins.map(plugin => {
                const sub: string[] = [];
                if (plugin.skillsCount) { sub.push(`${plugin.skillsCount} skill(s)`); }
                if (plugin.hookEventsCount) { sub.push(`${plugin.hookEventsCount} hook event(s)`); }
                if (plugin.mcpCount) { sub.push(`${plugin.mcpCount} MCP server(s)`); }
                const details: string[] = [];
                if (plugin.description) { details.push(col(plugin.description, c.dim)); }
                if (plugin.author) { details.push(`${col('Author:', c.dim)} ${plugin.author}`); }
                if (sub.length > 0) { details.push(col(sub.join(' · '), c.dim)); }
                return {
                    id: `plugin:${plugin.name}`,
                    kind: 'plugin' as const,
                    label: `${plugin.name} ${col(`(${plugin.format})`, c.dim)}`,
                    details,
                    plugin,
                };
            }),
        });
    }

    return sections;
}

// ---------------------------------------------------------------------------
// Interactive application
// ---------------------------------------------------------------------------

type Mode = 'browse' | 'target' | 'result';

interface WindowLine {
    text: string;
    /** Index into the current panel's `items` if this line is a selectable item. */
    itemIndex?: number;
}

class InteractiveApp {
    private readonly projectRoot: string;
    private readonly formats: { id: IDE; description: string }[];
    private isGlobal: boolean;

    private panels: Panel[] = [];
    private selectedTool = 0;       // index into panels
    private cursorItem = 0;         // index into current panel.items
    private scroll = 0;             // window scroll offset (in window lines)
    private scanning = false;
    private statusMsg = '';

    /** Per-tool selection of item ids. */
    private selections = new Map<IDE, Set<string>>();

    private mode: Mode = 'browse';
    // target picker state
    private targetIndex = 0;
    private targetScope: 'project' | 'global';
    // result state
    private report: SelectionConversionReport | null = null;
    private resultScroll = 0;

    private resolveDone: (() => void) | null = null;
    private keypressHandler = (str: string, key: readline.Key) => this.onKey(str, key);
    private resizeHandler = () => this.render();

    constructor(opts: InteractiveOptions) {
        this.projectRoot = opts.projectRoot;
        this.isGlobal = opts.isGlobal;
        this.formats = opts.formats;
        this.targetScope = opts.isGlobal ? 'global' : 'project';
    }

    async run(): Promise<void> {
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) { process.stdin.setRawMode(true); }
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

    // -- scanning ---------------------------------------------------------

    private get scanRoot(): string {
        return this.isGlobal ? getGlobalRoot() : this.projectRoot;
    }

    private conversionRoot(scope: 'project' | 'global'): string {
        return scope === 'global' ? getGlobalRoot() : this.projectRoot;
    }

    private async rescan(): Promise<void> {
        this.scanning = true;
        this.render();
        try {
            const data = await scanAll(this.scanRoot);
            this.panels = buildPanels(this.formats, data);
            if (this.selectedTool >= this.panels.length) {
                this.selectedTool = Math.max(0, this.panels.length - 1);
            }
            this.cursorItem = 0;
            this.scroll = 0;
        } catch (e: any) {
            this.statusMsg = col(`Scan error: ${e?.message ?? e}`, c.red);
        } finally {
            this.scanning = false;
            this.render();
        }
    }

    // -- geometry ---------------------------------------------------------

    private get cols(): number { return process.stdout.columns || 100; }
    private get rows(): number { return process.stdout.rows || 30; }
    private get navWidth(): number { return Math.min(30, Math.max(20, Math.floor(this.cols * 0.28))); }
    private get contentWidth(): number { return Math.max(10, this.cols - this.navWidth - 1); }
    private get bodyHeight(): number { return Math.max(3, this.rows - 4); }

    private get panel(): Panel | undefined { return this.panels[this.selectedTool]; }

    private currentSelection(): Set<string> {
        const ide = this.panel?.ide;
        if (!ide) { return new Set(); }
        let set = this.selections.get(ide);
        if (!set) { set = new Set(); this.selections.set(ide, set); }
        return set;
    }

    // -- key handling -----------------------------------------------------

    private onKey(_str: string, key: readline.Key): void {
        if (!key) { return; }
        const name = key.name;

        if ((key.ctrl && name === 'c') || (this.mode === 'browse' && name === 'q')) {
            this.quit();
            return;
        }
        if (this.scanning) { return; }

        if (this.mode === 'target') { this.onKeyTarget(name, key); return; }
        if (this.mode === 'result') { this.onKeyResult(name); return; }
        this.onKeyBrowse(name, key);
    }

    private onKeyBrowse(name: string | undefined, key: readline.Key): void {
        switch (name) {
            case 'right':
                this.toolDelta(1); break;
            case 'left':
                this.toolDelta(-1); break;
            case 'down':
            case 'j':
                this.cursorDelta(1); break;
            case 'up':
            case 'k':
                this.cursorDelta(-1); break;
            case 'pagedown':
                this.cursorDelta(this.bodyHeight - 1); break;
            case 'pageup':
                this.cursorDelta(-(this.bodyHeight - 1)); break;
            case 'home':
                this.cursorItem = 0; this.render(); break;
            case 'end':
                this.cursorItem = Math.max(0, (this.panel?.items.length ?? 1) - 1); this.render(); break;
            case 'space':
                this.toggleCurrent(); break;
            case 'a':
                this.toggleAll(); break;
            case 'c':
                this.openTargetPicker(); break;
            case 'g':
                this.toggleScope(); break;
            case 'r':
                void this.rescan(); break;
            case 'escape':
                this.quit(); break;
            default:
                if (name && /^[1-9]$/.test(name)) {
                    const idx = parseInt(name, 10) - 1;
                    if (idx < this.panels.length) {
                        this.selectedTool = idx;
                        this.cursorItem = 0;
                        this.scroll = 0;
                        this.render();
                    }
                }
                break;
        }
        void key;
    }

    private onKeyTarget(name: string | undefined, key: readline.Key): void {
        const targets = this.candidateTargets();
        switch (name) {
            case 'down':
            case 'j':
                this.targetIndex = (this.targetIndex + 1) % Math.max(1, targets.length); this.render(); break;
            case 'up':
            case 'k':
                this.targetIndex = (this.targetIndex - 1 + targets.length) % Math.max(1, targets.length); this.render(); break;
            case 'left':
            case 'right':
            case 's':
            case 'tab':
                this.targetScope = this.targetScope === 'project' ? 'global' : 'project'; this.render(); break;
            case 'return':
                this.runConversion(); break;
            case 'escape':
            case 'q':
                this.mode = 'browse'; this.render(); break;
            default:
                break;
        }
        void key;
    }

    private onKeyResult(name: string | undefined): void {
        switch (name) {
            case 'down':
            case 'j':
                this.resultScroll++; this.render(); break;
            case 'up':
            case 'k':
                this.resultScroll = Math.max(0, this.resultScroll - 1); this.render(); break;
            case 'q':
                this.quit(); break;
            default:
                // Any other key dismisses the report and rescans (to reflect new files).
                this.mode = 'browse';
                this.report = null;
                this.resultScroll = 0;
                void this.rescan();
                break;
        }
    }

    // -- browse actions ---------------------------------------------------

    private toolDelta(delta: number): void {
        if (this.panels.length === 0) { return; }
        this.selectedTool = (this.selectedTool + delta + this.panels.length) % this.panels.length;
        this.cursorItem = 0;
        this.scroll = 0;
        this.render();
    }

    private cursorDelta(delta: number): void {
        const n = this.panel?.items.length ?? 0;
        if (n === 0) { return; }
        this.cursorItem = Math.min(n - 1, Math.max(0, this.cursorItem + delta));
        this.render();
    }

    private toggleCurrent(): void {
        const item = this.panel?.items[this.cursorItem];
        if (!item) { return; }
        const set = this.currentSelection();
        if (set.has(item.id)) { set.delete(item.id); } else { set.add(item.id); }
        this.render();
    }

    private toggleAll(): void {
        const panel = this.panel;
        if (!panel || panel.items.length === 0) { return; }
        const set = this.currentSelection();
        const allSelected = panel.items.every(it => set.has(it.id));
        set.clear();
        if (!allSelected) { panel.items.forEach(it => set.add(it.id)); }
        this.render();
    }

    private toggleScope(): void {
        this.isGlobal = !this.isGlobal;
        this.targetScope = this.isGlobal ? 'global' : 'project';
        this.selectedTool = 0;
        void this.rescan();
    }

    private candidateTargets(): { id: IDE; description: string }[] {
        const src = this.panel?.ide;
        return this.formats.filter(f => f.id !== src);
    }

    private openTargetPicker(): void {
        if (!this.panel || this.panel.items.length === 0) { return; }
        this.mode = 'target';
        this.targetIndex = 0;
        this.render();
    }

    /** Build the ConversionSelection from the current panel's checked items (or all if none). */
    private buildSelection(): ConversionSelection | undefined {
        const panel = this.panel;
        if (!panel) { return undefined; }
        const set = this.currentSelection();
        if (set.size === 0) { return undefined; } // none checked → convert all

        const ruleIds = new Set<string>();
        const skillIds = new Set<string>();
        const mcpServerNames = new Set<string>();
        const hookEventNames = new Set<string>();
        const pluginNames = new Set<string>();
        for (const item of panel.items) {
            if (!set.has(item.id)) { continue; }
            if (item.kind === 'rule' && item.rule) { ruleIds.add(item.rule.id); }
            else if (item.kind === 'skill' && item.skill) { skillIds.add(item.skill.id); }
            else if (item.kind === 'mcp' && item.serverName) { mcpServerNames.add(item.serverName); }
            else if (item.kind === 'hooks' && item.eventName) { hookEventNames.add(item.eventName); }
            else if (item.kind === 'plugin' && item.plugin) { pluginNames.add(item.plugin.name); }
        }
        return { ruleIds, skillIds, mcpServerNames, hookEventNames, pluginNames };
    }

    private runConversion(): void {
        const panel = this.panel;
        const targets = this.candidateTargets();
        const target = targets[this.targetIndex];
        if (!panel || !target) { this.mode = 'browse'; this.render(); return; }

        let report: SelectionConversionReport;
        try {
            report = convertSelection({
                fromIde: panel.ide,
                toIde: target.id,
                rootPath: this.conversionRoot(this.targetScope),
                scope: this.targetScope,
                rules: panel.rules,
                skills: panel.skills,
                mcp: panel.mcp,
                hooks: panel.hooks,
                plugins: panel.plugins,
                selection: this.buildSelection(),
                dryRun: false,
            });
        } catch (e: any) {
            report = {
                fromIde: panel.ide, toIde: target.id, scope: this.targetScope, dryRun: false,
                outcomes: [{ kind: 'rule', name: '(conversion)', ok: false, error: e?.message ?? String(e) }],
                writtenPaths: [], successCount: 0, errorCount: 1,
            };
        }
        // Clear the selection that was just converted.
        this.currentSelection().clear();
        this.report = report;
        this.resultScroll = 0;
        this.mode = 'result';
        this.render();
    }

    // -- rendering --------------------------------------------------------

    private buildFrameLines(): string[] {
        const cols = this.cols;
        const lines: string[] = [];

        // Header
        const scope = this.isGlobal ? col(' [global]', c.magenta) : col(' [project]', c.dim);
        const title = col('aimig', c.bold, c.cyan) + col('  interactive', c.dim) + scope;
        const rootLabel = col(truncateToWidth(this.scanRoot, cols - visibleWidth(title) - 3), c.dim);
        lines.push(padToWidth(`${title}  ${rootLabel}`, cols));
        lines.push(col('─'.repeat(cols), c.dim));

        // Body
        if (this.mode === 'target') {
            for (const l of this.buildTargetBody()) { lines.push(padToWidth(l, cols)); }
        } else if (this.mode === 'result') {
            for (const l of this.buildResultBody()) { lines.push(padToWidth(l, cols)); }
        } else {
            const navLines = this.buildNavLines();
            const windowLines = this.buildWindowView();
            const sep = col('│', c.dim);
            for (let i = 0; i < this.bodyHeight; i++) {
                const left = padToWidth(navLines[i] ?? '', this.navWidth);
                const right = truncateToWidth(windowLines[i] ?? '', this.contentWidth);
                lines.push(left + sep + right);
            }
        }

        // Footer
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
        process.stdout.write('\x1b[H');
        process.stdout.write(lines.map(l => l + '\x1b[K').join('\r\n'));
        process.stdout.write('\x1b[J');
    }

    private buildNavLines(): string[] {
        const out: string[] = [];
        out.push(col('AI tools', c.bold));
        out.push('');
        if (this.scanning) { out.push(col('scanning…', c.yellow)); return out; }
        if (this.panels.length === 0) { out.push(col('none detected', c.dim)); return out; }

        this.panels.forEach((panel, idx) => {
            const isSel = idx === this.selectedTool;
            const num = idx < 9 ? `${idx + 1}` : ' ';
            const counts = this.shortCounts(panel.counts);
            const selCount = (this.selections.get(panel.ide)?.size ?? 0);
            const mark = selCount > 0 ? col('•', c.green) : ' ';
            if (isSel) {
                const inner = ` ${num} ${panel.ide} ${counts}`;
                out.push(col(padToWidth(stripAnsi(inner), this.navWidth), c.reverse, c.cyan));
            } else {
                out.push(padToWidth(`${mark}${col(num, c.dim)} ${panel.ide} ${col(counts, c.dim)}`, this.navWidth));
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
        if (counts.plugins) { parts.push(`${counts.plugins}P`); }
        return parts.join(' ');
    }

    /** Build the windowed (scrolled) slice of the current tool's items. */
    private buildWindowView(): string[] {
        if (this.scanning) { return [col('Scanning workspace…', c.yellow)]; }
        if (this.panels.length === 0) {
            return [
                col('No agentic capabilities detected.', c.bold),
                '',
                col(`Root: ${this.scanRoot}`, c.dim),
                '',
                col("'g' toggle global/project scope · 'r' rescan · 'q' quit.", c.dim),
            ];
        }

        const allLines = this.buildPanelLines();
        // Keep the cursor's line visible.
        const cursorLine = allLines.findIndex(l => l.itemIndex === this.cursorItem);
        if (cursorLine >= 0) {
            if (cursorLine < this.scroll) { this.scroll = cursorLine; }
            else if (cursorLine >= this.scroll + this.bodyHeight) { this.scroll = cursorLine - this.bodyHeight + 1; }
        }
        const maxScroll = Math.max(0, allLines.length - this.bodyHeight);
        this.scroll = Math.min(maxScroll, Math.max(0, this.scroll));
        return allLines.slice(this.scroll, this.scroll + this.bodyHeight).map(l => l.text);
    }

    private buildPanelLines(): WindowLine[] {
        const panel = this.panel;
        const out: WindowLine[] = [];
        if (!panel) { return out; }
        const set = this.currentSelection();

        out.push({ text: col(panel.description, c.bold, c.blue) + ' ' + col(`(${panel.ide})`, c.dim) });
        out.push({ text: '' });

        for (const section of panel.sections) {
            out.push({ text: col(section.title, c.bold, c.yellow) });
            for (const item of section.items) {
                const idx = panel.items.indexOf(item);
                const isCursor = idx === this.cursorItem;
                const checked = set.has(item.id);
                const box = checked ? col('[x]', c.green) : col('[ ]', c.dim);
                if (isCursor) {
                    const plain = ` ${checked ? '[x]' : '[ ]'} ${stripAnsi(item.label)}`;
                    out.push({ text: col(plain, c.reverse), itemIndex: idx });
                } else {
                    out.push({ text: ` ${box} ${item.label}`, itemIndex: idx });
                }
                for (const d of item.details) {
                    out.push({ text: `       ${d}` });
                }
            }
            out.push({ text: '' });
        }
        return out;
    }

    private buildTargetBody(): string[] {
        const panel = this.panel;
        const out: string[] = [];
        const sel = this.currentSelection();
        const count = sel.size === 0 ? (panel?.items.length ?? 0) : sel.size;
        const what = sel.size === 0 ? col('ALL', c.bold) : col(`${count}`, c.bold);

        out.push(col('Convert', c.bold, c.cyan) + `  ${what} item(s) from ` + col(panel?.ide ?? '?', c.yellow));
        out.push('');
        out.push('Scope:  ' + this.scopeToggle());
        out.push('');
        out.push(col('Target format:', c.bold) + col('  (↑/↓ choose · Enter convert · Esc cancel)', c.dim));
        out.push('');

        const targets = this.candidateTargets();
        const kinds = this.selectedKinds();
        targets.forEach((t, idx) => {
            const isSel = idx === this.targetIndex;
            const supportNote = this.supportNote(t.id, kinds);
            const line = `  ${t.id.padEnd(13)} ${t.description}${supportNote}`;
            out.push(isSel ? col(padToWidth(stripAnsi(line), Math.max(40, this.cols - 2)), c.reverse, c.cyan) : line);
        });
        return out;
    }

    private scopeToggle(): string {
        const proj = this.targetScope === 'project' ? col(' project ', c.reverse, c.green) : col(' project ', c.dim);
        const glob = this.targetScope === 'global' ? col(' global ', c.reverse, c.magenta) : col(' global ', c.dim);
        return `${proj} ${glob}  ${col('(Tab / ←→ to toggle)', c.dim)}`;
    }

    /** Which capability kinds are in the effective selection (for support hints). */
    private selectedKinds(): Set<CapabilityKind> {
        const panel = this.panel;
        const set = this.currentSelection();
        const kinds = new Set<CapabilityKind>();
        if (!panel) { return kinds; }
        const items = set.size === 0 ? panel.items : panel.items.filter(it => set.has(it.id));
        items.forEach(it => kinds.add(it.kind));
        return kinds;
    }

    private supportNote(toIde: IDE, kinds: Set<CapabilityKind>): string {
        const unsupported = Array.from(kinds).filter(k => !isKindSupported(k, toIde, this.targetScope));
        if (unsupported.length === 0) { return ''; }
        return col(`  (skips: ${unsupported.join(', ')})`, c.red);
    }

    private buildResultBody(): string[] {
        const r = this.report;
        const out: string[] = [];
        if (!r) { return out; }

        const head = `${r.dryRun ? 'Would convert' : 'Converted'} ` + col(r.fromIde, c.yellow) + ' → ' + col(r.toIde, c.green)
            + col(`  [${r.scope}]`, c.dim);
        out.push(col(head, c.bold));
        out.push(col(`${r.successCount} ok, ${r.errorCount} error(s)`, r.errorCount > 0 ? c.yellow : c.green));
        out.push('');

        for (const o of r.outcomes) {
            const icon = o.ok ? col('✓', c.green) : col('✗', c.red);
            const kind = col(`[${o.kind}]`, c.dim);
            const detail = o.ok ? col(o.writtenPath ?? '', c.dim) : col(o.error ?? '', c.red);
            out.push(`  ${icon} ${kind} ${o.name}  ${detail}`);
        }
        out.push('');
        out.push(col('Press any key to return (rescans) · q to quit.', c.dim));

        const maxScroll = Math.max(0, out.length - this.bodyHeight);
        this.resultScroll = Math.min(maxScroll, Math.max(0, this.resultScroll));
        return out.slice(this.resultScroll, this.resultScroll + this.bodyHeight);
    }

    private buildFooter(): string {
        if (this.statusMsg) { return this.statusMsg; }

        if (this.mode === 'target') {
            return col('↑↓', c.cyan) + ' format  ' + col('Tab/←→', c.cyan) + ' scope  '
                + col('Enter', c.cyan) + ' convert  ' + col('Esc', c.cyan) + ' cancel';
        }
        if (this.mode === 'result') {
            return col('↑↓', c.cyan) + ' scroll  ' + col('any key', c.cyan) + ' back  ' + col('q', c.cyan) + ' quit';
        }

        const nav = col('←→', c.cyan) + ' tool  '
            + col('↑↓', c.cyan) + ' item  '
            + col('Space', c.cyan) + ' select  '
            + col('a', c.cyan) + ' all  '
            + col('c', c.cyan) + ' convert  '
            + col('g', c.cyan) + ' scope  '
            + col('r', c.cyan) + ' rescan  '
            + col('q', c.cyan) + ' quit';
        let pos = '';
        if (this.panel) {
            const selCount = this.currentSelection().size;
            const selStr = selCount > 0 ? col(`  ${selCount} selected`, c.green) : '';
            pos = col(`  [${this.selectedTool + 1}/${this.panels.length}]`, c.dim) + selStr;
        }
        return nav + pos;
    }

    // -- test seams -------------------------------------------------------

    __setStateForTest(panels: Panel[], selectedTool = 0, isGlobal = this.isGlobal): void {
        this.panels = panels;
        this.selectedTool = selectedTool;
        this.cursorItem = 0;
        this.scroll = 0;
        this.scanning = false;
        this.isGlobal = isGlobal;
        this.mode = 'browse';
    }

    __keyForTest(name: string, opts: { ctrl?: boolean; shift?: boolean } = {}): string {
        this.onKey('', { name, ctrl: !!opts.ctrl, shift: !!opts.shift } as readline.Key);
        return this.renderFrame();
    }

    get __selectedTool(): number { return this.selectedTool; }
    get __cursorItem(): number { return this.cursorItem; }
    get __mode(): Mode { return this.mode; }
    get __report(): SelectionConversionReport | null { return this.report; }
    __selectionIds(): string[] { return Array.from(this.currentSelection()); }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Launches the interactive UI when stdout is a TTY; otherwise returns false so
 * the caller can fall back to non-interactive output.
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
    buildSections,
    truncateToWidth,
    padToWidth,
    visibleWidth,
};
