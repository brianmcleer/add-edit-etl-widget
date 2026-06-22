import {
  React, defaultMessages as jimuCoreMessages, hooks, type FeatureDataRecord, css
} from 'jimu-core'
import { Button, TextInput, Typography } from 'jimu-ui'
import { SearchOutlined } from 'jimu-icons/outlined/editor/search'
import { BatchEditOutlined } from 'jimu-icons/outlined/editor/batch-edit'
import type { EditFeatures } from './utils'
import type { LayerInfo } from './feature-form-component'
import defaultMessages from '../translations/default'
import FeatureFormListItems from './feature-form-list-items'

interface FeatureFormListProps {
  editFeatures: EditFeatures
  layersInfo: { [dsId: string]: LayerInfo }
  layersOrder: string[]
  batchEditing: boolean
  onBatchEdit: (dsId: string, records: FeatureDataRecord[]) => void
  onClickItem: (dsId: string, record: FeatureDataRecord) => void
}

export interface FeatureFormGroup {
  id: string
  dsId: string
  label: string
  items: FeatureDataRecord[]
}

const style = css`
  &.feature-list {
    padding: 8px 16px;
    max-height: unset;
    background-color: var(--calcite-color-background);
    .feature-list-no-match {
      justify-content: center;
      align-items: center;
      height: 96px;
      display: flex;
    }
    .feature-list-group {
      padding: 12px 12px 0;
      .feature-list-group-header {
        margin-bottom: 8px;
      }
      .feature-list-group-label {
        line-height: 1.286;
      }
    }
  }
`

const FeatureFormList = (props: FeatureFormListProps) => {
  const { editFeatures, layersOrder, layersInfo, batchEditing, onBatchEdit, onClickItem } = props
  const [filterText, setFilterText] = React.useState('')
  const translate = hooks.useTranslation(jimuCoreMessages, defaultMessages)
  const { count, groupedSelectedFeatures } = React.useMemo(() => {
    let count = 0
    const groupedSelectedFeatures: FeatureFormGroup[] = []
    for (const dsId in editFeatures) {
      const featuresArray = editFeatures[dsId]
      if (featuresArray.length === 0 || !layersInfo[dsId]) continue
      const dataSource = layersInfo[dsId]?.dataSource
      const dsLabel = dataSource.getLabel()
      const group: FeatureFormGroup = {
        id: dsId,
        dsId,
        label: dsLabel,
        items: featuresArray
      }
      count += group.items.length
      groupedSelectedFeatures.push(group)
    }
    // Sort the FeatureForm selection list
    groupedSelectedFeatures.sort((a, b) => {
      const aIndex = layersOrder.findIndex(dsId => dsId === a.id)
      const bIndex = layersOrder.findIndex(dsId => dsId === b.id)
      return aIndex - bIndex
    })
    return { count, groupedSelectedFeatures }
  }, [editFeatures, layersInfo, layersOrder])


  const onFilterChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(evt.target.value)
  }

  const handleBatchEdit = (group: FeatureFormGroup) => {
    onBatchEdit?.(group.dsId, group.items)
  }

  return (
    <div className='feature-list h-100 overflow-auto' css={style}>
      <div className='feature-list-search d-flex align-items-center m-2'>
        <TextInput
          className='w-100'
          placeholder={translate('search')}
          onChange={onFilterChange}
          value={filterText}
          prefix={<SearchOutlined color='var(--sys-color-action-input-field-placeholder)' />}
          allowClear
          title={filterText}
        />
      </div>
      {count === 0 &&
        <div className='feature-list-no-match'>
          <Typography variant='title1'>{translate('noItemsFound')}</Typography>
        </div>
      }
      {count > 0 && <div className='feature-list-groups'>
        {groupedSelectedFeatures.map(group =>
          <div role='group' aria-label={group.label} className='feature-list-group' key={group.id}>
            <h4 className='feature-list-group-header d-flex align-items-center justify-content-between' title={group.label}>
              <Typography component='span' variant='title2' className='feature-list-group-label'>{group.label}</Typography>
              {batchEditing &&
                <Button size='sm' variant='text' icon disabled={group.items.length === 0} title={translate('editTheseRecords')} onClick={() => { handleBatchEdit(group) }} >
                  <BatchEditOutlined />
                </Button>
              }
            </h4>
            <FeatureFormListItems group={group} filterText={filterText} onClickItem={onClickItem} />
          </div>
        )}
      </div>}
    </div>
  )
}

export default FeatureFormList
