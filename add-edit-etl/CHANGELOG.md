# Changelog

Newest first.

## 1.22.1 (2026-09-18)

- Added: anonymous usage and error telemetry (shared beacon module; off unless the portal publishes an exb-beacon-sink table; telemetry: false in config disables it).

## 1.22.0 (2026-09-17)

- Added: in-widget help guide (Help button, searchable guide, first-run hint)
- Packaging: the Visual Studio editor shims are no longer in the release zip. `publish.ps1` strips them from a staging copy (`$ReleaseOnlyExclude`) and refuses to zip if any ambient `declare module` of react, jimu or esri survives. The shims stay in the GitHub repo; clone users delete them before building.
- Editor: widget-level `tsconfig.json` moved to the self-contained mode B setup for Experience Builder 1.21 (pnpm): no `paths`, `"types": []`, master `src/exb-editor-shims.d.ts` copied from `widgets\_vs`, widget-specific declarations in `src/vendor-shims.d.ts`. `npx tsc -p .` is clean for the widget's own files; remaining errors, if any, are in the vendored Esri code under `src/vendor` and are not actionable. Webpack output is unchanged (jsx settings kept).

## 1.21.0

- Prior releases: see GitHub releases.
