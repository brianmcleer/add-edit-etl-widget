# Add, Map & Edit Data widget

A custom ArcGIS Experience Builder widget for the City of Grand Junction, CO. It
joins Esri's stock Add Data and Edit widgets into one settings-driven widget and
inserts a field-mapping step between them. A user adds data from a file, a URL, or
ArcGIS content, maps the source fields onto an editable target layer across one to
one, many to one, one to many, and many to many relationships, loads the records,
and edits them on the map. Mapping configurations export and import as XML, so
repetitive loads do not have to be rebuilt by hand.

The downloadable widget lives in the `add-edit-etl` subfolder. Download a release,
drop that folder into your Experience Builder install, and run the standard client
`npm install`. See the widget's own README for the feature list and install steps.

## Repository layout

```
add-edit-etl-widget/             <- this repo
├── README.md                    <- this file (GitHub landing page)
├── LICENSE                      <- Apache-2.0
├── NOTICE                       <- attribution for the derivative work
├── .gitignore                   <- ignores node_modules, .vs, dist, OS cruft
├── SECURITY.md                  <- how to report a vulnerability
├── publish.ps1                  <- one-command publish and update automation
└── add-edit-etl/                <- the widget (drops into your-extensions/widgets)
    ├── package.json
    ├── package-lock.json        <- generated in the EB environment
    ├── manifest.json
    ├── config.json
    ├── icon.svg
    ├── README.md                <- install steps and feature list
    ├── LICENSE
    ├── NOTICE
    ├── .gitignore
    ├── .npmignore
    └── src/ ...
```

## Install (for users)

See [add-edit-etl/README.md](add-edit-etl/README.md). In short: download the
release zip, place the `add-edit-etl` folder so its `manifest.json` sits directly
inside `client/your-extensions/widgets/add-edit-etl/`, then run `npm install` in
the `client` folder and restart.

## Requirements

- ArcGIS Experience Builder Developer Edition 1.19 or 1.20 (React 19). EB 1.18 and
  earlier are not supported.

## Publishing updates (for the maintainer)

The widget is developed in the Experience Builder install, then synced into this
repo and pushed with `publish.ps1`. Edit the three variables at the top of the
script the first time on a new machine, then:

```
# Code update only
powershell -ExecutionPolicy Bypass -File .\publish.ps1

# Code update plus a new downloadable release
powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Release v1.1.0
```

The script mirrors the widget from the EB folder into the `add-edit-etl` subfolder
(skipping `node_modules` and `.vs`), commits, pushes, and optionally cuts a
versioned GitHub release with a downloadable zip. Tags must increase and never
repeat.

Note on the lockfile: `package-lock.json` is generated in the real Experience
Builder environment by running `npm install` in the widget folder, so downstream
users get the exact tested dependency versions. It is not committed from a
development machine that lacks the EB toolchain.

## Esri Community

Post: add the Esri Community link here after the first publish.

## Credits and license

This widget is a derivative work based on Esri's ArcGIS Experience Builder
Add Data and Edit widgets, both by the Esri R&D Center Beijing, which Esri
publishes under the Apache License, Version 2.0. It has been combined, modified,
and extended by the City of Grand Junction, CO.

Licensed under Apache-2.0. See [LICENSE](LICENSE) for the full terms and
[NOTICE](NOTICE) for attribution. Original work copyright Esri; modifications
copyright City of Grand Junction, CO. This software is free to use, modify, and
redistribute under those terms.
