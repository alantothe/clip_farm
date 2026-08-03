import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, BookmarkPlus, Sliders, Trash2, Type, X } from 'lucide-react'
import { formatTime } from '../../lib/format'
import {
  faceFamily,
  loadFace,
  lookOfStyle,
  resolveFace,
  sameLook,
  swatchCss,
} from '../../lib/titles'
import type {
  FontCatalog,
  FontFamily,
  Phrase,
  Title,
  TitleAlign,
  TitleLook,
  TitlePatch,
  TitleStyle,
} from '../../types'

const CATEGORY_LABELS: Record<string, string> = {
  sans: 'Sans',
  display: 'Display',
  serif: 'Serif',
  script: 'Script & hand',
}

const WEIGHT_LABELS: Record<number, string> = {
  400: 'Regular',
  700: 'Bold',
  800: 'Extra',
  900: 'Black',
}

const ALIGNMENTS: TitleAlign[] = ['left', 'center', 'right']

/** Where the three placement buttons put a Title, as a percent down the frame. */
const PLACES: { label: string; y: number }[] = [
  { label: 'Top', y: 20 },
  { label: 'Middle', y: 50 },
  { label: 'Bottom', y: 80 },
]

/** How near a placement button a Title has to sit to count as being on it. */
const PLACE_TOLERANCE = 4

/**
 * How long typing pauses before the words are sent.
 *
 * The stage follows every keystroke — that is local — but the Batch is not
 * rewritten per letter. Long enough that a sentence is one request, short
 * enough that the Title Track's label is never stale by the time an eye
 * reaches it.
 */
const TEXT_COMMIT_MS = 500

/**
 * A number control that shows every intermediate value and sends only the last.
 *
 * A range input fires on every pixel of a drag. Sending each one would put a
 * hundred requests behind one gesture; showing none of them until release would
 * make the slider feel broken. So the moves go to the preview, which is local,
 * and the release goes to the server — the same split every gesture on the
 * Timeline already uses.
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onPreview,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (value: number) => string
  onPreview: (value: number) => void
  onCommit: (value: number) => void
}) {
  const latest = useRef(value)
  return (
    <label className="title-field">
      <span className="title-field__label">
        {label}
        <small>{format ? format(value) : value}</small>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          latest.current = Number(event.target.value)
          onPreview(latest.current)
        }}
        onPointerUp={() => onCommit(latest.current)}
        onKeyUp={() => onCommit(latest.current)}
        onBlur={() => onCommit(latest.current)}
      />
    </label>
  )
}

/** A colour well that commits when the picker closes, not while it is open. */
function Colour({
  label,
  value,
  onPreview,
  onCommit,
}: {
  label: string
  value: string
  onPreview: (value: string) => void
  onCommit: (value: string) => void
}) {
  const latest = useRef(value)
  return (
    <label className="title-field title-field--colour">
      <span className="title-field__label">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => {
          latest.current = event.target.value.toUpperCase()
          onPreview(latest.current)
        }}
        onBlur={() => onCommit(latest.current)}
      />
    </label>
  )
}

