# Lessons

## StaffCanvas keydown handler: register-once effect → use refs for live props
The window `keydown` handler in `src/components/editor/StaffCanvas.tsx` is registered in a
`useEffect(..., [])` that runs once. Any prop/state it reads **directly** is captured from the
first render and goes stale (e.g. `measures` is empty at mount). Symptom: `isMeasureFull` read
the stale empty measure, so `full` was always `false` and the cursor parked on a dead end slot
in already-full bars ("dead gap, only going forward").

Fix pattern (already used for `layout`, `hoverInfo`, `keyboardCursor`, `placeAt`): mirror the
prop into a ref updated every render (`const fooRef = useRef(foo); fooRef.current = foo`) and
read `fooRef.current` inside the handler. Added `measuresRef` / `timeSigRef` for this.

When adding logic to that handler, never reference `measures`, `timeSig`, or other props
directly — always go through a `*.current` ref.
