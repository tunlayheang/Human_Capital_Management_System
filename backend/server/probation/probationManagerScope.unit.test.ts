import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  managerCanSeeAssignedProbation,
  managerParticipatedInProbationOutcome,
} from './probationManagerScope.js';

describe('manager probation assignment scope', () => {
  it('allows the current assigned evaluator', () => {
    assert.equal(
      managerCanSeeAssignedProbation({
        actorUserId: 'u-mgr',
        assignedManagerUserId: 'u-mgr',
        canManagerEdit: true,
      }),
      true
    );
  });

  it('allows prior evaluators in the chain', () => {
    assert.equal(
      managerCanSeeAssignedProbation({
        actorUserId: 'u-mgr',
        assignedEvaluatorUserIds: ['u-mgr', 'u-2'],
      }),
      true
    );
  });

  it('denies department-wide visibility without assignment', () => {
    assert.equal(
      managerCanSeeAssignedProbation({
        actorUserId: 'u-mgr',
        assignedManagerUserId: 'u-other',
        assignedEvaluatorUserIds: ['u-other'],
      }),
      false
    );
  });

  it('scopes outcome totals to reviews the manager participated in', () => {
    assert.equal(
      managerParticipatedInProbationOutcome({
        actorUserId: 'u-mgr',
        managerSubmittedBy: 'u-mgr',
      }),
      true
    );
    assert.equal(
      managerParticipatedInProbationOutcome({
        actorUserId: 'u-mgr',
        assignedManagerUserId: 'u-other',
        managerSubmittedBy: null,
        outcomePayloadJson: null,
      }),
      false
    );
  });
});
