import Field from './Field';
import { render, screen, waitFor } from '@testing-library/react';
import { mockCma, mockSdk } from '../../test/mocks';
import { vi } from 'vitest';

vi.mock('@contentful/react-apps-toolkit', () => ({
  useSDK: () => ({ ...mockSdk, cma: mockCma }),
  useCMA: () => mockCma,
  useAutoResizer: vi.fn(),
}));

describe('Field component', () => {
  it('renders an autocomplete and fetches space users', async () => {
    render(<Field />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockCma.user.getManyForSpace).toHaveBeenCalledWith({
        spaceId: 'test-space',
      });
    });
  });
});
