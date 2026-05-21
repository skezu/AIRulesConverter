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
        rootPath: string
    ): HooksConversionResult {
        const filePath = this.getTargetFilePath(targetIde, rootPath);
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
            // Grouped format: { "group-name": { "EventName": [...] } }
            // Let's merge the target group
            const activeGroup = groupName || 'workspace-hooks';
            const existingGroupEvents = existingContent[activeGroup] || {};
            
            existingContent[activeGroup] = {
                ...existingGroupEvents,
                ...events,
            };
        } else if (targetIde === 'claude-code') {
            // Claude Code format: settings.json -> { "hooks": { "EventName": [...] } }
            const existingHooks = existingContent.hooks || {};
            existingContent.hooks = {
                ...existingHooks,
                ...events,
            };
        } else if (targetIde === 'windsurf') {
            // Windsurf format: hooks.json -> { "hooks": { "ws_event": [...] } }
            const existingHooks = existingContent.hooks || {};
            
            // Map canonical events to Windsurf event names
            const wsHooks: Record<string, any[]> = {};
            for (const [event, entries] of Object.entries(events)) {
                if (!entries) continue;
                const wsEventName = this.canonicalToWindsurfEvent(event as HookEvent);
                
                // Convert HookEntries to Windsurf format
                const wsEntries = entries.map(entry => {
                    if (entry.hooks && entry.hooks.length === 1) {
                        const hook = entry.hooks[0];
                        if (hook.type === 'command') {
                            return hook.command;
                        }
                    }
                    return entry;
                });

                wsHooks[wsEventName] = [
                    ...(existingHooks[wsEventName] || []),
                    ...wsEntries,
                ];
            }

            existingContent.hooks = {
                ...existingHooks,
                ...wsHooks,
            };
        } else if (targetIde === 'copilot') {
            existingContent = {
                ...existingContent,
                ...events,
            };
        }

        fs.writeFileSync(filePath, JSON.stringify(existingContent, null, 2) + '\n', 'utf-8');
        return filePath;
    }

    private canonicalToWindsurfEvent(event: HookEvent): string {
        switch (event) {
            case 'PreToolUse':
                return 'pre_write_code';
            case 'PostToolUse':
                return 'post_write_code';
            case 'SessionStart':
                return 'init';
            case 'Stop':
                return 'exit';
            default:
                return 'post_write_code'; // default fallback
        }
    }

    private getTargetFilePath(targetIde: IDE, rootPath: string): string {
        switch (targetIde) {
            case 'agy':
                return path.join(rootPath, '.agents', 'hooks.json');
            case 'antigravity':
                return path.join(rootPath, '.agent', 'hooks.json');
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
