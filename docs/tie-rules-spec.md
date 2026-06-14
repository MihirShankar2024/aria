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
