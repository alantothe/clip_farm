import { ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function ModesPage() {
  const navigate = useNavigate()

  return (
    <main className="modes-home">
      <section className="modes-home__intro" aria-labelledby="modes-title">
        <div>
          <p className="eyebrow">Mode library · 01 available</p>
          <h1 id="modes-title">Choose what<br />you want to make.</h1>
        </div>
        <p className="modes-home__lede">
          Each mode is a focused workflow with the right crop, format, and finishing tools already set up.
        </p>
      </section>

      <section className="mode-grid" aria-label="Available modes">
        <button className="mode-card" type="button" onClick={() => navigate('/modes/x-to-vertical')}>
          <span className="mode-card__visual" aria-hidden="true">
            <span className="mode-card__source">
              <span className="mode-card__x">X</span>
              <span className="mode-card__horizon"><i /><i /></span>
              <small>16:9 source</small>
            </span>
            <span className="mode-card__transfer"><ArrowRight size={23} /></span>
            <span className="mode-card__output">
              <span className="mode-card__crop"><i /><i /></span>
              <small>9:16 ready</small>
            </span>
          </span>

          <span className="mode-card__body">
            <span className="mode-card__meta"><b>01</b><i />Available now</span>
            <span className="mode-card__copy">
              <span>
                <strong>Landscape X<br />to Vertical</strong>
                <small>
                  Take a landscape video from an X post and turn it into a polished 9:16 MP4, ready to upload to TikTok, Instagram Reels, or YouTube Shorts.
                </small>
              </span>
              <span className="mode-card__action">Open mode <ArrowRight size={19} /></span>
            </span>
            <span className="mode-card__steps" aria-label="Workflow: paste an X link, crop and caption, export vertical">
              <span><b>1</b> Paste X link</span>
              <span><b>2</b> Crop + caption</span>
              <span><b>3</b> Export vertical</span>
            </span>
          </span>
        </button>

        <div className="mode-placeholder" aria-label="More modes coming later">
          <span>Next harvest</span>
          <p>More focused workflows will live here.</p>
        </div>
      </section>
    </main>
  )
}
