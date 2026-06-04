/**
 * HooksConverter.ts
 *
 * Converts hook configurations between Windsurf, Claude Code, and Antigravity formats,
 * handling event naming translations and JSON merging.
 */

import * as path from 'path';
import * as fs from 'fs';
import { HooksConfig, HookEvent, HookEntry } from './AgentCapability';
import { IDE } from './RuleModel';
import { getGlobalHooksFile } from './GlobalPathResolver';

export interface HooksConversionResult {
    targetIde: IDE;
    filePath: string;
    /** Group name (for agy/antigravity) */
    groupName: string;
    /** Event configurations */
    events: Partial<Record<HookEvent, HookEntry[]>>;
}

export class HooksConverter {
    constructor() {}

    /**
     * Convert hooks configuration to target format.
     */
    public convertConfig(
        config: HooksConfig,
        targetIde: IDE,
        rootPath: string,
        scope: 'project' | 'global' = 'project'
    ): HooksConversionResult {
        let filePath: string;
        if (scope === 'global') {
            const globalHooksFile = getGlobalHooksFile(targetIde);
            if (!globalHooksFile) {
                throw new Error(`Global hooks are not supported for target: ${targetIde}`);
            }
            filePath = globalHooksFile;
        } else {
            filePath = this.getTargetFilePath(targetIde, rootPath);
        }
        return {
            targetIde,
            filePath,
            groupName: config.groupName || 'imported-hooks',
            events: config.events,
        };
    }

