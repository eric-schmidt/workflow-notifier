// Purpose: App config UI. Curates the field IDs the notifications function
// reads (page title, page→stakeholder reference, stakeholder→members), then
// lets the installer pick which (workflow, step) pairs should trigger the
// function. All four pieces persist as installation parameters. Save is
// blocked until all three field IDs are non-empty. Does NOT use
// useDropdownAwareAutoResizer (would throw in app-config location).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfigAppSDK } from '@contentful/app-sdk';
import {
  Flex,
  Form,
  FormControl,
  Heading,
  Note,
  Paragraph,
  TextInput,
} from '@contentful/f36-components';
import { css } from 'emotion';
import { useSDK } from '@contentful/react-apps-toolkit';
import PillSelector from '../components/PillSelector';

export type WorkflowStepTrigger = {
  workflowDefinitionId: string;
  workflowDefinitionName: string;
  stepId: string;
  stepName: string;
};

export interface AppInstallationParameters {
  pageTitleFieldId: string;
  pageStakeholderFieldId: string;
  stakeholderMemberFieldId: string;
  triggers: WorkflowStepTrigger[];
}

const DEFAULT_PARAMETERS: AppInstallationParameters = {
  pageTitleFieldId: 'adminTitle',
  pageStakeholderFieldId: 'stakeholders',
  stakeholderMemberFieldId: 'members',
  triggers: [],
};

const triggerKey = (t: WorkflowStepTrigger) =>
  `${t.workflowDefinitionId}:${t.stepId}`;
const triggerLabel = (t: WorkflowStepTrigger) =>
  `${t.workflowDefinitionName} → ${t.stepName}`;

const isComplete = (p: AppInstallationParameters) =>
  p.pageTitleFieldId.trim() !== '' &&
  p.pageStakeholderFieldId.trim() !== '' &&
  p.stakeholderMemberFieldId.trim() !== '' &&
  p.triggers.length > 0;

const ConfigScreen = () => {
  const sdk = useSDK<ConfigAppSDK>();
  const [parameters, setParameters] =
    useState<AppInstallationParameters>(DEFAULT_PARAMETERS);
  const [allTriggers, setAllTriggers] = useState<WorkflowStepTrigger[]>([]);
  const [didLoadDefinitions, setDidLoadDefinitions] = useState(false);

  const onConfigure = useCallback(async () => {
    // Returning `false` here tells Contentful to block save with a generic
    // "configuration incomplete" notification. The inline Note below tells
    // the user exactly which inputs need values.
    if (!isComplete(parameters)) {
      return false;
    }
    const currentState = await sdk.app.getCurrentState();
    return { parameters, targetState: currentState };
  }, [parameters, sdk]);

  useEffect(() => {
    sdk.app.onConfigure(() => onConfigure());
  }, [sdk, onConfigure]);

  useEffect(() => {
    (async () => {
      const currentParameters =
        (await sdk.app.getParameters<AppInstallationParameters>()) ?? null;
      if (currentParameters) {
        setParameters({
          ...DEFAULT_PARAMETERS,
          ...currentParameters,
          triggers: currentParameters.triggers ?? [],
        });
      }
      sdk.app.setReady();
    })();
  }, [sdk]);

  useEffect(() => {
    // Workflow definitions live on the underlying environment, not aliases.
    const environmentId =
      sdk.ids.environmentAlias ?? sdk.ids.environment;
    sdk.cma.workflowDefinition
      .getMany({
        spaceId: sdk.ids.space,
        environmentId,
        query: { limit: 100 },
      })
      .then((res) => {
        const flat: WorkflowStepTrigger[] = res.items.flatMap((d) =>
          d.steps.map((s) => ({
            workflowDefinitionId: d.sys.id,
            workflowDefinitionName: d.name,
            stepId: s.id,
            stepName: s.name,
          }))
        );
        setAllTriggers(flat);
      })
      .finally(() => setDidLoadDefinitions(true));
  }, [sdk.cma, sdk.ids.space, sdk.ids.environment, sdk.ids.environmentAlias]);

  const available = useMemo(() => {
    const selectedKeys = new Set(parameters.triggers.map(triggerKey));
    return allTriggers.filter((t) => !selectedKeys.has(triggerKey(t)));
  }, [allTriggers, parameters.triggers]);

  const update = <K extends keyof AppInstallationParameters>(
    key: K,
    value: AppInstallationParameters[K]
  ) => setParameters((prev) => ({ ...prev, [key]: value }));

  return (
    <Flex
      flexDirection="column"
      className={css({ margin: '80px', maxWidth: '800px' })}
    >
      <Form>
        <Heading>Workflow Notifier Configuration</Heading>

        {!isComplete(parameters) && (
          <Note
            variant="negative"
            className={css({ marginBottom: '20px' })}
          >
            All fields below are required before this app can be saved.
          </Note>
        )}

        <FormControl isRequired>
          <FormControl.Label>Title Field ID</FormControl.Label>
          <TextInput
            value={parameters.pageTitleFieldId}
            onChange={(e) => update('pageTitleFieldId', e.target.value)}
          />
          <FormControl.HelpText>The "Title" field ID for "Page" content types.</FormControl.HelpText>
        </FormControl>

        <FormControl isRequired>
          <FormControl.Label>Stakeholder Field ID</FormControl.Label>
          <TextInput
            value={parameters.pageStakeholderFieldId}
            onChange={(e) =>
              update('pageStakeholderFieldId', e.target.value)
            }
          />
          <FormControl.HelpText>The "Stakeholders" field ID for "Page" content types.</FormControl.HelpText>
        </FormControl>

        <FormControl isRequired>
          <FormControl.Label>Members Field ID</FormControl.Label>
          <TextInput
            value={parameters.stakeholderMemberFieldId}
            onChange={(e) =>
              update('stakeholderMemberFieldId', e.target.value)
            }
          />
          <FormControl.HelpText>The "Members" field ID for the "Stakeholder" content type</FormControl.HelpText>
        </FormControl>

        {didLoadDefinitions && allTriggers.length === 0 ? (
          <Note variant="neutral">
            No workflow definitions found in this environment. Create one in the
            Workflows app first.
          </Note>
        ) : (
          <FormControl isRequired>
            <FormControl.Label>Trigger Step(s)</FormControl.Label>
            <PillSelector<WorkflowStepTrigger>
              available={available}
              selected={parameters.triggers}
              onChange={(next) => update('triggers', next)}
              getKey={triggerKey}
              getLabel={triggerLabel}
              placeholder="Search workflow steps…"
            />
            <FormControl.HelpText>
              Each "Workflow" → "Step" that should trigger the notifications.
            </FormControl.HelpText>
          </FormControl>
        )}
      </Form>
    </Flex>
  );
};

export default ConfigScreen;
