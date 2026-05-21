const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    // --- VS Code Extension bundle ---
    const extCtx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'out/extension.js',
        external: ['vscode'],
        logLevel: 'info',
    });

    // --- Standalone CLI bundle ---
    const cliCtx = await esbuild.context({
        entryPoints: ['src/cli/index.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'out/cli.js',
        // Mark vscode as external — the CLI never calls scanWorkspace() so this
        // dynamic require() in RuleScanner is never actually executed at runtime.
        external: ['vscode'],
        logLevel: 'info',
        banner: {
            js: '#!/usr/bin/env node',
        },
    });

    if (watch) {
        await extCtx.watch();
        await cliCtx.watch();
    } else {
        await extCtx.rebuild();
        await extCtx.dispose();
        await cliCtx.rebuild();
        await cliCtx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
