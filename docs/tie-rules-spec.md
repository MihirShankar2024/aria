# Tie Rules and Duration Decomposition

> Reference spec for ties/slurs and duration decomposition. The current editor implements
> only the **manual** drag-to-tie tool (a connection span stored on `Part.ties`). The
> automatic decomposition described below is for a **future** quantization / AI pass.
> See also [beat-hierarchy-spec.md](./beat-hierarchy-spec.md) and
> [notation-engraving-spec.md](./notation-engraving-spec.md).

## Purpose

Ties are used to extend the duration of a note across rhythmic boundaries while preserving beat visibility.

A tie connects two notes of identical pitch into one sustained sound.

The tied notes are performed as a single note whose duration equals the sum of all tied segments.

---

# Definition

A tie may only connect:

* Same pitch letter
* Same accidental state
* Same octave

Valid:

F#4 → F#4

Invalid:

F#4 → G4

Invalid:

F#4 → F4

Use a slur instead if pitches differ.

---

# Duration Calculation

The duration of a tied note equals the sum of all tied segments.

Examples:

Quarter tied to quarter

= 2 beats

Quarter tied to eighth

= 1.5 beats

Half tied to quarter

= 3 beats

---

# Primary Rule

Ties exist to preserve beat structure.

When a duration crosses an important rhythmic boundary, split it into tied notes.

Never hide beat structure simply to reduce note count.

---

# Measure Boundaries

A note may never extend beyond a measure without a tie.

Example in 4/4:

Beat 4 contains a half-note duration.

Incorrect:

One half note extending into next measure.

Correct:

Measure 1:
Quarter note on beat 4

Measure 2:
Quarter note tied from previous measure

---

# Beat Boundary Rules

## Strong beats must remain visible.

Example in 4/4:

Duration:
2 beats

Starting:
Beat 2.5

Incorrect:

One half note

Correct:

Eighth tied to quarter tied to eighth

This clearly shows crossing of beats 3 and 4.

---

# Preferred Note Decomposition

When multiple notations are possible:

Choose the notation that reveals the beat hierarchy.

Priority:

1. Preserve measure boundaries
2. Preserve strong beats
3. Preserve secondary beats
4. Minimize number of ties

Readability is more important than minimizing symbols.

---

# Ties vs Dots

Use dotted notes when they do not obscure beats.

Example:

4/4

Starting on beat 1:

Dotted quarter

Preferred

because beat structure remains obvious.

---

Starting on beat 2:

Dotted quarter

Often acceptable.

---

Starting on beat 4:

Dotted quarter

Avoid.

Use:

Quarter tied to eighth

because the duration crosses a barline or major beat boundary.

---

# Tie Chains

A duration may require multiple tied segments.

Example:

Duration:
5 beats

4/4

Represent as:

Whole tied to quarter

not:

Many smaller notes

Use the largest readable decomposition.

---

# Ties and Accidentals

Accidentals carry through a tie automatically.

Example:

Measure 1:

F# tied into Measure 2

Measure 2:

No accidental is displayed.

The tied note continues the original pitch.

---

# New Attack After Tie

Once a note is rearticulated, accidental rules reset.

Example:

Measure 1:
F#

Measure 2:
F# tied from previous measure

then later:

F

The later F requires accidental evaluation according to standard accidental rules.

---

# Tie Crossing a Barline

Accidental remains in force only for the tied continuation.

It does NOT establish accidental memory for later notes.

Example:

Measure 1:

F#

tied into Measure 2

Measure 2:

Tied F#

Later in same measure:
another F

The later F must be explicitly marked if required.

Do not assume accidental inheritance from the tie.

---

# Ties and Courtesy Accidentals

Courtesy accidentals are generally not shown on tied continuations.

Incorrect:

F# tied → F# (with repeated sharp)

Correct:

F# tied → F#

(no repeated accidental)

---

# Rests Break Ties

A tie cannot pass through a rest.

Invalid:

Quarter note
Quarter rest
Tied quarter note

