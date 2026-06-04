# Comparaison — Implémentation AIRulesConverter vs structures réelles des outils

> Confronte ce que le repo (`src/core/*`) **scanne et écrit réellement** aux structures officielles documentées dans `research/ai-coding-tools-config-structures.md`.
> Méthode : workflow 2 phases — (1) cartographie du code (5 agents, un par dimension, refs `file:line`) → (2) diff par IDE (8 IDE). Les agents `agy` et `kiro` n'ont pas émis de sortie structurée ; leurs diffs ont été complétés manuellement à partir de la carte repo (même fiabilité, dérivés du code).

---

## 0. Statut de résolution (mise à jour 2026-06-04)

Corrections appliquées au code pour aligner les **sorties** sur la syntaxe officielle, vérifiées via fixtures + round-trip CLI :

| Réf | Sujet | Statut |
|-----|-------|--------|
| #1 | Windsurf MCP `url`→`serverUrl` | ✅ corrigé (`McpConverter.convertServer`) |
| #2 | Windsurf hooks : vrais events `pre_*`/`post_*`/`pre_user_prompt` + shape `{command, show_output, …}` | ✅ corrigé |
| #3 | Copilot hooks : wrapper `{version:1, hooks:{…}}` | ✅ corrigé |
| #4 | Antigravity/agy skills `.agents/skill`→`.agents/skills` | ✅ corrigé |
| #5 | Antigravity/agy MCP write `.agent`→`.agents` | ✅ corrigé |
| #6 | Antigravity/agy hooks write `.agents` + stages kebab-case (`before-tool-execution`…) | ✅ corrigé (+ reverse map au scan) |
| #7 | claude-code MCP global → `~/.claude.json` (read + write) | ✅ corrigé |
| #8 | Antigravity MCP global → `~/.gemini/antigravity/` (sans `-cli`) | ✅ corrigé |
| §3.1 | Chemins **globaux** rules/skills/hooks (write) via table `(ide,dimension)→path` + `scope` first-class | ✅ corrigé pour l'écriture (gemini, windsurf, copilot, antigravity, kiro, claude ; cursor = UI-only → skip) |
| §3.4 | gemini-cli MCP HTTP → `httpUrl` (vs SSE `url`) | ✅ corrigé (+ canonicalisation au sens inverse) |
| §6 | claude-code rules ciblées : frontmatter officiel `paths` (au lieu du Cursor-style `alwaysApply`/`globs`/`description` inerte) dans `.claude/rules/*.md` | ✅ corrigé (`buildClaudeCodeRuleContent` ; `normaliseMetadata` lit `paths`→`globs` ; round-trip cursor↔claude vérifié) |
| — | Rules antigravity/agy `.agent/rules`→`.agents/rules` (cohérence du bundle) | ✅ corrigé (scan lit les deux, warn sur déprécié) |

**Restant (hors périmètre de cette passe — capacités/robustesse, non « syntaxe cassée »)** : lecture (scan) des sources **globales** non-claude (§3.1 côté read) ; `.agents/skills/` partagé entre tous les IDE (§3.2) ; dédup `agy`/`antigravity` (§3.3) ; claude-code hooks union 7→~30 events (§3.4) ; capacités absentes (§4 : Copilot MCP 2 surfaces, Cursor hooks+plugins, Gemini hooks+extensions, Kiro MCP/hooks ⚪) ; nouveaux outils (§7 : Codex, opencode, Zed).

---

## 1. Verdict global par IDE

| IDE repo | Outil réel | Verdict | Bugs HIGH | Capacités manquantes |
|----------|-----------|---------|-----------|----------------------|
| `claude-code` | Claude Code | 🟡 minor_gaps | 1 (MCP global) | — |
| `gemini-cli` | Gemini CLI | 🟡 minor_gaps | 0 | plugins, hooks |
| `cursor` | Cursor | 🟡 minor_gaps | 0 | plugins, hooks |
| `copilot` | GitHub Copilot | 🔴 major_gaps | 1 (hooks shape) | MCP (2 surfaces) |
| `windsurf` | Windsurf | 🔴 major_gaps | 2 (MCP `serverUrl`, hooks events) | — |
| `antigravity` | Antigravity | 🔴 major_gaps | 3 (MCP/skills/hooks paths) | — |
| `agy` | Antigravity (variante `.agents`) | 🔴 major_gaps | 3 (idem antigravity) | — |
| `kiro` | Kiro | 🟡 minor_gaps* | 0 | MCP, hooks (non vérifiés recherche) |

