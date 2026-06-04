/**
 * HooksScanner.ts
 *
 * Scans the workspace for event hooks in all supported formats.
 */

import * as path from 'path';
import * as fs from 'fs';
import { HooksConfig, HookEvent, HookEntry } from './AgentCapability';
import { IDE } from './RuleModel';

/** Canonical Claude-style events the scanners recognise as hook-event keys. */
const CANONICAL_EVENTS: HookEvent[] = [
    'PreToolUse', 'PostToolUse', 'SessionStart', 'Stop',
    'Notification', 'PermissionRequest', 'UserPromptSubmit',
];

/** Antigravity kebab-case lifecycle stage -> canonical event (best-effort reverse map). */
const ANTIGRAVITY_STAGE_TO_CANONICAL: Record<string, HookEvent> = {
    'before-tool-execution': 'PreToolUse',
    'after-tool-execution': 'PostToolUse',
    'before-model-call': 'UserPromptSubmit',
    'after-model-call': 'PostToolUse',
    'agent-loop-stop': 'Stop',
};

export class HooksScanner {
    constructor() {}

    /**
     * Scan workspace folders using VS Code APIs (if in extension context)
     */
    public async scanWorkspace(): Promise<HooksConfig[]> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vscode = require('vscode');
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const configs: HooksConfig[] = [];
        for (const folder of workspaceFolders) {
            const rootPath = folder.uri.fsPath;
            configs.push(...(await this.scanDirectory(rootPath)));
        }
        return configs;
    }

    /**
     * Scan a specific directory (CLI & core compatible)
     */
    public async scanDirectory(rootPath: string): Promise<HooksConfig[]> {
        const configs: HooksConfig[] = [];

        // 1. agy / antigravity PREFERRED (.agents/hooks.json — plural)
        const agyPreferredPath = path.join(rootPath, '.agents', 'hooks.json');
        if (fs.existsSync(agyPreferredPath)) {
            const agyConfig = this.parseAgyHooks(agyPreferredPath, 'agy');
            if (agyConfig) configs.push(agyConfig);
            const antigravityConfig = this.parseAgyHooks(agyPreferredPath, 'antigravity');
            if (antigravityConfig) configs.push(antigravityConfig);
        }

        // 2. agy / antigravity DEPRECATED (.agent/hooks.json — singular; still scanned, warns)
        const agyDeprecatedPath = path.join(rootPath, '.agent', 'hooks.json');
        if (fs.existsSync(agyDeprecatedPath)) {
            let used = false;
            const agyConfig = this.parseAgyHooks(agyDeprecatedPath, 'agy');
            if (agyConfig) { configs.push(agyConfig); used = true; }
            const antigravityConfig = this.parseAgyHooks(agyDeprecatedPath, 'antigravity');
            if (antigravityConfig) { configs.push(antigravityConfig); used = true; }
            if (used) {
                console.warn(`[HooksScanner] '.agent/hooks.json' is deprecated; please migrate to '.agents/hooks.json'`);
            }
        }

        // 3. claude-code (.claude/settings.json)
        const claudePath = path.join(rootPath, '.claude', 'settings.json');
        if (fs.existsSync(claudePath)) {
            const config = this.parseClaudeHooks(claudePath);
            if (config) configs.push(config);
        }

        // 4. windsurf (.windsurf/hooks.json)
        const windsurfPath = path.join(rootPath, '.windsurf', 'hooks.json');
        if (fs.existsSync(windsurfPath)) {
            const config = this.parseWindsurfHooks(windsurfPath);
            if (config) configs.push(config);
        }

        // 5. copilot (.github/hooks/*.json)
        const copilotHooksDir = path.join(rootPath, '.github', 'hooks');
        if (fs.existsSync(copilotHooksDir)) {
            try {
                const entries = fs.readdirSync(copilotHooksDir);
                for (const entryName of entries) {
                    if (entryName.endsWith('.json')) {
                        const filePath = path.join(copilotHooksDir, entryName);
                        const config = this.parseAgyHooks(filePath, 'copilot');
                        if (config) configs.push(config);
                    }
                }
            } catch (e) {
                console.error(`[HooksScanner] Error scanning Copilot hooks directory`, e);
            }
        }

        return configs;
    }

    private parseAgyHooks(filePath: string, ide: IDE): HooksConfig | null {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }

            // agy / antigravity hook format is grouped by a top level key:
            //   { "groupName": { "before-tool-execution": [...] } }   (kebab-case stages)
            // Copilot uses a versioned wrapper:
            //   { "version": 1, "hooks": { "PreToolUse": [...] } }
            // Find the first object value whose sub-keys look like hook events/stages.
            const keys = Object.keys(parsed);
            for (const key of keys) {
                const val = parsed[key];
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    const eventKeys = Object.keys(val);
                    const hasEvents = eventKeys.some(ek =>
                        (CANONICAL_EVENTS as string[]).includes(ek) || ek in ANTIGRAVITY_STAGE_TO_CANONICAL
                    );
                    if (hasEvents) {
                        return {
                            ide,
                            filePath,
                            scope: 'project',
                            groupName: key,
                            events: this.normaliseEventKeys(val),
                        };
                    }
                }
            }

            // Fallback: assume the root itself is the events dictionary if no group key
            return {
                ide,
                filePath,
                scope: 'project',
                groupName: 'default-hooks',
                events: this.normaliseEventKeys(parsed),
            };
        } catch (e) {
            console.error(`[HooksScanner] Error parsing hooks at ${filePath}`, e);
        }
        return null;
    }

    /**
     * Normalise a raw events object's keys to canonical Claude-style event names,
     * translating Antigravity kebab-case stages. Entries under keys that collapse to
     * the same canonical event are concatenated. Unknown keys are dropped.
     */
    private normaliseEventKeys(raw: Record<string, any>): Partial<Record<HookEvent, HookEntry[]>> {
        const out: Partial<Record<HookEvent, HookEntry[]>> = {};
        for (const [key, value] of Object.entries(raw || {})) {
            if (!Array.isArray(value)) continue;
            let canonical: HookEvent | undefined;
            if ((CANONICAL_EVENTS as string[]).includes(key)) {
                canonical = key as HookEvent;
            } else if (key in ANTIGRAVITY_STAGE_TO_CANONICAL) {
                canonical = ANTIGRAVITY_STAGE_TO_CANONICAL[key];
            }
            if (!canonical) continue;
            out[canonical] = [...(out[canonical] || []), ...(value as HookEntry[])];
        }
        return out;
    }

    private parseClaudeHooks(filePath: string): HooksConfig | null {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.hooks && typeof parsed.hooks === 'object') {
                return {
                    ide: 'claude-code',
                    filePath,
                    scope: 'project',
                    events: parsed.hooks as Partial<Record<HookEvent, HookEntry[]>>,
                };
            }
        } catch (e) {
            console.error(`[HooksScanner] Error parsing Claude hooks at ${filePath}`, e);
        }
        return null;
    }

    private parseWindsurfHooks(filePath: string): HooksConfig | null {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }

            // Windsurf hooks typically have structure: { "hooks": { "pre_write_code": [...] } }
            const hooksObj = parsed.hooks || parsed;
            if (hooksObj && typeof hooksObj === 'object') {
                // Map Windsurf events to HookEvent canonical names
                const mappedEvents: Partial<Record<HookEvent, HookEntry[]>> = {};

                // Windsurf: "pre_write_code" / "post_write_code" etc
                // Let's normalize these to PreToolUse / PostToolUse
                for (const wsEvent of Object.keys(hooksObj)) {
                    let canonicalEvent: HookEvent | null = null;
                    if (wsEvent.includes('user_prompt')) {
                        canonicalEvent = 'UserPromptSubmit';
                    } else if (wsEvent.includes('pre_')) {
                        canonicalEvent = 'PreToolUse';
                    } else if (wsEvent.includes('post_')) {
                        canonicalEvent = 'PostToolUse';
                    } else if (wsEvent.includes('start') || wsEvent.includes('init')) {
                        canonicalEvent = 'SessionStart';
                    } else if (wsEvent.includes('stop') || wsEvent.includes('exit')) {
                        canonicalEvent = 'Stop';
                    }

                    if (canonicalEvent) {
                        const entries: any[] = Array.isArray(hooksObj[wsEvent]) ? hooksObj[wsEvent] : [hooksObj[wsEvent]];
                        const normalizedEntries: HookEntry[] = entries.map(entry => {
                            if (typeof entry === 'string') {
                                return {
                                    matcher: '*',
                                    hooks: [{ type: 'command', command: entry }]
                                };
                            } else if (entry && typeof entry === 'object') {
                                return {
                                    matcher: entry.matcher || '*',
                                    hooks: entry.hooks || [{
                                        type: entry.type || 'command',
                                        command: entry.command || entry.script
                                    }]
                                };
                            }
                            return { matcher: '*', hooks: [] };
                        });

                        if (!mappedEvents[canonicalEvent]) {
                            mappedEvents[canonicalEvent] = [];
                        }
                        mappedEvents[canonicalEvent]!.push(...normalizedEntries);
                    }
                }

                return {
                    ide: 'windsurf',
                    filePath,
                    scope: 'project',
                    events: mappedEvents,
                };
            }
        } catch (e) {
            console.error(`[HooksScanner] Error parsing Windsurf hooks at ${filePath}`, e);
        }
        return null;
    }
}
