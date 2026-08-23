import { defineWorkspace } from 'vitest/config';

// Two kinds of test, and they want opposite environments.
//
// The great majority are pure functions over plain data — the balancer, the
// milestone detectors, the Worker's validators — and they want no DOM at all.
// Giving them one costs a jsdom per file to no purpose, and the setup file the
// component tests need (matchers, a fake localStorage, a fetch that refuses)
// is meaningless to them and breaks on import.
//
// So the DOM half is opted into by filename: `*.dom.test.tsx`. That is
// deliberately visible in the file listing — a component test is slower and
// more fragile than a unit test, and it should be obvious which one you are
// looking at before you open it.
export default defineWorkspace([
  {
    extends: './vite.config.ts',
    test: {
      name: 'logic',
      environment: 'node',
      include: ['src/**/*.test.ts', 'worker/**/*.test.js'],
      exclude: ['**/*.dom.test.*'],
    },
  },
  {
    extends: './vite.config.ts',
    test: {
      name: 'dom',
      environment: 'jsdom',
      include: ['src/**/*.dom.test.{ts,tsx}'],
      setupFiles: ['src/test-setup.ts'],
    },
  },
]);
