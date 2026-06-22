import { React, type FeatureDataRecord, css } from 'jimu-core'
import { Button } from 'jimu-ui'
import { useFeatureTitleMap } from './utils'
import { getDataSourceById, getEditDataSource } from '../../utils'
import type { FeatureFormGroup } from './feature-form-list'

interface FeatureFormListItemProps {
  group: FeatureFormGroup
  filterText: string
  onClickItem: (dsId: string, feature: FeatureDataRecord) => void
}

const style = css`
  &.feature-list-items {
    list-style: none;
    margin: 0;
    padding: 0;
    .feature-list-item {
      background-color: var(--sys-color-action);
      color: var(--sys-color-action-text);
      cursor: pointer;
      margin-bottom: 6px;
      min-height: 48px;
      transition: border 250ms ease-in-out;
      display: flex;
      justify-content: space-between;
      .feature-list-item-container {
        display: flex;
        margin: 9px 2px;
        width: 100%;
        .feature-list-item-label{
          flex: 1;
          margin: 0;
          display: flex;
          align-items: center;
          word-break: break-word;
          text-align: left;
        }
      }
      &:last-child {
        margin-bottom: 0;
      }
      :hover {
        cursor: pointer;
        background-color: var(--sys-color-action-hover);
      }
      :focus,
      :focus-visible {
        outline-offset: -2px !important;
      }
    }
  }
`

const FeatureFormListItems = (props: FeatureFormListItemProps) => {
  const { group, filterText, onClickItem } = props
  const dataSource = getEditDataSource(getDataSourceById(group.dsId))
  const featureTitleMap = useFeatureTitleMap(group.items, dataSource)

  const lowerCasedFilter = filterText.toLowerCase()
  const isMatch = (title: string) => !lowerCasedFilter || title?.toString()?.toLowerCase().includes(lowerCasedFilter)


  return (
    <div className='feature-list-items' role='listbox' css={style}>
      {group.items.map((item, index) => {
        const id = item.getId()
        const title = featureTitleMap.get(id) || ''
        if (!isMatch(title)) {
          return null
        } else {
          return (<Button
            key={`${group.dsId}__${id}_${index}`}
            role='option'
            className='w-100 border-0 feature-list-item'
            onClick={() => { onClickItem(group.dsId, item) }}
          >
            <div className='feature-list-item-container'>
              <span className='feature-list-item-label'>{title}</span>
            </div>
          </Button>)
        }
      })}
    </div>
  )
}

export default FeatureFormListItems
