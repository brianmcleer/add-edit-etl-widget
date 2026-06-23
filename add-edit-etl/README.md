# Add → Map → Edit (ETL) — merged Experience Builder widget

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
self-contained — its internal imports only reference itself plus jimu packages),
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

## What is verified vs what needs a live EB build

- **Verified here:** the framework-free ETL engine (transform + coercion +
  validation) — `tests/transform-engine.test.ts`, 18 assertions across all four
  cardinalities, all passing.
- **Needs your EB 1.20 environment to build/run** (this sandbox has no jimu SDK
  or Esri JSAPI, so it can't be compiled here). When you build, sanity-check
  these integration seams against your installed `jimu-core` typings, since
  minor API drift between 1.20 patch builds is the most likely source of
  compile fixes:
  - `DataSourceComponent`, `DataSourceSelector` prop names.
  - `ds.query({ page, pageSize })` paging shape in `schema.ts` /
    `load-panel.ts` — adjust if your build expects `{ start, num }`.
  - `loadArcGISJSAPIModules(['esri/geometry/projection', …])` —
    if your JSAPI is 4.30+ you may prefer the `operators/projectOperator`.
  - The review step builds an attribute-only Edit config via the vendored
    `constructConfig`; the OOTB feature form lists all records, not only the
    just-loaded ones (the loaded objectIds are returned in the load result if
    you want to add a filter).

## License

Inherits Apache-2.0 from the OOTB widgets (`vendor/`). New ETL code is provided
under the same terms.
