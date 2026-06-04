# Structures de configuration des applications IA de code

> Rapport de recherche basé sur les documentations officielles et dépôts GitHub officiels.
> Recherche indépendante du codebase AIRulesConverter. Couvre : **rules**, **MCP**, **skills**, **plugins**, **hooks** — chemins projet vs global/utilisateur, format des fichiers.

---

## 1. Méthodologie & niveaux de confiance

Deux passes de recherche ont alimenté ce rapport :

1. **Passe vérifiée (adversariale, vote 3-0)** — chaque affirmation a été refutée par 3 vérificateurs indépendants ; ne survit que ce qui résiste. Couvre **Claude Code** (5 dimensions), **les règles Cursor**, **le steering Kiro**.
2. **Passe d'extraction documentaire (source officielle, simple passe)** — un agent par outil, lisant la doc officielle / le dépôt GitHub officiel. Couvre les 11 autres outils. Données fiables mais **non re-vérifiées en adversarial** et **sujettes à évolution rapide** (skills/plugins/hooks sont récents partout).

| Symbole | Signification |
|---------|---------------|
| 🟢 | Vérifié en adversarial (3-0) — haute confiance |
| 🟡 | Extrait de doc officielle, non re-vérifié — bonne confiance, à reconfirmer pour le détail fin |
| ⚪ | Non couvert dans ce cycle de recherche |
| ❌ | Fonctionnalité **inexistante** nativement pour cet outil |

**À retenir avant tout (pièges confirmés) :**
- Claude Code : le champ JSON MCP est **`type`** (pas `transport`). `transport` n'existe que comme **flag CLI** `--transport`.
- Claude Code : les événements de hooks **`PromptSubmit`, `TurnComplete`, `ToolExecute`, `ConfigChange` n'existent PAS** (inventés, réfutés). Voir la vraie liste plus bas.
- Le **contenu exact** du manifeste `plugin.json` de Claude Code reste incertain (claim réfuté) ; seule la *structure* (`.claude-plugin/plugin.json` + composants à la racine) est confirmée.

---

## 2. Tableau de synthèse

### 2.1 RULES / instructions

| Outil | Projet | Global / User | Format |
|-------|--------|---------------|--------|
| 🟢 Claude Code | `./CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `./CLAUDE.local.md` | `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md` | Markdown ; rules avec frontmatter YAML `paths` (globs) |
| 🟡 Gemini CLI | `GEMINI.md` (+ parents), `.gemini/GEMINI.md` | `~/.gemini/GEMINI.md` | Markdown, imports `@fichier.md` |
| 🟡 Codex CLI | `.codex/AGENTS.md`, `AGENTS.md` (git root → cwd) | `~/.codex/AGENTS.md` | Markdown (+ `config.toml`) |
| 🟡 Copilot CLI | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md` | `~/.copilot/copilot-instructions.md` | Markdown + frontmatter `applyTo` |
| 🟡 Cursor CLI | `.cursor/rules/*.mdc`, `AGENTS.md` | UI Settings (pas de fichier) | `.mdc` + frontmatter |
| 🟡 opencode | `AGENTS.md` | `~/.config/opencode/AGENTS.md` | Markdown |
| ❌ aider | *(pas de moteur de règles)* — conventions via `CONVENTIONS.md` chargé par `read:` | — | Markdown (convention, pas une règle) |
| 🟢 Cursor IDE | `.cursor/rules/*.mdc`, `AGENTS.md` | UI Settings (pas de fichier) | `.mdc` obligatoire + frontmatter `description`/`globs`/`alwaysApply` |
| 🟡 Copilot VS Code | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md` | `~/.copilot/instructions/*.instructions.md` | Markdown + frontmatter `applyTo` |
| 🟡 Windsurf | `.windsurf/rules/*.md` (ou `.devin/rules/`), `.windsurfrules` | `~/.codeium/windsurf/memories/global_rules.md` | Markdown + frontmatter `trigger`/`globs` |
| 🟡 Antigravity | `.agent/rules/`, `.agents/rules/` | `~/.gemini/GEMINI.md` | Markdown, `@fichier` |
| 🟢 Kiro | `.kiro/steering/*.md` | `~/.kiro/steering/*.md` | Markdown + frontmatter YAML optionnel (modes `always`/`manual`/`fileMatch`/`auto`) |
| 🟡 Zed | `.rules` (+ `AGENTS.md`, `CLAUDE.md`…) | `~/.config/zed/AGENTS.md` | Markdown / texte ; **Rules dépréciées depuis v1.4.0 → Skills** |

### 2.2 MCP servers

| Outil | Projet | Global / User | Clé racine + champs |
|-------|--------|---------------|---------------------|
| 🟢 Claude Code | `.mcp.json` (committé) | `~/.claude.json` (scopes local & user) | `mcpServers` ; champ **`type`** (stdio/http/sse-déprécié/ws) ; stdio = `command`/`args`/`env` ; http = `url`/`headers` |
| 🟡 Gemini CLI | `.gemini/settings.json` | `~/.gemini/settings.json` | `mcpServers` ; `command`\|`url`\|`httpUrl` ; `args`/`env`/`cwd`/`timeout`/`trust`/`includeTools`/`excludeTools` |
| 🟡 Codex CLI | `.codex/config.toml`, `.mcp.json` | `~/.codex/config.toml` | TOML `[[mcp_servers]]` ; `command`/`args`/`env`/`enabled_tools`/`disabled_tools` |
| 🟡 Copilot CLI | *(via `.mcp.json` repo)* | `~/.copilot/mcp-config.json` | `mcpServers` ; `type` (stdio/http/sse/local) ; `command`/`args`/`env`/`url`/`headers`/`tools` |
| 🟡 Cursor (CLI+IDE) | `.cursor/mcp.json` | `~/.cursor/mcp.json` | `mcpServers` ; `command`/`args`/`env`/`url`/`headers` ; interpolation `${env:NAME}` |
| 🟡 opencode | `opencode.json` (clé `mcp`) | `~/.config/opencode/opencode.json` | `mcp` ; `type` local\|remote ; `command[]`\|`url` ; `auth` |
| ❌ aider | — | — | aider n'expose pas de config MCP native (client tiers seulement) |
| 🟡 Copilot VS Code | `.vscode/mcp.json` | « MCP: Open User Configuration » | **`servers`** (pas `mcpServers`) ; `type` stdio\|http\|sse ; `inputs[]` ; `${input:id}` |
| 🟡 Windsurf | ⚪ (global uniquement documenté) | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` ; `command`/`args`/`env` ; remote = **`serverUrl`**/`headers` |
| 🟡 Antigravity | `.agent/mcp_config.json`, `.agents/mcp_config.json` | `~/.gemini/antigravity/mcp_config.json` | `mcpServers` ; local `command`/`args`/`env` ; remote **`serverUrl`**/`headers` |
| 🟡 Zed | `.zed/settings.json` | `~/.config/zed/settings.json` | **`context_servers`** ; `command`/`args`/`env` ; remote `url`/`headers` |
| ⚪ Kiro | *(non capturé ; communément cité : `.kiro/settings/mcp.json`)* | *(`~/.kiro/settings/mcp.json`)* | `mcpServers` — **à confirmer en doc officielle** |

