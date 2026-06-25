import { useEffect, useMemo, useState } from 'react';
import { Box } from '@contentful/f36-components';
import { FieldAppSDK } from '@contentful/app-sdk';
import { useSDK } from '@contentful/react-apps-toolkit';
import PillSelector from '../components/PillSelector';
import { useDropdownAwareAutoResizer } from '../hooks/useDropdownAwareAutoResizer';

type Stakeholder = {
  userId: string;
  firstName: string;
  lastName: string;
};

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

const Field = () => {
  const sdk = useSDK<FieldAppSDK>();
  const resizer = useDropdownAwareAutoResizer();

  const [stakeholders, setStakeholders] = useState<Stakeholder[]>(
    sdk.field.getValue() ?? []
  );
  const [allUsers, setAllUsers] = useState<Stakeholder[]>([]);

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
      allUsers.filter(
        (u) => !stakeholders.some((s) => s.userId === u.userId)
      ),
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
