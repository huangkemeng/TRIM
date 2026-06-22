import { MessageManager } from '../src/agent/MessageManager';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

console.log('\n🧪 MessageManager Tests');

const manager = new MessageManager(128000);

// Test: System prompt generation
const systemPrompt = manager.buildSystemPrompt('/test/workspace');
assert(systemPrompt.includes('autonomous AI coding agent'), 'System prompt mentions "autonomous AI coding agent"');
assert(systemPrompt.includes('/test/workspace'), 'System prompt includes workspace path');
assert(systemPrompt.includes('task_complete'), 'System prompt mentions task_complete');
assert(systemPrompt.includes('plan tool'), 'System prompt mentions planning');

// Test: Token estimation
const emptyMessage: any[] = [];
assert(manager.estimateTokenCount(emptyMessage) === 0, 'Empty messages use 0 tokens');

const singleMessage: any[] = [
  { role: 'user', content: 'Hello world', timestamp: Date.now() },
];
const estimatedTokens = manager.estimateTokenCount(singleMessage);
assert(estimatedTokens > 0, 'Single message has positive token count');

// Test: Token estimation with tool calls
const messageWithToolCall: any[] = [
  {
    role: 'assistant',
    content: 'Let me read that file',
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"file_path": "/test.ts"}' },
      },
    ],
    timestamp: Date.now(),
  },
];
const estimatedWithTool = manager.estimateTokenCount(messageWithToolCall);
assert(estimatedWithTool > 10, 'Message with tool call has reasonable token count');

// Test: Context fit (no truncation needed)
const smallMessages: any[] = [
  { role: 'system', content: 'You are an AI agent.', timestamp: Date.now() },
  { role: 'user', content: 'Hello', timestamp: Date.now() },
];
const result = manager.ensureContextFit(smallMessages);
assert(result.length === 2, 'No truncation for small message set');

// Test: Token estimation accuracy
const longText = 'x'.repeat(1000);
const longMessage: any[] = [
  { role: 'user', content: longText, timestamp: Date.now() },
];
const estimatedLong = manager.estimateTokenCount(longMessage);
assert(estimatedLong >= 200 && estimatedLong <= 300, `1000 chars ≈ 250 tokens (got ${estimatedLong})`);

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