/** One Style, drawn in itself, as the button that applies it. */
function StyleSwatch({
  style,
  catalog,
  active,
  onApply,
}: {
  style: TitleStyle
  catalog: FontCatalog | null
  active: boolean
  onApply: () => void
}) {
  const face = resolveFace(catalog, style.font_family, style.font_weight)
  const { box, text } = swatchCss(style, face)
  return (
    <button
      type="button"
      className={`title-swatch ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      // The name is the label because the sample is a picture of the answer,
      // not the answer: a screen reader gets "Sticker", not "Sticker sticker".
      aria-label={style.name}
      title={style.builtin ? style.name : `${style.name} — saved`}
      onClick={onApply}
    >
      <span className="title-swatch__sample" aria-hidden="true">
        {/* The tilt is a layer of its own: a transform on the panel would tip
            the dark backdrop with the type, and one on the text would not
            apply at all — it is an inline box. */}
        <span className="title-swatch__tilt" style={box}>
          <span style={text}>{style.name}</span>
        </span>
      </span>
      <span className="title-swatch__name">
        {style.name}
        {!style.builtin && <em> saved</em>}
      </span>
    </button>
  )
}

/**
 * One saved Phrase, drawn in its own words and its own look, as the button
 * that writes it.
 *
 * The sample is the label here, unlike a Style's swatch: a Phrase has no name
 * because its words are its name, so what a screen reader is given is the
 * words too.
 */
function PhraseSwatch({
  phrase,
  catalog,
  active,
  onApply,
  onDelete,
  busy,
}: {
  phrase: Phrase
  catalog: FontCatalog | null
  active: boolean
  onApply: () => void
  onDelete: () => void
  busy: boolean
}) {
  const face = resolveFace(catalog, phrase.font_family, phrase.font_weight)
  const { box, text } = swatchCss(phrase, face)
  return (
    <span className={`phrase ${active ? 'is-active' : ''}`}>
      <button
        type="button"
        className="phrase__apply"
        aria-pressed={active}
        title="Write these words here, at the size and place they were saved"
        onClick={onApply}
        disabled={busy}
      >
        <span className="phrase__sample">
          {/* The words are their own layer, so a tilted Phrase tips the type
              and not the dark panel behind it. */}
          <span className="phrase__words" style={box}>
            <span style={text}>{phrase.text}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="phrase__forget"
        aria-label={`Forget “${phrase.text}”`}
        title="Forget these words. Any text already written from them is untouched."
        onClick={onDelete}
        disabled={busy}
      >
        <X size={11} />
      </button>
    </span>
  )
}

/**
 * Everything about the selected Title.
 *
 * The panel is a look and four adjustments. Choosing from twenty ready-made
 * Styles — each drawn in itself, so the choice is made by eye rather than by
 * reading a font list — is how a Title is meant to be dressed here; size,
 * placement, colour and timing are what an operator reaches for afterwards.
 * Everything else the renderer can do is still here, behind Fine-tune, because
 * a rare control belongs out of the way rather than gone.
 *
 * Nothing here binds a Title to a Style. Applying one copies its values, so
 * editing a Style later leaves this Title alone (ADR 0008) — which is also why
 * the lit swatch is found by comparing looks rather than by a stored id.
 */
export function TitleInspector({
  title,
  catalog,
  styles,
  phrases,
  onEdit,
  onPreview,
  onRemove,
  onSaveStyle,
  onUpdateStyle,
  onDeleteStyle,
  onSavePhrase,
  onDeletePhrase,
  busy,
}: {
  title: Title
  catalog: FontCatalog | null
  styles: TitleStyle[]
  phrases: Phrase[]
  onEdit: (patch: TitlePatch) => void
  /** Local-only, for the stage to follow a drag before it is sent. */
  onPreview: (patch: TitlePatch | null) => void
  onRemove: () => void
  onSaveStyle: (name: string) => void
  onUpdateStyle: (style: TitleStyle) => void
  onDeleteStyle: (style: TitleStyle) => void
  /** The words as they stand in the box, which may not have been sent yet. */
  onSavePhrase: (text: string) => void
  onDeletePhrase: (phrase: Phrase) => void
  busy: boolean
}) {
  const [text, setText] = useState(title.text)
  const [naming, setNaming] = useState(false)
  const [styleName, setStyleName] = useState('')
  const [previewsLoaded, setPreviewsLoaded] = useState(false)

  // Only on the way to another Title. Following `title.text` as well would let
  // a reply to a half-finished request overwrite the letters typed since it
  // went out.
  useEffect(() => {
    setText(title.text)
  }, [title.id])

  const family = useMemo(
    () => catalog?.families.find((item) => item.id === title.font_family) ?? null,
    [catalog, title.font_family],
  )
  const face = resolveFace(catalog, title.font_family, title.font_weight)

  // The face in use has to be loaded for the stage to draw it.
  useEffect(() => {
    if (face) void loadFace(face)
  }, [face])

  /**
   * Every Style's own face, because every Style is drawn in it.
   *
   * This is a real download — a dozen or so files — and it is paid the moment
   * a Title is selected rather than deferred, because the swatches *are* the
   * control now. A picker whose samples arrive one by one in the fallback face
   * is worse than the wait.
   */
  useEffect(() => {
    if (!catalog) return
    for (const style of styles) {
      const sample = resolveFace(catalog, style.font_family, style.font_weight)
      if (sample) void loadFace(sample)
    }
  }, [catalog, styles])

  // A Phrase is shown in its own face for the same reason a Style is: the words
  // and the way they are set are the whole of what is being recognised. Mostly
  // already loaded — a Phrase was saved from a Style — so this is usually free.
  useEffect(() => {
    if (!catalog) return
    for (const phrase of phrases) {
      const sample = resolveFace(catalog, phrase.font_family, phrase.font_weight)
      if (sample) void loadFace(sample)
    }
  }, [catalog, phrases])

  const grouped = useMemo(() => {
    const groups = new Map<string, FontFamily[]>()
    for (const item of catalog?.families ?? []) {
      groups.set(item.category, [...(groups.get(item.category) ?? []), item])
    }
    return [...groups]
  }, [catalog])

  /**
   * Load one face per family so the font list's options draw in their own type.
   *
   * Deferred until Fine-tune's picker is first reached: 27 files is a real
   * download, and the swatches above answer the question for almost everyone.
   */
  function loadPickerPreviews() {
    if (previewsLoaded || !catalog) return
    setPreviewsLoaded(true)
    for (const item of catalog.families) {
      const preview = resolveFace(catalog, item.id, 400)
      if (preview) void loadFace(preview)
    }
  }

  const set = (patch: TitlePatch) => onEdit(patch)
  const preview = (patch: TitlePatch) => onPreview(patch)

  // The Style the Title still looks like, which is not necessarily the one it
  // was made from — and for a built-in, is the only way to know at all.
  const matched = styles.find((style) => sameLook(title, style)) ?? null
  // The saved profile it came from, which it keeps after departing from it:
  // departing and then saving the departure is what Update is for.
  const applied = styles.find((style) => style.id === title.style_id) ?? null
  const saved = applied && !applied.builtin ? applied : null

  // Saving words already saved rewrites that Phrase rather than adding a second
  // reading the same — the server settles that. Said here so the button does
  // not offer to save something that is already on the shelf.
  const savedAlready = phrases.some((phrase) => phrase.text === text.trim())

  // --- The words -----------------------------------------------------------
  //
  // Typing goes three places: local state so the box is a text box, the
  // preview so the picture keeps up with the fingers, and — once the fingers
  // stop — the server.
  const timer = useRef<number | undefined>(undefined)
  const unsent = useRef<string | null>(null)
  // Rebound every render so the flush on the way out sends through the props
  // the last render had, not the ones this effect first closed over.
  const commit = useRef<(value: string) => void>(() => {})
  commit.current = (value: string) => {
    unsent.current = null
    if (value !== title.text) set({ text: value })
  }

  function type(value: string) {
    setText(value)
    unsent.current = value
    preview({ text: value })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit.current(value), TEXT_COMMIT_MS)
  }

  function flush() {
    window.clearTimeout(timer.current)
    if (unsent.current !== null) commit.current(unsent.current)
  }

  /**
   * Write a saved Phrase into this Title: its words and its whole look.
   *
   * The timing is deliberately left alone. Where a Title sits in a Sequence and
   * how long it runs are facts about this Sequence — the block was dragged
   * there on purpose — and a Phrase knows nothing about either.
   *
   * The pending keystroke timer is dropped rather than flushed: whatever was
   * half-typed is exactly what is being replaced, and letting it land after
   * would overwrite the Phrase a moment later.
   */
  function writePhrase(phrase: Phrase) {
    window.clearTimeout(timer.current)
    unsent.current = null
    setText(phrase.text)
    set({ ...lookOfStyle(phrase), text: phrase.text })
  }

  // Clearing on the way out: a preview left behind would keep overriding the
  // Title on the stage after the inspector had gone. Anything typed in the last
  // half second goes with it rather than being dropped on the floor.
  useEffect(() => () => {
    flush()
    onPreview(null)
  }, [])

  return (
    <section className="title-inspector" aria-label="Title">
      <header className="title-inspector__head">
        <h2>
          <Type size={14} /> Text
        </h2>
        <span className="title-inspector__time">
          {formatTime(title.start_ms)}–{formatTime(title.end_ms)}
        </span>
        <button
          className="icon-button"
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label="Remove this text"
          title="Remove this text"
        >
          <Trash2 size={15} />
        </button>
      </header>

      <textarea
        className="title-inspector__text"
        value={text}
        rows={2}
        maxLength={500}
        placeholder="Type the text that appears over the video"
        aria-label="Title text"
        onChange={(event) => type(event.target.value)}
        onBlur={flush}
      />

      {/*
       * Words worth writing twice.
       *
       * Sits under the box rather than beside the Looks because it is about the
       * words: a Style answers "how should this be set", a Phrase answers "what
       * did I write last time". Hidden entirely until the first one is saved —
       * an empty shelf is a control that only ever cost the operator a glance.
       */}
      <div className="title-inspector__saved">
        <button
          className="text-button title-inspector__save-phrase"
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => onSavePhrase(text.trim())}
          title="Save these words with their size and place, to write again on any batch"
        >
          <BookmarkPlus size={13} />
          {savedAlready ? 'Update these words' : 'Save these words'}
        </button>

        {phrases.length > 0 && (
          <div className="phrases" role="group" aria-label="Saved words">
            {phrases.map((phrase) => (
              <PhraseSwatch
                key={phrase.id}
                phrase={phrase}
                catalog={catalog}
                active={phrase.text === title.text && sameLook(title, phrase)}
                onApply={() => writePhrase(phrase)}
                onDelete={() => onDeletePhrase(phrase)}
                busy={busy}
              />
            ))}
          </div>
        )}
      </div>

      <div className="title-inspector__group">
        <p className="title-inspector__label" id="title-looks">
          Look
        </p>
        <div className="title-swatches" role="group" aria-labelledby="title-looks">
          {styles.map((style) => (
            <StyleSwatch
              key={style.id}
              style={style}
              catalog={catalog}
              active={matched?.id === style.id}
              onApply={() =>
                // The whole look travels with the id, so the stage changes on
                // the click rather than on the reply. The server would arrive
                // at the same values from the id alone.
                set({ ...lookOfStyle(style), style_id: style.id })
              }
            />
          ))}
        </div>
      </div>

      <div className="title-inspector__group">
        <Slider
          label="Size"
          value={title.font_size_percent}
          min={1}
          max={20}
          step={0.1}
          format={(value) => `${value.toFixed(1)}% of frame`}
          onPreview={(value) => preview({ font_size_percent: value })}
          onCommit={(value) => set({ font_size_percent: value })}
        />

        <p className="title-inspector__label">Place</p>
        <div className="title-inspector__row" role="group" aria-label="Place">
          {PLACES.map((place) => {
            const on = Math.abs(title.center_y - place.y) <= PLACE_TOLERANCE
            return (
              <button
                key={place.label}
                type="button"
                className={`chip ${on ? 'is-active' : ''}`}
                aria-pressed={on}
                onClick={() => set({ center_y: place.y, center_x: 50 })}
              >
                {place.label}
              </button>
            )
          })}
        </div>
        <p className="title-inspector__hint">
          Or drag the text on the player to place it, and its corner to resize it.
        </p>

        <div className="title-inspector__row">
          <Colour
            label="Text"
            value={title.color}
            onPreview={(value) => preview({ color: value })}
            onCommit={(value) => set({ color: value })}
          />
          {title.background === 'box' ? (
            <Colour
              label="Panel"
              value={title.background_color}
              onPreview={(value) => preview({ background_color: value })}
              onCommit={(value) => set({ background_color: value })}
            />
          ) : (
            <Colour
              label="Outline"
              value={title.outline_color}
              onPreview={(value) => preview({ outline_color: value })}
              onCommit={(value) => set({ outline_color: value })}
            />
          )}
        </div>

        <div className="title-inspector__row">
          <label className="title-field title-field--number">
            <span className="title-field__label">Starts</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={(title.start_ms / 1000).toFixed(1)}
              onChange={(event) => {
                const start = Math.max(0, Math.round(Number(event.target.value) * 1000))
                // Carrying the length keeps a retype from inverting the span,
                // which the API would refuse.
                set({ start_ms: start, end_ms: start + (title.end_ms - title.start_ms) })
              }}
            />
          </label>
          <label className="title-field title-field--number">
            <span className="title-field__label">Runs for</span>
            <input
              type="number"
              min={0.4}
              step={0.1}
              value={((title.end_ms - title.start_ms) / 1000).toFixed(1)}
              onChange={(event) =>
                set({
                  end_ms:
                    title.start_ms + Math.max(400, Math.round(Number(event.target.value) * 1000)),
                })
              }
            />
          </label>
        </div>
      </div>

      {/*
       * Everything the renderer can draw that the swatches above have already
       * decided. Shut by default and shut again on the next Title: an operator
       * who wants tracking and rotation knows to open it, and one who does not
       * should never have to look past it.
       */}
      <details className="title-inspector__more" key={title.id}>
        <summary>
          <Sliders size={12} /> Fine-tune
        </summary>

        <div className="title-inspector__group">
          <div className="title-inspector__row">
            <label className="title-field title-field--grow">
              <span className="title-field__label">Font</span>
              <select
                value={title.font_family}
                style={face ? { fontFamily: `"${faceFamily(face.id)}", sans-serif` } : undefined}
                onFocus={loadPickerPreviews}
                onPointerDown={loadPickerPreviews}
                onChange={(event) => set({ font_family: event.target.value })}
              >
                {grouped.map(([category, items]) => (
                  <optgroup key={category} label={CATEGORY_LABELS[category] ?? category}>
                    {items?.map((item) => {
                      const sample = resolveFace(catalog, item.id, 400)
                      return (
                        <option
                          key={item.id}
                          value={item.id}
                          style={
                            sample
                              ? { fontFamily: `"${faceFamily(sample.id)}", sans-serif` }
                              : undefined
                          }
                        >
                          {item.name}
                        </option>
                      )
                    })}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          {/* Only the weights this family was actually vendored at: offering one
              it does not have would draw the nearest and look like a bug. */}
          <div className="title-inspector__row" role="group" aria-label="Weight">
            {(family?.weights ?? [400]).map((weight) => (
              <button
                key={weight}
                type="button"
                className={`chip ${title.font_weight === weight ? 'is-active' : ''}`}
                aria-pressed={title.font_weight === weight}
                onClick={() => set({ font_weight: weight })}
              >
                {WEIGHT_LABELS[weight] ?? weight}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${title.italic ? 'is-active' : ''}`}
              aria-pressed={title.italic}
              onClick={() => set({ italic: !title.italic })}
              title="Slanted. Synthesised rather than a face of its own."
            >
              <em>Italic</em>
            </button>
            <button
              type="button"
              className={`chip ${title.uppercase ? 'is-active' : ''}`}
              aria-pressed={title.uppercase}
              onClick={() => set({ uppercase: !title.uppercase })}
            >
              AA
            </button>
          </div>

          <div className="title-inspector__row" role="group" aria-label="Alignment">
            {ALIGNMENTS.map((option) => (
              <button
                key={option}
                type="button"
                className={`chip ${title.align === option ? 'is-active' : ''}`}
                aria-pressed={title.align === option}
                onClick={() => set({ align: option })}
              >
                {option}
              </button>
            ))}
          </div>

          <Slider
            label="Letter spacing"
            value={title.letter_spacing}
            min={-0.05}
            max={0.4}
            step={0.01}
            format={(value) => `${value.toFixed(2)}em`}
            onPreview={(value) => preview({ letter_spacing: value })}
            onCommit={(value) => set({ letter_spacing: value })}
          />
        </div>

        <div className="title-inspector__group">
          <div className="title-inspector__row">
            <Colour
              label="Outline"
              value={title.outline_color}
              onPreview={(value) => preview({ outline_color: value })}
              onCommit={(value) => set({ outline_color: value })}
            />
            <Colour
              label="Shadow"
              value={title.shadow_color}
              onPreview={(value) => preview({ shadow_color: value })}
              onCommit={(value) => set({ shadow_color: value })}
            />
          </div>
          <Slider
            label="Opacity"
            value={title.opacity}
            min={0.05}
            max={1}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            onPreview={(value) => preview({ opacity: value })}
            onCommit={(value) => set({ opacity: value })}
          />
          <Slider
            label="Outline width"
            value={title.outline_width}
            min={0}
            max={0.3}
            step={0.01}
            format={(value) => (value ? `${value.toFixed(2)}em` : 'none')}
            onPreview={(value) => preview({ outline_width: value })}
            onCommit={(value) => set({ outline_width: value })}
          />
          <Slider
            label="Shadow"
            value={title.shadow_offset}
            min={0}
            max={0.3}
            step={0.01}
            format={(value) => (value ? `${value.toFixed(2)}em` : 'none')}
            onPreview={(value) => preview({ shadow_offset: value })}
            onCommit={(value) => set({ shadow_offset: value })}
          />
        </div>

        <div className="title-inspector__group">
          <div className="title-inspector__row" role="group" aria-label="Background">
            <button
              type="button"
              className={`chip ${title.background === 'none' ? 'is-active' : ''}`}
              aria-pressed={title.background === 'none'}
              onClick={() => set({ background: 'none' })}
            >
              No panel
            </button>
            <button
              type="button"
              className={`chip ${title.background === 'box' ? 'is-active' : ''}`}
              aria-pressed={title.background === 'box'}
              onClick={() => set({ background: 'box' })}
              title="A filled panel behind each line. Replaces the outline."
            >
              Panel
            </button>
          </div>
          {title.background === 'box' && (
            <>
              <Slider
                label="Panel opacity"
                value={title.background_opacity}
                min={0}
                max={1}
                step={0.05}
                format={(value) => `${Math.round(value * 100)}%`}
                onPreview={(value) => preview({ background_opacity: value })}
                onCommit={(value) => set({ background_opacity: value })}
              />
              <Slider
                label="Panel padding"
                value={title.background_padding}
                min={0}
                max={1}
                step={0.05}
                format={(value) => `${value.toFixed(2)}em`}
                onPreview={(value) => preview({ background_padding: value })}
                onCommit={(value) => set({ background_padding: value })}
              />
            </>
          )}
        </div>

        <div className="title-inspector__group">
          <Slider
            label="Across"
            value={title.center_x}
            min={0}
            max={100}
            step={0.5}
            format={(value) => `${Math.round(value)}%`}
            onPreview={(value) => preview({ center_x: value })}
            onCommit={(value) => set({ center_x: value })}
          />
          <Slider
            label="Down"
            value={title.center_y}
            min={0}
            max={100}
            step={0.5}
            format={(value) => `${Math.round(value)}%`}
            onPreview={(value) => preview({ center_y: value })}
            onCommit={(value) => set({ center_y: value })}
          />
          <Slider
            label="Wrap width"
            value={title.width_percent}
            min={5}
            max={100}
            step={1}
            format={(value) => `${Math.round(value)}% of frame`}
            onPreview={(value) => preview({ width_percent: value })}
            onCommit={(value) => set({ width_percent: value })}
          />
          <Slider
            label="Rotation"
            value={title.rotation_deg}
            min={-45}
            max={45}
            step={1}
            format={(value) => `${value}°`}
            onPreview={(value) => preview({ rotation_deg: value })}
            onCommit={(value) => set({ rotation_deg: value })}
          />
        </div>

        <div className="title-inspector__group">
          <div className="title-inspector__row">
            <button
              className="chip"
              type="button"
              onClick={() => {
                setStyleName(text.slice(0, 30) || 'My style')
                setNaming(true)
              }}
              disabled={busy}
              title="Save this look as a profile you can reuse on any batch"
            >
              <Bookmark size={13} />
              Save as profile
            </button>
          </div>

          {naming && (
            <div className="title-inspector__row">
              <label className="title-field title-field--grow">
                <span className="title-field__label">Profile name</span>
                <input
                  autoFocus
                  value={styleName}
                  maxLength={80}
                  onChange={(event) => setStyleName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && styleName.trim()) {
                      onSaveStyle(styleName.trim())
                      setNaming(false)
                    }
                    if (event.key === 'Escape') setNaming(false)
                  }}
                />
              </label>
              <button
                className="chip"
                type="button"
                disabled={!styleName.trim() || busy}
                onClick={() => {
                  onSaveStyle(styleName.trim())
                  setNaming(false)
                }}
              >
                Save
              </button>
              <button className="text-button" type="button" onClick={() => setNaming(false)}>
                Cancel
              </button>
            </div>
          )}

          {saved && (
            <div className="title-inspector__row">
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => onUpdateStyle(saved)}
                title="Overwrite the profile with how this text looks now"
              >
                Update “{saved.name}”
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => onDeleteStyle(saved)}
              >
                Delete profile
              </button>
            </div>
          )}
        </div>
      </details>
    </section>
  )
}

/** The look fields alone, for saving a Title as a Style. */
export function lookOf(title: Title): Partial<TitleLook> {
  const {
    id: _id,
    batch_id: _batchId,
    text: _text,
    start_ms: _start,
    end_ms: _end,
    style_id: _style,
    ...look
  } = title
  return look
}
