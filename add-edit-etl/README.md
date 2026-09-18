# Add → Map → Edit (ETL) - merged Experience Builder widget

A single ArcGIS Experience Builder **Developer Edition 1.20** widget that merges
the OOTB **Add Data** and **Edit** widgets and inserts a real field-mapping ETL
step between them.

```
 ┌──────────┐      ┌──────────────────────┐      ┌─────────────────────────┐
 │ ADD DATA │  →   │  ETL: field mapping   │  →   │  LOAD into target layer │
 │ (source) │      │  source → target      │      │  (applyEdits addFeatures│
 │          │      │  1:1 M:1 1:M M:M       │      │   + optional edit form) │
 └──────────┘      └──────────────────────┘      └─────────────────────────┘
```

The runtime user adds data (file / URL / ArcGIS content), maps the **source
schema** onto the **target schema** of the editable layer the app author
configured, and loads the records. Optionally they then edit the loaded
records in the OOTB Edit feature form.

## Features

- Three-step wizard: **Add data** → **Map fields** → **Load**, with an optional
  **Edit** step for the records that land in the target layer.
- Field mapping with all four cardinalities, type coercion, validation, a data
  quality check, insert / update / upsert load modes and XML import/export of
  the rules.
- **Help guide** - a question button at the top right opens a short, searchable,
  plain-language guide that adapts to the options the app author enabled; a
  one-time hint points new users at it.

## Where things live

```
add-edit-etl/
├─ manifest.json              widget manifest (jimu-arcgis dep, DATA_SOURCES_CHANGE)
├─ config.json                default config
├─ icon.svg
└─ src/
   ├─ config.ts               merged Config (Add Data toggles + target layer + ETL options)
   ├─ version-manager.ts
   ├─ runtime/
   │  ├─ widget.tsx           ★ the 3-step wizard orchestrator
   │  ├─ etl/                 ★ THE NEW ETL LAYER (framework-free + glue)
   │  │  ├─ types.ts          mapping data model (rules, cardinality, geometry)
   │  │  ├─ transform-engine.ts  executes 1:1 / M:1 / 1:M / M:M + coercion + validation
   │  │  ├─ schema.ts         read source/target schemas, auto-match, read records
   │  │  ├─ geometry.ts       passthrough / reproject / build point from X-Y
   │  │  └─ apply.ts          chunked applyEdits(addFeatures) into target + refresh
   │  ├─ components/
   │  │  ├─ mapping-panel.tsx ★ runtime rule editor (per-rule cardinality + transform)
   │  │  └─ load-panel.tsx    validate → preview → run → report
   │  └─ translations/default.ts
   ├─ setting/
   │  ├─ setting.tsx          author picks the target editable layer + toggles
   │  └─ translations/default.ts
   ├─ tests/
   │  └─ transform-engine.test.ts   cardinality unit tests (all pass)
   └─ vendor/                 ★ the two OOTB widgets' src, vendored unchanged
      ├─ add-data/            reused: AddDataPopper, DataList, createDataSourcesByDataOptions
      └─ edit/                reused: applyEdits/updateDataSourceAfterEdit, FeatureForm, constructConfig
```

The two OOTB `src` trees are vendored **verbatim** under `src/vendor/` (each is
self-contained - its internal imports only reference itself plus jimu packages),
so the merge does not fork or rewrite Esri's code. The wizard imports the exact
pieces it needs from them. Unused vendored files are harmless dead weight and
can be pruned later.

## The ETL model (the part you asked about)

Every mapping is a list of **rules**. A rule reads `sourceFields[]` and writes
`targetFields[]`; its `mode` decides how. This covers all four cardinalities:

| Cardinality | Modes | Example |
|---|---|---|
| **1:1** | `direct`, `expression`, `constant` | `fname → FIRST` |
| **M:1** | `concat`, `coalesce`, `sum`/`avg`/`min`/`max`, `expression` | `first + last → FULLNAME` |
| **1:M** | `splitDelimiter`, `splitRegex`, `duplicate` | `"Denver, CO" → CITY + STATE` |
| **M:M** | `expression` (one expression per target) | `fn, ln → FULLNAME, COMBO` |

`M:M` is the general case: one rule, N target outputs, each computed by its own
expression over the shared M source inputs. The named modes exist so a non-coder
can build the common shapes without writing an expression.

On top of the rules: **type coercion** to the target field's esri type (int /
double / date-epoch / string with length truncation), **null/required-field
validation**, **last-wins / first-wins** conflict resolution when two rules
target the same field, and **geometry** handling (reuse source geometry with
on-the-fly reprojection, build a point from X/Y fields, or none for tables).

