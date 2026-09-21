import PillSelector from './PillSelector';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

type Item = { id: string; name: string };
const items: Item[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
];

const renderComp = (selected: Item[] = [], onChange = vi.fn()) => {
  const available = items.filter((i) => !selected.some((s) => s.id === i.id));
  render(
    <PillSelector<Item>
      available={available}
      selected={selected}
      onChange={onChange}
      getKey={(i) => i.id}
      getLabel={(i) => i.name}
    />
  );
  // The `combobox` role sits on Autocomplete's wrapper; this is the text input.
  return { onChange, input: screen.getByTestId('cf-autocomplete-input') };
};

const optionLabels = () =>
  screen.queryAllByRole('option').map((o) => o.textContent);

describe('PillSelector', () => {
  it('renders an Autocomplete', () => {
    renderComp();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders one Pill per selected item', () => {
    renderComp([items[0]]);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('calls onChange minus the item when a Pill is closed', () => {
    const { onChange } = renderComp([items[0], items[1]]);
    const closeButtons = screen.getAllByLabelText(/close/i);
    fireEvent.click(closeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([items[1]]);
  });

  it('appends the chosen item to the selection', () => {
    const { onChange, input } = renderComp();

    fireEvent.focus(input);
    fireEvent.click(screen.queryAllByRole('option')[0]);

    expect(onChange).toHaveBeenCalledWith([items[0]]);
  });

  it('filters the options by the typed text', () => {
    const { input } = renderComp();

    fireEvent.focus(input);
    expect(optionLabels()).toEqual(['Alpha', 'Beta']);

    fireEvent.change(input, { target: { value: 'bet' } });
    expect(optionLabels()).toEqual(['Beta']);
  });

  it('fires again when the same item is picked twice', () => {
    // Guards the sentinel `selectedItem`: Downshift caches the last selection
    // and skips onSelectItem on a re-pick, so without it the second click here
    // is silently swallowed. The parent owns selection state, so a re-pick is
    // reachable whenever the parent has not yet applied the first one.
    const { onChange, input } = renderComp();

    fireEvent.focus(input);
    fireEvent.click(screen.queryAllByRole('option')[0]);
    fireEvent.focus(input);
    fireEvent.click(screen.queryAllByRole('option')[0]);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith([items[0]]);
  });
});
