/**
 * Test runner for TRIM extension.
 * Runs all test files and reports results.
 */
const path = require('path');
const { execSync } = require('child_process');

const tests = [
  'ToolRegistry.test.ts',
  'MessageManager.test.ts',
];

let allPassed = true;

console.log('🧪 TRIM Test Runner');
console.log('='.repeat(50));

for (const testFile of tests) {
  console.log(`\n📄 Running ${testFile}...`);
  try {
    execSync(`npx tsx "${path.join(__dirname, testFile)}"`, {
      stdio: 'inherit',
      timeout: 30000,
    });
    console.log(`  ✅ ${testFile} passed`);
  } catch (error) {
    console.error(`  ❌ ${testFile} failed`);
    allPassed = false;
  }
}

console.log('\n' + '='.repeat(50));
if (allPassed) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed.');
  process.exit(1);
}
