/** @jsx jsx */
import { React, jsx, css, hooks, Immutable } from 'jimu-core'
import { Button, Select, Option, TextInput, NumericInput, Label, Tooltip, Switch, Alert, defaultMessages as jimuUIMessages } from 'jimu-ui'
import { PlusOutlined } from 'jimu-icons/outlined/editor/plus'
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash'
import defaultMessages from '../translations/default'
import type { Schema, SchemaField, FieldMappingConfig, FieldMappingRule, Cardinality, TransformMode } from '../etl/types'
import { autoMatch } from '../etl/schema'
import { mappingToXml, xmlToMapping } from '../etl/xml'

const { useCallback, useRef, useState } = React

interface Props {
  sourceSchema: Schema
  targetFields: SchemaField[]
  targetSchema: Schema
  value: FieldMappingConfig
  allowExpressions: boolean
  onChange: (next: FieldMappingConfig) => void
}

const MODES_BY_CARDINALITY: Record<Cardinality, TransformMode[]> = {
  '1:1': ['direct', 'expression', 'constant'],
  'M:1': ['concat', 'coalesce', 'sum', 'avg', 'min', 'max', 'expression'],
  '1:M': ['splitDelimiter', 'splitRegex', 'duplicate'],
  'M:M': ['expression']
}

