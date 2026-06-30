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
      screen.getByText('Workflow Notifier Configuration')
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mockCma.workflowDefinition.getMany).toHaveBeenCalledWith({
        spaceId: 'test-space',
        environmentId: 'test-env',
        query: { limit: 100 },
      });
    });
  });

  it('renders all three field-id inputs with help text', async () => {
    mockCma.workflowDefinition.getMany.mockResolvedValueOnce({ items: [] });

    render(<ConfigScreen />);

    expect(screen.getByLabelText(/Title Field ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stakeholder Field ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Members Field ID/i)).toBeInTheDocument();
  });

  it('blocks save when any required field id is empty', async () => {
    mockCma.workflowDefinition.getMany.mockResolvedValueOnce({ items: [] });

    render(<ConfigScreen />);

    expect(
      screen.getByText(/All fields below are required/i)
    ).toBeInTheDocument();

    // The onConfigure callback Contentful invokes on save.
    const onConfigureFn = mockSdk.app.onConfigure.mock.calls[0]?.[0];
    expect(onConfigureFn).toBeTypeOf('function');
    await expect(onConfigureFn()).resolves.toBe(false);
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
