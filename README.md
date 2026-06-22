# TRIM — Token-Reduced Intelligent Maker

An autonomous AI coding agent powered by DeepSeek API that runs as a VS Code extension. TRIM can understand requirements, explore codebases, write code, run tests, and iterate until tasks are complete.

> **TRIM** = **T**oken-**R**educed **I**ntelligent **M**aker — 省 Token 的智能造物者

## Features

- 🤖 **Autonomous Coding** — Agent independently plans, writes, tests, and fixes code
- 🔧 **Tool System** — Read/write files, search code, run terminal commands
- 📺 **Real-time Streaming** — Watch the agent think and act in a dedicated webview panel
- 🔄 **Self-correcting** — Detects errors and automatically fixes them
- 🛡️ **Safe Execution** — Dangerous commands are blocked; user can stop anytime
- 🧠 **DeepSeek Powered** — Uses DeepSeek V3/R1 models via OpenAI-compatible API

## Requirements

- [VS Code](https://code.visualstudio.com/) 1.96.0 or higher
- [Node.js](https://nodejs.org/) 18 or higher
- [DeepSeek API Key](https://platform.deepseek.com/api_keys)

## Installation

### From Source

```bash
# Clone the repository
git clone <repo-url>
cd trim-agent

# Install dependencies
npm install

# Build the extension
npm run build

# Launch in VS Code Extension Development Host
code .
# Then press F5 to run
```

## Configuration

Open VS Code Settings (`Ctrl+,`) and search for "TRIM":

| Setting | Default | Description |
|---------|---------|-------------|
| `trim.apiKey` | `""` | **Required.** Your DeepSeek API key |
| `trim.model` | `"deepseek-chat"` | Model to use (`deepseek-chat` or `deepseek-reasoner`) |
| `trim.temperature` | `0.1` | Model temperature (lower = more deterministic) |
| `trim.maxIterations` | `100` | Maximum agent loop iterations per task |
| `trim.maxTokens` | `128000` | Maximum context window tokens |

## Usage

### Start a Task

1. Press `Ctrl+Shift+P` to open the command palette
2. Run **TRIM: Start New Task**
3. Describe your task (e.g., "Create a REST API endpoint for user authentication")
4. Watch TRIM work in the webview panel

### Stop a Task

- Click the **Stop** button in the webview panel
- Or run **TRIM: Stop Current Task** from the command palette

### Example Tasks

Here are some tasks TRIM can handle:

```
"Create a new Express.js server with a health check endpoint"
"Add unit tests for the user service module"
"Refactor the database layer to use connection pooling"
"Find and fix all TypeScript type errors in the src/ directory"
"Create a Dockerfile and docker-compose.yml for this project"
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   TRIM Extension                      │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Commands │  │ Webview  │  │ Output Channel   │   │
│  └────┬─────┘  └────┬─────┘  └──────────────────┘   │
│       │              │                                │
│  ┌────▼──────────────▼─────┐                         │
│  │        Agent            │                         │
│  │  (Plan → Act → Observe) │                         │
│  └────┬──────────────┬─────┘                         │
│       │              │                                │
│  ┌────▼────┐  ┌──────▼──────┐                        │
│  │ Tools   │  │ DeepSeek   │                        │
│  │ Registry│  │ Client     │                        │
│  └─────────┘  └────────────┘                        │
└─────────────────────────────────────────────────────┘
```

### Agent Loop

1. **Build Prompt** — System instructions + conversation history + tool schemas
2. **Call LLM** — Send to DeepSeek API with streaming
3. **Parse Response** — Extract text and tool calls
4. **Execute Tools** — Run tools (read/write files, bash commands, etc.)
5. **Observe Results** — Append results to conversation history
6. **Iterate** — Repeat until task is complete or max iterations reached

### Available Tools

| Tool | Purpose |
|------|---------|
| `read_file` | Read file contents with line offset/limit |
| `write_file` | Create or overwrite files |
| `edit_file` | Surgical search/replace edits |
| `grep` | Regex search across codebase |
| `glob` | List files matching a pattern |
| `list_dir` | List directory contents |
| `bash` | Execute terminal commands |
| `ask_user` | Ask the user for clarification |
| `task_complete` | Signal task completion |

## Development

### Build

```bash
npm run build    # Production build
npm run watch    # Watch mode for development
```

### Type Check

```bash
npx tsc --noEmit
```

### Test

```bash
npm test
```

### Project Structure

```
src/
├── extension.ts           # Extension entry point
├── config.ts              # Configuration management
├── commands.ts            # Command registrations
├── agent/
│   ├── Agent.ts           # Core autonomous loop
│   ├── AgentContext.ts    # Conversation history
│   ├── MessageManager.ts  # Token counting & truncation
│   └── index.ts
├── api/
│   ├── DeepSeekClient.ts  # DeepSeek API client
│   └── types.ts           # Type definitions
├── tools/
│   ├── ToolInterface.ts   # Tool interface
│   ├── ToolRegistry.ts    # Tool registration
│   ├── ReadFileTool.ts
│   ├── WriteFileTool.ts
│   ├── EditFileTool.ts
│   ├── GrepTool.ts
│   ├── GlobTool.ts
│   ├── ListDirTool.ts
│   ├── BashTool.ts
│   ├── AskUserTool.ts
│   ├── TaskCompleteTool.ts
│   └── index.ts
├── ui/
│   ├── AgentWebview.ts    # Webview panel
│   └── webview/
│       ├── style.css
│       └── script.js
└── terminal/
    └── TerminalManager.ts
```

## Safety

- **Dangerous commands** (`rm -rf`, `git push --force`, etc.) are automatically blocked
- **Stop button** lets you interrupt TRIM at any time
- **Max iterations** prevents infinite loops
- **Loop detection** identifies repeated tool calls with the same arguments
- **API key** is stored in VS Code settings (not in code)

## Troubleshooting

### "API Key is not configured"
Go to VS Code Settings → TRIM → Api Key and enter your DeepSeek API key.

### "Failed to connect to DeepSeek API"
- Verify your API key is correct
- Check your internet connection
- Ensure you can reach `https://api.deepseek.com`

### TRIM is stuck in a loop
- Click the **Stop** button in the webview
- Restart with a more specific task description
- Increase `trim.maxIterations` if the task is complex

## License

MIT