A rest indicates silence.

A tie requires continuous sound.

---

# Ties and Voices

Ties belong to a specific voice.

A tie may not connect notes in different voices.

Voice identity must remain preserved.

---

# Ties and Chords

Every tied notehead in a chord must match pitch exactly.

Example:

C-E-G tied to C-E-G

Valid.

If only C and G continue:

Tie only C and G.

Do not tie E.

---

# Quantization Rule

When converting MIDI or audio:

Determine total duration first.

Then decompose according to:

1. Measure boundaries
2. Beat boundaries
3. Readability rules

Only after decomposition should ties be inserted.

Never generate ties arbitrarily.

---

# Rest Interaction Rules

## Core Principle

Rests reveal silence.

Ties reveal sustained sound.

They serve opposite purposes.

---

# Rest Consolidation

Silence may be merged into larger rests only if beat visibility remains clear.

Example in 4/4:

Four sixteenth rests occupying one complete beat

Convert to:

Quarter rest

Preferred.

---

Two sixteenth rests occupying half a beat

Convert to:

Eighth rest

Preferred.

---

# Do Not Merge Across Strong Beats

Example:

Silence spans beats 2 and 3.

Avoid:

Half rest

Prefer:

Quarter rest + Quarter rest

because the performer should immediately see beat locations.

---

# Tie vs Rest Decision

If sound continues:

Use ties.

If sound stops:

Use rests.

Never replace one with the other.

---

# Algorithm

For every duration:

1. Determine total duration.
2. Split at measure boundaries.
3. Split at strong beat boundaries.
4. Merge segments only if readability improves.
5. Represent sounding segments with notes and ties.
6. Represent silent segments with rests.
7. Apply accidental carry rules.
8. Validate measure duration.

The resulting notation should make the beat structure immediately visible to a trained musician.

---

# Slur Engraving Rules

> These rules cover visual placement of slurs (and ties, which follow the same arc rules).
> Aria targets the "95% case" — professional software uses dozens more heuristics, but
> the rules below handle the vast majority of real scores correctly.

---

## Slur/Tie Direction

Auto-placement decides the side (above/below) in a fixed **priority order** — the first rule that applies wins. Implemented in `src/lib/vexflow/curvePlacement.ts` (`autoDirection`); a manual override on `tie.curve.direction` always supersedes it.

1. **Voice** (two voices on one staff): upper voice → always **above**, lower voice → always **below**. Voice separation takes precedence over everything below.
2. **Chord position**: the curve follows the connected notehead — the **top** head of a chord arches **above**, the **bottom** head **below**. (Interior heads fall through to the stem rule.) This is what makes stacked chord-ties separate cleanly.
3. **Stem direction** (single voice): the curve goes **opposite the stems** (i.e. on the notehead side), so it never crosses a stem.

| Stem direction | Curve placement |
|---------------|----------------|
| Stems up      | Curve **below** notes |
| Stems down    | Curve **above** notes |

   **Reason:** the curve attaches near the noteheads and stays clear of the stems. **Mixed stems:** majority vote; only notes that actually have a stem vote.
4. **Whole notes / no stems:** standard practice keys off staff position — **above** when the head is at or above the middle line, **below** otherwise.
5. **Fallback:** above.

---

## Slur Concavity

A slur should curve **toward** the notes it connects:

- **Slur above notes:** concavity points downward `╭────╮`
- **Slur below notes:** concavity points upward `╰────╯`

---

## Slur Domain (Covered Notes)

A slur is a **phrase**, not a two-note connector: it logically spans every note **of its own voice** between the endpoints, even when the user only clicks the first and last. Placement (direction, contour height, collision) is computed over that covered set, so the arch clears the whole phrase and a *different* voice never pushes it around.

- `coveredNotes = notes in start.voice between start and end, inclusive`
- A **tie** (same pitch) connects only its two heads — `coveredNotes = [start, end]`, no intermediate spanning.
- A **cross-voice slur** (`start.voice ≠ end.voice`) can't infer intermediates — `coveredNotes = [start, end]`; rely on endpoint geometry only.

