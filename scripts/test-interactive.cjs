/* Headless test harness for the interactive scanner + conversion UI.
 * Runs without a TTY by driving InteractiveApp's test seams directly, and
 * exercises the core SelectionConverter in dry-run mode (no disk writes).
 *
 * process.stdout.write is muted for the whole run (so the app's ANSI paints and
 * any async rescan renders never leak); test logging goes through `realWrite`. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _internals } = require('../out/_interactive_test.cjs');
const sc = require('../out/_selection_test.cjs');
const { InteractiveApp, buildPanels } = _internals;
const { convertSelection, isKindSupported } = sc;

const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true; // mute app paints for the whole run

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); realWrite('  ok - ' + msg + '\n'); pass++; }
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

// The app's runConversion writes for real — give it a throwaway project root.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aimig-it-'));
process.on('exit', () => { try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {} });

process.stdout.columns = 100;
process.stdout.rows = 30;

// --- synthetic scan data ---
const formats = [
    { id: 'cursor', description: 'Cursor IDE' },
    { id: 'claude-code', description: 'Claude Code CLI (Anthropic)' },
    { id: 'gemini-cli', description: 'Gemini CLI (Google)' },
];
const data = {
    rules: [
        { id: 'cur-r1', name: 'style', ide: 'cursor', filePath: 'a', content: 'body', rawContent: '', metadata: { globs: ['*.ts'], description: 'TS style' } },
        { id: 'cc-r1', name: 'overview', ide: 'claude-code', filePath: 'b', content: 'over', rawContent: '', metadata: { alwaysApply: true } },
        { id: 'cc-r2', name: 'api', ide: 'claude-code', filePath: 'c', content: 'api', rawContent: '', metadata: { globs: ['src/**'], description: 'api rule' } },
    ],
    skills: [
        { id: 'cc-s1', folderName: 'review', name: 'review', description: 'do review', ide: 'claude-code', category: 'workspace', skillFilePath: '', folderPath: '/x/review', rawContent: '', content: '', metadata: {}, additionalFiles: ['ref.md'] },
    ],
    mcps: [
        { ide: 'claude-code', filePath: '', scope: 'project', servers: { fs: { command: 'npx', args: ['server-fs'] }, remote: { url: 'https://x' } } },
    ],
    hooks: [
        { ide: 'claude-code', filePath: '', scope: 'project', events: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } },
    ],
    plugins: [
        { name: 'eccc', description: 'big plugin', author: 'aff', format: 'claude-code', ide: 'claude-code', sourceDir: '/p/eccc', skillsCount: 5, hookEventsCount: 1, mcpCount: 0 },
    ],
};

// --- buildPanels ---
const panels = buildPanels(formats, data);
ok(panels.length === 2, 'buildPanels: only detected tools (cursor + claude-code)');
const cc = panels.find(p => p.ide === 'claude-code');
ok(cc.counts.rules === 2 && cc.counts.skills === 1 && cc.counts.mcp === 2 && cc.counts.hooks === 1 && cc.counts.plugins === 1, 'claude-code counts 2R 1S 2M 1H 1P');
ok(cc.items.length === 7, 'claude-code flattened items = 7 (rules+skill+mcp+hooks+plugin all selectable)');
ok(cc.items.map(i => i.kind).join(',') === 'rule,rule,skill,mcp,mcp,hooks,plugin', 'item order: rules, skills, mcp, hooks, plugins');

// --- app: browse + selection ---
const app = new InteractiveApp({ projectRoot: TMP_ROOT, isGlobal: false, formats });
app.__setStateForTest(panels, 1); // claude-code

app.__keyForTest('down');
ok(app.__cursorItem === 1, 'down moves item cursor within the tool');

app.__keyForTest('space'); // select rule "api" (item 1)
ok(app.__selectionIds().length === 1 && app.__selectionIds()[0] === 'rule:cc-r2', 'Space selects the item under cursor');
let frame = strip(app.renderFrame());
ok(/\[x\]/.test(frame), 'checkbox renders [x] for selected item');
ok(/1 selected/.test(frame), 'footer shows selection count');
ok(/Plugins \(1\)/.test(frame) && /eccc/.test(frame), 'window shows a Plugins section with the plugin item');

app.__keyForTest('a');
ok(app.__selectionIds().length === 7, "'a' selects all 7 items (incl. plugin)");
app.__keyForTest('a');
ok(app.__selectionIds().length === 0, "'a' again clears all");

// --- conversion target picker ---
app.__keyForTest('a');   // select all
app.__keyForTest('c');   // open picker
ok(app.__mode === 'target', "'c' opens the target picker");
frame = strip(app.renderFrame());
ok(/Target format:/.test(frame) && /cursor/.test(frame) && /gemini-cli/.test(frame), 'picker lists candidate targets');
ok(/project/.test(frame) && /global/.test(frame), 'picker shows scope toggle');

app.__keyForTest('tab');
ok(/global/.test(strip(app.renderFrame())), 'Tab toggles scope to global');
app.__keyForTest('tab'); // back to project

app.__keyForTest('escape');
ok(app.__mode === 'browse', 'Esc cancels target picker');

// --- run a real conversion (claude-code -> gemini-cli) into TMP_ROOT ---
// candidate targets for claude-code = [cursor, gemini-cli]; pick gemini-cli (index 1)
app.__keyForTest('a');         // select all
app.__keyForTest('c');
app.__keyForTest('down');      // gemini-cli
app.__keyForTest('return');    // convert
ok(app.__mode === 'result', 'Enter runs conversion and shows the result view');
const rep = app.__report;
ok(rep && rep.toIde === 'gemini-cli', 'report target is gemini-cli');
ok(rep.outcomes.some(o => o.kind === 'rule' && o.ok), 'rules converted to gemini-cli');
ok(rep.outcomes.some(o => o.kind === 'hooks' && !o.ok), 'hooks reported unsupported for gemini-cli');
ok(rep.outcomes.some(o => o.kind === 'plugin' && !o.ok), 'plugin reported unsupported for gemini-cli (no global write)');
ok(fs.existsSync(path.join(TMP_ROOT, 'GEMINI.md')), 'GEMINI.md written to project root');
frame = strip(app.renderFrame());
ok(/Converted/.test(frame) && /gemini-cli/.test(frame), 'result view header rendered');

app.__keyForTest('space'); // dismiss -> rescan -> browse (rescan is muted)
ok(app.__mode === 'browse', 'any key dismisses the result view');

// =========================================================================
// Core SelectionConverter (dry-run, no disk writes)
// =========================================================================
ok(isKindSupported('mcp', 'kiro', 'project') === false, 'isKindSupported: MCP not supported for kiro');
ok(isKindSupported('hooks', 'cursor', 'project') === false, 'isKindSupported: hooks not supported for cursor');
ok(isKindSupported('rule', 'cursor', 'global') === false, 'isKindSupported: global rules not supported for cursor');
ok(isKindSupported('rule', 'claude-code', 'project') === true, 'isKindSupported: rules supported for claude-code');

const ccRules = data.rules.filter(r => r.ide === 'claude-code');
const ccSkills = data.skills.filter(s => s.ide === 'claude-code');
const ccMcp = data.mcps.find(m => m.ide === 'claude-code');
const ccHooks = data.hooks.find(h => h.ide === 'claude-code');

const allRep = convertSelection({
    fromIde: 'claude-code', toIde: 'agy', rootPath: TMP_ROOT, scope: 'project',
    rules: ccRules, skills: ccSkills, mcp: ccMcp, hooks: ccHooks, dryRun: true,
});
ok(allRep.outcomes.filter(o => o.kind === 'rule').length === 2, 'convert-all (dry-run): two rules');
ok(allRep.outcomes.filter(o => o.kind === 'mcp').length === 2, 'convert-all (dry-run): two mcp servers');
ok(allRep.outcomes.some(o => o.kind === 'hooks' && o.ok), 'convert-all (dry-run): hooks converted to agy');

const specRep = convertSelection({
    fromIde: 'claude-code', toIde: 'agy', rootPath: TMP_ROOT, scope: 'project',
    rules: ccRules, skills: ccSkills, mcp: ccMcp, hooks: ccHooks,
    selection: { ruleIds: new Set(['cc-r1']), skillIds: new Set(), mcpServerNames: new Set(['fs']), hookEventNames: new Set() },
    dryRun: true,
});
ok(specRep.outcomes.length === 2, 'specific selection: exactly 2 items (1 rule + 1 mcp server)');
ok(specRep.outcomes.some(o => o.kind === 'rule' && o.name === 'overview'), 'selected rule = overview');
ok(specRep.outcomes.some(o => o.kind === 'mcp' && o.name === 'fs'), 'selected mcp server = fs');

// global scope: rules to cursor unsupported, but skills to claude-code ok
const globRep = convertSelection({
    fromIde: 'claude-code', toIde: 'cursor', rootPath: TMP_ROOT, scope: 'global',
    rules: ccRules, skills: [], dryRun: true,
});
ok(globRep.errorCount === ccRules.length && globRep.successCount === 0, 'global rules to cursor: all unsupported');

const sameRep = convertSelection({ fromIde: 'cursor', toIde: 'cursor', rootPath: '.', scope: 'project', rules: [], skills: [], dryRun: true });
ok(sameRep.errorCount === 1, 'identical source/target is rejected');

realWrite(`\nAll ${pass} checks passed.\n`);
