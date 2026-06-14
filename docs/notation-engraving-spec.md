# Aria Music Notation & Engraving Specification

> **Status:** Authoritative reference. When generating, editing, quantizing,
> transcribing, validating, or rendering notation in Aria, cross-reference this
> document. Prioritize **readability** over the fewest symbols. Respect beat
> structure above all else.

## Core Principles

- Always prioritize readability.
- Follow standard Western music engraving conventions.
- Produce notation that would be accepted by a school band, orchestra, jazz
  ensemble, choir, or piano score.
- Avoid technically correct but visually confusing notation.
- Minimize ties when a simpler note value exists.
- **Respect beat structure above all else.**

---

## Core Duration Values

| Name              | Symbol          | Beats in 4/4 |
|-------------------|-----------------|--------------|
| Whole Note        | Semibreve       | 4            |
| Half Note         | Minim           | 2            |
| Quarter Note      | Crotchet        | 1            |
| Eighth Note       | Quaver          | 1/2          |
| Sixteenth Note    | Semiquaver      | 1/4          |
| Thirty-second     | Demisemiquaver  | 1/8          |

### Dotted Notes

A dot increases duration by **half** of the original note.

| Note            | Value     |
|-----------------|-----------|
| Dotted Half     | 3 beats   |
| Dotted Quarter  | 1.5 beats |
| Dotted Eighth   | 0.75 beats|
| Dotted Sixteenth| 0.375 beats|

Formula: `dotted_duration = base_duration × 1.5`

Double dots add: `base + 1/2·base + 1/4·base`
- Dotted half = 3 beats
- Double-dotted half = 3.5 beats

### Ties

A tie joins two notes of **identical pitch**. Use ties when:
- Duration crosses a beat boundary
- Duration crosses a measure boundary
- Duration cannot be represented by a single note value

Do **not** write a dotted note if it obscures the beat structure — tie instead.

---

## Measure Completion

Every measure must contain exactly the number of beats specified by the time
signature (4/4 → 4, 3/4 → 3, 6/8 → 3+3 eighths). No measure may overfill or
underfill unless explicitly marked as a pickup measure.

### Pickup Measures (Anacrusis)

A pickup measure contains fewer beats than the time signature. The total
duration across the pickup and final measure must balance.

---

## Time Signatures & Beat Hierarchy

### Simple Meter (beat divides into two)

| Meter | Beat stress              |
|-------|--------------------------|
| 2/4   | Strong Weak              |
| 3/4   | Strong Weak Weak         |
| 4/4   | Strong Weak Medium Weak  |

### Compound Meter (beat divides into three)

| Meter | Grouping        |
|-------|-----------------|
| 6/8   | (1 2 3)(4 5 6) = 3+3 |
| 9/8   | 3+3+3           |
| 12/8  | 3+3+3+3         |

Notation should visually reveal beats. **Avoid beaming or rests that cross
major beat boundaries.**

---

## Beaming Rules

Beam by beat group; never one giant beam across the measure.

| Meter | Beam grouping                          |
|-------|----------------------------------------|
| 4/4   | `[1&] [2&] [3&] [4&]`                   |
| 2/4   | `[1&] [2&]`                            |
| 3/4   | `[1&] [2&] [3&]`                       |
| 6/8   | `[123] [456]` (per dotted-quarter beat) |
| 9/8   | `[123][456][789]`                      |
| 12/8  | `[123][456][789][10 11 12]`            |

### Sixteenth Notes

Group by beat: `[1 e & a]` per beat. Never `[1e&a2e&a]` across beats.

### Mixed Eighth/Sixteenth

`eighth + two sixteenths` within one beat. Maintain beat visibility.

---

## Rests

