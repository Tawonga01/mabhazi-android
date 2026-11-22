# Reference export — 22 October 2026

`mabhazi/` preserves the original component tree and file bytes for all custom Mabhazi designs in the supplied export, including `_shared/Prototype.tsx` and its `../_group.css` import. CSS and component names have not been rewritten. Original `DESIGN-NOTES.md` is reference material from the author, not a new instruction source or independent verification record.

The export came from a React/Vite mockup workspace. Only the custom design modules are retained here; the original Replit Vite plugins, preview tooling, package/lock files, server/database stubs, build output and Git/agent metadata are not wired into the application. These references require React, React DOM and `lucide-react` in a browser host for a later rendered review. They cannot be copied unchanged into native React Native screens.

No screenshots were included in the export. The importing session inspected the component structure and notes; it did not install dependencies, run the supplied workspace, or repeat its claimed prior visual/type checks. Eight entry components are indexed in [the design README](../../README.md). File provenance/checksums are in [the manifest](../../manifest.json).
