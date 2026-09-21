import { vi } from 'vitest';

/**
 * Shared App SDK double. Module-scoped, therefore shared by every test in a
 * file — call `resetMocks()` (see ./index) from a `beforeEach` or call history
 * accumulates and assertions read state left behind by an earlier test.
 */
const mockSdk: any = {
  app: {
    onConfigure: vi.fn(),
    getParameters: vi.fn(),
    setReady: vi.fn(),
    getCurrentState: vi.fn(),
  },
  ids: {
    app: 'test-app',
    space: 'test-space',
    environment: 'test-env',
    environmentAlias: undefined,
  },
  field: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    onValueChanged: vi.fn(),
  },
  window: {
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updateHeight: vi.fn(),
  },
  notifier: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
};

/**
 * Default return values, reapplied after every reset. Deliberately not
 * `mockReturnValueOnce`: a single queued value is consumed by the first render
 * in a file, leaving every later render with `undefined` — which quietly meant
 * the "load saved parameters" branch was never exercised.
 */
export const applySdkDefaults = () => {
  mockSdk.app.getParameters.mockResolvedValue(undefined);
  mockSdk.app.getCurrentState.mockResolvedValue({});
  mockSdk.field.getValue.mockReturnValue([]);
  mockSdk.field.onValueChanged.mockReturnValue(() => {});
};

applySdkDefaults();

export { mockSdk };
