---
name: Embedded-iframe file picker
description: Why hidden-input + programmatic .click() file uploads silently fail in the Replit canvas/preview iframe, and the pattern that works.
---

- A hidden `<input type="file">` triggered by `ref.current.click()` from a separate Button often does NOT open the OS file dialog when the app is viewed inside the embedded canvas/preview iframe (cross-origin). The user clicks and nothing happens — symptom is "I can't see / select the file to upload."
- Reliable pattern: wrap the `<input type="file" className="hidden">` inside a `<label>` styled as the button (use `buttonVariants()` for shadcn styling). Clicking the label is a direct user activation on the input itself, which browsers allow even inside iframes.

**Why:** programmatic `.click()` is not always treated as a trusted user gesture inside a sandboxed/cross-origin iframe, so the file chooser is suppressed; a real click on a `<label>` bound to the input is.

**How to apply:** in brand-studio, prefer the label-wrapped-input pattern (see templates/ImportPdf, knowledge/Guidelines, brands/Edit guideline upload) for any new file upload UI. Avoid the `fileInputRef.current?.click()` approach for user-facing uploads.