### 2.3 SKILLS

| Outil | Projet | Global / User | Format |
|-------|--------|---------------|--------|
| 🟢 Claude Code | `.claude/skills/<nom>/SKILL.md` | `~/.claude/skills/<nom>/SKILL.md` (+ skills de plugin) | dossier + `SKILL.md` (frontmatter YAML, `description` recommandé) |
| 🟡 Gemini CLI | `.gemini/skills/`, `.agents/skills/` | `~/.gemini/skills/`, `~/.agents/skills/` | `SKILL.md` (`name`/`description`) + `scripts/`/`references/`/`assets/` |
| 🟡 Codex CLI | `.agents/skills/`, `.codex/skills/` | `~/.agents/skills/`, `~/.codex/skills/` | `SKILL.md` (`name`/`description`) ; standard « open agent skills » |
| 🟡 Copilot CLI | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/`, `~/.agents/skills/` | `SKILL.md` (`name`/`description`/`allowed-tools`) |
| 🟡 Cursor (CLI+IDE) | `.cursor/skills/`, `.agents/skills/` | `~/.cursor/skills/`, `~/.agents/skills/` | `SKILL.md` (`name`/`description`/`paths`/`disable-model-invocation`) |
| 🟡 opencode | `.opencode/skills/<nom>/SKILL.md` (+ `.claude/`, `.agents/`) | `~/.config/opencode/skills/` (+ `~/.claude/`, `~/.agents/`) | `SKILL.md` (name regex strict, `description`) |
| ❌ aider | — | — | pas de système de skills |
| 🟡 Copilot VS Code | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/` | `SKILL.md` (`name`/`description`/`argument-hint`/`context`) |
| 🟡 Windsurf | `.windsurf/skills/<nom>/SKILL.md`, `.windsurf/skills.json` | `~/.codeium/windsurf/skills/` (+ chemins entreprise OS) | `SKILL.md` (`name`/`description`) |
| 🟡 Antigravity | `.agent/skills/<nom>/SKILL.md` | `~/.gemini/antigravity-cli/skills/` | `SKILL.md` (`name`/`description` + sections « Use/Do not use ») |
| ⚪ Kiro | non capturé | non capturé | — |
| 🟡 Zed | `.agents/skills/<nom>/SKILL.md` | `~/.agents/skills/<nom>/SKILL.md` | `SKILL.md` (`name`/`description`/`disable-model-invocation`) ; remplace les Rules depuis v1.4 |

### 2.4 PLUGINS / extensions

