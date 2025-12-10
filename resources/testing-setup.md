# GhostPad Testing Infrastructure

## Overview

This document describes the testing infrastructure that was implemented for the GhostPad project. The test suite provides automated validation of core functionality to ensure code quality and prevent regressions.

## Testing Framework

**Vitest** was chosen as the testing framework for the following reasons:

- **Vite-native**: Seamless integration with the existing Vite build system
- **Fast execution**: Optimized for speed with smart caching
- **Modern**: First-class ESM support, TypeScript support, and async/await
- **Great DX**: Built-in UI, coverage reporting, and excellent error messages
- **Lightweight**: Smaller footprint compared to Jest

### Installed Dependencies

```json
{
  "devDependencies": {
    "vitest": "^4.0.15",
    "@vitest/ui": "^4.0.15",
    "happy-dom": "^20.0.11"
  }
}
```

## Test Scripts

Added to `package.json`:

```json
{
  "test": "vitest",              // Watch mode for development
  "test:ui": "vitest --ui",      // Visual UI for test exploration
  "test:run": "vitest run",      // Run once (CI/CD)
  "test:coverage": "vitest run --coverage"  // Generate coverage report
}
```

## Test Coverage

### Current Test Statistics

- **Total Tests**: 67 tests
- **Passing**: 52 tests
- **Skipped**: 15 tests (integration/E2E tests requiring full Electron environment)
- **Test Files**: 4 files

### What's Tested

#### 1. ConfigService Tests (`src/services/__tests__/config-service.test.js`)
**19 tests covering configuration management**

**Features Tested:**
- ✅ Initialization with default configuration
- ✅ API key storage and retrieval (Gemini, OpenAI, Anthropic)
- ✅ Active provider management
- ✅ Provider-specific configuration
- ✅ Model migration (Gemini 1.5 → 2.5)
- ✅ File persistence and loading
- ✅ Configuration reset functionality

**Key Test Examples:**
```javascript
// API Key Management
test('should save and retrieve API key for Gemini', () => {
  configService.setApiKey('gemini', 'test-gemini-key-123')
  expect(configService.getApiKey('gemini')).toBe('test-gemini-key-123')
})

// Model Migration
test('should migrate old Gemini 1.5 models to 2.5', () => {
  // Creates config with old model, verifies automatic migration
})
```

#### 2. LLMFactory Tests (`src/services/__tests__/llm-factory.test.js`)
**14 tests covering provider instantiation**

**Features Tested:**
- ✅ Gemini provider creation with valid API keys
- ✅ Custom configuration support
- ✅ Error handling for missing API keys
- ✅ Case-insensitive provider names
- ✅ Provider availability checking
- ✅ Future provider placeholders (OpenAI, Anthropic)

**Key Test Examples:**
```javascript
// Provider Creation
test('should create Gemini provider with valid API key', () => {
  const provider = LLMFactory.createProvider('gemini', 'test-api-key-123')
  expect(provider.getName()).toBe('gemini')
})

// Error Handling
test('should throw error for unsupported provider', () => {
  expect(() => {
    LLMFactory.createProvider('invalid-provider', 'test-key')
  }).toThrow('Unknown provider: invalid-provider')
})
```

#### 3. GeminiProvider Tests (`src/services/providers/__tests__/gemini-provider.test.js`)
**20 tests (10 active, 10 skipped) covering Gemini integration**

**Features Tested:**
- ✅ Provider initialization
- ✅ Model configuration (default and custom)
- ✅ Error handling for invalid API keys
- ✅ Available models listing
- ⏭️ Message sending (skipped - requires complex mocking)
- ⏭️ Streaming responses (skipped - requires complex mocking)
- ⏭️ API key validation (skipped - requires real API calls)

**Why Some Tests Are Skipped:**
The Google Generative AI SDK has complex internal behavior that's difficult to mock effectively. These tests are marked as skipped and documented as better candidates for integration testing:

```javascript
test.skip('should send text-only message successfully', async () => {
  // Skipped: Complex mocking of Google Generative AI SDK
  // Integration test would be more appropriate
})
```

#### 4. Screen Capture Tests (`src/services/__tests__/screen-capture.test.js`)
**14 tests (9 active, 5 skipped) covering image compression**

**Features Tested:**
- ✅ Image compression to base64
- ✅ Size validation (<5MB target)
- ✅ Format conversion (PNG → JPEG)
- ✅ Aspect ratio preservation
- ✅ Error handling for invalid images
- ✅ Large screenshot compression
- ✅ Base64 encoding validation
- ⏭️ Screen capture (skipped - requires Electron environment)

**Key Test Examples:**
```javascript
// Compression Quality
test('should compress large screenshots efficiently', async () => {
  const largeScreenshot = await sharp({
    create: { width: 3840, height: 2160, channels: 4 }
  }).png().toBuffer()

  const result = await compressImage(largeScreenshot)

  expect(result.size).toBeLessThan(5 * 1024 * 1024) // <5MB
})

// Format Conversion
test('should convert images to JPEG format', async () => {
  const pngImage = await sharp(...).png().toBuffer()
  const result = await compressImage(pngImage)

  const metadata = await sharp(result.buffer).metadata()
  expect(metadata.format).toBe('jpeg')
})
```