### Tie vs. slur classification
A connection is a **tie** only when the endpoints share a pitch **and** there is no intervening note of the same voice. The instant a different note sits between two same-pitch heads it becomes a phrase (legato) **slur** — it must arc over/under that note and be spaced as a slur, not flattened like a sustain. Different endpoint pitches are always a slur.

Covered notes are *derived at render time* (not stored), so they stay correct as notes are added/edited. Implemented in `drawTies()` (renderer) feeding `computeCurvePlacement()`.

---

## Height Rules

### Basic Rule
The middle of the slur should be farther from the staff than either endpoint. Never draw a straight line — always use visible curvature.

### By Span Length

| Span       | Note count | Arch height (staff spaces) |
|------------|------------|---------------------------|
| Short      | 2–3 notes  | ~1 space (shallow)        |
| Medium     | 4–8 notes  | ~1.5–2 spaces             |
| Long       | 9+ notes   | ~2–3 spaces               |

Long slurs must not flatten — increase height to maintain a clear arc.

### Increase height further if there is:
- A beam collision
- An accidental collision
- An articulation collision

---

## Melodic Shape Adjustment

The slur should roughly follow the contour of the melody:

| Melody shape   | Adjustment                  |
|----------------|-----------------------------|
| Ascending      | Raise the right endpoint slightly |
| Descending     | Raise the left endpoint slightly  |
| Arch-shaped    | Mirror the melodic contour        |

---

## Distance from Notes

- **Minimum clearance:** ~0.5 staff spaces between slur and nearest notehead/stem.
- Slur must **never** touch: noteheads, stems, articulations, accidentals.

---

## Endpoint Placement

Endpoints attach **near noteheads** — not to stems, beams, or flags.

| Stem direction | Endpoint attachment          |
|---------------|------------------------------|
| Stem up       | Near **top** side of notehead |
| Stem down     | Near **bottom** side of notehead |

---

## Special Cases

### Slur Over Beamed Notes
Raise the slur enough to clear the beam.

### Slur With Articulations
Articulation stays closest to the note; slur moves farther away.

- Slur above: order is `slur → articulation → note`
- Slur below: order is `note → articulation → slur`

---

## Implementation Heuristic

VexFlow sign convention used by the renderer: `direction === 1` → curve bulges **down/below**;
`direction === -1` → **up/above**.

```
1. Determine direction (priority order, first match wins) — autoDirection():
   - Voice:  upper voice → above (-1); lower voice → below (+1)
   - Phrase contour (multi-note slur, ≥3 covered notes): arc toward the side the
             interior melody pushes past the endpoint line — over a peak (above),
             under a valley (below). Skipped when near-linear (defer to stem).
   - Chord:  top head → above (-1); bottom head → below (+1)
   - Stem:   opposite the stems — stem up → below (+1); stem down → above (-1)
             (mixed: majority of notes that have a stem)
   - Whole notes / no stem: head at/above middle line → above (-1), else below (+1)
   - Fallback: above (-1)
   A manual tie.curve.direction override supersedes all of the above.

2. Find first and last notehead positions (getAbsoluteX()).

3. Create cubic Bézier curve via VexFlow StaveTie:
   - Set endpoint Y offset: ~0.5 staff spaces from noteheads
   - Set arch height via renderOptions.cp1 / cp2:
       ties: cp ≈ 6 (compact, ~tieHeight = slurHeight * 0.6)
       slur, pixel span < 60px  → cp ≈ 10  (1 staff space)
       slur, pixel span < 180px → cp ≈ 18  (1.5–2 spaces)
       slur, pixel span ≥ 180px → cp ≈ 28  (2.5–3 spaces)

4. Increase cp values further if a beam/accidental/intermediate-note collision is detected
   (content-based clearance over notes between the endpoints).

5. Ensure the curve never intersects: notes, stems, beams, articulations, dynamics.
```