| Outil | Manifeste | Emplacement | Format |
|-------|-----------|-------------|--------|
| 🟢 Claude Code | `.claude-plugin/plugin.json` | racine du plugin | JSON ; composants (`skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`) à la **racine**, pas dans `.claude-plugin/` |
| 🟡 Gemini CLI | `gemini-extension.json` | `~/.gemini/extensions/<nom>/` | JSON (`name`/`version`/`mcpServers`/`contextFileName`/`excludeTools`) + `commands/*.toml` |
| 🟡 Codex CLI | `.codex-plugin/plugin.json` | dossier de plugin | JSON ; composants à la racine (`skills/`, `hooks/hooks.json`, `.mcp.json`, `.app.json`) |
| 🟡 Copilot CLI | `plugin.json` | `~/.copilot/installed-plugins/` | JSON (`name` requis ; `agents`/`skills`/`hooks`/`mcpServers`/`lspServers`) |
| 🟡 Cursor (CLI+IDE) | `.cursor-plugin/plugin.json` | projet ; `~/.cursor/plugins/local/` | JSON (`name` requis ; `rules`/`skills`/`agents`/`commands`/`hooks`/`mcpServers`) + `marketplace.json` |
| 🟡 opencode | *(pas de manifeste)* | `.opencode/plugins/*.js`, `~/.config/opencode/plugins/`, npm via `opencode.json` | **Modules JS/TS** exportant des handlers d'événements |
| ❌ aider | — | — | pas d'architecture de plugin |
| 🟡 Copilot VS Code | `.plugin/plugin.json` \| `plugin.json` \| `.github/plugin/plugin.json` \| `.claude-plugin/plugin.json` | projet | JSON ; token `${CLAUDE_PLUGIN_ROOT}` |
| 🟡 Windsurf | `package.json` (extension type VS Code) | `.devin/`, `~/.codeium/windsurf/` | **Pas de manifeste propre** : architecture extension VS Code (Open VSX) |
| 🟡 Antigravity | `plugin.json` (marqueur) | `~/.gemini/antigravity-cli/plugins/<nom>/` | JSON + `mcp_config.json`/`hooks.json`/`skills/`/`agents/`/`rules/` |
| ⚪ Kiro | non capturé | non capturé | — |
| 🟡 Zed | `extension.toml` (+ `Cargo.toml` pour Rust/WASM) | `.../extensions/installed/` (par OS) | TOML ; thèmes/langages/MCP/snippets |

### 2.5 HOOKS

| Outil | Projet | Global / User | Format / mécanisme |
|-------|--------|---------------|--------------------|
| 🟢 Claude Code | `.claude/settings.json`, `.claude/settings.local.json` | `~/.claude/settings.json` | Clé `hooks` → événement → `[{matcher, hooks:[{type, command}]}]` ; types `command`/`http`/`mcp_tool`/`prompt`/`agent` |
| 🟡 Gemini CLI | `.gemini/settings.json` (+ `.gemini/hooks/`) | `~/.gemini/settings.json` | Clé `hooks` → événement → `[{matcher, hooks:[{name, type, command, timeout}]}]` |
| 🟡 Codex CLI | `.codex/hooks.json`, `.codex/config.toml` | `~/.codex/hooks.json`, `~/.codex/config.toml` | JSON ou TOML `[hooks.<Event>]` ; nécessite « trust » par hash |
| 🟡 Copilot CLI | `.github/hooks/*.json` | `~/.copilot/hooks/*.json` | JSON (`version: 1`, `hooks`) ; types `command`/`http`/`prompt` |
| 🟡 Cursor (CLI+IDE) | `.cursor/hooks.json` | `~/.cursor/hooks.json` | JSON (`version: 1`, `hooks`) ; exit 0=ok, 2=block |
| 🟡 opencode | `.opencode/plugins/*.js` | `~/.config/opencode/plugins/*.js` | **Via plugins** (pas de fichier de hooks dédié) ; ~25 événements |
| 🟡 aider | `.aider.conf.yml` | `~/.aider.conf.yml` | YAML : `auto-lint`/`lint-cmd`/`auto-test`/`test-cmd`/`auto-commits` (pas de hooks lifecycle génériques) |
| 🟡 Copilot VS Code | `.github/hooks/*.json`, `.claude/settings.json` | `~/.copilot/hooks`, `~/.claude/settings.json` | JSON (`hooks`) — **Preview** ; 8 événements |
| 🟡 Windsurf | `.windsurf/hooks.json` | `~/.codeium/windsurf/hooks.json` (+ chemins OS) | JSON `hooks` → `[{command, powershell?, show_output, working_directory?}]` |
| 🟡 Antigravity | `.agent/hooks.json`, `.agents/hooks.json` | `~/.gemini/antigravity-cli/hooks.json` (ou `settings.json`) | JSON ; stdin/stdout JSON |
| ⚪ Kiro | non capturé (« agent hooks » existent) | non capturé | — |
| 🟡 Zed | `.zed/tasks.json` | `~/.config/zed/tasks.json` | JSON : tâche avec champ `hooks` ; **un seul hook : `create_worktree`** |

