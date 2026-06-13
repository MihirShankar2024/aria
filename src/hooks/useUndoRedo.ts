import { useReducer, useCallback } from 'react'
import type { Score } from '../types/score'
import { scoreReducer } from '../state/scoreReducer'
import type { ScoreAction } from '../state/actions'

interface UndoRedoState {
  past: Score[]
  present: Score
  future: Score[]
}

type UndoRedoAction = ScoreAction | { type: 'UNDO' } | { type: 'REDO' }

function undoRedoReducer(state: UndoRedoState, action: UndoRedoAction): UndoRedoState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state
    const [newPresent, ...newPast] = [...state.past].reverse()
    return {
      past: newPast.reverse(),
      present: newPresent,
      future: [state.present, ...state.future],
    }
  }
  if (action.type === 'REDO') {
    if (state.future.length === 0) return state
    const [newPresent, ...newFuture] = state.future
    return {
      past: [...state.past, state.present],
      present: newPresent,
      future: newFuture,
    }
  }

  const newPresent = scoreReducer(state.present, action as ScoreAction)
  if (newPresent === state.present) return state
  return {
    past: [...state.past, state.present].slice(-50), // cap history at 50
    present: newPresent,
    future: [],
  }
}

export function useUndoRedo(initialScore: Score) {
  const [state, dispatch] = useReducer(undoRedoReducer, {
    past: [],
    present: initialScore,
    future: [],
  })

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [])
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [])

  return {
    score: state.present,
    dispatch,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