Use the **largest readable** rest values, but never combine rests in a way that
hides where beats occur. See the full [Rest Grouping Rules](#rest-grouping-rules)
section below.

---

## Tuplets

- **Triplet (3):** N notes in the time of M. Eighth-note triplet = one quarter
  beat split into 1/3 + 1/3 + 1/3.
- **Quarter-note triplet:** two beats split into three equal notes.
- General rule: N notes in the time normally occupied by M notes. Display the
  number; use brackets when grouping is unclear.

---

## Stem Direction

| Position             | Stem      |
|----------------------|-----------|
| Below middle line    | Up        |
| Above middle line    | Down      |
| On middle line       | Down (default) |

- **Chords:** use the note furthest from the middle line to decide direction.
- **Standard stem length:** ~3.5 staff spaces. Never excessively short.
- **Two voices on one staff:** upper voice stems up, lower voice stems down —
  this overrides normal stem direction.

---

## Accidentals

### Placement

Accidentals sit **immediately to the left of the notehead**. Left-to-right order:

```
Accidental → Notehead → Dot
```

Correct: `♯ ♪ .`  — never `♪ ♯ .`

**Chords:** when multiple notes in a chord need accidentals, stack them
vertically so they never overlap; professional engraving staggers them
horizontally into multiple accidental *columns* rather than stacking directly:

```
♯
  ♭
♮
```

### Scope — what an accidental affects

An accidental applies to the **same pitch letter + same octave + same measure**
only.

- `F#` then `F` in the same measure → the second F is **also F#** (don't repeat
  the sharp).
- `F#4` then `F5` → the F5 is **not** affected (different octave); it stays
  natural unless marked.
- **Barline resets:** measure 1 `F#`, measure 2 `F` → the F is natural again.

### Natural signs & cancellation

Use a natural sign to cancel a previous accidental. To cancel the **key
signature** (e.g. `F♮` in D major), the natural **must** be shown.

### Courtesy (cautionary) accidentals

Not technically required, but shown to prevent error. Allowed when:

- The barline already cancelled an accidental but clarity helps (m1 `F#`, m2 `F♮`).
- Many notes intervene, another accidental occurred nearby, or there's real risk
  of performer error (e.g. `F#` … 20 notes later … courtesy `F#`).

### Repeated notes

Never repeat an accidental unnecessarily — `F# F# F#` shows the sharp on the
**first** note only.

### Ties

A tied note does **not** repeat its accidental: `F#` tied to `F#` shows the sharp
once. If the tie breaks across a barline, a new accidental may be needed.

### Simultaneous voices (where many engines fail)

If two voices share a staff (voice 1 `F#`, voice 2 `F♮`), **both** accidentals
must be shown when ambiguity exists. Accidental memory must not leak between
voices.

### Key-signature interaction

Do **not** show accidentals already implied by the key signature (in D major,
`F#` needs no accidental). Only show one to *cancel* the key signature.

### Enharmonic spelling — choose by harmonic context

- **D major** → `F#`, `C#` (not `Gb`, `Db`).
- **Eb major** → `Eb`, `Ab`, `Bb` (not `D#`, `G#`, `A#`).
- **Chromatic lines:** ascending prefers sharps (`C C# D D# E`), descending
  prefers flats (`E Eb D Db C`) — unless harmony says otherwise.
