import { useCallback, useReducer } from 'react';
import type { RosterGrid } from '../utils/rosterGrid';

function cloneGrid(g: RosterGrid): RosterGrid {
  return JSON.parse(JSON.stringify(g)) as RosterGrid;
}

type State = { stack: RosterGrid[]; index: number };

type Action =
  | { type: 'reset'; grid: RosterGrid }
  | { type: 'push'; grid: RosterGrid }
  | { type: 'undo' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset': {
      const grid = cloneGrid(action.grid);
      return { stack: [grid], index: 0 };
    }
    case 'push': {
      const grid = cloneGrid(action.grid);
      const stack = [...state.stack.slice(0, state.index + 1), grid];
      return { stack, index: stack.length - 1 };
    }
    case 'undo':
      if (state.index <= 0) return state;
      return { ...state, index: state.index - 1 };
    default:
      return state;
  }
}

/** Undo stack for roster paint edits (reliable index + stack sync). */
export function useRosterGridHistory(initialGrid: RosterGrid) {
  const [state, dispatch] = useReducer(reducer, {
    stack: [cloneGrid(initialGrid)],
    index: 0,
  });

  const rosterData = state.stack[state.index] ?? state.stack[0];

  const resetHistory = useCallback((grid: RosterGrid) => {
    dispatch({ type: 'reset', grid });
  }, []);

  const pushHistory = useCallback((grid: RosterGrid) => {
    dispatch({ type: 'push', grid });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'undo' });
  }, []);

  const canUndo = state.index > 0;

  return { rosterData, pushHistory, undo, canUndo, resetHistory };
}
