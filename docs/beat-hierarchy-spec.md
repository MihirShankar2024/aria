# Beat Hierarchy and Rhythmic Decomposition Rules

> Reference chart for metric hierarchy and duration decomposition. Used by the tie/slur
> engine and intended for future quantization / AI features. See also
> [tie-rules-spec.md](./tie-rules-spec.md) and [notation-engraving-spec.md](./notation-engraving-spec.md).

## Purpose

When a duration cannot be represented by a single readable note value, it must be decomposed according to the beat hierarchy of the current meter.

The goal is not to minimize symbols.

The goal is to make the beat structure immediately visible to a performer.

Professional notation software follows this principle.

---

# Hierarchy of Priorities

When notating a duration:

1. Preserve measure boundaries.
2. Preserve primary beat boundaries.
3. Preserve secondary beat boundaries.
4. Minimize ties.
5. Use largest readable note values.

Readability always takes precedence over note count.

---

# Meter Hierarchy Definitions

## Simple Meter

Beat divides into 2.

Examples:

2/4
3/4
4/4

Beat unit = quarter note

Subdivision = eighths, sixteenths

---

## Compound Meter

Beat divides into 3.

Examples:

6/8
9/8
12/8

Beat unit = dotted quarter

Subdivision = eighths

---

# 2/4 Hierarchy

Structure:

Beat 1 | Beat 2

Strong | Weak

Subdivision:

1 & | 2 &

---

## Preferred Grouping

Eighth notes:

[1&] [2&]

Sixteenth notes:

[1e&a] [2e&a]

Never beam across the midpoint of the measure.

---

# 3/4 Hierarchy

Structure:

Beat 1 | Beat 2 | Beat 3

Strong | Weak | Weak

Subdivision:

1 & | 2 & | 3 &

---

## Preferred Grouping

Eighth notes:

[1&] [2&] [3&]

Sixteenth notes:

[1e&a] [2e&a] [3e&a]

Do not beam across beats.

---

# 4/4 Hierarchy

Structure:

Beat 1 | Beat 2 | Beat 3 | Beat 4

Strong | Weak | Medium | Weak

Subdivision:

1 & | 2 & | 3 & | 4 &

Secondary division:

1-2 | 3-4

---

## Preferred Grouping

Eighth notes:

[1&] [2&] [3&] [4&]

Sixteenth notes:

[1e&a] [2e&a] [3e&a] [4e&a]

Never create a single beam across the entire measure.

---

# 6/8 Hierarchy

Structure:

(1 2 3) | (4 5 6)

Strong | Weak

Beat unit:

Dotted quarter

Subdivision:

Three eighth notes

---

## Preferred Grouping

[123] [456]

Do not group:

[12][34][56]

This incorrectly suggests simple meter.

---

# 9/8 Hierarchy

Structure:

(123) | (456) | (789)

Strong | Weak | Weak

---

## Preferred Grouping

[123] [456] [789]

---

# 12/8 Hierarchy

Structure:

(123) | (456) | (789) | (101112)

Strong | Weak | Medium | Weak

---

## Preferred Grouping

[123] [456] [789] [101112]

---

# Duration Decomposition Algorithm

For every note duration:

Step 1:
Determine total duration.

Step 2:
Determine current meter hierarchy.

Step 3:
Check if duration crosses:

* Measure boundary
* Strong beat boundary
* Secondary beat boundary

Step 4:
Split duration at those boundaries.

Step 5:
Use ties to reconnect resulting segments.

---

# Example: 4/4

Starting position:

Beat 1

Duration:

1.5 beats

Preferred:

Dotted quarter

Reason:

No important boundary is crossed.

---

# Example: 4/4

Starting position:

Beat 2

Duration:

1.5 beats

Acceptable:

Dotted quarter

because it ends exactly on beat 4.

---

# Example: 4/4

Starting position:

Beat 2.5

Duration:

2 beats

Crosses beat 3 and beat 4.

Preferred:

Eighth tied to quarter tied to eighth

Not:

Half note

Reason:

Beat structure becomes visible.

---

# Example: 4/4

Starting position:

Beat 4

Duration:

1.5 beats

Crosses barline.

Preferred:

Quarter tied to eighth

Not:

Dotted quarter

---

# Example: 6/8

Starting position:

Eighth 2

Duration:

4 eighths

Crosses compound beat boundary.

Preferred:

Two eighths tied to dotted quarter

Not:

Single dotted half subdivision.

---

# Dotted Note Decision Rules

Use a dotted note when:

1. Duration remains inside a beat group.
2. Duration does not obscure strong beats.
3. Duration does not cross a measure boundary.

Otherwise use ties.

---

# Tie Decision Rules

Use ties when:

1. Crossing a measure boundary.
2. Crossing a strong beat boundary.
3. Crossing a compound beat boundary.
4. Crossing a major subdivision boundary.

Ties are preferred over confusing dotted values.

---

# Rest Decomposition Algorithm

Apply the same hierarchy used for notes.

Silence should reveal beat structure.

---

## Example

4/4

Entire beat silent:

Four sixteenth rests

Convert to:

Quarter rest

---

## Example

Half beat silent:

Two sixteenth rests

Convert to:

Eighth rest

---

## Example

Silence across beats 2 and 3

Avoid:

Half rest

Prefer:

Quarter rest + Quarter rest

because beat locations remain visible.

---

# Quantization Output Rules

After transcription:

1. Determine exact duration.
2. Quantize duration.
3. Decompose according to meter hierarchy.
4. Create ties where required.
5. Consolidate rests where allowed.
6. Beam according to beat groups.
7. Validate measure duration.

This process should occur before rendering.

---

# Examples of Professional Notation Preferences

Preferred:

Quarter tied to eighth

instead of:

Dotted quarter crossing a strong beat

---

Preferred:

Quarter rest + Quarter rest

instead of:

Half rest spanning strong beats

---

Preferred:

[1&] [2&] [3&] [4&]

instead of:

[1&2&3&4&]

---

Preferred:

[123] [456]

instead of:

[12][34][56]

in 6/8.

---

# Golden Rule

If two notations are mathematically equivalent:

Choose the version that most clearly reveals the beat hierarchy of the meter.