const newRule = (cardinality: Cardinality): FieldMappingRule => ({
  id: `rule_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
  cardinality,
  sourceFields: [],
  targetFields: [],
  mode: MODES_BY_CARDINALITY[cardinality][0],
  options: { coerce: true, trim: true, delimiter: cardinality === '1:M' ? ',' : ' ', expressions: [] },
  enabled: true
})

const MappingPanel = (props: Props) => {
  const { sourceSchema, targetFields, value, allowExpressions, onChange } = props
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)

  const update = useCallback((rules: FieldMappingRule[]) => {
    onChange({ ...value, rules })
  }, [value, onChange])

  const updateRule = useCallback((id: string, patch: Partial<FieldMappingRule>) => {
    update(value.rules.map(r => r.id === id ? { ...r, ...patch } : r))
  }, [value.rules, update])

  const updateRuleOptions = useCallback((id: string, patch: Record<string, unknown>) => {
    update(value.rules.map(r => r.id === id ? { ...r, options: { ...r.options, ...patch } } : r))
  }, [value.rules, update])

  const addRule = (c: Cardinality) => update(value.rules.concat(newRule(c)))
  const removeRule = (id: string) => update(value.rules.filter(r => r.id !== id))

  const doAutoMatch = () => {
    const proposed = autoMatch(sourceSchema, targetFields)
    // keep existing rules, append matches for not-yet-mapped targets
    const mappedTargets = new Set(value.rules.flatMap(r => r.targetFields))
    const merged = value.rules.concat(proposed.filter(p => !p.targetFields.some(t => mappedTargets.has(t))))
    update(merged)
  }

  const setGeometry = (patch: Record<string, unknown>) => onChange({ ...value, geometry: { ...value.geometry, ...patch } })

  const allModes = (c: Cardinality) => MODES_BY_CARDINALITY[c].filter(m => m !== 'expression' || allowExpressions)

  // ---- XML import / export ----
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [ioError, setIoError] = useState<string>(null)

  const doExport = useCallback(() => {
    try {
      const xml = mappingToXml(value)
      const blob = new Blob([xml], { type: 'application/xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'field-mapping.xml'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setIoError(null)
    } catch (e) {
      setIoError((e as Error).message)
    }
  }, [value])

  const onImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = xmlToMapping(String(reader.result || ''))
        onChange(parsed)
        setIoError(null)
      } catch (err) {
        setIoError((err as Error).message)
      }
    }
    reader.onerror = () => setIoError(translate('importReadError'))
    reader.readAsText(file)
  }, [onChange, translate])

  return (
    <div css={style} className='etl-mapping-panel'>
      <div className='toolbar d-flex align-items-center justify-content-between mb-2'>
        <span className='count'>{translate('rulesCount', { count: value.rules.length })}</span>
        <div className='d-flex' style={{ gap: 8 }}>
          <Button size='sm' type='tertiary' onClick={doAutoMatch}>{translate('autoMatch')}</Button>
          <Button size='sm' type='tertiary' onClick={() => update([])}>{translate('clearRules')}</Button>
          <Tooltip title={translate('importHint')}>
            <Button size='sm' type='tertiary' onClick={() => fileInputRef.current?.click()}>{translate('importXml')}</Button>
          </Tooltip>
          <Tooltip title={translate('exportHint')}>
            <Button size='sm' type='tertiary' onClick={doExport} disabled={value.rules.length === 0}>{translate('exportXml')}</Button>
          </Tooltip>
          <input
            ref={fileInputRef}
            type='file'
            accept='.xml,application/xml,text/xml'
            style={{ display: 'none' }}
            onChange={onImportFile}
          />
        </div>
      </div>

      {ioError && <Alert type='error' open withIcon closable className='mb-2' text={ioError} onClose={() => setIoError(null)} />}

      <div className='rules'>
        {value.rules.map(rule => (
          <div key={rule.id} className='rule-card'>
            <div className='rule-head d-flex align-items-center justify-content-between'>
              <Select size='sm' className='card-sel' aria-label={translate('cardinality')} value={rule.cardinality} onChange={(e) => {
                const c = e.target.value as Cardinality
                updateRule(rule.id, { cardinality: c, mode: allModes(c)[0] })
              }}>
                {(['1:1', 'M:1', '1:M', 'M:M'] as Cardinality[]).map(c => <Option key={c} value={c}>{c}</Option>)}
              </Select>
              <Select size='sm' className='mode-sel' aria-label={translate('mode')} value={rule.mode} onChange={(e) => updateRule(rule.id, { mode: e.target.value as TransformMode })}>
                {allModes(rule.cardinality).map(m => <Option key={m} value={m}>{m}</Option>)}
              </Select>
              <div className='d-flex align-items-center' style={{ gap: 6 }}>
                <Switch checked={rule.enabled !== false} onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })} aria-label={translate('ruleEnabled')} />
                <Tooltip title={translate('removeRule')}>
                  <Button size='sm' type='tertiary' icon aria-label={translate('removeRule')} onClick={() => removeRule(rule.id)}><TrashOutlined /></Button>
                </Tooltip>
              </div>
            </div>

            {/* Source side (hidden for constant) */}
            {rule.mode !== 'constant' && (
              <div className='field-block'>
                <Label className='blk-label'>{translate('source')}</Label>
                <MultiFieldSelect
                  multiple={rule.cardinality === 'M:1' || rule.cardinality === 'M:M'}
                  fields={sourceSchema.fields}
                  byJimu
                  ariaLabel={translate('source')}
                  value={rule.sourceFields}
                  onChange={(vals) => updateRule(rule.id, { sourceFields: vals })}
                />
              </div>
            )}

            {/* Target side */}
            <div className='field-block'>
              <Label className='blk-label'>{translate('target')}</Label>
              <MultiFieldSelect
                multiple={rule.cardinality === '1:M' || rule.cardinality === 'M:M'}
                fields={targetFields}
                ariaLabel={translate('target')}
                value={rule.targetFields}
                onChange={(vals) => updateRule(rule.id, { targetFields: vals })}
              />
            </div>

            {/* Mode-specific options */}
            <RuleOptions rule={rule} translate={translate} onOptions={(p) => updateRuleOptions(rule.id, p)} />
          </div>
        ))}
      </div>

      <div className='add-row d-flex align-items-center mt-2' style={{ gap: 8 }}>
        <span>{translate('addRule')}:</span>
        {(['1:1', 'M:1', '1:M', 'M:M'] as Cardinality[]).map(c => (
          <Button key={c} size='sm' type='secondary' onClick={() => addRule(c)}><PlusOutlined /> {c}</Button>
        ))}
      </div>

      {/* Geometry */}
      <div className='geometry-block mt-3'>
        <Label className='blk-label'>{translate('geometry')}</Label>
        <Select size='sm' aria-label={translate('geometry')} value={value.geometry.mode} onChange={(e) => setGeometry({ mode: e.target.value })}>
          <Option value='passthrough'>{translate('geometryPassthrough')}</Option>
          <Option value='fromXY'>{translate('geometryFromXY')}</Option>
          <Option value='none'>{translate('geometryNone')}</Option>
        </Select>
        {value.geometry.mode === 'fromXY' && (
          <div className='xy-grid mt-2'>
            <FieldPick label={translate('xField')} fields={sourceSchema.fields} byJimu value={value.geometry.xField} onChange={(v) => setGeometry({ xField: v })} />
            <FieldPick label={translate('yField')} fields={sourceSchema.fields} byJimu value={value.geometry.yField} onChange={(v) => setGeometry({ yField: v })} />
            <FieldPick label={translate('zField')} fields={sourceSchema.fields} byJimu value={value.geometry.zField} onChange={(v) => setGeometry({ zField: v })} allowEmpty />
            <div>
              <Label className='blk-label'>{translate('sourceWkid')}</Label>
              <NumericInput size='sm' showHandlers={false} value={value.geometry.sourceWkid ?? 4326} onChange={(v) => setGeometry({ sourceWkid: Number(v) })} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// --- helper sub-components -------------------------------------------------

const FieldPick = (p: { label: string, fields: SchemaField[], value?: string, byJimu?: boolean, allowEmpty?: boolean, onChange: (v: string) => void }) => (
  <div>
    <Label className='blk-label'>{p.label}</Label>
    <Select size='sm' aria-label={p.label} value={p.value ?? ''} onChange={(e) => p.onChange(e.target.value)}>
      {p.allowEmpty && <Option value=''>—</Option>}
      {p.fields.map(f => {
        const key = p.byJimu ? (f.jimuName || f.name) : f.name
        return <Option key={key} value={key}>{f.alias || f.name}</Option>
      })}
    </Select>
  </div>
)

const MultiFieldSelect = (p: { fields: SchemaField[], value: string[], multiple?: boolean, byJimu?: boolean, ariaLabel?: string, onChange: (vals: string[]) => void }) => {
  if (!p.multiple) {
    return (
      <Select size='sm' aria-label={p.ariaLabel || 'field'} value={p.value[0] ?? ''} onChange={(e) => p.onChange(e.target.value ? [e.target.value] : [])}>
        <Option value=''>—</Option>
        {p.fields.map(f => {
          const key = p.byJimu ? (f.jimuName || f.name) : f.name
          return <Option key={key} value={key}>{f.alias || f.name}</Option>
        })}
      </Select>
    )
  }
  // multi: simple chip checklist
  const toggle = (key: string) => {
    p.onChange(p.value.includes(key) ? p.value.filter(v => v !== key) : p.value.concat(key))
  }
  return (
    <div className='multi-check'>
      {p.fields.map(f => {
        const key = p.byJimu ? (f.jimuName || f.name) : f.name
        const on = p.value.includes(key)
        return (
          <label key={key} className={`chk ${on ? 'on' : ''}`}>
            <input type='checkbox' checked={on} onChange={() => toggle(key)} /> {f.alias || f.name}
          </label>
        )
      })}
    </div>
  )
}

const RuleOptions = (p: { rule: FieldMappingRule, translate: (k: string, v?: any) => string, onOptions: (patch: Record<string, unknown>) => void }) => {
  const { rule, translate, onOptions } = p
  const o = rule.options || {}
  const blocks: React.ReactNode[] = []

  if (rule.mode === 'concat' || rule.mode === 'splitDelimiter') {
    blocks.push(
      <div key='delim'>
        <Label className='blk-label'>{translate('delimiter')}</Label>
        <TextInput size='sm' aria-label={translate('delimiter')} value={o.delimiter ?? ''} onChange={(e) => onOptions({ delimiter: e.target.value })} />
      </div>
    )
  }
  if (rule.mode === 'splitRegex') {
    blocks.push(
      <div key='re'>
        <Label className='blk-label'>{translate('regex')}</Label>
        <TextInput size='sm' value={o.regex ?? ''} placeholder='^(\\d+)\\s+(.+)$' onChange={(e) => onOptions({ regex: e.target.value })} />
      </div>
    )
  }
  if (rule.mode === 'constant') {
    blocks.push(
      <div key='const'>
        <Label className='blk-label'>{translate('constant')}</Label>
        <TextInput size='sm' aria-label={translate('constant')} value={o.constant == null ? '' : String(o.constant)} onChange={(e) => onOptions({ constant: e.target.value })} />
      </div>
    )
  }
  if (rule.mode === 'expression') {
    const targets = rule.targetFields.length ? rule.targetFields : ['(target)']
    blocks.push(
      <div key='expr' className='expr-block'>
        <Label className='blk-label'>{translate('expression')}</Label>
        {targets.map((t, i) => (
          <div key={t + i} className='mb-1'>
            <span className='expr-target'>{t} =</span>
            <TextInput size='sm' aria-label={translate('expression')} value={o.expressions?.[i] ?? ''} placeholder="helpers.upper($.NAME)" onChange={(e) => {
              const next = (o.expressions || []).slice()
              next[i] = e.target.value
              onOptions({ expressions: next })
            }} />
          </div>
        ))}
        <div className='expr-help'>{translate('expressionHelp')}</div>
      </div>
    )
  }

  if (blocks.length === 0) return null
  return <div className='rule-opts'>{blocks}</div>
}

export default MappingPanel

const style = css`
  font-size: 0.8125rem;
  .toolbar .count { color: var(--sys-color-surface-paper-hint); }
  .rule-card {
    border: 1px solid var(--sys-color-divider-secondary);
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 8px;
    background: var(--sys-color-surface-paper);
  }
  .rule-head { margin-bottom: 6px; }
  .card-sel { width: 64px; }
  .mode-sel { width: 130px; }
  .blk-label { font-size: 0.75rem; color: var(--sys-color-surface-paper-hint); margin-bottom: 2px; display: block; }
  .field-block { margin-bottom: 6px; }
  .multi-check { display: flex; flex-wrap: wrap; gap: 4px; max-height: 90px; overflow: auto; }
  .multi-check .chk { border: 1px solid var(--sys-color-divider-secondary); border-radius: 12px; padding: 1px 8px; cursor: pointer; }
  .multi-check .chk.on { background: var(--sys-color-primary-light); border-color: var(--sys-color-primary-main); }
  .multi-check .chk input { margin-right: 4px; }
  .rule-opts { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
  .expr-target { font-family: monospace; margin-right: 6px; }
  .expr-help { color: var(--sys-color-surface-paper-hint); font-size: 0.6875rem; margin-top: 2px; }
  .xy-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
`
