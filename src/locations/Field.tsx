// Purpose: Stakeholders field editor. Fetches every user in the space (across
// CMA pages) and lets editors pick them via PillSelector. Persists
// Array<Stakeholder> on the field — the shape functions/notifications.ts reads
// back, declared once in ../../shared/contract. Uses
// useDropdownAwareAutoResizer so the iframe tracks the open dropdown's height.

import { useEffect, useMemo, useState } from 'react';
import { Box } from '@contentful/f36-components';
import { FieldAppSDK } from '@contentful/app-sdk';
import { useSDK } from '@contentful/react-apps-toolkit';
import PillSelector from '../components/PillSelector';
import { useDropdownAwareAutoResizer } from '../hooks/useDropdownAwareAutoResizer';
import { Stakeholder } from '../../shared/contract';

/** One CMA page of users; the API caps a page at 100 by default. */
const USER_PAGE_SIZE = 100;

/** Guards against a runaway loop if `total` and `items` ever disagree. */
const MAX_USER_PAGES = 50;

const fullName = (s: Stakeholder) => `${s.firstName} ${s.lastName}`.trim();

const toStakeholder = (u: {
  sys: { id: string };
  firstName: string;
  lastName: string;
}): Stakeholder => ({
  userId: u.sys.id,
  firstName: u.firstName,
  lastName: u.lastName,
});

/**
 * The field is a plain JSON field, so its stored value is whatever anyone ever
 * put there — including hand-edited JSON. Keep only entries that still look
 * like stakeholders rather than letting a bad value throw during render.
 */
const toStakeholders = (value: unknown): Stakeholder[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Stakeholder =>
          typeof (item as Stakeholder)?.userId === 'string'
      )
    : [];

const Field = () => {
  const sdk = useSDK<FieldAppSDK>();
  const resizer = useDropdownAwareAutoResizer();

  const [stakeholders, setStakeholders] = useState<Stakeholder[]>(() =>
    toStakeholders(sdk.field.getValue())
  );
  const [allUsers, setAllUsers] = useState<Stakeholder[]>([]);

  useEffect(() => {
    return sdk.field.onValueChanged((value: unknown) => {
      setStakeholders(toStakeholders(value));
    });
  }, [sdk.field]);

  useEffect(() => {
    let cancelled = false;

    // Paginate: a single request returns only the first 100 users, which
    // silently made the rest of a larger space unpickable.
    const loadAllUsers = async () => {
      const collected: Stakeholder[] = [];
      for (let page = 0; page < MAX_USER_PAGES; page++) {
        const res = await sdk.cma.user.getManyForSpace({
          spaceId: sdk.ids.space,
          query: { limit: USER_PAGE_SIZE, skip: page * USER_PAGE_SIZE },
        });
        collected.push(...res.items.map(toStakeholder));
        if (!res.items.length || collected.length >= (res.total ?? 0)) {
          break;
        }
      }
      return collected;
    };

    loadAllUsers()
      .then((users) => {
        if (!cancelled) {
          setAllUsers(users);
        }
      })
      .catch((error: unknown) => {
        // Without this the picker just sat there empty, looking like a space
        // with no users rather than a failed request.
        console.warn('Field: could not load space users.', error);
        if (!cancelled) {
          sdk.notifier.error(
            'Could not load the list of users. Reload the entry to try again.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sdk.cma, sdk.ids.space, sdk.notifier]);

  const available = useMemo(
    () =>
      allUsers.filter((u) => !stakeholders.some((s) => s.userId === u.userId)),
    [allUsers, stakeholders]
  );

  const commit = (next: Stakeholder[]) => {
    setStakeholders(next);
    sdk.field.setValue(next);
  };

  return (
    <Box padding="spacing2Xs">
      <PillSelector<Stakeholder>
        available={available}
        selected={stakeholders}
        onChange={commit}
        getKey={(s) => s.userId}
        getLabel={fullName}
        onOpen={resizer.onOpen}
        onClose={resizer.onClose}
      />
    </Box>
  );
};

export default Field;
