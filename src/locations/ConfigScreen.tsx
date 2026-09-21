// Purpose: App config UI. Curates the field IDs the notifications function
// reads (page title, page→stakeholder reference, stakeholder→members), then
// lets the installer pick which (workflow, step) pairs should trigger the
// function. All four pieces persist as installation parameters. Save is
// blocked until the three field IDs are non-empty, and until at least one
// trigger is picked *when there is one to pick*. Does NOT use
// useDropdownAwareAutoResizer (would throw in app-config location).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfigAppSDK } from '@contentful/app-sdk';
import {
  Flex,
  Form,
  FormControl,
  Heading,
  Note,
  TextInput,
} from '@contentful/f36-components';
import { css } from 'emotion';
import { useSDK } from '@contentful/react-apps-toolkit';
import PillSelector from '../components/PillSelector';
import {
  AppInstallationParameters,
  DEFAULT_PARAMETERS,
  WorkflowStepTrigger,
} from '../../shared/contract';

const triggerKey = (t: WorkflowStepTrigger) =>
  `${t.workflowDefinitionId}:${t.stepId}`;
const triggerLabel = (t: WorkflowStepTrigger) =>
  `${t.workflowDefinitionName} → ${t.stepName}`;

const hasFieldIds = (p: AppInstallationParameters) =>
  p.pageTitleFieldId.trim() !== '' &&
  p.pageStakeholderFieldId.trim() !== '' &&
  p.stakeholderMemberFieldId.trim() !== '';

/**
 * Triggers are only demanded when the environment actually offers some.
 * Requiring them unconditionally made the app unsaveable in a space with no
 * workflow definitions (or when the definitions request failed): the trigger
 * picker isn't rendered in that state, so nothing could ever satisfy the rule
 * and even the field IDs couldn't be persisted.
 */
const isComplete = (
  p: AppInstallationParameters,
  triggersRequired: boolean
) => hasFieldIds(p) && (!triggersRequired || p.triggers.length > 0);

const ConfigScreen = () => {
  const sdk = useSDK<ConfigAppSDK>();
  const [parameters, setParameters] =
    useState<AppInstallationParameters>(DEFAULT_PARAMETERS);
  const [allTriggers, setAllTriggers] = useState<WorkflowStepTrigger[]>([]);
  const [didLoadDefinitions, setDidLoadDefinitions] = useState(false);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);

  const triggersRequired = allTriggers.length > 0;

  const onConfigure = useCallback(async () => {
    // Returning `false` here tells Contentful to block save with a generic
    // "configuration incomplete" notification. The inline Note below tells
    // the user exactly which inputs need values.
    if (!isComplete(parameters, triggersRequired)) {
      return false;
    }
    const currentState = await sdk.app.getCurrentState();
    return { parameters, targetState: currentState };
  }, [parameters, triggersRequired, sdk]);

  useEffect(() => {
    sdk.app.onConfigure(() => onConfigure());
  }, [sdk, onConfigure]);

  useEffect(() => {
    (async () => {
      const currentParameters =
        await sdk.app.getParameters<AppInstallationParameters>();
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
    // An alias ID is interchangeable with an environment ID in CMA requests,
    // and alias-first is what the App SDK reference recommends: it keeps the
    // app reading from whichever environment the editor is actually looking at.
    const environmentId = sdk.ids.environmentAlias ?? sdk.ids.environment;
    sdk.cma.workflowDefinition
      .getMany({
        spaceId: sdk.ids.space,
        environmentId,
        // The CMA caps workflow definitions at 20 per environment, so a single
        // page always holds all of them.
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
        setDefinitionsError(null);
      })
      .catch((error: unknown) => {
        // Without this, a 403 or network failure fell through to the
        // "no workflow definitions found" empty state and told the installer
        // to go create workflows they may well already have.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          'ConfigScreen: could not load workflow definitions.',
          error
        );
        setDefinitionsError(message);
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

        {!isComplete(parameters, triggersRequired) && (
          <Note variant="negative" className={css({ marginBottom: '20px' })}>
            All fields below are required before this app can be saved.
          </Note>
        )}

        <FormControl isRequired>
          <FormControl.Label>Title Field ID</FormControl.Label>
          <TextInput
            value={parameters.pageTitleFieldId}
            onChange={(e) => update('pageTitleFieldId', e.target.value)}
          />
          <FormControl.HelpText>
            The "Title" field ID for "Page" content types.
          </FormControl.HelpText>
        </FormControl>

        <FormControl isRequired>
          <FormControl.Label>Stakeholder Field ID</FormControl.Label>
          <TextInput
            value={parameters.pageStakeholderFieldId}
            onChange={(e) => update('pageStakeholderFieldId', e.target.value)}
          />
          <FormControl.HelpText>
            The "Stakeholders" field ID for "Page" content types.
          </FormControl.HelpText>
        </FormControl>

        <FormControl isRequired>
          <FormControl.Label>Members Field ID</FormControl.Label>
          <TextInput
            value={parameters.stakeholderMemberFieldId}
            onChange={(e) => update('stakeholderMemberFieldId', e.target.value)}
          />
          <FormControl.HelpText>
            The "Members" field ID for the "Stakeholder" content type
          </FormControl.HelpText>
        </FormControl>

        {didLoadDefinitions && definitionsError ? (
          <Note variant="warning">
            Could not load workflow definitions ({definitionsError}). You can
            still save the field IDs above, then reopen this screen to pick
            trigger steps.
          </Note>
        ) : didLoadDefinitions && allTriggers.length === 0 ? (
          <Note variant="neutral">
            No workflow definitions found in this environment. Create one in the
            Workflows app, then reopen this screen to pick trigger steps — you
            can save the field IDs above in the meantime.
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
