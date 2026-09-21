import { vi } from 'vitest';

/**
 * Shared CMA double. Same caveat as mockSdk: module-scoped, so reset it between
 * tests via `resetMocks()`.
 */
const mockCma: any = {
  user: {
    getManyForSpace: vi.fn(),
  },
  workflowDefinition: {
    getMany: vi.fn(),
  },
  task: {
    create: vi.fn(),
    getMany: vi.fn(),
  },
  entry: {
    get: vi.fn(),
  },
};

/** Default return values, reapplied after every reset. */
export const applyCmaDefaults = () => {
  mockCma.user.getManyForSpace.mockResolvedValue({
    items: [],
    total: 0,
    skip: 0,
    limit: 100,
  });
  mockCma.workflowDefinition.getMany.mockResolvedValue({ items: [], total: 0 });
  mockCma.task.create.mockResolvedValue({});
  mockCma.task.getMany.mockResolvedValue({ items: [], total: 0 });
};

applyCmaDefaults();

export { mockCma };