\* Kiro : seul le *steering* (rules) est vérifié côté recherche ; le reste est ⚪.

**Score dimensions** (6 IDE diffés automatiquement + 2 manuels, 5 dimensions) : ~8 `correct`/`none`, ~10 `partial`, ~5 `missing_in_repo`, **9 entrées HIGH**, ~3 `not_applicable`.

---

## 2. 🔴 Bugs HIGH — config cassée que l'utilisateur devrait réparer à la main

Classés par impact. **Ce sont les corrections prioritaires.**

| # | IDE | Dim | Bug | Correctif | Réf code |
|---|-----|-----|-----|-----------|----------|
| 1 | windsurf | mcp | Remote MCP émis avec **`url`** ; Windsurf exige **`serverUrl`**. Seuls agy/antigravity reçoivent le rewrite. Serveur HTTP/SSE converti → ne se connecte pas. | Ajouter `windsurf` au set du rewrite `url→serverUrl`. | `McpConverter.ts:88-101` |
| 2 | windsurf | hooks | Events **inventés** : `init`/`exit` + tout collapse dans `pre_write_code`/`post_write_code`. Mauvaise *shape* (`{matcher,hooks,type,command,script}`). Vrais events : `pre_read_code`/`pre_write_code`/`pre_run_command`/`pre_mcp_tool_use`/`pre_user_prompt` ; vraie shape `{command, show_output, working_directory?, powershell?}`. | Réécrire `canonicalToWindsurfEvent` + la shape d'entrée. | `HooksConverter.ts:109-133` |
| 3 | copilot | hooks | Writer émet un **spread d'events à la racine** sans wrapper. Vrai format : `{ "version": 1, "hooks": { … } }`. Fichier ignoré/rejeté par Copilot. | Émettre `{version:1, hooks:{<Event>:[…]}}`. | `HooksConverter.ts:109-114, 145-146` |
| 4 | antigravity + agy | skills | `IDE_SKILLS_DIR_MAP['antigravity'\|'agy'] = '.agents/skill'` (**SINGULIER**). N'est lu par aucun scanner → skills écrits dans un dossier mort. | `'.agents/skill'` → `'.agents/skills'`. | `SkillConverter.ts:32-33` |
| 5 | antigravity + agy | mcp | Writer hardcode le **`.agent/` singulier déprécié** alors que le scanner préfère `.agents/` (et *warn*). Round-trip relocalise la config vers le chemin déprécié. | Écrire vers `.agents/mcp_config.json`. | `McpConverter.ts:108-111` |
| 6 | antigravity + agy | hooks | Idem : write hardcodé `.agent/hooks.json` (singulier déprécié). + events **Claude-style** (`PreToolUse`…) au lieu des stages kebab-case Antigravity (`before-tool-execution`/`after-tool-execution`/`before-model-call`/`after-model-call`/`agent-loop-stop`). | Écrire `.agents/hooks.json` + table de mapping d'events. | `HooksConverter.ts:137-140` |
| 7 | claude-code | mcp | Le **global MCP** résout `~/.mcp.json` (swap rootPath→home sur le relatif `.mcp.json`). Claude Code lit le MCP user/local dans **`~/.claude.json`**. Le commentaire de `GlobalPathResolver` documente aussi le mauvais `~/.mcp.json`. | Cible globale dédiée `~/.claude.json` + corriger le commentaire. | `GlobalPathResolver.ts:12-13` |
| 8 | antigravity + agy | mcp | `getAntigravityGlobalMcpConfig()` construit `~/.gemini/antigravity-cli/mcp_config.json` ; doc = `~/.gemini/antigravity/mcp_config.json` (**sans `-cli`**), et le resolver **n'est jamais câblé**. | Corriger le chemin (drop `-cli`) + câbler dans le flux `--global`. | `GlobalPathResolver.ts:41-43` |

