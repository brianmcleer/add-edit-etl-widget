// vendor-shims.d.ts
// City of Grand Junction GIS Division
//
// Widget-specific editor declarations for the Add Edit ETL widget. Sits beside
// the untouched master copy of exb-editor-shims.d.ts (copied from widgets\_vs)
// so the master can stay byte-identical across widgets. Editor only: emits
// nothing, the Experience Builder webpack build never reads this file.
//
// Keep this file a script (no top-level import/export) so every block below
// stays ambient and merges with the master shim's declarations.

// The master shim declares 'jimu-for-builder' in shorthand form, which makes
// AllWidgetSettingProps a namespace rather than a type (TS2709). Give it a shape.
declare module 'jimu-for-builder' {
    export type AllWidgetSettingProps<T = any> = {
        id: string
        config: T & { set: (key: any, value: any) => any; [key: string]: any }
        onSettingChange: (settings: any, ...rest: any[]) => void
        useDataSources?: any
        useMapWidgetIds?: any
        intl?: any
        theme?: any
        portalUrl?: string
        [key: string]: any
    }
    export const getAppConfigAction: any
    export const builderAppSync: any
}

// jimu-core members the master shim lists as values only, or not at all.
declare module 'jimu-core' {
    export type JimuFieldType = string
    export class BaseVersionManager { versions: any[]; [key: string]: any }
}
declare module 'jimu-ui/basic/item-selector' {
    export type ItemTypeCategory = string
    export const ItemTypeCategory: any
    const mod: any
    export default mod
}

// ArcGIS Maps SDK modules this widget uses as types (import type X from 'esri/...').
// The master shim's 'esri/*' wildcard exposes only a default `any` value, so these
// specific declarations (which win over the wildcard) declare classes.
declare module 'esri/geometry/Geometry' {
    export default class Geometry { constructor (properties?: any); [key: string]: any }
}
declare module 'esri/Graphic' {
    export default class Graphic { constructor (properties?: any); [key: string]: any }
}
declare module 'esri/layers/FeatureLayer' {
    export default class FeatureLayer { constructor (properties?: any); [key: string]: any }
}

// calcite-components is supplied by Experience Builder (webpack aliases it to
// jimu-ui/calcite-components), so it is an import, not a dependency, and must
// never appear in package.json. Used by the shared help guide files.
declare module 'calcite-components' {
    export const CalciteIcon: any
    export const CalciteChip: any
    export const CalciteButton: any
    export const CalciteSlider: any
    const mod: any
    export default mod
}
