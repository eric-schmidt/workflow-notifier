import { applyCmaDefaults, mockCma } from './mockCma';
import { applySdkDefaults, mockSdk } from './mockSdk';

const forEachMockFn = (target: unknown, visit: (fn: any) => void) => {
  if (!target || typeof target !== 'object') {
    return;
  }
  for (const value of Object.values(target)) {
    if (typeof value === 'function') {
      if ((value as any)._isMockFunction) {
        visit(value);
      }
    } else if (value && typeof value === 'object') {
      forEachMockFn(value, visit);
    }
  }
};

/**
 * Clears call history *and* queued/overridden implementations on every mock in
 * both doubles, then reapplies their defaults. Call it from a `beforeEach`.
 *
 * Without it these singletons leak between tests in a file: `mock.calls` keeps
 * growing, so `mock.calls[0]` refers to the first render in the *file* rather
 * than the current test, and a `…Once` override set by one test silently
 * changes the next one.
 */
export const resetMocks = () => {
  forEachMockFn(mockSdk, (fn) => fn.mockReset());
  forEachMockFn(mockCma, (fn) => fn.mockReset());
  applySdkDefaults();
  applyCmaDefaults();
};

export { mockCma, mockSdk };
