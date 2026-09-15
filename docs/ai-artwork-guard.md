# AI Artwork Guard

The campaign builder can now review and safely correct each resized layout before saving it to Work in progress.

## Providers

- **Automatic**, OpenAI first, Claude if OpenAI fails
- **OpenAI only**
- **Claude only**

Vercel needs `OPENAI_API_KEY` for OpenAI and `ANTHROPIC_API_KEY` for Claude. The optional `OPENAI_ARTWORK_REVIEW_MODEL` variable changes the OpenAI review model, the default is `gpt-4o`.

## Build sequence

1. The measured geometry engine creates one target size.
2. Deterministic checks find missing elements, collisions, overflow, unsafe dimensions and out-of-bounds artwork.
3. The selected vision model compares the rendered target with the source master and measured campaign rules.
4. Only controlled element edits are accepted.
5. The corrected layout is rendered and reviewed again.
6. Deterministic checks run again after the AI corrections.
7. Unresolved problems mark the result Rejected for a designer.

The AI cannot rewrite copy, alter logos or lockups, delete protected brand furniture, or stretch image layers. Any proposed image resize is converted to a uniform scale before it is applied.

AI remains an artwork critic and correction assistant. A designer still provides final approval.

## Using it

On **Build A Campaign**, enable **AI Artwork Guard** before selecting **Build artwork**. Automatic is the recommended provider setting. Guarded builds send one output size per request so the complete render, review and correction cycle has enough execution time on Vercel.

The result appears in the comparison screen under **AI Artwork Guard**. Corrections can be undone, and **Check & fix** can be run again manually.
