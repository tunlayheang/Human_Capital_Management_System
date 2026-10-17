import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreTaskCompletionFromTasks } from './taskKpiCalculator.js';

describe('scoreTaskCompletionFromTasks', () => {
  it('returns 100 when no tasks are assigned', () => {
    const result = scoreTaskCompletionFromTasks([], '2026-03-31');
    assert.equal(result.score, 100);
    assert.equal(result.breakdown.assigned, 0);
  });

  it('counts completed tasks before due date as on time', () => {
    const result = scoreTaskCompletionFromTasks(
      [
        { status: 'DONE', dueDate: '2026-02-15', updatedAt: '2026-02-10' },
        { status: 'DONE', dueDate: '2026-02-20', updatedAt: '2026-02-25' },
      ],
      '2026-03-31'
    );
    assert.equal(result.breakdown.assigned, 2);
    assert.equal(result.breakdown.completed, 2);
    assert.equal(result.breakdown.completedOnTime, 1);
    assert.equal(result.score, 50);
  });

  it('penalizes open overdue tasks', () => {
    const result = scoreTaskCompletionFromTasks(
      [
        { status: 'TODO', dueDate: '2026-02-01', updatedAt: null },
        { status: 'DONE', dueDate: '2026-02-28', updatedAt: '2026-02-20' },
      ],
      '2026-03-31'
    );
    assert.equal(result.breakdown.overdue, 1);
    assert.equal(result.breakdown.completedOnTime, 1);
    assert.equal(result.score, 45);
  });

  it('treats a task at 100% progress as completed even when status lags', () => {
    const result = scoreTaskCompletionFromTasks(
      [{ status: 'IN_PROGRESS', dueDate: '2026-02-28', updatedAt: '2026-02-20', progress: 100 }],
      '2026-03-31'
    );
    assert.equal(result.breakdown.completed, 1);
    assert.equal(result.breakdown.completedOnTime, 1);
    assert.equal(result.breakdown.overdue, 0);
    assert.equal(result.score, 100);
  });

  it('does not count a sub-100% in-progress task as done, and flags it overdue', () => {
    const result = scoreTaskCompletionFromTasks(
      [{ status: 'IN_PROGRESS', dueDate: '2026-02-01', updatedAt: '2026-02-01', progress: 80 }],
      '2026-03-31'
    );
    assert.equal(result.breakdown.completed, 0);
    assert.equal(result.breakdown.overdue, 1);
    assert.equal(result.score, 0);
  });
});