---

## 3. Problèmes transversaux (touchent plusieurs IDE)

### 3.1 Niveau global/user quasi toujours faux 🔴
Le repo n'a **pas de constantes de chemin global par dimension** pour la plupart des IDE. `--global` se contente de remplacer `rootPath` par `os.homedir()` et de ré-ancrer le chemin **projet-relatif**. Résultat : des chemins globaux **inexistants** pour les vrais outils.

| IDE | Ce que le repo produit en `--global` | Vrai chemin global |
|-----|--------------------------------------|--------------------|
| claude-code (mcp) | `~/.mcp.json` | `~/.claude.json` |
| gemini-cli (rules) | `~/GEMINI.md` | `~/.gemini/GEMINI.md` |
| windsurf (rules) | `~/.windsurf/rules/` | `~/.codeium/windsurf/memories/global_rules.md` |
| windsurf (mcp) | `~/.windsurf/mcp_config.json` | `~/.codeium/windsurf/mcp_config.json` |
| windsurf (skills) | `~/.windsurf/skills/` | `~/.codeium/windsurf/skills/` |
| copilot (rules) | `~/.github/copilot-instructions.md` | `~/.copilot/copilot-instructions.md` |
| copilot (skills) | `~/.github/skills/` | `~/.copilot/skills/` |
| antigravity (rules) | *(aucun)* | `~/.gemini/GEMINI.md` |

➡️ **Recommandation structurante** : étendre `GlobalPathResolver` avec une vraie table `(ide, dimension) → cheminGlobal` au lieu du swap `rootPath`. Modéliser un `scope: 'global'` first-class (actuellement le scope est hardcodé `'project'` même pour des fichiers lus en global).

### 3.2 Standard cross-tool `.agents/skills/` sous-exploité 🟡
La recherche (§3 convention 2) établit que **presque tous** les outils modernes lisent `.agents/skills/` (projet) + `~/.agents/skills/` (global) **en plus** de leur dossier natif. Le repo n'attribue `.agents/skills/` **qu'à `agy`/`antigravity`** (`SkillScanner.ts:48-49`). Donc un skill placé dans `.agents/skills/` est invisible pour `cursor`, `copilot`, `windsurf`, `gemini-cli`, `claude-code`.
➡️ Traiter `.agents/skills/` comme source partagée (source-agnostique) ou l'ajouter aux scans de chaque IDE concerné.

### 3.3 `agy` ≡ `antigravity` : doublon d'IDE 🟡
`agy` et `antigravity` scannent **les mêmes fichiers `.agent/rules`** et émettent **deux objets `Rule` par fichier** (`RuleScanner.ts:277` partage le chemin). MCP/skills/hooks sont identiques (alias). Les bugs HIGH #4/#5/#6 frappent donc **en double**.
➡️ Décider si `agy` est un alias d'affichage d'`antigravity` (dédup) ou un format distinct ; aujourd'hui c'est une redondance qui double les bugs.