---

## 3. Conventions transversales (à connaître pour un convertisseur)

1. **`AGENTS.md` = standard émergent inter-outils pour les règles.** Lu nativement par Codex, opencode, Copilot (CLI + VS Code), Cursor, Zed, et configurable dans Gemini CLI. Markdown plat, sans frontmatter obligatoire.
2. **`SKILL.md` + dossier `.agents/skills/` = standard émergent inter-outils pour les skills.** Quasi tous les outils modernes lisent `.agents/skills/` (projet) et `~/.agents/skills/` (global) **en plus** de leur dossier natif (`.claude/skills/`, `.cursor/skills/`, etc.). Frontmatter minimal : `name` + `description`. Sous-dossiers optionnels `scripts/`, `references/`, `assets/`.
3. **`mcpServers` (objet JSON) = clé MCP quasi universelle**, avec 3 exceptions notables :
   - VS Code → **`servers`**
   - Zed → **`context_servers`**
   - opencode → **`mcp`** ; Codex → **`[[mcp_servers]]`** (TOML)
   - Champ remote : la plupart utilisent `url`, mais **Antigravity et Windsurf utilisent `serverUrl`**.
4. **Manifeste de plugin `plugin.json` à composants-racine** : motif partagé par Claude Code, Cursor (`.cursor-plugin/`), Codex (`.codex-plugin/`), Copilot. opencode (modules JS) et Zed (`extension.toml`/WASM) divergent.
5. **Niveau global sous le home utilisateur**, mais le chemin varie fortement : `~/.claude/`, `~/.gemini/`, `~/.codex/`, `~/.copilot/`, `~/.cursor/`, `~/.config/opencode/`, `~/.codeium/windsurf/`, `~/.kiro/`, `~/.config/zed/`. Sur Windows, `~` ≈ `%USERPROFILE%` (parfois `%APPDATA%`/`%LOCALAPPDATA%` pour Zed).

---

## 4. Détail par outil

### 4.1 Claude Code (CLI) 🟢

