import { vi } from 'vitest';

const mockSdk: any = {
  app: {
    onConfigure: vi.fn(),
    getParameters: vi.fn().mockReturnValueOnce({}),
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
    getValue: vi.fn().mockReturnValue([]),
    setValue: vi.fn(),
    onValueChanged: vi.fn().mockReturnValue(() => {}),
  },
  window: {
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updateHeight: vi.fn(),
  },
};

export { mockSdk };
