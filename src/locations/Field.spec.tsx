import Field from './Field';
import { render, screen, waitFor } from '@testing-library/react';
import { mockCma, mockSdk, resetMocks } from '../../test/mocks';
import { beforeEach, vi } from 'vitest';

vi.mock('@contentful/react-apps-toolkit', () => ({
  useSDK: () => ({ ...mockSdk, cma: mockCma }),
  useCMA: () => mockCma,
  useAutoResizer: vi.fn(),
}));

const user = (id: string, firstName: string, lastName: string) => ({
  sys: { id },
  firstName,
  lastName,
});

const page = (
  items: ReturnType<typeof user>[],
  total: number,
  skip: number
) => ({ items, total, skip, limit: 100 });

beforeEach(() => {
  resetMocks();
});

describe('Field component', () => {
  it('renders an autocomplete and fetches space users', async () => {
    render(<Field />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockCma.user.getManyForSpace).toHaveBeenCalledWith({
        spaceId: 'test-space',
        query: { limit: 100, skip: 0 },
      });
    });
  });

  it('pages through every user in the space', async () => {
    // A single request returns only the first 100 users, which silently made
    // the rest of a larger space unpickable.
    const firstPage = page(
      Array.from({ length: 100 }, (_, i) => user(`u${i}`, `First${i}`, 'Last')),
      150,
      0
    );
    const secondPage = page(
      Array.from({ length: 50 }, (_, i) =>
        user(`u${100 + i}`, `Second${i}`, 'Last')
      ),
      150,
      100
    );
    mockCma.user.getManyForSpace
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    render(<Field />);

    await waitFor(() => {
      expect(mockCma.user.getManyForSpace).toHaveBeenCalledTimes(2);
    });
    expect(mockCma.user.getManyForSpace).toHaveBeenLastCalledWith({
      spaceId: 'test-space',
      query: { limit: 100, skip: 100 },
    });
  });

  it('surfaces a failed user fetch instead of showing an empty picker', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCma.user.getManyForSpace.mockRejectedValue(new Error('503'));

    render(<Field />);

    await waitFor(() => {
      expect(mockSdk.notifier.error).toHaveBeenCalledWith(
        expect.stringContaining('Could not load the list of users')
      );
    });
  });

  it('renders a pill per stored stakeholder', async () => {
    mockSdk.field.getValue.mockReturnValue([
      { userId: 'u1', firstName: 'Ada', lastName: 'Lovelace' },
    ]);

    render(<Field />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('ignores a malformed stored value rather than throwing', async () => {
    // The field is plain JSON, so the stored value can be anything anyone ever
    // pasted into it.
    mockSdk.field.getValue.mockReturnValue({ nope: true });

    expect(() => render(<Field />)).not.toThrow();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
