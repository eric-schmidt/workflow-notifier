// Purpose: App config UI. Fetches all WorkflowDefinitions in the current env,
// flattens to (workflow → step) rows, and lets the installer pick which pairs
// trigger the notifications function. Persists as triggers[] on the app
// installation parameters. Does NOT use useDropdownAwareAutoResizer (would
// throw in app-config location).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfigAppSDK } from '@contentful/app-sdk';
import {
  Flex,
  Form,
  FormControl,
  Heading,
  Note,
  Paragraph,
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
  triggers: WorkflowStepTrigger[];
}

const triggerKey = (t: WorkflowStepTrigger) =>
  `${t.workflowDefinitionId}:${t.stepId}`;
const triggerLabel = (t: WorkflowStepTrigger) =>
  `${t.workflowDefinitionName} → ${t.stepName}`;

const ConfigScreen = () => {
  const sdk = useSDK<ConfigAppSDK>();
  const [parameters, setParameters] = useState<AppInstallationParameters>({
    triggers: [],
  });
  const [allTriggers, setAllTriggers] = useState<WorkflowStepTrigger[]>([]);
  const [didLoadDefinitions, setDidLoadDefinitions] = useState(false);

  const onConfigure = useCallback(async () => {
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
      if (currentParameters?.triggers) {
        setParameters({ triggers: currentParameters.triggers });
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

  return (
    <Flex
      flexDirection="column"
      className={css({ margin: '80px', maxWidth: '800px' })}
    >
      <Form>
        <Heading>Workflow notifier configuration</Heading>
        <Paragraph>
          Pick the workflow steps that should fan out Contentful Tasks to the
          stakeholders configured on each entry's linked brand(s).
        </Paragraph>

        {didLoadDefinitions && allTriggers.length === 0 ? (
          <Note variant="neutral">
            No workflow definitions found in this environment. Create one in the
            Workflows app first.
          </Note>
        ) : (
          <FormControl>
            <FormControl.Label>Trigger steps</FormControl.Label>
            <PillSelector<WorkflowStepTrigger>
              available={available}
              selected={parameters.triggers}
              onChange={(next) => setParameters({ triggers: next })}
              getKey={triggerKey}
              getLabel={triggerLabel}
              placeholder="Search workflow steps…"
            />
          </FormControl>
        )}
      </Form>
    </Flex>
  );
};

export default ConfigScreen;
