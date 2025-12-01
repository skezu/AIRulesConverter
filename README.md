# AI Rules Converter

**AI Rules Converter** is a VS Code extension designed to streamline the management of AI coding rules. It allows you to easily convert rule definitions between various AI-assisted IDE formats, ensuring your coding standards are consistent across different tools.

![Logo](images/logo.png)

## Features

-   **Multi-Format Support**: Convert rules between popular AI IDE formats:
    -   Cursor (`.cursor/rules`)
    -   Windsurf (`.windsurf/rules`)
    -   Kiro (`.kiro/*`)
    -   Antigravity (`.agents/rules`)
-   **Automatic Detection**: Automatically detects rule files in your workspace.
-   **One-Click Conversion**: Convert rules directly from the "Detected Rules" side panel.
-   **Rule Management**: Delete obsolete or incorrect rules directly from the extension view.
-   **Live Updates**: The view automatically refreshes when changes are made.

## Usage

1.  **Open the Rules Converter View**: Click on the ruler icon in the Activity Bar to open the "Rules Converter" side panel.
2.  **View Detected Rules**: The extension will scan your workspace and list all detected rule files.
3.  **Convert a Rule**:
    -   Hover over a rule in the list.
    -   Click the "Convert Rule" icon (or right-click and select "Convert Rule").
    -   Follow the prompts to select the target format.
4.  **Delete a Rule**:
    -   Hover over a rule in the list.
    -   Click the trash icon (or right-click and select "Delete Rule") to remove it.

## Extension Settings

This extension contributes the following settings:

*   `rulesConverter.refresh`: Manually refresh the list of detected rules.

## Known Issues

-   Ensure your rule files are valid Markdown before converting.

## Release Notes

| Version | Changes |
|---|---|
| 1.0.1 | Icon update. |
| 1.0.0 | Production release. |
| 0.0.3 | Added extension icon and README documentation. |
| 0.0.2 | Added support for deleting rules.<br>Improved rule detection and refresh logic. |
| 0.0.1 | Initial release with basic conversion support. |

---

**Enjoy using AI Rules Converter!**
