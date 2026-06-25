import { vi } from 'vitest';

const mockCma: any = {
  user: {
    getManyForSpace: vi.fn().mockResolvedValue({ items: [] }),
  },
  workflowDefinition: {
    getMany: vi.fn().mockResolvedValue({ items: [] }),
  },
  task: {
    create: vi.fn().mockResolvedValue({}),
  },
  entry: {
    get: vi.fn(),
  },
};

export { mockCma };
