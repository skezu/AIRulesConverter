/**
 * RuleConverter.ts
 *
 * VS Code adapter around RuleConverterCore.
 * This class uses vscode APIs for workspace resolution and error display,
 * then delegates pure conversion logic to RuleConverterCore.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { Rule, IDE } from './RuleModel';
import { convertRuleToResult, writeConversionResult, deleteRuleFile } from './RuleConverterCore';

export class RuleConverter {
    constructor() { }

    public async convertRule(
        rule: Rule,
        targetIde: IDE,
        isFirstInBatch: boolean = true
    ): Promise<string | undefined> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(rule.filePath));
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Could not determine workspace folder for rule.');
            return;
        }
        const rootPath = workspaceFolder.uri.fsPath;

        try {
            const result = convertRuleToResult(rule, targetIde, rootPath);
            const writtenPath = writeConversionResult(result, isFirstInBatch);
            return writtenPath;
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to convert rule "${rule.name}": ${e?.message ?? e}`);
            return undefined;
        }
    }

    public async deleteRule(rule: Rule): Promise<void> {
        try {
            deleteRuleFile(rule.filePath);
            vscode.window.showInformationMessage(`Rule deleted: ${rule.name}`);
        } catch (e: any) {
            vscode.window.showErrorMessage(e?.message ?? String(e));
        }
    }
}