## Test Configuration

### Vitest Config (`vitest.config.js`)

```javascript
{
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'dist/', 'testing/', '**/*.test.js']
    },
    testTimeout: 10000,
    mockReset: true,
    restoreMocks: true
  }
}
```

## Testing Strategy

### Unit Tests ✅ (Implemented)
**What's Tested:**
- Pure functions and business logic
- Configuration management
- Provider factory patterns
- Image compression algorithms

**Test Approach:**
- Isolated testing with mocked dependencies
- Fast execution (<500ms total)
- No external dependencies (APIs, file system when possible)

### Integration Tests ⏭️ (Skipped for Now)
**Why Skipped:**
Electron-specific tests require:
- Full Electron runtime environment
- Spectron or similar E2E framework
- Significantly longer execution time
- More complex setup

**Examples of Skipped Tests:**
- Screen capture with `desktopCapturer`
- IPC communication between main and renderer
- Real Gemini API calls

### Future Testing Improvements

1. **Integration Tests**
   - Set up Spectron for Electron E2E testing
   - Test full IPC communication flow
   - Test window creation and management

2. **API Integration Tests**
   - Create test suite with real API keys (CI/CD secrets)
   - Test actual Gemini responses
   - Test rate limiting and error recovery

3. **Coverage Improvements**
   - Aim for >80% code coverage
   - Add renderer process tests
   - Add main process tests (IPC handlers)

## Running Tests

### Development Workflow

```bash
# Watch mode - automatically re-run on file changes
npm test

# Run once - for CI/CD or quick checks
npm run test:run

# Visual UI - explore tests interactively
npm run test:ui

# Coverage report - see what's tested
npm run test:coverage
```

### Test Output

```
Test Files  4 passed (4)
Tests       52 passed | 15 skipped (67)
Duration    494ms
```

## Mocking Strategy

### Electron Mocking
Electron APIs are mocked using Vitest's `vi.mock()`:

```javascript
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/ghostpad-test')
  }
}))
```

### Google Generative AI Mocking
Complex SDK mocking is skipped in favor of integration tests:

```javascript
// Too complex to mock reliably
vi.mock('@google/generative-ai', () => ({ ... })) // ❌

// Better approach: Mark as integration test
test.skip('should send message', async () => {
  // Requires real API or complex mocking
})
```

### File System Testing
Tests use temporary directories for file operations:

```javascript
const testDir = path.join('/tmp/ghostpad-test')
fs.mkdirSync(testDir, { recursive: true })
// Test operations
fs.unlinkSync(configPath) // Cleanup
```

## Continuous Integration

### .gitignore Updates
Added coverage output to `.gitignore`:

```
# Test coverage
coverage/
.nyc_output/
*.lcov
```

### CI/CD Recommendations

```yaml
# Example GitHub Actions workflow
- name: Run tests
  run: npm run test:run

- name: Generate coverage
  run: npm run test:coverage

- name: Upload coverage
  uses: codecov/codecov-action@v3
```

## Test Organization

### File Structure

```
src/services/
├── __tests__/
│   ├── config-service.test.js      # 19 tests
│   ├── llm-factory.test.js         # 14 tests
│   └── screen-capture.test.js      # 14 tests
└── providers/
    └── __tests__/
        └── gemini-provider.test.js # 20 tests
```

### Naming Conventions

- Test files: `*.test.js` or `__tests__/*.js`
- Test descriptions: Clear, action-oriented (e.g., "should save API key")
- Mock functions: Prefixed with `mock` (e.g., `mockGetSources`)

## Benefits of This Test Suite

1. **Regression Prevention**: Catches bugs before they reach production
2. **Refactoring Confidence**: Change code knowing tests will catch breakage
3. **Documentation**: Tests serve as usage examples
4. **Faster Development**: Quick feedback on changes
5. **Code Quality**: Forces better code organization and separation of concerns

## Known Limitations

1. **No E2E Tests**: Full application workflow not tested
2. **No UI Tests**: Renderer process UI not tested
3. **No IPC Tests**: Main-renderer communication not tested
4. **Mocked APIs**: Real API behavior not validated
5. **Windows-only**: Cross-platform behavior not verified

## Next Steps

To improve test coverage:

1. **Add Spectron**: Enable full Electron integration tests
2. **Add Renderer Tests**: Test UI components and user interactions
3. **Add IPC Tests**: Verify main-renderer communication
4. **Add API Integration Tests**: Test real provider APIs (with test accounts)
5. **Improve Coverage**: Aim for 80%+ code coverage
6. **Add Performance Tests**: Ensure compression stays fast
7. **Add Visual Regression Tests**: Catch UI changes

## Conclusion

The current test suite provides a solid foundation with **52 passing tests** covering the core business logic of GhostPad. While integration and E2E tests are skipped for now, the unit tests ensure that critical functionality (config management, provider factory, image compression) works correctly.

The tests run fast (<500ms), provide clear feedback, and can be easily extended as the application grows.

**Total Test Execution Time**: ~500ms
**Test Coverage**: Core services (config, LLM factory, compression)
**Confidence Level**: High for refactoring services layer
