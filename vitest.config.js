import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Global test setup
    globals: true,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'build/',
        'testing/',
        '**/*.test.js',
        '**/*.spec.js',
        'vite.config.js',
        'vitest.config.js'
      ]
    },

    // Test file patterns
    include: [
      'src/**/*.{test,spec}.js',
      'src/**/__tests__/**/*.js'
    ],

    // Exclude patterns
    exclude: [
      'node_modules/',
      'dist/',
      'build/',
      'testing/'
    ],

    // Mock Electron APIs
    mockReset: true,
    restoreMocks: true,

    // Test timeout
    testTimeout: 10000,

    // Hook timeout
    hookTimeout: 10000
  }
})
