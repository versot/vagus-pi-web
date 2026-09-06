import type { ReactNode } from "react";

/**
 * Transient notification toast (ctx.ui.notify). Anchored above the composer's
 * maxWidth container (same margins as the input card) so it is centered over
 * the conversation column — not the browser viewport (sidebar/right panel
 * would offset a fixed-position toast). Mounted INSIDE the position:relative
 * maxWidth container next to InputCard.
 */
export function ToastHost(props: { toast: ReactNode }) {
  if (!props.toast) return null;
  return (
    <div style={{ position: "absolute", bottom: "calc(100% + 12px)", left: "50%", transform: "translateX(-50%)", zIndex: 30, maxWidth: "min(90vw, 560px)", animation: "vagus-toast-in 0.2s ease" }}>
      {props.toast}
    </div>
  );
}
