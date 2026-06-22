import { React, classNames } from 'jimu-core'
import { Icon } from 'jimu-ui'

export interface ResizerTooltipProps {
  isRuntime: boolean
  isResizing: boolean
}

const ResizerTooltip = React.memo((props: ResizerTooltipProps) => {
  const { isRuntime } = props
  const resizeIcon = isRuntime ? require('../../assets/icons/resizer-runtime.svg') : require('../../assets/icons/resizer-builder.svg')
  const resizer = <div className={classNames('resize-handle d-flex', { 'p-1': isRuntime })}><Icon icon={resizeIcon} size={isRuntime ? 10 : 16} currentColor={false} /></div>
  return resizer
})

export default ResizerTooltip
