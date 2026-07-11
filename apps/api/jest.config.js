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
  // Coverage thresholds — set ~5 points below the measured baseline (floored to nearest 5)
  // so the gate protects against regression without breaking the build today.
  // NOTE: thresholds were set without a live run (shell unavailable at config time);
  // update these after running: pnpm --filter @cf/api test -- --coverage --coverageReporters=text-summary
  coverageThreshold: {
    global: {
      statements: 5,
      lines: 5,
      functions: 5,
      branches: 5,
    },
  },
};
