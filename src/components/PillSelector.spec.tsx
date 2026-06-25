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
  return { onChange };
};

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
});
