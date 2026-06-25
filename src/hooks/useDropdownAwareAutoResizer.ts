// Purpose: Dynamic iframe sizing for an Autocomplete dropdown. Swaps the
// default auto-resizer for a ResizeObserver while the popover is open so the
// iframe tracks the popover's actual bottom edge + buffer (avoids both
// clipping and the empty-gap of a fixed expanded height). Field/Sidebar/Dialog
// only; calling from app-config/page locations throws.

import { useEffect, useRef } from 'react';
import { FieldAppSDK, SidebarAppSDK, DialogAppSDK } from '@contentful/app-sdk';
import { useAutoResizer, useSDK } from '@contentful/react-apps-toolkit';

// Visual gap left below the open dropdown so the iframe doesn't snap flush
// against the popover's bottom edge.
const DROPDOWN_BOTTOM_BUFFER = 16;

type ResizableLocationSDK = FieldAppSDK | SidebarAppSDK | DialogAppSDK;

/**
 * Hook for locations where the SDK exposes `sdk.window` (entry-field,
 * entry-sidebar, dialog). Keeps the iframe sized to the document while the
 * dropdown is closed; while open, swaps to a ResizeObserver that tracks the
 * popover's actual bottom edge so the dropdown never gets clipped — and never
 * leaves an awkward gap when the filtered list is short.
 *
 * Returns `onOpen`/`onClose` callbacks meant to be wired to a Forma 36
 * Autocomplete. Pattern derived from contentful/apps:apps/marketo (which uses
 * a fixed expanded height); the dynamic ResizeObserver is our addition.
 *
 * NOT safe to call from `app-config` or `page` locations — those SDKs don't
 * expose `sdk.window` and useAutoResizer throws.
 */
export function useDropdownAwareAutoResizer() {
  const sdk = useSDK<ResizableLocationSDK>();
  useAutoResizer({ absoluteElements: true });

  const cleanupRef = useRef<(() => void) | null>(null);

  const onOpen = () => {
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
    cleanupRef.current = () => ro.disconnect();
  };

  const onClose = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    sdk.window.startAutoResizer({ absoluteElements: true });
  };

  useEffect(() => () => cleanupRef.current?.(), []);

  return { onOpen, onClose };
}
