import { ToolRegistry } from '../src/tools/ToolRegistry';
import { ReadFileTool } from '../src/tools/ReadFileTool';
import { WriteFileTool } from '../src/tools/WriteFileTool';
import { EditFileTool } from '../src/tools/EditFileTool';
import { BashTool } from '../src/tools/BashTool';
import { TaskCompleteTool } from '../src/tools/TaskCompleteTool';
import { GrepTool } from '../src/tools/GrepTool';
import { GlobTool } from '../src/tools/GlobTool';
import { ListDirTool } from '../src/tools/ListDirTool';
import { PlanTool } from '../src/tools/PlanTool';
import { ITool } from '../src/tools/ToolInterface';

// Simple test runner
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

// Test: ToolRegistry basic operations
console.log('\n🧪 ToolRegistry Tests');

const registry = new ToolRegistry();

assert(registry.list().length === 0, 'Registry starts empty');

registry.register(new ReadFileTool());
assert(registry.list().length === 1, 'Registry has 1 tool after registering ReadFileTool');
assert(registry.list()[0] === 'read_file', 'Tool name is "read_file"');

const tool = registry.get('read_file');
assert(tool !== undefined, 'Can retrieve ReadFileTool by name');
assert(tool.definition.name === 'read_file', 'Tool definition name matches');
assert(tool.definition.requiredParameters.includes('file_path'), 'read_file requires file_path');

// Test: Schema generation
console.log('\n🧪 Tool Schema Tests');

const schemas = registry.getToolSchemas();
assert(schemas.length === 1, 'getToolSchemas returns 1 schema');
assert(schemas[0].name === 'read_file', 'Schema name matches');

const openaiSchemas = registry.getOpenAIToolSchemas();
assert(openaiSchemas.length === 1, 'getOpenAIToolSchemas returns 1 schema');
assert(openaiSchemas[0].type === 'function', 'Schema type is "function"');
assert(openaiSchemas[0].function.name === 'read_file', 'OpenAI schema function name matches');

// Test: Multiple tools
console.log('\n🧪 Multiple Tool Registration');

const multiRegistry = new ToolRegistry();
multiRegistry.register(new ReadFileTool());
multiRegistry.register(new WriteFileTool());
multiRegistry.register(new EditFileTool());
multiRegistry.register(new BashTool());
multiRegistry.register(new TaskCompleteTool());
multiRegistry.register(new GrepTool());
multiRegistry.register(new GlobTool());
multiRegistry.register(new ListDirTool());
	multiRegistry.register(new PlanTool());

assert(multiRegistry.list().length === 9, 'Registry has 9 tools');
assert(multiRegistry.list().includes('read_file'), 'Has read_file');
assert(multiRegistry.list().includes('write_file'), 'Has write_file');
assert(multiRegistry.list().includes('edit_file'), 'Has edit_file');
assert(multiRegistry.list().includes('bash'), 'Has bash');
assert(multiRegistry.list().includes('task_complete'), 'Has task_complete');
	assert(multiRegistry.list().includes('plan'), 'Has plan');

// Test: Unknown tool error
console.log('\n🧪 Error Handling Tests');

try {
  registry.get('nonexistent_tool');
  assert(false, 'Should throw for unknown tool');
} catch (e: any) {
  assert(e.message.includes('Unknown tool'), 'Throws error with "Unknown tool" message');
  assert(e.message.includes('nonexistent_tool'), 'Error includes tool name');
}

// Test: Tool definition structure
console.log('\n🧪 Tool Definition Structure');

const bashTool = new BashTool();
assert(typeof bashTool.definition.name === 'string', 'Tool definition has name');
assert(typeof bashTool.definition.description === 'string', 'Tool definition has description');
assert(typeof bashTool.definition.parameters === 'object', 'Tool definition has parameters');
assert(Array.isArray(bashTool.definition.requiredParameters), 'Tool definition has requiredParameters array');

const bashParams = bashTool.definition.parameters;
assert('command' in bashParams, 'BashTool has "command" parameter');
assert(bashParams.command.type === 'string', 'command parameter is string type');
assert('description' in bashParams, 'BashTool has "description" parameter');

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
