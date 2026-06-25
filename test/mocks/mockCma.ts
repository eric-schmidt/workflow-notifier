import { vi } from 'vitest';

const mockCma: any = {
  user: {
    getManyForSpace: vi.fn().mockResolvedValue({ items: [] }),
  },
};

export { mockCma };
