import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { mockSdk, resetMocks } from '../../test/mocks';
import { useDropdownAwareAutoResizer } from './useDropdownAwareAutoResizer';

const useAutoResizer = vi.fn();

vi.mock('@contentful/react-apps-toolkit', () => ({
  useSDK: () => mockSdk,
  useAutoResizer: (...args: unknown[]) => useAutoResizer(...args),
}));

/** Instrumented ResizeObserver so the test can assert the observer is cleaned up. */
const observers: Array<{ disconnected: boolean; fire: () => void }> = [];

class TestResizeObserver {
  private record: { disconnected: boolean; fire: () => void };
  constructor(callback: () => void) {
    this.record = { disconnected: false, fire: callback };
    observers.push(this.record);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
}

const POPOVER_BOTTOM = 300;
const BUFFER = 16;

const Harness = () => {
  const resizer = useDropdownAwareAutoResizer();
  return (
    <>
      <button onClick={resizer.onOpen}>open</button>
      <button onClick={resizer.onClose}>close</button>
    </>
  );
};

/** Stands in for Forma 36's open Autocomplete popover. */
const mountPopover = () => {
  const popover = document.createElement('div');
  popover.setAttribute('data-test-id', 'cf-autocomplete-container');
  popover.getBoundingClientRect = () =>
    ({ bottom: POPOVER_BOTTOM, height: 200 }) as DOMRect;
  document.body.appendChild(popover);
  return popover;
};

beforeEach(() => {
  resetMocks();
  useAutoResizer.mockClear();
  observers.length = 0;
  (globalThis as any).ResizeObserver = TestResizeObserver;
});

afterEach(() => {
  document
    .querySelectorAll('[data-test-id="cf-autocomplete-container"]')
    .forEach((el) => el.remove());
});

describe('useDropdownAwareAutoResizer', () => {
  it('keeps the toolkit auto-resizer on while the dropdown is closed', () => {
    render(<Harness />);
    expect(useAutoResizer).toHaveBeenCalledWith({ absoluteElements: true });
    expect(mockSdk.window.stopAutoResizer).not.toHaveBeenCalled();
  });

  it('sizes the iframe to the popover bottom plus a buffer on open', () => {
    mountPopover();
    render(<Harness />);

    fireEvent.click(screen.getByText('open'));

    expect(mockSdk.window.stopAutoResizer).toHaveBeenCalled();
    expect(mockSdk.window.updateHeight).toHaveBeenCalledWith(
      POPOVER_BOTTOM + BUFFER
    );
  });

  it('re-syncs the height when the observed body resizes', () => {
    mountPopover();
    render(<Harness />);

    fireEvent.click(screen.getByText('open'));
    mockSdk.window.updateHeight.mockClear();
    observers[0].fire();

    expect(mockSdk.window.updateHeight).toHaveBeenCalledWith(
      POPOVER_BOTTOM + BUFFER
    );
  });

  it('disconnects the observer and restores the auto-resizer on close', () => {
    mountPopover();
    render(<Harness />);

    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('close'));

    expect(observers[0].disconnected).toBe(true);
    expect(mockSdk.window.startAutoResizer).toHaveBeenCalledWith({
      absoluteElements: true,
    });
  });

  it('disconnects the observer if it unmounts while the dropdown is open', () => {
    mountPopover();
    const { unmount } = render(<Harness />);

    fireEvent.click(screen.getByText('open'));
    unmount();

    expect(observers[0].disconnected).toBe(true);
  });
});