- **Double accidentals** (`F##`, `Gbb`) are correct when harmony requires them
  (e.g. `F##` in G# minor); don't swap for an enharmonic that damages spelling.

### Collision rules

When accidentals appear in chords: prevent accidental-over-note and
accidental-accidental collisions, stagger horizontally if needed, preserve
minimum spacing, use multiple accidental columns when necessary.

### AI decision hierarchy (choosing spelling)

1. Respect the key signature.
2. Respect harmonic function.
3. Preserve scalar / chromatic motion.
4. Minimize accidentals.
5. Avoid double accidentals unless theoretically required.

---

## Chords, Articulations, Dynamics, Slurs

- **Chords:** stack tones vertically; offset noteheads for intervals of a second.
- **Articulations:** stem up → above note; stem down → below note.
- **Dynamics:** below the staff, centered under the event (`pp p mp mf f ff`).
- **Slurs:** for legato phrasing across *different* pitches — not the same as a
  tie (which joins the *same* pitch).

---

## Spacing

- Horizontal spacing is **proportional to duration** — longer notes get more
  space. A quarter occupies more horizontal space than a sixteenth.
- Avoid collisions between noteheads, accidentals, dots, lyrics, dynamics, and
  articulations.

---

## Ledger Lines

Use only when needed. Do not substitute octave transpositions unless instrument
notation requires it.

---

## Quantization (MIDI / mic input)

Prefer quarter, eighth, sixteenth, and triplet values before introducing more
complex ones. Use the smallest rhythmic value necessary. Do not create 128th
notes, excessive ties, or unusual tuplets unless explicitly requested.

---

## Readability Priority Order

When multiple valid notations exist, resolve in this order:

1. Preserve beat structure.
2. Preserve measure structure.
3. Minimize ties.
4. Use standard beaming.
5. Match key-signature spelling.
6. Minimize accidentals.
7. Optimize visual spacing.

---

# Rest Grouping Rules

## Core Principle

Rests should **reveal** the beat structure of the measure. Never combine rests
in a way that hides where beats occur.

### Rule 1 — Combine rests within a beat
In 4/4, beat 1 silent as eighth + eighth rest → **quarter rest** (silence stays
within one beat).

### Rule 2 — Do not combine across strong beats
Silence from beat 2 to beat 3: use **quarter rest | quarter rest**, NOT a single
half rest. The midpoint between beats 2 and 3 is a major beat boundary; the
reader must see beat 2 empty and beat 3 empty.

### Rule 3 — Preserve beat visibility
Silence for beats 2+3+4: use **quarter rest + half rest**, NOT a dotted half rest.

## Typical Rest Patterns in 4/4

| Silence            | Use                          |
|--------------------|------------------------------|
| Entire measure     | whole rest (always, any meter, centered) |
| Beats 1 and 2      | half rest                    |
| Beat 2 only        | quarter rest                 |
| Beats 2 and 3      | quarter rest + quarter rest  |

## Sixteenth Rest Grouping

- Entire beat silent (`1 e & a`) → **quarter rest**.
- `1 e` silent, `&` note, `a` silent → **eighth rest, note, sixteenth rest**.
- Do not preserve unnecessary sixteenth rests if they merge without obscuring
  rhythm, but **never merge across beats**.

## Dotted Rest Rules

- **Allowed in compound meter.** 6/8, three eighths silent = **dotted quarter
  rest** (one 6/8 beat = a dotted quarter).
- **Generally avoid in simple meter.** In 4/4, avoid a dotted quarter rest when
  it obscures beat location; split into quarter rest + eighth rest if necessary.

## Syncopation

Notes may cross beats (use ties). Rests generally should NOT hide beats. An
eighth note starting on 4& lasting into the next measure → use ties; do not
rewrite to hide the beat structure.

## The Golden Rule

A professional engraver asks *"Can the performer instantly identify where the
beat is?"* — not *"Can I represent this duration with the fewest symbols?"* When
those goals conflict, **show the beat structure.**

---

## Aria Beat-Decomposition Algorithm

This is how Aria decides whether a duration becomes `quarter rest`, or
`eighth rest + eighth rest`, or `sixteenth + eighth + sixteenth` — all the same
total duration, but the choice is driven by **readability**, not math:

1. Determine meter hierarchy.
2. Determine strong and weak beat locations.
3. Split durations at strong beats.
4. Recombine durations only when recombination does not obscure the hierarchy.
5. Beam according to beat groups.
6. Choose rests according to beat groups.

---

## Validation Checklist

Every generated measure should pass:

- [ ] Measure duration equals time-signature duration.
- [ ] No overlapping notes within a voice.
- [ ] Correct stem directions.
- [ ] Correct beaming for the meter.
- [ ] Correct accidental scope.
- [ ] No illegal tuplets.
- [ ] No collisions.
- [ ] Beat structure clearly visible.
- [ ] Enharmonic spelling matches key.
- [ ] Notation readable by a trained musician without ambiguity.
