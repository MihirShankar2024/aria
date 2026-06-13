import { createDefaultScore } from '../state/scoreReducer'
import { useUndoRedo } from './useUndoRedo'
import { getMeasureCount } from '../state/selectors'

export function useScore() {
  const { score, dispatch, undo, redo, canUndo, canRedo } = useUndoRedo(createDefaultScore())
  return { score, dispatch, undo, redo, canUndo, canRedo, measureCount: getMeasureCount(score) }
}