**Fichiers `settings.json` — 4 niveaux**
- User/global : `~/.claude/settings.json`
- Projet partagé (committé) : `.claude/settings.json`
- Projet-local (gitignored) : `.claude/settings.local.json`
- Entreprise/managed : `managed-settings.json`
  - macOS : `/Library/Application Support/ClaudeCode/managed-settings.json`
  - Linux/WSL : `/etc/claude-code/managed-settings.json`
  - Windows : `C:\Program Files\ClaudeCode\managed-settings.json` *(l'ancien `C:\ProgramData\ClaudeCode\` est déprécié depuis v2.1.75)*

**Rules / mémoire** — fichiers `CLAUDE.md`, concaténés (jamais écrasés), chargés en remontant l'arborescence :
- Managed : mêmes dossiers OS que ci-dessus, fichier `CLAUDE.md`
- User : `~/.claude/CLAUDE.md`
- Projet : `./CLAUDE.md` ou `./.claude/CLAUDE.md`
- Local : `./CLAUDE.local.md`
- Sous-répertoires : `CLAUDE.md` chargé **à la demande** quand Claude lit ces dossiers.
- **Rules ciblées** : `.claude/rules/*.md` (projet) et `~/.claude/rules/*.md` (user), frontmatter YAML avec champ **`paths`** (globs, ex. `src/api/**/*.ts`). Sans `paths` → chargé inconditionnellement. *(NB : des issues GitHub rapportent que `paths` est buggé en pratique ; un champ non documenté `globs` fonctionnerait parfois mieux.)*

**MCP** — 3 scopes :
- Local & User → `~/.claude.json` (Local : clé sous le chemin du projet ; User : global ; même fichier physique)
- Project → `.mcp.json` à la racine (committé)
- CLI : `claude mcp add --transport <http|sse|stdio> --scope <local|project|user>`
- Format `.mcp.json` : objet racine `mcpServers` ; champ **`type`** :
```json
{ "mcpServers": {
  "stdio-server": { "type": "stdio", "command": "/path/to/server", "args": [], "env": {} },
  "http-server":  { "type": "http", "url": "https://mcp.stripe.com" },
  "ws-server":    { "type": "ws", "url": "wss://...", "headers": {} }
}}
```
  `stdio` est le défaut ; `sse` est déprécié (utiliser `http`) ; `streamable-http` est un alias accepté.

**Skills** — dossier avec point d'entrée `SKILL.md` :
- `~/.claude/skills/<nom>/SKILL.md` (perso), `.claude/skills/<nom>/SKILL.md` (projet), `<plugin>/skills/<nom>/SKILL.md`
- Frontmatter YAML (tous champs optionnels sauf `description` recommandé). Champs : `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`.

**Plugins** — `.claude-plugin/plugin.json` est le **seul** fichier dans `.claude-plugin/` ; tout le reste (`skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`, `.lsp.json`, `monitors/`, `bin/`, `settings.json`) est à la **racine** du plugin. Hooks de plugin : `hooks/hooks.json`, **format identique** à l'objet `hooks` de `.claude/settings.json`. *(Champs exacts du manifeste : non confirmés.)*

**Hooks** — clé `hooks` dans les `settings.json`. Structure à 3 niveaux : événement → `[{matcher, hooks:[{type, command}]}]`. Types de handler : `command`, `http`, `mcp_tool`, `prompt`, `agent`.
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash",
  "hooks": [ { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh" } ] } ] } }
```
Événements (~30, liste partielle vérifiée) : `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `PermissionRequest`, `PermissionDenied`, `SessionStart`, `Setup`, `SessionEnd`, `UserPromptSubmit`, `UserPromptExpansion`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`.
⚠️ **N'existent pas** : `PromptSubmit`, `TurnComplete`, `ToolExecute`, `ConfigChange`.

*Sources : code.claude.com/docs/en/{settings,mcp,skills,hooks,plugins,plugins-reference}, docs.anthropic.com/.../memory*

---

### 4.2 Gemini CLI (Google) 🟡

- **Rules** : `GEMINI.md` (projet + parents jusqu'au `.git`), `~/.gemini/GEMINI.md` (global). Markdown, imports modulaires `@fichier.md`. Nom personnalisable via `settings.json` → `context.fileName: ["AGENTS.md","GEMINI.md"]`. Géré par `/memory`.
- **MCP** : `.gemini/settings.json` (projet) / `~/.gemini/settings.json` (global), objet `mcpServers`. Transports : stdio (`command`+`args`+`cwd`), SSE (`url`), HTTP (`httpUrl`). Champs : `env` (`$VAR`/`${VAR:-def}`), `timeout`, `trust`, `includeTools`/`excludeTools`. Objet global `mcp.allowed`/`mcp.excluded`. OAuth → `~/.gemini/mcp-oauth-tokens.json`.
- **Skills** : `.gemini/skills/` ou `.agents/skills/` (projet) ; `~/.gemini/skills/` ou `~/.agents/skills/` (global). `SKILL.md` (`name`/`description`) + `scripts/`/`references/`/`assets/`. CLI `gemini skills --scope user|workspace`. 4 niveaux de précédence (builtin > extension > user > workspace).
- **Plugins (« extensions »)** : `~/.gemini/extensions/<nom>/gemini-extension.json` (`name`/`version`/`mcpServers`/`contextFileName`/`excludeTools`) + `commands/*.toml` (namespacés : `commands/gcs/sync.toml` → `/gcs:sync`). Variables `${extensionPath}`, `${workspacePath}`.
- **Hooks** : clé `hooks` dans `settings.json`. Événements (10) : `SessionStart`, `SessionEnd`, `BeforeAgent`, `AfterAgent`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `BeforeTool`, `AfterTool`, `PreCompress`. `{matcher, hooks:[{name, type:"command", command, timeout}]}`. stdin/stdout JSON, exit 0=ok/2=block. Vars `GEMINI_PROJECT_DIR`, `GEMINI_SESSION_ID`.

---

### 4.3 Codex CLI (OpenAI) 🟡

- **Rules** : `AGENTS.md` (de la racine git → cwd, fusionnés, limite 32 KiB via `project_doc_max_bytes`) ; `~/.codex/AGENTS.md` (global). `AGENTS.override.md` prioritaire si présent. Aussi `config.toml`.
- **MCP** : `~/.codex/config.toml` via `[[mcp_servers]]` (`command`/`args`/`env`/`enabled_tools`/`disabled_tools`/`default_tools_approval_mode`/`startup_timeout_sec`) ; aussi `.mcp.json`. CLI `codex mcp`.
- **Skills** : `.agents/skills/` ou `.codex/skills/` (repo + parents) ; `~/.agents/skills/`, `~/.codex/skills/` (user) ; `/etc/codex/skills/` (admin). Standard « open agent skills ». Chargement nom/description d'abord (~8000 car.) puis `SKILL.md` complet. Activation/désactivation via `[[skills.config]]` dans `config.toml`.
- **Plugins** : `.codex-plugin/plugin.json` (seul dans ce dossier) ; composants racine `skills/`, `hooks/hooks.json`, `.mcp.json`, `.app.json`. Champs : `name`/`version`/`description`/`skills`/`mcpServers`/`apps`/`hooks`/`interface`. Chemins relatifs `./`. Activation par `@`.
- **Hooks** : `~/.codex/hooks.json` ou `config.toml` `[hooks.<Event>]` ; repo `.codex/hooks.json`. Événements : `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop` (turn) ; `SessionStart`, `SubagentStart` (session). « Trust » requis (par hash) ; managed via `requirements.toml`.

---

### 4.4 GitHub Copilot CLI 🟡

- **Rules** : `.github/copilot-instructions.md` (global au repo), `.github/instructions/*.instructions.md` (frontmatter `applyTo` glob, `excludeAgent`), `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` ; global `~/.copilot/copilot-instructions.md`. Var `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`.
- **MCP** : `~/.copilot/mcp-config.json` (ou `$COPILOT_HOME/`), objet `mcpServers`, `type` stdio/http/sse/local, `tools: "*"`. PATH hérité, autres env explicites.
- **Skills** : `.github/skills/`, `.claude/skills/`, `.agents/skills/` (projet) ; `~/.copilot/skills/`, `~/.agents/skills/` (user). `SKILL.md` (`name` kebab-case, `description`, `allowed-tools`).
- **Plugins** : `~/.copilot/installed-plugins/` (user/global uniquement). `plugin.json` (`name` requis, max 64 ; `agents`/`skills`/`hooks`/`mcpServers`/`lspServers`/`commands` en string ou array). Marketplaces `copilot-plugins`, `awesome-copilot`.
- **Hooks** : `.github/hooks/*.json` (repo) / `~/.copilot/hooks/*.json` (user). `version: 1`, types `command` (bash/powershell), `http`, `prompt`. Événements : `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `preCompact`, `agentStop`, `subagentStart`, `subagentStop`, `errorOccurred`, `notification`, `permissionRequest`. Conventions camelCase **et** PascalCase (compat VS Code).

---

### 4.5 Cursor CLI / cursor-agent 🟡 (partage les fichiers de l'IDE)

- **Rules** : `.cursor/rules/*.mdc` (frontmatter), `AGENTS.md`. User rules en UI Settings. CLI `/rules`.
- **MCP** : `.cursor/mcp.json` (projet) / `~/.cursor/mcp.json` (global). `mcpServers`, stdio + remote, interpolation `${env:NAME}`/`${workspaceFolder}`/`${userHome}`, `envFile`, OAuth.
- **Skills** : `.cursor/skills/`, `.agents/skills/` ; `~/.cursor/skills/`, `~/.agents/skills/`. `SKILL.md` (`name`/`description`/`paths`/`disable-model-invocation`).
- **Plugins** : `.cursor-plugin/plugin.json` ; `~/.cursor/plugins/local/`. `name` requis ; `rules`/`skills`/`agents`/`commands`/`hooks`/`mcpServers`. Multi-plugins : `marketplace.json`. Marketplace cursor.com.
- **Hooks** : `.cursor/hooks.json` (projet) / `~/.cursor/hooks.json` (global). Compatibilité hooks Claude Code annoncée.

---

### 4.6 opencode 🟡

- **Rules** : `AGENTS.md` (projet) / `~/.config/opencode/AGENTS.md` (global). Compat `CLAUDE.md`. `/init` génère le fichier. `instructions:[]` dans `opencode.json` (globs + URLs distantes).
- **MCP** : clé `mcp` dans `opencode.json` (projet ou global). `type` local (`command[]`) | remote (`url`), `auth:"oauth"`. CLI `opencode mcp auth <server>`.
- **Skills** : `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` (projet) ; équivalents globaux sous `~/.config/opencode/`, `~/.claude/`, `~/.agents/`. `SKILL.md` (nom regex `^[a-z0-9]+(-[a-z0-9]+)*$`, `description`). Invocation `skill({name})`.
- **Plugins** : **modules JS/TS** dans `.opencode/plugins/` ou `~/.config/opencode/plugins/` (ou npm via `opencode.json`). Fonction → objet de handlers d'événements.
- **Hooks** : **pas de fichier dédié** — implémentés dans les plugins. ~25 événements : `session.created/deleted/compacted/idle/error`, `chat.message`, `tool.execute.before/after`, `file.edited`, `command.executed`, `shell.env`, etc.

---

### 4.7 aider 🟡 / ❌

- **Rules** : ❌ pas de moteur natif. Contournement : `CONVENTIONS.md` (Markdown) chargé via `/read` ou clé `read:` dans `.aider.conf.yml`.
- **MCP** : ❌ aider n'est pas serveur/client MCP nativement (intégrations tierces seulement).
- **Skills** : ❌ inexistant.
- **Plugins** : ❌ inexistant (outil monolithique).
- **Hooks** : 🟡 partiel — `.aider.conf.yml` (projet) / `~/.aider.conf.yml` (global), options `auto-lint`/`lint-cmd`/`auto-test`/`test-cmd`/`auto-commits`/`git-commit-verify`. Pas de hooks lifecycle génériques. Aussi `.env` avec préfixe `AIDER_*`.

---

### 4.8 Cursor (IDE) 🟢 (rules) / 🟡 (reste)

- **Rules** 🟢 : `.cursor/rules/` — extension **`.mdc` obligatoire** (un `.md` sans frontmatter y est **ignoré silencieusement**). Frontmatter `description`/`globs`/`alwaysApply`. 4 modes : *Always Apply*, *Apply Intelligently/Agent* (selon `description`), *Apply to Specific Files* (`globs`), *Apply Manually* (`@mention`). User/Team rules en UI/dashboard (pas de fichier). `AGENTS.md` plat à la racine = alternative.
- **MCP / Skills / Plugins / Hooks** 🟡 : identiques au CLI (§4.5). Hooks : hiérarchie 4 niveaux Enterprise → Team → Project → User ; événements `sessionStart`/`sessionEnd`/`preToolUse`/`postToolUse`/`beforeSubmitPrompt`/`beforeShellExecution`/`afterFileEdit`/`workspaceOpen`/`subagentStart`/`subagentStop`… ; agents cloud lisent uniquement `.cursor/hooks.json`. Chemins entreprise : `/Library/Application Support/Cursor/`, `/etc/cursor/`, `C:\ProgramData\Cursor\`.

---

### 4.9 GitHub Copilot dans VS Code 🟡

- **Rules** : `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` (frontmatter `applyTo`/`name`/`description`), `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*.md`. Global `~/.copilot/instructions/`, `~/.claude/`. Réglage `chat.instructionsFilesLocations`.
- **MCP** : `.vscode/mcp.json` (projet, clé **`servers`**) ; config user via « MCP: Open User Configuration ». `type` stdio/http/sse, `inputs[]` (`${input:id}`), objet `sandbox` (macOS/Linux). IntelliSense fourni.
- **Skills** : `.github/skills/`, `.claude/skills/`, `.agents/skills/` ; globaux `~/.copilot/skills/`, `~/.claude/`, `~/.agents/`. `SKILL.md` (`name`/`description`/`argument-hint`/`user-invocable`/`disable-model-invocation`/`context:"fork"`). Réglage `chat.agentSkillsLocations`.
- **Plugins** : auto-détection manifeste `.plugin/plugin.json` → `plugin.json` → `.github/plugin/plugin.json` → `.claude-plugin/plugin.json`. Token `${CLAUDE_PLUGIN_ROOT}`.
- **Hooks** (**Preview**) : `.github/hooks/*.json`, `.claude/settings.json` ; user `~/.copilot/hooks`, `~/.claude/settings.json`. 8 événements : `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`. Champs OS-spécifiques `windows`/`linux`/`osx`.

---

### 4.10 Windsurf (Codeium / Devin Desktop) 🟡

- **Rules** : `.windsurf/rules/*.md` (préféré : `.devin/rules/`), limite 12 000 car./fichier ; legacy `.windsurfrules`. Global : `~/.codeium/windsurf/memories/global_rules.md` (limite 6 000 car.). Frontmatter `trigger` (`always_on`/`model_decision`/`glob`/`manual`) + `globs`.
- **MCP** : `~/.codeium/windsurf/mcp_config.json` (**global uniquement** documenté). `mcpServers` ; stdio (`command`/`args`/`env`) ; remote **`serverUrl`**/`headers`. Interpolation `${env:VAR}`, `${file:/path}`.
- **Skills** : `.windsurf/skills/<nom>/SKILL.md` + `.windsurf/skills.json` (projet) ; `~/.codeium/windsurf/skills/` (global) + chemins entreprise OS. `SKILL.md` (`name`/`description`). Compat `.agents/skills/`, `.claude/skills/`.
- **Plugins** : architecture **extension VS Code** (`package.json`, Open VSX) — pas de manifeste Windsurf propre. Stockage `.devin/` (préféré) / `.windsurf/`.
- **Hooks** : `.windsurf/hooks.json` (projet) / `~/.codeium/windsurf/hooks.json` (global) + chemins OS. `{command, powershell?, show_output, working_directory?}`. Pre-hooks bloquants (exit 2) : `pre_read_code`/`pre_write_code`/`pre_run_command`/`pre_mcp_tool_use`/`pre_user_prompt`. Post-hooks informatifs. 3 niveaux fusionnés system→user→workspace.

---

### 4.11 Antigravity (Google IDE) 🟡

- **Rules** : `.agent/rules/` ou `.agents/rules/` (workspace) ; `~/.gemini/GEMINI.md` (global — **partagé avec Gemini CLI**, source de conflits potentiels). Markdown, `@fichier`.
- **MCP** : `.agent/mcp_config.json` ou `.agents/mcp_config.json` (projet, prioritaire) ; `~/.gemini/antigravity/mcp_config.json` (global ; Windows `C:\Users\<USER>\.gemini\antigravity\mcp_config.json`). `mcpServers` ; remote **`serverUrl`**. Flags `MCP_ENABLED=true`, `AG_ALLOW_MCP=true`.
- **Skills** : `.agent/skills/<nom>/SKILL.md` (+ `scripts/`/`examples/`/`resources/`) ; `~/.gemini/antigravity-cli/skills/`. Sections « Use this skill when / Do not use ». Format universel compatible Claude/Cursor/Codex/Gemini.
- **Plugins** : `~/.gemini/antigravity-cli/plugins/<nom>/plugin.json` (marqueur) + `mcp_config.json`/`hooks.json`/`skills/`/`agents/`/`rules/` + `import_manifest.json`.
- **Hooks** : `.agent/hooks.json`/`.agents/hooks.json` (workspace, prioritaire) ; `~/.gemini/antigravity-cli/{settings.json,hooks.json}`. Stades : `before-tool-execution`/`after-tool-execution`/`before-model-call`/`after-model-call`/`agent-loop-stop`. Contextes Session/Turn/Operation.

*NB : plusieurs sources Antigravity proviennent de dépôts communautaires GitHub — fiabilité 🟡 à confirmer sur antigravity.google/docs.*

---

### 4.12 Kiro (IDE) 🟢 (steering) / ⚪ (reste)

- **Rules / steering** 🟢 : `.kiro/steering/*.md` (workspace, prioritaire) ; `~/.kiro/steering/*.md` (global). Markdown + frontmatter YAML **optionnel** (au tout début, entre `---`). Modes d'inclusion : `always` / `manual` / `fileMatch` / `auto`.
- **MCP / Skills / Plugins / Hooks** ⚪ : **non capturés dans ce cycle**. (Couramment cités hors de cette vérification : MCP en `.kiro/settings/mcp.json` + `~/.kiro/settings/mcp.json`, et « agent hooks » — **à confirmer en doc officielle kiro.dev** avant usage.)

---

### 4.13 Zed 🟡

- **Rules** : `.rules` (+ variantes lues : `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` — **premier trouvé seulement**). Global : `~/.config/zed/AGENTS.md` (Windows `%APPDATA%\Zed\AGENTS.md`). ⚠️ **Rules dépréciées depuis v1.4.0 → remplacées par Skills.**
- **MCP** : clé **`context_servers`** dans `settings.json` — `.zed/settings.json` (projet) / `~/.config/zed/settings.json` (global ; Windows `%LOCALAPPDATA%\Zed\settings.json`). Local (`command`/`args`/`env`) + remote (`url`/`headers`).
- **Skills** : `.agents/skills/<nom>/SKILL.md` (projet, worktree « trusted ») ; `~/.agents/skills/<nom>/SKILL.md` (global). `SKILL.md` (`name`/`description`/`disable-model-invocation`), corps ≤ 500 lignes, catalogue ≤ 50 KB. Commande `/create-skill`.
- **Plugins (« extensions »)** : `extension.toml` (+ `Cargo.toml`/`src/lib.rs` pour Rust/WASM). Installées sous `.../extensions/installed/` (par OS). Fournissent langages/thèmes/MCP/snippets. Dépôt Git public requis.
- **Hooks** : `.zed/tasks.json` (projet) / `~/.config/zed/tasks.json` (global). Tâche avec champ `hooks`. **Un seul hook supporté : `create_worktree`**. Vars `$ZED_WORKTREE_ROOT`, `$ZED_MAIN_GIT_WORKTREE`. Hooks d'agent (PreToolUse…) « en développement ».

---

## 5. Pièges & points de vigilance

- **Champ MCP** : `mcpServers` (majorité) vs `servers` (VS Code) vs `context_servers` (Zed) vs `mcp` (opencode) vs `[[mcp_servers]]` TOML (Codex). Remote : `url` (majorité) vs **`serverUrl`** (Antigravity, Windsurf).
- **Claude Code** : champ JSON `type` (pas `transport`) ; événements de hooks réels (pas `PromptSubmit`/`TurnComplete`/etc.) ; manifeste `plugin.json` non confirmé dans le détail.
- **Cursor** : `.md` dans `.cursor/rules/` est **ignoré** — seul `.mdc` (avec frontmatter) fonctionne.
- **Windsurf** : limites de caractères dures (12 000 par règle, 6 000 global) ; bascule de nommage `.windsurf/` → `.devin/`.
- **Zed** : Rules **dépréciées** (→ Skills) depuis v1.4 ; un seul hook (`create_worktree`).
- **Antigravity & Gemini CLI** partagent `~/.gemini/GEMINI.md` → conflits possibles.
- **Sensibilité temporelle** : skills/plugins/hooks sont récents et évoluent vite partout. Docs `docs.anthropic.com`/`docs.claude.com` redirigent (301) vers `code.claude.com`.

## 6. Lacunes & questions ouvertes

- **Kiro** : MCP, skills, plugins, hooks non capturés/vérifiés ici.
- **Windsurf MCP** : niveau projet non documenté officiellement (global uniquement).
- **Claude Code `plugin.json`** : champs exacts obligatoires/optionnels à confirmer.
- Plusieurs chemins **Antigravity** proviennent de dépôts communautaires (🟡) plutôt que de la doc officielle seule.
- Statut 🟡 = à reconfirmer pour tout usage critique (génération de fichiers de config réels).
