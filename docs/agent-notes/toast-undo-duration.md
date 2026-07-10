---
name: toast-undo duration
description: Deferred/undo toasts must set an explicit duration or the Undo button outlives the grace window.
---

When building a Gmail-style "deferred action + Undo toast" in brand-studio, always pass an explicit `duration` to `toast({...})` that matches the grace-window timer.

**Why:** the shadcn `use-toast` here sets `TOAST_REMOVE_DELAY = 1000000` (~16min) and `TOAST_LIMIT = 1`. Without an explicit `duration`, an Undo toast stays clickable long after the action has already committed; clicking it then silently no-ops (and can briefly flash the item back if the commit mutation is in flight). The `duration` prop flows through Toaster's `{...props}` to the Radix Toast root, which auto-closes.

**How to apply:** set `duration` equal to the commit timer (e.g. `setTimeout(commit, 5000)` → `toast({ duration: 5000, action: <ToastAction>Undo</ToastAction> })`). The visible Undo affordance then disappears exactly when it stops working.
