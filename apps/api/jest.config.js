/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    // Resolve workspace package to its source so jest doesn't need a build step
    '^@cf/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/instrument.ts',
  ],
  // Coverage thresholds — ~2 points below the measured baseline so the gate
  // catches real regressions without failing on noise. Measured 2026-07-13:
  // statements 17.08 / branches 15.68 / functions 14.82 / lines 16.47.
  // Re-measure and raise after adding tests:
  //   pnpm --filter @cf/api test -- --coverage --coverageReporters=text-summary
  coverageThreshold: {
    global: {
      statements: 15,
      lines: 14,
      functions: 12,
      branches: 13,
    },
  },
};
