import { useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, Box, Flex, Pill } from '@contentful/f36-components';
import { FieldAppSDK } from '@contentful/app-sdk';
import { useAutoResizer, useSDK } from '@contentful/react-apps-toolkit';
import tokens from '@contentful/f36-tokens';
import { css } from 'emotion';

// Visual gap left below the open dropdown so the iframe doesn't snap flush against
// the popover's bottom edge.
const DROPDOWN_BOTTOM_BUFFER = 16;

const autocompleteStyles = css({
  '[data-test-id="cf-autocomplete-container"]': {
    marginTop: tokens.spacing2Xs,
  },
});

type Stakeholder = {
  userId: string;
  firstName: string;
  lastName: string;
};

const EMPTY_STAKEHOLDER: Stakeholder = { userId: '', firstName: '', lastName: '' };

const fullName = (s: Stakeholder) => `${s.firstName} ${s.lastName}`.trim();

const toStakeholder = (u: { sys: { id: string }; firstName: string; lastName: string }): Stakeholder => ({
  userId: u.sys.id,
  firstName: u.firstName,
  lastName: u.lastName,
});

const Field = () => {
  const sdk = useSDK<FieldAppSDK>();

  // Resize the iframe to fit body content (including absolute-positioned elements
  // like the dropdown popover) while the dropdown is closed. We pause this and
  // take over manually while it's open — see handleDropdownOpen/Close below.
  // Pattern derived from contentful/apps:apps/marketo/src/locations/Field.tsx,
  // but with dynamic height tracking instead of Marketo's fixed expanded height
  // (which would leave an awkward gap whenever the filtered list is short).
  useAutoResizer({ absoluteElements: true });

  // When the dropdown opens, useAutoResizer would size the iframe flush against
  // the popover's bottom edge — there's no buffer/offset option on the hook, and
  // the popover's container has no externally-targetable element where margin
  // would add visual space without also growing the dropdown. So we stop the
  // auto-resizer and run a ResizeObserver on the popover for as long as it's
  // open, sizing the iframe to popover.bottom + a buffer. On close we restart
  // the auto-resizer and the iframe shrinks back to fit input + pills.
  const openResizerCleanup = useRef<(() => void) | null>(null);

  const handleDropdownOpen = () => {
    sdk.window.stopAutoResizer();

    const sync = () => {
      const popover = document.querySelector<HTMLElement>(
        '[data-test-id="cf-autocomplete-container"]'
      );
      const docHeight = Math.ceil(
        document.documentElement.getBoundingClientRect().height
      );
      const popoverBottom = popover
        ? Math.ceil(popover.getBoundingClientRect().bottom)
        : 0;
      sdk.window.updateHeight(
        Math.max(docHeight, popoverBottom) + DROPDOWN_BOTTOM_BUFFER
      );
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(document.body);
    openResizerCleanup.current = () => ro.disconnect();
  };

  const handleDropdownClose = () => {
    openResizerCleanup.current?.();
    openResizerCleanup.current = null;
    sdk.window.startAutoResizer({ absoluteElements: true });
  };

  useEffect(() => () => openResizerCleanup.current?.(), []);

  const [stakeholders, setStakeholders] = useState<Stakeholder[]>(
    sdk.field.getValue() ?? []
  );
  const [allUsers, setAllUsers] = useState<Stakeholder[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    return sdk.field.onValueChanged((value: Stakeholder[] | undefined) => {
      setStakeholders(value ?? []);
    });
  }, [sdk.field]);

  useEffect(() => {
    sdk.cma.user
      .getManyForSpace({ spaceId: sdk.ids.space })
      .then((res) => setAllUsers(res.items.map(toStakeholder)));
  }, [sdk.cma, sdk.ids.space]);

  const available = useMemo(
    () =>
      allUsers
        .filter((u) => !stakeholders.some((s) => s.userId === u.userId))
        .filter((u) => fullName(u).toLowerCase().includes(filter.toLowerCase())),
    [allUsers, stakeholders, filter]
  );

  const commit = (next: Stakeholder[]) => {
    setStakeholders(next);
    sdk.field.setValue(next);
  };

  return (
    <Box padding="spacing2Xs">
      <Autocomplete<Stakeholder>
        className={autocompleteStyles}
        items={available}
        onInputValueChange={setFilter}
        onSelectItem={(user) => {
          commit([...stakeholders, user]);
          setFilter('');
        }}
        onOpen={handleDropdownOpen}
        onClose={handleDropdownClose}
        selectedItem={EMPTY_STAKEHOLDER}
        itemToString={fullName}
        renderItem={fullName}
        textOnAfterSelect="clear"
        closeAfterSelect={false}
        listWidth="full"
      />
      <Flex isInline flexWrap="wrap" gap="spacingXs" marginTop="spacingS">
        {stakeholders.map((s) => (
          <Pill
            key={s.userId}
            label={fullName(s)}
            onClose={() =>
              commit(stakeholders.filter((x) => x.userId !== s.userId))
            }
          />
        ))}
      </Flex>
    </Box>
  );
};

export default Field;
