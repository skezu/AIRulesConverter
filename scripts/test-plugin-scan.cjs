/* Regression test for PluginScanner global Claude Code plugin discovery.
 * Builds a synthetic ~/.claude/plugins/marketplaces tree in a temp dir covering
 * both single-plugin and multi-plugin marketplace shapes, then asserts every
 * plugin (and its skills/) is found. Guards the 4-of-42 discovery bug. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PluginScanner } = require('../out/_pluginscanner_test.cjs');
const { scanInstalledPlugins } = require('../out/_inventory_test.cjs');
const { convertSelection } = require('../out/_selection_test.cjs');

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok - ' + msg); pass++; }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aimig-plugins-'));
process.on('exit', () => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {} });

const w = (rel, content) => {
    const p = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
};
const manifest = (name, desc) => JSON.stringify({ name, description: desc, author: { name: 'x' } });
const skill = (name) => `---\nname: ${name}\ndescription: skill ${name}\n---\n\nbody`;
const marketplace = (name, plugins) => JSON.stringify({ name, plugins });

const mk = 'marketplaces';

// 1) single-plugin marketplace: plugin.json AND marketplace.json at the root.
w(`${mk}/solo/.claude-plugin/plugin.json`, manifest('solo-plugin', 'a solo plugin'));
w(`${mk}/solo/.claude-plugin/marketplace.json`, marketplace('solo', [{ name: 'solo-plugin', source: './' }]));
w(`${mk}/solo/skills/foo/SKILL.md`, skill('foo'));
w(`${mk}/solo/skills/bar/SKILL.md`, skill('bar'));
// a non-skill folder at plugin root must NOT count as a skill (old-bug guard)
w(`${mk}/solo/commands/cmd.md`, '# cmd');

// 2) multi-plugin marketplace: only marketplace.json at root; plugins nested.
w(`${mk}/multi/.claude-plugin/marketplace.json`, marketplace('multi', [
    { name: 'a', source: './plugins/a' },
    { name: 'b', source: './external_plugins/b' },
]));
w(`${mk}/multi/plugins/a/.claude-plugin/plugin.json`, manifest('a', 'plugin a'));
w(`${mk}/multi/plugins/a/skills/s1/SKILL.md`, skill('s1'));
w(`${mk}/multi/external_plugins/b/.claude-plugin/plugin.json`, manifest('b', 'plugin b'));
// b has no skills/ dir

// 3) a marketplace dir with no plugins at all (catalog-only / empty checkout)
w(`${mk}/empty/.claude-plugin/marketplace.json`, marketplace('empty', []));
w(`${mk}/empty/README.md`, 'nothing here');

// 4) a synthetic Antigravity plugin dir (different ecosystem/layout)
const AG = 'ag-plugins';
w(`${AG}/cave/plugin.json`, JSON.stringify({ name: 'cave-ag', description: 'ag plugin', author: { name: 'y' } }));
w(`${AG}/cave/hooks.json`, JSON.stringify({ 'cave-hooks': { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'x' }] }] } }));
w(`${AG}/cave/mcp_config.json`, JSON.stringify({ mcpServers: { srv: { command: 'run' } } }));

(async () => {
    const scanner = new PluginScanner();
    const plugins = await scanner.scanPlugins(path.join(ROOT, mk));
    const byName = Object.fromEntries(plugins.map(p => [p.name, p]));

    ok(plugins.length === 3, `discovers all 3 plugins across single + multi marketplaces (got ${plugins.length})`);
    ok(byName['solo-plugin'], 'single-plugin marketplace (root plugin.json) found');
    ok(byName['a'], 'nested plugins/<name> plugin found (the multi-plugin bug case)');
    ok(byName['b'], 'nested external_plugins/<name> plugin found');

    ok(byName['solo-plugin'].skills.length === 2, 'solo-plugin: 2 skills from skills/ (not commands/)');
    ok(byName['solo-plugin'].skills.every(s => s.skillFilePath.includes(path.join('skills'))), 'skills resolved under skills/ dir');
    ok(byName['a'].skills.length === 1, 'plugin a: 1 skill from skills/');
    ok(byName['b'].skills.length === 0, 'plugin b: 0 skills (no skills/ dir) — no crash');

    // marketplace roots themselves must not be reported as plugins
    ok(!byName['multi'] && !byName['empty'], 'marketplace dirs are not mistaken for plugins');

    // === unified inventory: INSTALLED-only (ledger), not the marketplace catalog ===
    // Build a synthetic ~/.claude/plugins layout: installed_plugins.json + cache/.
    const cacheSoloRel = path.join('cache', 'solo-mp', 'solo', '1.0.0');
    const cacheLocRel = path.join('cache', 'official', 'loc', '2.0.0');
    const cacheSolo = path.join(ROOT, cacheSoloRel);  // absolute (ledger installPath + assertions)
    const cacheLoc = path.join(ROOT, cacheLocRel);
    w(path.join(cacheSoloRel, '.claude-plugin', 'plugin.json'), manifest('solo-plugin', 'installed solo'));
    w(path.join(cacheSoloRel, 'skills', 'foo', 'SKILL.md'), skill('foo'));
    w(path.join(cacheSoloRel, 'skills', 'bar', 'SKILL.md'), skill('bar'));
    w(path.join(cacheLocRel, '.claude-plugin', 'plugin.json'), manifest('loc-plugin', 'project-local plugin'));
    w(path.join('plugins', 'installed_plugins.json'), JSON.stringify({
        version: 2,
        plugins: {
            'solo@solo-mp': [{ scope: 'user', installPath: cacheSolo, version: '1.0.0' }],
            'loc@official': [{ scope: 'local', projectPath: 'C:/some/proj', installPath: cacheLoc, version: '2.0.0' }],
            'stale@gone': [{ scope: 'user', installPath: path.join(ROOT, 'cache', 'missing'), version: '9' }],
        },
    }));
    const ledgerFile = path.join(ROOT, 'plugins', 'installed_plugins.json');

    const inv = scanInstalledPlugins({ installedPluginsFile: ledgerFile, antigravityDir: path.join(ROOT, 'ag-plugins') });
    const invByName = Object.fromEntries(inv.map(p => [p.name, p]));
    ok(inv.length === 3, `inventory lists 2 installed claude + 1 antigravity = 3, NOT the on-disk catalog (got ${inv.length})`);
    ok(invByName['solo-plugin'] && invByName['loc-plugin'], 'both ledger entries with existing installPath are listed');
    ok(!inv.some(p => p.name === 'stale'), 'ledger entry whose installPath is missing is skipped');
    ok(invByName['solo-plugin'].scope === 'user' && invByName['solo-plugin'].skillsCount === 2, 'solo-plugin: user scope, 2 skills');
    ok(invByName['loc-plugin'].scope === 'local' && invByName['loc-plugin'].projectPath === 'C:/some/proj', 'loc-plugin: local scope carries projectPath');
    ok(invByName['cave-ag'] && invByName['cave-ag'].format === 'antigravity', 'antigravity plugin discovered & tagged');
    ok(invByName['cave-ag'].hookEventsCount === 1 && invByName['cave-ag'].mcpCount === 1, 'antigravity plugin counts: 1 hook event, 1 MCP');

    // === plugin conversion via the unified converter (dry-run, no writes) ===
    const claudePlugin = invByName['solo-plugin'];
    const toAg = convertSelection({
        fromIde: 'claude-code', toIde: 'antigravity', rootPath: ROOT, scope: 'project',
        rules: [], skills: [], plugins: [claudePlugin],
        selection: { pluginNames: new Set(['solo-plugin']) }, dryRun: true,
    });
    ok(toAg.outcomes.length === 1 && toAg.outcomes[0].kind === 'plugin' && toAg.outcomes[0].ok,
        'plugin converts claude-code -> antigravity (dry-run)');

    const toGemini = convertSelection({
        fromIde: 'claude-code', toIde: 'gemini-cli', rootPath: ROOT, scope: 'project',
        rules: [], skills: [], plugins: [claudePlugin],
        selection: { pluginNames: new Set(['solo-plugin']) }, dryRun: true,
    });
    ok(toGemini.errorCount === 1 && !toGemini.outcomes[0].ok,
        'plugin to non-plugin target (gemini-cli) reported unsupported');

    console.log(`\nAll ${pass} checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
