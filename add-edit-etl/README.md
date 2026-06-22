# Add, Map & Edit Data

A custom ArcGIS Experience Builder widget for the City of Grand Junction, CO. It
joins Esri's stock Add Data and Edit widgets into one guided workflow and inserts
a field-mapping step between them, so a user can bring in data, line its fields
up with an editable target layer, load the records, and edit them on the map.

This is a derivative work. It combines and extends two out of the box Esri
widgets. See "Credits and license" below.

## Workflow

The widget walks the user through four numbered steps:

1. Add data. Bring in a source from a file, a URL, or ArcGIS content, using the
   stock Add Data experience.
2. Map fields. Match the source schema onto the target layer's schema. The
   mapping supports one to one, many to one, one to many, and many to many
   relationships, with transforms such as direct copy, concatenate, split,
   coalesce, numeric reductions, constants, and expressions. A configuration can
   be exported to XML and imported again later, so repetitive loads do not have
   to be rebuilt by hand.
3. Load. Validate the mapping, preview the first transformed record, then write
   the records into the target layer in batches, with a progress readout.
4. Edit. Edit the loaded records on the map using the stock Edit tools,
   including attribute forms and geometry editing.

## Features

- One guided widget in place of two separate ones, plus the mapping step that
  normally has to happen outside Experience Builder.
- Field mapping across one to one, many to one, one to many, and many to many,
  with type coercion and validation.
- Mapping import and export as XML for reusable, repeatable workflows.
- Optional add of the target layer to the linked map, with zoom to the loaded
  features and zoom to a feature when it is selected during editing.
- A configurable zoom scale, so zoom to actually changes scale rather than only
  panning.
- A full set of Edit options surfaced in the settings panel, including create,
  update, delete, geometry update, snapping, and the advanced editing tools.
- Keyboard accessible controls and screen reader labels throughout.

## Requirements

- ArcGIS Experience Builder Developer Edition 1.19 or 1.20, which run React 19.
- EB 1.18 and earlier run React 18 and are not supported.

## Install

1. Download the release zip and extract it.
2. Place the `add-edit-etl` folder into your Experience Builder install so that
   its `manifest.json` sits directly inside
   `client/your-extensions/widgets/add-edit-etl/`. The `manifest.json` must be
   one level deep, never nested a second level deep such as
   `widgets/add-edit-etl/add-edit-etl/`. Nesting is the most common reason a
   widget does not register.
3. From the `client` folder, run `npm install`. Experience Builder installs the
   widget's dependencies automatically for widgets in `your-extensions`, so there
   are no per-dependency commands to run.
4. Restart the client, then add the widget to an experience.

## Settings

Open the widget's settings panel to:

- Pick the editable target layer the data will load into.
- Pick the linked map widget, if you want loaded or selected features shown and
  zoomed to.
- Set the zoom scale and turn zoom to selected feature on or off.
- Turn the individual Edit permissions, snapping options, and editing tools on or
  off.

## Troubleshooting: "add-edit-etl is duplicated"

If `npm start` in the `client` folder reports that the widget name is duplicated,
a second copy is registered somewhere. A single, correctly placed copy cannot
duplicate itself. Check, in this order:

1. A nested folder, `widgets\add-edit-etl\add-edit-etl`. The `manifest.json` must
   sit directly inside the widget folder, not a second level deep. This is the
   usual cause when a zip is extracted into a folder that already has the
   widget's name.
2. A leftover folder from an earlier build or version, including any `-copy`
   folder.
3. A stale compiled build in `client\dist\widgets`. Stop the client server,
   delete the matching folder under `dist\widgets`, then start again.

If removing one copy makes the widget disappear from the Entrypoint list, the
copy that remains is nested too deep. Move it so the `manifest.json` is directly
inside the widget folder.

## Feedback

Please open an issue on the GitHub repository, or reply on the Esri Community
post for this widget.

## Credits and license

This widget is a derivative work based on Esri's ArcGIS Experience Builder
Add Data and Edit widgets, both by the Esri R&D Center Beijing, which Esri
publishes under the Apache License, Version 2.0. It has been combined, modified,
and extended by the City of Grand Junction, CO.

Licensed under Apache-2.0. See the LICENSE file for the full terms and the NOTICE
file for attribution. Original work copyright Esri; modifications copyright City
of Grand Junction, CO. This software is free to use, modify, and redistribute
under those terms.
