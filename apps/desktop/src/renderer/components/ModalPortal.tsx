import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a modal / overlay at <body>, outside the app layout.
 *
 * A `position: fixed` overlay is only viewport-sized while no ancestor has a
 * backdrop-filter, transform or filter. The macOS glass theme gives every
 * .card and the right panel a backdrop-filter, so a modal opened from a
 * sidebar card (the LAX flow, the Quantt agent sheets) was laid out inside
 * that card — squeezed into the sidebar with the card's content showing
 * through. Portaled, it always covers the window. React context and events
 * still flow as if it were rendered in place.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
