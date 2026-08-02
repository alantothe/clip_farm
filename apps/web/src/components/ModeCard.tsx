import { ArrowRight } from 'lucide-react'
import { Fragment } from 'react'
import type { ModeDefinition } from '../modes/registry'

export function ModeCard({ mode, onOpen }: { mode: ModeDefinition; onOpen: () => void }) {
  return (
    <button className="mode-card" type="button" onClick={onOpen}>
      {mode.visual}

      <span className="mode-card__body">
        <span className="mode-card__meta"><b>{mode.number}</b><i />Available now</span>
        <span className="mode-card__copy">
          <span>
            <strong>
              {mode.titleLines.map((line, index) => (
                <Fragment key={line}>
                  {index > 0 && <br />}
                  {line}
                </Fragment>
              ))}
            </strong>
            <small>{mode.blurb}</small>
          </span>
          <span className="mode-card__action">Open mode <ArrowRight size={19} /></span>
        </span>
        <span className="mode-card__steps" aria-label={mode.stepsLabel}>
          {mode.steps.map((step, index) => (
            <span key={step}><b>{index + 1}</b> {step}</span>
          ))}
        </span>
      </span>
    </button>
  )
}
