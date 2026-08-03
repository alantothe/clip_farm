import { Image as ImageIcon, Layers, LoaderCircle, Save, Trash2, Type, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { formatTime } from '../../lib/format'
import type { BatchMedia, LayerProfile, Title } from '../../types'

type SaveSelection = { name: string; titleIds: string[]; mediaIds: string[] }

export function LayerProfilesDialog({
  profiles,
  currentTitles,
  currentMedia,
  playheadMs,
  pending,
  error,
  onCancel,
  onSave,
  onApply,
  onDelete,
}: {
  profiles: LayerProfile[]
  currentTitles: Title[]
  currentMedia: BatchMedia[]
  playheadMs: number
  pending: boolean
  error: Error | null
  onCancel: () => void
  onSave: (selection: SaveSelection) => void
  onApply: (profile: LayerProfile) => void
  onDelete: (profile: LayerProfile) => void
}) {
  const [tab, setTab] = useState<'saved' | 'save'>(profiles.length ? 'saved' : 'save')
  const [name, setName] = useState('')
  const [titleIds, setTitleIds] = useState(() => currentTitles.map((title) => title.id))
  const [mediaIds, setMediaIds] = useState(() => currentMedia.map((item) => item.id))
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const selectedCount = titleIds.length + mediaIds.length

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, pending])

  function toggle(id: string, selected: string[], setSelected: (ids: string[]) => void) {
    setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  }

  return (
    <div className="delete-dialog-backdrop" role="presentation">
      <section
        className="layer-profiles-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="layer-profiles-title"
      >
        <button
          className="add-media-dialog__close"
          type="button"
          onClick={onCancel}
          disabled={pending}
          aria-label="Close layer profiles"
        >
          <X size={16} />
        </button>

        <p className="eyebrow">Reusable compositions</p>
        <h2 id="layer-profiles-title">Layer profiles</h2>
        <p className="layer-profiles-dialog__lede">
          Carry a finished text-and-image arrangement into the next Batch. Every layer fills
          the new Sequence, whatever its duration.
        </p>

        <div className="layer-profiles-dialog__tabs" role="tablist" aria-label="Layer profiles">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'saved'}
            className={tab === 'saved' ? 'is-active' : ''}
            onClick={() => setTab('saved')}
            disabled={pending}
          >
            <Layers size={15} /> Saved
            {profiles.length > 0 && <span>{profiles.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'save'}
            className={tab === 'save' ? 'is-active' : ''}
            onClick={() => setTab('save')}
            disabled={pending}
          >
            <Save size={15} /> Save current
          </button>
        </div>

        {tab === 'saved' ? (
          <div className="layer-profiles__saved" role="tabpanel" aria-label="Saved layer profiles">
            {profiles.length === 0 ? (
              <div className="layer-profiles__empty">
                <Layers size={28} />
                <strong>No layer profiles yet</strong>
                <span>Save what is on the Player now, then reuse it in another Batch.</span>
                <button type="button" onClick={() => setTab('save')}>Save the first profile</button>
              </div>
            ) : (
              <div className="layer-profiles__grid" role="list" aria-label="Saved profiles">
                {profiles.map((profile) => {
                  const deleting = deleteId === profile.id
                  return (
                    <article className="layer-profile-card" role="listitem" key={profile.id}>
                      <div className="layer-profile-card__preview" aria-hidden="true">
                        {profile.media.slice(0, 2).map((item) => (
                          <img
                            key={item.id}
                            src={api.mediaUrl(item.url)}
                            alt=""
                            loading="lazy"
                            style={{
                              left: `${item.center_x}%`,
                              top: `${item.center_y}%`,
                              width: `${item.width_percent}%`,
                              opacity: item.opacity,
                              transform: `translate(-50%, -50%) rotate(${item.rotation_deg}deg)`,
                            }}
                          />
                        ))}
                        {profile.titles.slice(0, 3).map((title) => (
                          <span
                            key={title.id}
                            style={{
                              left: `${title.center_x}%`,
                              top: `${title.center_y}%`,
                              color: title.color,
                            }}
                          >
                            {title.text}
                          </span>
                        ))}
                      </div>
                      <div className="layer-profile-card__copy">
                        <strong>{profile.name}</strong>
                        <small>
                          <Type size={11} /> {profile.titles.length}
                          <ImageIcon size={11} /> {profile.media.length}
                          <em>0:00 → end</em>
                        </small>
                      </div>
                      {deleting ? (
                        <div className="layer-profile-card__confirm" role="alert">
                          <span>Delete this profile?</span>
                          <button type="button" onClick={() => setDeleteId(null)} disabled={pending}>
                            Keep
                          </button>
                          <button type="button" onClick={() => onDelete(profile)} disabled={pending}>
                            Delete
                          </button>
                        </div>
                      ) : (
                        <div className="layer-profile-card__actions">
                          <button
                            className="layer-profile-card__apply"
                            type="button"
                            onClick={() => onApply(profile)}
                            disabled={pending}
                          >
                            {pending ? <LoaderCircle className="spin" size={14} /> : <Layers size={14} />}
                            Apply
                          </button>
                          <button
                            className="layer-profile-card__delete"
                            type="button"
                            onClick={() => setDeleteId(profile.id)}
                            disabled={pending}
                            aria-label={`Delete ${profile.name}`}
                            title="Delete profile"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="layer-profiles__save" role="tabpanel" aria-label="Save current layout">
            <label className="layer-profiles__name">
              <span>Profile name</span>
              <input
                value={name}
                maxLength={80}
                autoFocus
                placeholder="Brand close, CTA, Corner logo…"
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
              />
            </label>

            <div className="layer-profiles__capture-head">
              <span>Visible at {formatTime(playheadMs)}</span>
              <small>{selectedCount} selected</small>
            </div>
            {currentTitles.length + currentMedia.length === 0 ? (
              <div className="layer-profiles__empty layer-profiles__empty--compact">
                <Layers size={24} />
                <strong>Nothing to capture here</strong>
                <span>Move the playhead onto a text or image layer, then open this again.</span>
              </div>
            ) : (
              <div className="layer-profiles__capture" role="group" aria-label="Layers to save">
                {currentTitles.map((title) => (
                  <label key={title.id} className="layer-profile-choice">
                    <input
                      type="checkbox"
                      checked={titleIds.includes(title.id)}
                      onChange={() => toggle(title.id, titleIds, setTitleIds)}
                      disabled={pending}
                    />
                    <i><Type size={14} /></i>
                    <span><strong>{title.text || 'Untitled text'}</strong><small>Text layer</small></span>
                  </label>
                ))}
                {currentMedia.map((item) => (
                  <label key={item.id} className="layer-profile-choice">
                    <input
                      type="checkbox"
                      checked={mediaIds.includes(item.id)}
                      onChange={() => toggle(item.id, mediaIds, setMediaIds)}
                      disabled={pending}
                    />
                    <i className="is-image"><img src={api.mediaUrl(item.url)} alt="" /></i>
                    <span><strong>{item.name}</strong><small>Image layer</small></span>
                  </label>
                ))}
              </div>
            )}

            <p className="layer-profiles__rule">
              <span aria-hidden="true">∞</span>
              Timing is intentionally not saved. When applied, every chosen layer starts at 0:00
              and reaches the target Sequence’s end.
            </p>

            <div className="delete-dialog__actions">
              <button className="secondary-button" type="button" onClick={onCancel} disabled={pending}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => onSave({ name: name.trim(), titleIds, mediaIds })}
                disabled={pending || !name.trim() || selectedCount === 0}
              >
                {pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
                {pending ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error.message}</p>}
      </section>
    </div>
  )
}
