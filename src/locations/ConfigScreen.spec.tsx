import ConfigScreen from './ConfigScreen';
import { render, screen, waitFor } from '@testing-library/react';
import { mockCma, mockSdk } from '../../test/mocks';
import { vi } from 'vitest';

vi.mock('@contentful/react-apps-toolkit', () => ({
  useSDK: () => ({ ...mockSdk, cma: mockCma }),
  useCMA: () => mockCma,
}));

describe('ConfigScreen', () => {
  it('renders heading and fetches workflow definitions', async () => {
    mockCma.workflowDefinition.getMany.mockResolvedValueOnce({ items: [] });

    render(<ConfigScreen />);

    expect(
      screen.getByText('Workflow notifier configuration')
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mockCma.workflowDefinition.getMany).toHaveBeenCalledWith({
        spaceId: 'test-space',
        environmentId: 'test-env',
        query: { limit: 100 },
      });
    });
  });

  it('shows an empty-state Note when no workflow definitions exist', async () => {
    mockCma.workflowDefinition.getMany.mockResolvedValueOnce({ items: [] });

    render(<ConfigScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(/No workflow definitions found/i)
      ).toBeInTheDocument();
    });
  });
});
