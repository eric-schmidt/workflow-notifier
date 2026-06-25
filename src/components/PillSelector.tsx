import { useMemo, useState } from 'react';
import { Autocomplete, Flex, Pill } from '@contentful/f36-components';
import tokens from '@contentful/f36-tokens';
import { css } from 'emotion';

const autocompleteStyles = css({
  '[data-test-id="cf-autocomplete-container"]': {
    marginTop: tokens.spacing2Xs,
  },
});

type PillSelectorProps<T> = {
  available: T[];
  selected: T[];
  onChange: (next: T[]) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  placeholder?: string;
  noMatchesMessage?: string;
  onOpen?: () => void;
  onClose?: () => void;
};

// Forma 36 Autocomplete is built on Downshift, which caches the last selected
// item and skips onSelectItem on re-pick. Passing a constant sentinel as
// selectedItem keeps the cache always-empty so every click fires onSelectItem.
const SENTINEL = Symbol('pill-selector-empty');

function PillSelector<T>({
  available,
  selected,
  onChange,
  getKey,
  getLabel,
  placeholder,
  noMatchesMessage,
  onOpen,
  onClose,
}: PillSelectorProps<T>) {
  const [filter, setFilter] = useState('');

  // The sentinel is fed to Autocomplete's selectedItem to defeat Downshift's
  // cache; it must never reach the caller's getLabel, or "undefined" leaks into
  // the input value and breaks filtering.
  const safeLabel = (item: T) =>
    (item as unknown) === SENTINEL ? '' : getLabel(item);

  const filtered = useMemo(
    () =>
      available.filter((item) =>
        safeLabel(item).toLowerCase().includes(filter.toLowerCase())
      ),
    [available, filter, getLabel]
  );

  return (
    <>
      <Autocomplete<T>
        className={autocompleteStyles}
        items={filtered}
        onInputValueChange={setFilter}
        onSelectItem={(item) => {
          onChange([...selected, item]);
          setFilter('');
        }}
        onOpen={onOpen}
        onClose={onClose}
        selectedItem={SENTINEL as unknown as T}
        itemToString={safeLabel}
        renderItem={safeLabel}
        textOnAfterSelect="clear"
        closeAfterSelect={false}
        listWidth="full"
        placeholder={placeholder}
        noMatchesMessage={noMatchesMessage}
      />
      <Flex isInline flexWrap="wrap" gap="spacingXs" marginTop="spacingS">
        {selected.map((item) => (
          <Pill
            key={getKey(item)}
            label={getLabel(item)}
            onClose={() =>
              onChange(selected.filter((x) => getKey(x) !== getKey(item)))
            }
          />
        ))}
      </Flex>
    </>
  );
}

export default PillSelector;
