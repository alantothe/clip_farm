import { useNavigate } from 'react-router-dom'
import { ModeCard } from '../components/ModeCard'
import { availableModeCount, availableModes } from '../modes/registry'

export function ModesPage() {
  const navigate = useNavigate()
  const modes = availableModes()

  return (
    <main className="modes-home">
      <section className="modes-home__intro" aria-labelledby="modes-title">
        <div>
          <p className="eyebrow">Mode library · {availableModeCount()} available</p>
          <h1 id="modes-title">Choose what<br />you want to make.</h1>
        </div>
        <p className="modes-home__lede">
          Each mode is a focused workflow with the right crop, format, and finishing tools already set up.
        </p>
      </section>

      <section className="mode-grid" aria-label="Available modes">
        {modes.map((mode) => (
          <ModeCard key={mode.id} mode={mode} onOpen={() => navigate(mode.route)} />
        ))}

        <div className="mode-placeholder" aria-label="More modes coming later">
          <span>Next harvest</span>
          <p>More focused workflows will live here.</p>
        </div>
      </section>
    </main>
  )
}