Expressions use `$.FIELD` for source values plus a small `helpers` library
(`helpers.upper`, `helpers.join`, `helpers.coalesce`, `helpers.toNumber`, …).
They run only in the user's own browser. If you don't want runtime users typing
expressions, turn off **Allow expression transforms** in settings.

## Install (EB Developer Edition 1.20)

1. Copy the `add-edit-etl/` folder into
   `client/your-extensions/widgets/add-edit-etl/`.
2. Restart the dev server (`npm start` in `client/`).
3. In your app, drop the **Add, Map & Edit (ETL)** widget onto a page (inside a
   Controller or on its own), and connect a Map widget if you want geometry
   passthrough/editing.
4. In the widget **settings**, pick the **target editable feature layer** (this
   defines the target schema), and set the Add Data / mapping toggles.

At runtime: **Add data → choose which added layer is the source → Map fields
(auto-match seeds 1:1 rules; refine cardinalities) → Validate / Preview / Load →
(optional) Edit loaded records.**

### The release zip and the editor shims

The zip is the widget only. The Visual Studio type shims in the repo (`add-edit-etl/src/exb-editor-shims.d.ts`, `add-edit-etl/src/vendor-shims.d.ts`) are left out on purpose: their ambient `declare module` blocks are not file-scoped and would rewrite the react, jimu and esri types for every other widget in your `your-extensions` folder.

If you clone the repository instead of using the zip, delete `add-edit-etl/src/exb-editor-shims.d.ts` and the other shim files listed above before building; nothing else depends on them.

## What is verified vs what needs a live EB build

- **Verified here:** the framework-free ETL engine (transform + coercion +
  validation) - `tests/transform-engine.test.ts`, 18 assertions across all four
  cardinalities, all passing.
- **Needs your EB 1.20 environment to build/run** (this sandbox has no jimu SDK
  or Esri JSAPI, so it can't be compiled here). When you build, sanity-check
  these integration seams against your installed `jimu-core` typings, since
  minor API drift between 1.20 patch builds is the most likely source of
  compile fixes:
  - `DataSourceComponent`, `DataSourceSelector` prop names.
  - `ds.query({ page, pageSize })` paging shape in `schema.ts` /
    `load-panel.ts` - adjust if your build expects `{ start, num }`.
  - `loadArcGISJSAPIModules(['esri/geometry/projection', …])`  - 
    if your JSAPI is 4.30+ you may prefer the `operators/projectOperator`.
  - The review step builds an attribute-only Edit config via the vendored
    `constructConfig`; the OOTB feature form lists all records, not only the
    just-loaded ones (the loaded objectIds are returned in the load result if
    you want to add a filter).

## Usage telemetry

This widget records anonymous usage counts and errors so the GIS Division can see which widgets and versions are in use and which errors users hit. It records the app id and title, widget name and version, the action name, a truncated error message, the site host name and browser family. It never records usernames, coordinates, addresses, attribute values or URLs with query strings. Where the data goes: on page load the widget asks the app's portal for a public item tagged `exb-beacon-sink` and posts to that table. If your portal has no such item, nothing is sent anywhere. To turn it off for an app, set `"telemetry": false` in the widget's config, or users can enable Do Not Track in their browser. The shared module is `src/shared/beacon.ts`.

## Troubleshooting: `add-edit-etl is duplicated`

If `npm start` (or `pnpm start`) stops with `add-edit-etl is duplicated`, Experience Builder found two copies of the
widget registered under the same name. A single, correctly placed copy cannot duplicate itself,
so a second copy is present somewhere. Check, in this order:

1. A nested folder: `widgets\add-edit-etl\add-edit-etl\`. The `manifest.json` must sit directly
   inside `widgets\add-edit-etl\`, not a level deeper. This is the usual cause when a zip is
   extracted into a folder that already has the widget's name.
2. A leftover folder from an earlier build or version, including any `-copy` folder or a folder
   under a previous name if the widget was renamed.
3. A stale compiled build in `client\dist\widgets\add-edit-etl`. Stop the client server, delete
   that folder (or run a clean build), then start again.

Tell for the nesting case: if removing one copy makes the widget vanish from the build entirely,
the copy that remains is nested too deep. Move it so `manifest.json` is directly inside the
widget folder.

## License

Inherits Apache-2.0 from the OOTB widgets (`vendor/`). New ETL code is provided
under the same terms.