### 3.4 Tables de mapping d'events/champs manquantes 🟡
Le repo passe les noms canoniques tels quels au lieu de mapper vers les conventions de chaque outil :
- **claude-code hooks** : union de **7 events** sur ~30 réels (manquent `SessionEnd`, `PreCompact`, `PostCompact`, `SubagentStart/Stop`, `PostToolUseFailure`, `UserPromptExpansion`, `Setup`, `PermissionDenied`, `PostToolBatch`…). Les hooks sous ces clés sont **silencieusement perdus**. (`PluginMigrator.ts:60-63`)
- **gemini-cli MCP** : pas de notion de `httpUrl` (champ HTTP/streamable distinct de `url`=SSE). Un serveur HTTP migré vers Gemini sort en `url`.
- **antigravity hooks** : events kebab-case non mappés (cf. #6).
- **cursor/windsurf hooks** : events camelCase (`sessionStart`, `preToolUse`) non normalisés.
- ✅ Bon point : le repo **n'émet pas** les events bidons `PromptSubmit`/`TurnComplete`/`ToolExecute`/`ConfigChange`.

---

## 4. Capacités totalement absentes (le vrai outil les a, le repo non)

| IDE | Dimension | Réalité | Sévérité |
|-----|-----------|---------|----------|
| gemini-cli | plugins | « extensions » `~/.gemini/extensions/<n>/gemini-extension.json` + `commands/*.toml`. `toPluginFormat('gemini-cli')→null`. | medium |
| gemini-cli | hooks | clé `hooks` dans `settings.json`, 10 events. Non scanné/écrit (`getTargetFilePath` throw). | medium |
| cursor | plugins | `.cursor-plugin/plugin.json` + `~/.cursor/plugins/local/` + `marketplace.json`. `toPluginFormat('cursor')→null`. | medium |
| cursor | hooks | `.cursor/hooks.json` + `~/.cursor/hooks.json` (compat Claude). Non supporté. | medium |
| copilot | mcp | **les 2 surfaces** supportent MCP : VS Code `.vscode/mcp.json` (clé **`servers`** !) ; CLI `~/.copilot/mcp-config.json` (clé `mcpServers`). Totalement absent. | medium |
| kiro | mcp | Kiro a un MCP natif (`.kiro/settings/mcp.json`)\*. Repo : `toPluginFormat`/scanner absents. | medium |
| kiro | hooks | Kiro a des « agent hooks »\*. Non supporté. | medium |

\* Kiro MCP/hooks : **non vérifiés** dans le cycle de recherche (⚪) — à confirmer sur kiro.dev avant implémentation.

⚠️ **Piège pré-emptif Copilot MCP** : si on ajoute le MCP Copilot, la surface **VS Code exige `servers`**, pas `mcpServers`. Le converter écrit `mcpServers` pour tous les autres IDE → un copier-coller naïf produira la mauvaise clé racine.

---

## 5. ✅ Ce qui est CORRECT (ne pas toucher)

- **claude-code** : clé `mcpServers` ✓, champ `type` (jamais le faux `transport`) ✓, `.mcp.json` projet ✓, `.claude-plugin/plugin.json` + composants à la racine ✓, structure hooks 3-niveaux + naming canonique ✓.
- **cursor** : écriture **`.mdc` uniquement** ✓ (respecte l'exigence dure de Cursor), clé `mcpServers` ✓, remote `url` ✓ (rewrite `serverUrl→url`), `.cursor/mcp.json` projet **et** global ✓, frontmatter `alwaysApply`/`globs`/`description` ✓.
- **windsurf** : frontmatter `trigger` (`always_on`/`glob`/`model_decision`/`manual`) ✓, clé MCP `mcpServers` ✓.
- **antigravity/agy** : clé `mcpServers` ✓, rewrite **`url→serverUrl`** ✓, format plugin bundle (`plugin.json`+`hooks.json`+`mcp_config.json`+`skills/agents/rules`) bien aligné ✓.
- **gemini-cli** : clé `mcpServers` embarquée dans `.gemini/settings.json` avec préservation des autres clés ✓, skills `.gemini/skills/` ✓, rules flat-file H2 ✓.
- **copilot** : layout `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md` ✓, frontmatter `applyTo` ✓.
- **kiro** : steering `.kiro/steering/` + frontmatter `inclusion` ✓ (manque le mode `auto` et le niveau global).

---

## 6. Détail par IDE (statut × dimension)

**Légende statut** : `correct` · `partial` · `outdated` (chemin/clé que l'outil n'utilise pas/plus) · `missing_in_repo` · `repo_only` · `n/a`.

### claude-code — minor_gaps
| Dim | Statut | Sév | Note |
|-----|--------|-----|------|
| rules | correct* | low | ✅ Frontmatter officiel **`paths`** dans `.claude/rules/*.md` (scan le relit en `globs`). *Reste capacité : `CLAUDE.local.md` + `~/.claude/rules/` réel (non bloquant syntaxe). |
| mcp | partial | **high** | Bug #7 (global `~/.mcp.json`). Projet `.mcp.json` + `mcpServers` + `type` + `url` = ✓. |
| skills | partial | med | `.claude/skills/` ✓ ; manque standard `.agents/skills/` + global `~/.claude/skills/`. |
| plugins | correct | low | `.claude-plugin/plugin.json` + racine ✓. Ne lit/écrit pas `hooks/hooks.json` externalisé (hooks gardés inline). |
| hooks | partial | med | Fichier/clé/structure ✓ ; **7/30 events** seulement ; manque `settings.local.json` + global. |

### gemini-cli — minor_gaps
| Dim | Statut | Sév | Note |
|-----|--------|-----|------|
| rules | partial | med | Global → `~/GEMINI.md` au lieu de `~/.gemini/GEMINI.md`. Ne scanne pas `.gemini/GEMINI.md` ni parents ni imports `@file`. |
| mcp | partial | med | `mcpServers` ✓ ; manque le champ **`httpUrl`** (HTTP) → sort en `url`. |
| skills | partial | low | `.gemini/skills/` ✓ ; `.agents/skills/` non attribué à gemini-cli. |
| plugins | missing | med | Extensions `gemini-extension.json` non gérées. |
| hooks | missing | med | clé `hooks` settings.json (10 events) non gérée. |

### cursor — minor_gaps
| Dim | Statut | Sév | Note |
|-----|--------|-----|------|
| rules | correct | low | `.mdc`-only ✓. Optionnel : `AGENTS.md`. Note : global `~/.cursor/rules/` n'est PAS le mécanisme user de Cursor (UI-only). |
| mcp | correct | none | `.cursor/mcp.json` projet+global, `mcpServers`, `url` = tout ✓. |
| skills | partial | med | `.cursor/skills/` ✓ ; manque standard `.agents/skills/`. |
| plugins | missing | med | `.cursor-plugin/plugin.json` non géré. |
| hooks | missing | med | `.cursor/hooks.json` non géré. |

### copilot — major_gaps
| Dim | Statut | Sév | Note |
|-----|--------|-----|------|
| rules | partial | med | Layout `.github` ✓ ; global → `~/.github/...` au lieu de `~/.copilot/...`. `applyTo` split par virgule (OK sauf glob à virgule littérale). |
| mcp | missing | med | Absent ; **2 surfaces** (`servers` VS Code / `mcpServers` CLI). Piège clé racine. |
| skills | partial | med | `.github/skills/` ✓ ; manque `.agents/`+`.claude/skills/` + global `~/.copilot/skills/`. |
| plugins | n/a | low | OK : Copilot auto-détecte `.claude-plugin/plugin.json`. |
| hooks | **outdated** | **high** | Bug #3 (pas de wrapper `{version:1,hooks:{}}`). |

### windsurf — major_gaps
| Dim | Statut | Sév | Note |
|-----|--------|-----|------|
| rules | partial | med | Global `~/.windsurf/` faux (→ `~/.codeium/windsurf/memories/global_rules.md`). Manque `.devin/rules/` + limites 12k/6k chars. Trigger frontmatter ✓. |
| mcp | partial | **high** | Bug #1 (`url` au lieu de `serverUrl`) + global faux. |
| skills | partial | med | `.windsurf/skills/` ✓ ; global faux + manque `.agents/.claude` + `skills.json`. |
| plugins | n/a | none | OK : modèle extension VS Code, pas de manifeste propre. |
| hooks | **outdated** | **high** | Bug #2 (events inventés + mauvaise shape). |

### antigravity & agy — major_gaps (mêmes bugs, ×2)
| Dim | Statut | Sév | Note |
|-----|--------|-----|------|
| rules | partial | med | Scan/write **`.agent/rules/` singulier** seulement (jamais `.agents/rules/`). Pas de global (`~/.gemini/GEMINI.md`). Frontmatter trigger non doc-confirmé pour Antigravity. |
| mcp | partial | **high** | Bugs #5 (write `.agent` singulier) + #8 (global path `-cli`). `mcpServers`+`serverUrl` = ✓. |
| skills | partial | **high** | Bug #4 (`.agents/skill` singulier = dossier mort). Scan multi-emplacements OK. |
| plugins | partial | low | Bundle bien aligné ; manque `import_manifest.json` ; events bundle Claude-style à vérifier. |
| hooks | partial | **high** | Bug #6 (write `.agent` singulier + events Claude vs kebab-case). |

### kiro — minor_gaps (recherche partielle ⚪)
| Dim | Statut | Sév | Note |
|-----|--------|-----|------|
| rules | partial | low/med | `.kiro/steering/` (inclusion `always`) + `.kiro/specs/` (`manual`) ✓. Manque mode **`auto`** + niveau global **`~/.kiro/steering/`** (aucune entrée kiro dans `GlobalPathResolver`). |
| mcp | missing | med* | Kiro a un MCP natif\* ; repo absent. |
| skills | repo_only | — | Repo écrit `.kiro/skills/` mais **aucune feature skills Kiro confirmée** par la recherche → à vérifier (potentiellement chemin fictif). |
| plugins | n/a | none | Pas de bundle Kiro documenté. |
| hooks | missing | med* | Kiro a des « agent hooks »\* ; repo absent. |

\* Non vérifié recherche — confirmer sur kiro.dev.

---

## 7. Outils recherchés NON gérés du tout par le repo

Le repo couvre 8 IDE (`cursor, windsurf, kiro, antigravity, agy, claude-code, gemini-cli, copilot`). La recherche documente aussi des outils **sans aucun équivalent** dans l'`IDE` union :

- **Codex CLI (OpenAI)** — `AGENTS.md`/`~/.codex/`, MCP TOML `[[mcp_servers]]`, skills `.agents/skills`, plugins `.codex-plugin/`, hooks. Format AGENTS.md + skills `.agents/` = **forte compatibilité** si ajouté.
- **opencode** — `AGENTS.md`, MCP clé `mcp` dans `opencode.json`, skills `.opencode/skills`, plugins JS, hooks via plugins.
- **aider** — rules ❌, MCP ❌, skills ❌, plugins ❌ ; seulement `.aider.conf.yml`. Peu d'intérêt à convertir.
- **Zed** — rules `.rules`/`AGENTS.md`, MCP clé **`context_servers`**, skills `.agents/skills`, extensions `extension.toml`, hooks `tasks.json` (`create_worktree` seul).
- **Copilot CLI** et **Cursor CLI** — le repo les traite via les IDE génériques `copilot`/`cursor` ; surfaces CLI distinctes (ex. `~/.copilot/mcp-config.json`) non modélisées séparément.

➡️ `AGENTS.md` + `.agents/skills/` étant le terrain commun, prioriser **Codex CLI** et **opencode** offrirait le meilleur ratio couverture/effort.

---

## 8. Plan de correction suggéré (par priorité)

**P0 — bugs qui cassent la config produite :**
1. Windsurf MCP `serverUrl` (#1) · 2. Windsurf hooks events+shape (#2) · 3. Copilot hooks wrapper (#3) · 4. Antigravity/agy skills `.agents/skill→skills` (#4) · 5. Antigravity/agy MCP+hooks write `.agent→.agents` (#5,#6).

**P1 — chemins globaux faux :**
6. `GlobalPathResolver` : table `(ide,dimension)→global` réelle (#7,#8 + §3.1). Modéliser `scope:'global'`.

**P2 — capacités manquantes à fort ROI :**
7. Copilot MCP (2 surfaces, attention clé `servers`) · 8. Cursor hooks+plugins · 9. Gemini hooks+extensions · 10. claude-code : étendre l'union de 7→~30 events de hooks.

**P3 — robustesse/standard :**
11. `.agents/skills/` partagé entre tous les IDE (§3.2) · 12. Dédup `agy`/`antigravity` (§3.3) · 13. gemini `httpUrl` · 14. Kiro mode `auto` + global ; vérifier `.kiro/skills/`.

**P4 — extension du périmètre :** Codex CLI, opencode, Zed.
