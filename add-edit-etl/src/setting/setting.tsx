/** @jsx jsx */
import {
  React, jsx, css, hooks, Immutable, DataSourceTypes,
  type UseDataSource, type IMState, type ImmutableArray, type DataSourceJson
} from 'jimu-core'
import { type AllWidgetSettingProps } from 'jimu-for-builder'
import { SettingSection, SettingRow, MapWidgetSelector } from 'jimu-ui/advanced/setting-components'
import { DataSourceSelector } from 'jimu-ui/advanced/data-source-selector'
import { Switch, NumericInput, Label, defaultMessages as jimuUIMessages } from 'jimu-ui'
import defaultMessages from './translations/default'
import type { Config, IMConfig } from '../config'

const supportedTypes = Immutable([
  DataSourceTypes.FeatureLayer,
  DataSourceTypes.SubtypeSublayer,
  DataSourceTypes.SceneLayer
])

const Setting = (props: AllWidgetSettingProps<IMConfig>) => {
  const { config, id, onSettingChange, useDataSources, useMapWidgetIds } = props
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)

  const set = (key: keyof Config, value: unknown) => {
    onSettingChange({ id, config: (config as any).set(key as string, value) })
  }

  const onMapWidgetSelected = (ids: string[]) => {
    onSettingChange({ id, useMapWidgetIds: ids })
  }

  const onTargetChange = (uds: UseDataSource[]) => {
    const target = uds?.[0]
    onSettingChange({
      id,
      useDataSources: uds as any,
      config: (config as any).set('targetUseDataSource', target ? Immutable(target) : undefined)
    })
  }

  return (
    <div css={style} className='widget-setting-add-edit-etl'>
      <SettingSection title={translate('target')}>
        <SettingRow>
          <DataSourceSelector
            types={supportedTypes}
            useDataSources={useDataSources}
            mustUseDataSource
            onChange={onTargetChange}
            widgetId={id}
            isMultiple={false}
            hideAddDataButton={false}
          />
        </SettingRow>
        <SettingRow tag='label' label={translate('reviewEdit')}>
          <Switch checked={config.enableReviewEdit !== false} onChange={(e) => set('enableReviewEdit', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('editExisting')}>
          <Switch checked={!!config.startInEditMode} onChange={(e) => set('startInEditMode', e.target.checked)} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('mapSection')}>
        <SettingRow flow='wrap' label={translate('mapWidget')}>
          <MapWidgetSelector useMapWidgetIds={useMapWidgetIds} onSelect={onMapWidgetSelected} />
        </SettingRow>
        <SettingRow tag='label' label={translate('showOnMap')}>
          <Switch checked={config.showOnMap !== false} onChange={(e) => set('showOnMap', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('zoomToSelected')}>
          <Switch checked={config.zoomToSelected !== false} onChange={(e) => set('zoomToSelected', e.target.checked)} />
        </SettingRow>
        <SettingRow flow='wrap' label={translate('zoomScale')}>
          <NumericInput size='sm' min={0} max={500000000} step={500} value={config.zoomScale || 0} aria-label={translate('zoomScale')} onChange={(v) => set('zoomScale', v)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('geometryEdit')}>
          <Switch checked={config.enableGeometryEdit !== false} onChange={(e) => set('enableGeometryEdit', e.target.checked)} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('editPermissions')}>
        <SettingRow tag='label' label={translate('allowCreate')}>
          <Switch checked={config.allowCreate !== false} onChange={(e) => set('allowCreate', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('allowUpdate')}>
          <Switch checked={config.allowUpdate !== false} onChange={(e) => set('allowUpdate', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('allowDelete')}>
          <Switch checked={config.allowDelete !== false} onChange={(e) => set('allowDelete', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('allowGeometryUpdate')}>
          <Switch checked={config.allowGeometryUpdate !== false} onChange={(e) => set('allowGeometryUpdate', e.target.checked)} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('snappingSection')}>
        <SettingRow tag='label' label={translate('snapGuides')}>
          <Switch checked={config.snapGuides !== false} onChange={(e) => set('snapGuides', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('snapFeature')}>
          <Switch checked={config.snapFeature !== false} onChange={(e) => set('snapFeature', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('snapGrid')}>
          <Switch checked={!!config.snapGrid} onChange={(e) => set('snapGrid', e.target.checked)} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('toolsSection')}>
        <SettingRow tag='label' label={translate('advancedTools')}>
          <Switch checked={config.advancedTools !== false} onChange={(e) => set('advancedTools', e.target.checked)} />
        </SettingRow>
        {config.advancedTools !== false && (
          <React.Fragment>
            <SettingRow tag='label' label={translate('toolSplit')}>
              <Switch checked={config.toolSplit !== false} onChange={(e) => set('toolSplit', e.target.checked)} />
            </SettingRow>
            <SettingRow tag='label' label={translate('toolMerge')}>
              <Switch checked={config.toolMerge !== false} onChange={(e) => set('toolMerge', e.target.checked)} />
            </SettingRow>
            <SettingRow tag='label' label={translate('toolCopyPaste')}>
              <Switch checked={config.toolCopyPaste !== false} onChange={(e) => set('toolCopyPaste', e.target.checked)} />
            </SettingRow>
          </React.Fragment>
        )}
        <SettingRow tag='label' label={translate('displayVertices')}>
          <Switch checked={!!config.displayVertices} onChange={(e) => set('displayVertices', e.target.checked)} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('editingBehavior')}>
        <SettingRow tag='label' label={translate('enableTooltips')}>
          <Switch checked={config.enableTooltips !== false} onChange={(e) => set('enableTooltips', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('templateFilter')}>
          <Switch checked={config.templateFilter !== false} onChange={(e) => set('templateFilter', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('batchEditingOpt')}>
          <Switch checked={config.batchEditing !== false} onChange={(e) => set('batchEditing', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={translate('relatedRecords')}>
          <Switch checked={config.relatedRecords !== false} onChange={(e) => set('relatedRecords', e.target.checked)} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('stepAdd')}>
        <SettingRow tag='label' label='Allow search'>
          <Switch checked={!config.disableAddBySearch} onChange={(e) => set('disableAddBySearch', !e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label='Allow URL'>
          <Switch checked={!config.disableAddByUrl} onChange={(e) => set('disableAddByUrl', !e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label='Allow file upload'>
          <Switch checked={!config.disableAddByFile} onChange={(e) => set('disableAddByFile', !e.target.checked)} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('stepMap')}>
        <SettingRow tag='label' label='Let user edit the mapping'>
          <Switch checked={config.allowRuntimeMapping !== false} onChange={(e) => set('allowRuntimeMapping', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label='Allow expression transforms'>
          <Switch checked={config.allowExpressions !== false} onChange={(e) => set('allowExpressions', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label='Load chunk size'>
          <NumericInput size='sm' min={1} max={2000} value={config.loadChunkSize || 200} onChange={(v) => set('loadChunkSize', v)} />
        </SettingRow>
      </SettingSection>
    </div>
  )
}

export default Setting

const style = css`
  .jimu-widget-setting--section { border-bottom: 1px solid var(--sys-color-divider-secondary); }
`
