# AGENTS.md — TRIM Coding Agent Guidelines

## Project Overview

**TRIM** (Token-Reduced Intelligent Maker) is an autonomous AI coding agent powered by the DeepSeek API, packaged as a VS Code extension. It can explore codebases, write/edit files, run terminal commands, and iterate until tasks are complete.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode, ES2022) |
| Runtime | Node.js 20+, VS Code Extension API 1.96+ |
| Build | esbuild → CommonJS (single entry `src/extension.ts` → `dist/extension.js`) |
| Module | CommonJS (`require`/`module.exports` compatible) |
| API | DeepSeek API via OpenAI-compatible SDK (`openai` npm package) |
| Testing | Custom test runner (`test/runTest.js` + `npx tsx`) |
| Lint/Format | None configured (rely on `tsc --noEmit` for type checking) |

## Build & Test Commands

```bash
npm install              # Install dependencies
npm run build            # Production build (minified)
npm run dev              # Development build (watch mode, sourcemaps)
npm test                 # Run all tests
npm run lint             # TypeScript type check (tsc --noEmit)
npx tsx test/runTest.js  # Run tests directly without npm script
```

## Project Structure

```
src/
├── extension.ts              # VS Code extension entry point (activate/deactivate)
├── config.ts                 # Configuration loading from VS Code settings
├── commands.ts               # VS Code command registrations
├── agent/
│   ├── Agent.ts              # Core agent loop (run, cancel, loop detection)
│   ├── AgentContext.ts       # Message history management
│   ├── MessageManager.ts     # System prompt, token estimation, context truncation
│   └── index.ts              # Barrel export
├── api/
│   ├── DeepSeekClient.ts     # OpenAI-compatible API client with retries
│   └── types.ts              # API type definitions (ChatMessage, ToolCall, etc.)
├── tools/
│   ├── ToolInterface.ts      # ITool interface + ToolDefinition/ToolResult types
│   ├── ToolRegistry.ts       # Tool registration & OpenAI schema generation
│   ├── ReadFileTool.ts       # Read file contents
│   ├── WriteFileTool.ts      # Create/overwrite files
│   ├── EditFileTool.ts       # Search-and-replace surgical edits
│   ├── GrepTool.ts           # Regex content search (ripgrep)
│   ├── GlobTool.ts           # File pattern matching
│   ├── ListDirTool.ts        # Directory listing
│   ├── BashTool.ts           # Terminal command execution
│   ├── AskUserTool.ts        # Prompt user for input
│   ├── TaskCompleteTool.ts   # Mark task as done
│   └── index.ts              # Barrel export
├── terminal/
│   └── TerminalManager.ts    # VS Code terminal integration
├── ui/
│   ├── AgentWebview.ts       # Webview panel management
│   ├── sidebar/
│   │   ├── SidebarProvider.ts # Sidebar view provider
│   │   └── SidebarStore.ts   # Conversation state management
│   └── webview/
│       ├── script.js         # Webview frontend logic
│       └── style.css         # Webview styles
test/
├── MessageManager.test.ts
├── ToolRegistry.test.ts
└── runTest.js                # Test runner script
```

## Coding Conventions

### TypeScript

- **Strict mode** is on — all code must pass `tsc --noEmit` without errors.
- **No `any`** unless absolutely necessary (mostly in catch blocks: `catch (error: any)`).
- **Use `interface`** for object shapes (see `ToolParameter`, `ToolDefinition`, `ToolResult`).
- **Use `type` unions** for discriminated types where interfaces don't fit.
- **Use `as const`** for literal type assertions (e.g., `'function' as const`).
- **Semicolons** at end of every statement — follow existing code strictly.
- **Single quotes** for strings; template literals only when interpolation is needed.

### Naming

| Category | Convention | Examples |
|----------|-----------|---------|
| Classes | PascalCase | `ToolRegistry`, `MessageManager`, `DeepSeekClient` |
| Interfaces | PascalCase with `I` prefix for contracts | `ITool`, `ToolDefinition`, `ToolResult` |
| Files | PascalCase for classes, PascalCase for interfaces | `ReadFileTool.ts`, `ToolInterface.ts` |
| Methods | camelCase | `buildSystemPrompt()`, `estimateTokenCount()` |
| Constants | UPPER_SNAKE_CASE for static constants | `MAX_RETRIES`, `BASE_DELAY_MS` |
| Private fields | camelCase | `private maxTokens`, `private abortController` |

### Error Handling

Follow the project's pattern: return `ToolResult` with `{ success, data, error }` rather than throwing exceptions:

```typescript
try {
  // ... operation ...
  return { success: true, data: result };
} catch (error: any) {
  return { success: false, data: '', error: `Descriptive message: ${error?.message || error}` };
}
```

### Tools

Every tool implements `ITool` and must provide:
- `definition: ToolDefinition` — name, description, parameters, requiredParameters
- `execute(args: Record<string, unknown>): Promise<ToolResult>` — the tool's logic

When adding a new tool:
1. Create the tool class in `src/tools/`
2. Register it in `src/extension.ts` → `registerAllTools()`
3. Add a test case in `test/ToolRegistry.test.ts` if applicable

### API Layer

- The DeepSeek client wraps the `openai` npm package with DeepSeek's base URL.
- All API calls go through `DeepSeekClient`, never call `openai` directly elsewhere.
- The client has built-in retry logic (max 3 retries with exponential backoff).

### VS Code Integration

- Configuration is read via `vscode.workspace.getConfiguration('trim')` in `config.ts`.
- All VS Code API calls happen in `extension.ts` or `ui/` — the `agent/` and `tools/` layers are framework-agnostic.
- Webview communication uses VS Code's `postMessage` API.

## Testing

- Tests are plain TypeScript files run with `npx tsx` (no Jest/Mocha).
- Each test file has its own tiny assertion helper:
  ```typescript
  let passed = 0, failed = 0;
  function assert(condition: boolean, message: string) { ... }
  ```
- **Always run `npm test` after making changes** to verify nothing is broken.
- Add new test files to the `tests` array in `test/runTest.js`.

## Areas Requiring Extra Care

- **`src/tools/ToolInterface.ts`** — Changing `ITool`, `ToolDefinition`, or `ToolResult` affects every tool and the API schema generation. Make changes deliberately and update all tool implementations.
- **`src/extension.ts`** — The VS Code entry point controls activation lifecycle. Errors here break the entire extension. Test manually in the Extension Development Host (F5).
- **`src/agent/Agent.ts`** — Contains the core agent loop and loop-detection logic. The loop detection heuristics (repeated calls, alternating patterns) are tuned for specific agent behaviors — change thresholds conservatively.
- **`src/api/DeepSeekClient.ts`** — Handles streaming, abort signals, and retry logic. The `waitForAbort`/`never` pattern is deliberate for `Promise.race` with abort signals. Don't simplify without understanding the flow.
- **`BashTool.ts`** — Executes arbitrary shell commands. The `isDestructiveCommand` blocklist is a safety measure. When adding patterns, prefer false positives (blocking safe commands) over false negatives (allowing dangerous ones).

## Agent System Prompt

The agent's behavior is controlled by the system prompt in `MessageManager.buildSystemPrompt()`. Key directives:
- Always read files before modifying them
- Prefer `edit_file` (surgical) over `write_file` (full rewrite) for small changes
- Call `task_complete` when the task is done
- Answer simple questions concisely and call `task_complete` immediately
- Use absolute paths when working with files
