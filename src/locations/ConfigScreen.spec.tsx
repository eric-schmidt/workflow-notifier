import ConfigScreen from './ConfigScreen';
import { render, screen, waitFor } from '@testing-library/react';
import { mockCma, mockSdk, resetMocks } from '../../test/mocks';
import { beforeEach, vi } from 'vitest';
import { DEFAULT_PARAMETERS } from '../../shared/contract';

vi.mock('@contentful/react-apps-toolkit', () => ({
  useSDK: () => ({ ...mockSdk, cma: mockCma }),
  useCMA: () => mockCma,
}));

/**
 * The callback Contentful invokes on save. Always read the *latest*
 * registration: onConfigure is re-registered whenever parameters change, and
 * `mock.calls` accumulates across every render in this file, so `calls[0]`
 * would hand back a closure from an earlier test's component instance.
 */
const latestOnConfigure = () =>
  mockSdk.app.onConfigure.mock.calls.at(-1)?.[0] as () => Promise<unknown>;

const definition = (id: string, steps: Array<{ id: string; name: string }>) => ({
  sys: { id },
  name: `Workflow ${id}`,
  steps,
});

beforeEach(() => {
  resetMocks();
});

describe('ConfigScreen', () => {
  it('renders heading and fetches workflow definitions', async () => {
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
    render(<ConfigScreen />);

    expect(screen.getByLabelText(/Title Field ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stakeholder Field ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Members Field ID/i)).toBeInTheDocument();
  });

  it('hydrates saved parameters into the inputs', async () => {
    mockSdk.app.getParameters.mockResolvedValue({
      pageTitleFieldId: 'savedTitle',
      pageStakeholderFieldId: 'savedRefs',
      stakeholderMemberFieldId: 'savedMembers',
      triggers: [
        {
          workflowDefinitionId: 'wf-1',
          workflowDefinitionName: 'Approval',
          stepId: 'step-1',
          stepName: 'Ready for review',
        },
      ],
    });

    render(<ConfigScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Title Field ID/i)).toHaveValue('savedTitle');
    });
    expect(screen.getByLabelText(/Stakeholder Field ID/i)).toHaveValue(
      'savedRefs'
    );
    expect(screen.getByLabelText(/Members Field ID/i)).toHaveValue(
      'savedMembers'
    );
  });

  it('blocks save when any required field id is empty', async () => {
    mockSdk.app.getParameters.mockResolvedValue({
      ...DEFAULT_PARAMETERS,
      pageTitleFieldId: '',
    });

    render(<ConfigScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Title Field ID/i)).toHaveValue('');
    });
    expect(
      screen.getByText(/All fields below are required/i)
    ).toBeInTheDocument();

    await expect(latestOnConfigure()()).resolves.toBe(false);
  });

  it('shows an empty-state Note when no workflow definitions exist', async () => {
    render(<ConfigScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(/No workflow definitions found/i)
      ).toBeInTheDocument();
    });
  });

  it('still allows save when the environment has no workflow definitions', async () => {
    // Requiring a trigger unconditionally made this state unsaveable: the
    // trigger picker isn't rendered, so nothing could satisfy the rule.
    render(<ConfigScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(/No workflow definitions found/i)
      ).toBeInTheDocument();
    });

    await expect(latestOnConfigure()()).resolves.toEqual({
      parameters: DEFAULT_PARAMETERS,
      targetState: {},
    });
  });

  it('requires at least one trigger once definitions are available', async () => {
    mockCma.workflowDefinition.getMany.mockResolvedValue({
      items: [definition('wf-1', [{ id: 'step-1', name: 'Ready for review' }])],
      total: 1,
    });

    render(<ConfigScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Trigger Step\(s\)/i)).toBeInTheDocument();
    });

    await expect(latestOnConfigure()()).resolves.toBe(false);
  });

  it('reports a failed definitions load instead of an empty environment', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCma.workflowDefinition.getMany.mockRejectedValue(
      new Error('403 AccessDenied')
    );

    render(<ConfigScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(/Could not load workflow definitions/i)
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/403 AccessDenied/)).toBeInTheDocument();
    expect(
      screen.queryByText(/No workflow definitions found/i)
    ).not.toBeInTheDocument();

    // The field IDs must still be persistable so the install isn't stuck.
    await expect(latestOnConfigure()()).resolves.toEqual({
      parameters: DEFAULT_PARAMETERS,
      targetState: {},
    });
  });
});