    /**
     * Execute hook conversion (merge and write to target file).
     */
    public executeConversion(result: HooksConversionResult): string {
        const { targetIde, filePath, groupName, events } = result;

        // Ensure parent directory exists
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        let existingContent: any = {};
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                existingContent = JSON.parse(raw) || {};
            } catch (e) {
                console.warn(`[HooksConverter] Could not parse existing hooks at ${filePath}, overwriting.`, e);
            }
        }

        if (targetIde === 'agy' || targetIde === 'antigravity') {
            // Antigravity grouped format: { "group-name": { "<stage>": [...] } }.
            // Antigravity uses kebab-case lifecycle STAGES, not Claude-style event names.
            const activeGroup = groupName || 'workspace-hooks';
            const existingGroupEvents = existingContent[activeGroup] || {};

            const stageEvents: Record<string, HookEntry[]> = { ...existingGroupEvents };
            for (const [event, entries] of Object.entries(events)) {
                if (!entries) continue;
                const stage = HooksConverter.CANONICAL_TO_ANTIGRAVITY[event as HookEvent];
                if (!stage) {
                    console.warn(`[HooksConverter] Antigravity has no hook stage for canonical event '${event}'; skipping.`);
                    continue;
                }
                stageEvents[stage] = [...(stageEvents[stage] || []), ...entries];
            }

            existingContent[activeGroup] = stageEvents;
        } else if (targetIde === 'claude-code') {
            // Claude Code format: settings.json -> { "hooks": { "EventName": [...] } }
            const existingHooks = existingContent.hooks || {};
            existingContent.hooks = {
                ...existingHooks,
                ...events,
            };
        } else if (targetIde === 'windsurf') {
            // Windsurf hooks.json -> { "hooks": { "<ws_event>": [ {command, show_output, ...} ] } }
            // Real Windsurf events are snake_case (pre_write_code, pre_user_prompt, ...) and each
            // entry is a flat shell-command object, NOT the {matcher,hooks:[...]} nesting.
            const existingHooks = existingContent.hooks || {};
            const wsHooks: Record<string, any[]> = { ...existingHooks };

            for (const [event, entries] of Object.entries(events)) {
                if (!entries) continue;
                const wsEventName = HooksConverter.CANONICAL_TO_WINDSURF[event as HookEvent];
                if (!wsEventName) {
                    console.warn(`[HooksConverter] Windsurf has no hook event for canonical event '${event}'; skipping.`);
                    continue;
                }
                const wsEntries = HooksConverter.toWindsurfEntries(entries);
                if (wsEntries.length === 0) continue;
                wsHooks[wsEventName] = [...(wsHooks[wsEventName] || []), ...wsEntries];
            }

            existingContent.hooks = wsHooks;
        } else if (targetIde === 'copilot') {
            // GitHub Copilot hooks file requires a wrapper: { "version": 1, "hooks": { "<Event>": [...] } }.
            // Copilot accepts PascalCase event names (VS Code compatibility) = our canonical names.
            const existingHooks = (existingContent && existingContent.hooks) || {};
            const mergedHooks: Record<string, HookEntry[]> = { ...existingHooks };
            for (const [event, entries] of Object.entries(events)) {
                if (!entries) continue;
                mergedHooks[event] = [...(existingHooks[event] || []), ...entries];
            }
            existingContent = { version: 1, ...existingContent, hooks: mergedHooks };
        }

        fs.writeFileSync(filePath, JSON.stringify(existingContent, null, 2) + '\n', 'utf-8');
        return filePath;
    }

    /**
     * Canonical (Claude-style) event -> real Windsurf event name.
     * Windsurf only exposes pre_/post_ tool-lifecycle and prompt hooks; lifecycle
     * events with no Windsurf equivalent (SessionStart/Stop/Notification/PermissionRequest)
     * are intentionally absent and skipped at conversion time.
     */
    private static readonly CANONICAL_TO_WINDSURF: Partial<Record<HookEvent, string>> = {
        PreToolUse: 'pre_write_code',
        PostToolUse: 'post_write_code',
        UserPromptSubmit: 'pre_user_prompt',
    };

    /**
     * Canonical (Claude-style) event -> real Antigravity kebab-case lifecycle stage.
     * Stages with no canonical equivalent (after-model-call) are produced only on the
     * reverse path; canonical events with no Antigravity stage are skipped.
     */
    private static readonly CANONICAL_TO_ANTIGRAVITY: Partial<Record<HookEvent, string>> = {
        PreToolUse: 'before-tool-execution',
        PostToolUse: 'after-tool-execution',
        UserPromptSubmit: 'before-model-call',
        Stop: 'agent-loop-stop',
    };

    /**
     * Flatten canonical HookEntries ({matcher, hooks:[{type,command}]}) into Windsurf's
     * flat command-object shape: { command, show_output, working_directory?, powershell? }.
     * Only shell-command hooks are representable in Windsurf; others are dropped.
     */
    private static toWindsurfEntries(entries: HookEntry[]): any[] {
        const out: any[] = [];
        for (const entry of entries) {
            for (const hook of entry.hooks || []) {
                if (hook.type && hook.type !== 'command') continue;
                const command = hook.command ?? (hook as any).script;
                if (!command) continue;
                const wsEntry: any = { command, show_output: hook.show_output ?? true };
                if ((hook as any).working_directory) {
                    wsEntry.working_directory = (hook as any).working_directory;
                }
                if ((hook as any).powershell !== undefined) {
                    wsEntry.powershell = (hook as any).powershell;
                }
                out.push(wsEntry);
            }
        }
        return out;
    }

    private getTargetFilePath(targetIde: IDE, rootPath: string): string {
        switch (targetIde) {
            case 'agy':
                // Preferred plural workspace path; the singular '.agent/' is deprecated.
                return path.join(rootPath, '.agents', 'hooks.json');
            case 'antigravity':
                return path.join(rootPath, '.agents', 'hooks.json');
            case 'claude-code':
                return path.join(rootPath, '.claude', 'settings.json');
            case 'windsurf':
                return path.join(rootPath, '.windsurf', 'hooks.json');
            case 'copilot':
                return path.join(rootPath, '.github', 'hooks', 'hooks.json');
            default:
                throw new Error(`Hooks configuration is not supported for target: ${targetIde}`);
        }
    }
}
