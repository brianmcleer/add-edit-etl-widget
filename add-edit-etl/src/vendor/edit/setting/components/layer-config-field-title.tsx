import { React, hooks, css } from 'jimu-core'
import { Icon, TextInput, Button, defaultMessages as jimuUiDefaultMessages } from 'jimu-ui'
import { dataComponentsUtils } from 'jimu-ui/advanced/data-source-selector'
import { useTheme } from 'jimu-theme'
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash'
import { InfoOutlined } from 'jimu-icons/outlined/suggested/info'
import type { TreeFields } from '../../config'

export interface LayerConfigFieldTitleProps {
  item: TreeFields
  disableDescription: boolean
  onGroupNameChange: (groupKey: number, newName: string) => void
  removeGroup: (groupKey: number) => void
  showDetailPopper: (ref: React.RefObject<HTMLDivElement>, curField: TreeFields) => void
}

const style = css`
&.group-field {
  display: flex;
  align-items: center;
  .field-icon {
    flex-shrink: 0;
    margin: 0 2px;
  }
  .group-name, .field-name {
    min-height: 22px;
    flex: 1 1 auto;
    min-width: 0;
    margin: 0 2px;
  }
  .group-name {
    .group-name-input {
      width: 100%;
      .input-wrapper {
        width: 100%;
        height: 22px;
        .jimu-input-base {
          width: 100%;
        }
      }
      &:hover .input-wrapper {
        border: 1px solid var(--sys-color-divider-primary);
      }
    }
  }
  .group-remove {
    flex-shrink: 0;
    padding: 0;
    margin: 0 2px;
  }
  .group-field-detail {
    flex-shrink: 0;
    padding: 0;
    margin: 0 2px;
  }
}
`

export default function LayerConfigFieldTitle (props: LayerConfigFieldTitleProps) {
  const { item, disableDescription, onGroupNameChange, removeGroup, showDetailPopper } = props

  const theme = useTheme()
  const translate = hooks.useTranslation(jimuUiDefaultMessages)

  const titleRef = React.useRef<HTMLDivElement>(null)

  const iconInfo = dataComponentsUtils.getIconFromFieldType(item.type, theme)

  const displayName = item.alias || item.jimuName || item.name || ''
  const [draftName, setDraftName] = React.useState<string>(displayName)

  React.useEffect(() => {
    setDraftName(displayName)
  }, [displayName])

  const commitGroupNameChange = React.useCallback((newName: string) => {
    if (item.alias === newName || item.name === newName) return
    onGroupNameChange?.(item.groupKey, newName)
  }, [item.alias, item.groupKey, item.name, onGroupNameChange])

  const handleGroupNameBlur = React.useCallback((evt: React.FocusEvent<HTMLInputElement>) => {
    commitGroupNameChange(evt.target.value)
  }, [commitGroupNameChange])

  const handleGroupNameInputChange = React.useCallback((evt: React.ChangeEvent<HTMLInputElement>) => {
    setDraftName(evt.target.value)
  }, [])

  const handleGroupNameKeyDown = React.useCallback((evt: React.KeyboardEvent<HTMLInputElement>) => {
    if (evt.key !== 'Enter') return
    commitGroupNameChange((evt.target as HTMLInputElement).value)
    ;(evt.target as HTMLInputElement).blur()
  }, [commitGroupNameChange])

  const handleRemoveGroup = React.useCallback((evt: React.MouseEvent<HTMLButtonElement>) => {
    removeGroup?.(item.groupKey)
  }, [item.groupKey, removeGroup])

  const handleShowDetail = React.useCallback((evt: React.MouseEvent<HTMLButtonElement>) => {
    showDetailPopper?.(titleRef, item)
  }, [item, showDetailPopper])

  return <div ref={titleRef} className='group-field' css={style}>
    {!item.groupKey &&
      <Icon icon={iconInfo.icon} color={iconInfo.color} title={iconInfo.title} className='field-icon' />
    }
    {item.groupKey &&
      <div className='group-name'>
        <TextInput
          size='sm'
          value={draftName}
          className='group-name-input'
          onChange={handleGroupNameInputChange}
          onKeyDown={handleGroupNameKeyDown}
          onBlur={handleGroupNameBlur}
        />
      </div>
    }
    {!item.groupKey &&
      <div className='field-name'>{item.alias || item.jimuName || item.name}</div>
    }
    {item.groupKey &&
      <Button
        icon
        type='tertiary'
        size='sm'
        title={translate('remove')}
        aria-label={translate('remove')}
        disableHoverEffect
        disableRipple
        className='group-remove'
        onClick={handleRemoveGroup}
      >
      <TrashOutlined />
    </Button>
    }
    <Button
      icon
      type='tertiary'
      size='sm'
      title={translate('description')}
      aria-label={translate('description')}
      disabled={disableDescription}
      disableHoverEffect
      disableRipple
      className='group-field-detail'
      onClick={handleShowDetail}
    >
      <InfoOutlined />
    </Button>
  </div>
}