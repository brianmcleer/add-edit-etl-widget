import type { HelpSection } from './components/HelpPopup'

/**
 * Flags the widget computes from config and live status. One per feature that has help text.
 * widget.tsx computes these with the same checks the render code uses (for example
 * `!!mapWidgetId && config.allowSymbology !== false`), so the guide never describes a
 * control the widget is not currently showing.
 */
export interface HelpFeatures {
  /* Add data step: which ways in are on */
  addByFile: boolean
  addByUrl: boolean
  addBySearch: boolean
  /* targets */
  hasTarget: boolean
  multipleTargets: boolean
  /* Map fields step */
  allowMapping: boolean
  allowExpressions: boolean
  /* Load step */
  allowUpsert: boolean
  reviewEdit: boolean
  showOnMap: boolean
  /* Edit step */
  geometryEdit: boolean
  allowCreate: boolean
  allowDelete: boolean
  allowSymbology: boolean
}

type T = (id: string, values?: Record<string, string>) => string

export function buildHelpSections (t: T, f: HelpFeatures): HelpSection[] {
  const when = (on: boolean, ...ids: string[]): string[] => (on ? ids.map((id: string) => t(id)) : [])
  const listOf = (parts: string[]): string =>
    parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} ${t('helpAnd')} ${parts[parts.length - 1]}`

  /* The ways in, in the order the Add data button offers them. */
  const ways: string[] = [
    ...(f.addByFile ? [t('helpWayFile')] : []),
    ...(f.addByUrl ? [t('helpWayUrl')] : []),
    ...(f.addBySearch ? [t('helpWaySearch')] : [])
  ]
  const anyWay = ways.length > 0

  const sections: HelpSection[] = [
    {
      key: 'start',
      icon: 'play',
      title: t('helpStartTitle'),
      ordered: true,
      body: [
        anyWay ? t('helpStart1', { ways: listOf(ways) }) : t('helpStart1NoWays'),
        t('helpStart2'),
        t('helpStart3')
      ]
    }
  ]

  sections.push({
    key: 'add',
    icon: 'file',
    title: t('helpAddTitle'),
    intro: t('helpAddIntro'),
    body: [
      ...when(f.addByFile, 'helpAddFile'),
      ...when(f.addByUrl, 'helpAddUrl'),
      ...when(f.addBySearch, 'helpAddSearch'),
      t('helpAddList'),
      t('helpAddSource'),
      ...when(f.hasTarget, 'helpAddEditExisting')
    ]
  })

  sections.push({
    key: 'map',
    icon: 'table',
    title: t('helpMapTitle'),
    intro: t('helpMapIntro'),
    body: [
      ...when(f.multipleTargets, 'helpMapTarget'),
      ...when(!f.allowMapping, 'helpMapFixed'),
      ...when(f.allowMapping, 'helpMapAuto', 'helpMapCard', 'helpMapShapes', 'helpMapSwitch'),
      ...when(f.allowMapping && f.allowExpressions, 'helpMapExpression'),
      ...when(f.allowMapping, 'helpMapFiles'),
      t('helpMapGeometry')
    ]
  })

  sections.push({
    key: 'load',
    icon: 'upload-to',
    title: t('helpLoadTitle'),
    intro: t('helpLoadIntro'),
    body: [
      t('helpLoadCheck'),
      t('helpLoadPreview'),
      ...when(f.allowUpsert, 'helpLoadMode', 'helpLoadKey'),
      t('helpLoadRun'),
      t('helpLoadResult'),
      ...when(f.showOnMap, 'helpLoadZoom'),
      ...when(f.reviewEdit, 'helpLoadReview')
    ]
  })

  sections.push({
    key: 'edit',
    icon: 'pencil',
    title: t('helpEditTitle'),
    intro: t('helpEditIntro'),
    body: [
      t('helpEditForm'),
      ...when(f.allowCreate, 'helpEditCreate'),
      ...when(f.allowDelete, 'helpEditDelete'),
      ...when(f.geometryEdit, 'helpEditGeometry'),
      ...when(f.allowSymbology, 'helpEditSymbology'),
      t('helpEditStartOver')
    ]
  })

  sections.push({
    key: 'trouble',
    icon: 'exclamation-mark-triangle',
    title: t('helpTroubleTitle'),
    body: [
      ...when(!f.hasTarget, 'helpTroubleNoTarget'),
      t('helpTroubleNext'),
      t('helpTroubleErrors'),
      t('helpTroubleFailed'),
      t('helpTroubleDates'),
      t('helpTroubleXY'),
      ...when(f.allowUpsert, 'helpTroubleDuplicates'),
      t('helpTroubleNoEdit'),
      t('helpTroubleContact')
    ]
  })

  sections.push({
    key: 'tips',
    icon: 'lightbulb',
    title: t('helpTipsTitle'),
    body: [
      t('helpTips1'),
      t('helpTips2'),
      ...when(f.allowMapping, 'helpTips3')
    ]
  })

  return sections
}
