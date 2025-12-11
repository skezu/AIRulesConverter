# Changelog

All notable changes to the "AI Rules Converter" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-12-11

### Added
- **Recursive Folder Actions**: Support for converting and deleting entire folders and their subdirectories.
- **Root Folder Support**: Added "Convert All" and "Delete" actions to root IDE folders (e.g., .cursor).
- **Confirmation Dialogs**: Added safety warnings when deleting folders.

## [1.1.0] - 2025-12-09

### Added
- **Recursive subfolder scanning**: Rules are now detected recursively in all subdirectories (e.g., `.cursor/rules/subfolder/rule.md`)
- Improved rule discovery for complex project structures

## [1.0.2] - 2025-12-01

### Changed
- Updated extension logo

## [1.0.1] - Previous Release

### Added
- Initial release features
- Convert AI coding rules between Cursor, Windsurf, Kiro, and Antigravity formats
- Automatic detection of rules files in workspace
- Tree view for managing detected rules
- Convert and delete rule commands
