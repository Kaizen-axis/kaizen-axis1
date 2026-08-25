import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGoalVisibleToUser,
  normalizeScopeType,
  resolveAssigneeLabel,
  resolveDirectorateIdForTarget,
} from './scopeTarget.ts';

describe('normalizeScopeType', () => {
  it('maps aliases to canonical scope values', () => {
    assert.equal(normalizeScopeType(undefined), 'All');
    assert.equal(normalizeScopeType('global'), 'All');
    assert.equal(normalizeScopeType('Diretoria'), 'Directorate');
    assert.equal(normalizeScopeType('equipe'), 'Team');
    assert.equal(normalizeScopeType('Coordenação'), 'Coordinator');
    assert.equal(normalizeScopeType('individual'), 'User');
  });
});

describe('resolveAssigneeLabel', () => {
  const catalogs = {
    directorates: [{ id: 'dir-1', name: 'Sul' }],
    teams: [{ id: 'team-1', name: 'Leão' }],
    profiles: [{ id: 'u-1', name: 'Ana', role: 'CORRETOR' }, { id: 'c-1', name: 'Carla', role: 'COORDENADOR' }],
  };

  it('labels global, org and person targets', () => {
    assert.equal(resolveAssigneeLabel({ assignee_type: 'All' }, catalogs), 'Global');
    assert.equal(resolveAssigneeLabel({ assignee_type: 'Directorate', assignee_id: 'dir-1' }, catalogs), 'Sul');
    assert.equal(resolveAssigneeLabel({ directorate_id: 'dir-1' }, catalogs), 'Sul');
    assert.equal(resolveAssigneeLabel({ assignee_type: 'Team', assignee_id: 'team-1' }, catalogs), 'Leão');
    assert.equal(resolveAssigneeLabel({ assignee_type: 'Coordinator', assignee_id: 'c-1' }, catalogs), 'Coordenação · Carla');
    assert.equal(resolveAssigneeLabel({ assignee_type: 'User', assignee_id: 'u-1' }, catalogs), 'Ana');
  });
});

describe('resolveDirectorateIdForTarget', () => {
  const catalogs = {
    teams: [{ id: 'team-1', name: 'Leão', directorate_id: 'dir-2' }],
    profiles: [{ id: 'u-1', name: 'Ana', directorate_id: 'dir-3' }],
    fallbackDirectorateId: 'dir-fallback',
  };

  it('keeps global empty for admin and inherits entity directorate otherwise', () => {
    assert.equal(resolveDirectorateIdForTarget({ type: 'All' }, { ...catalogs, fallbackDirectorateId: null }), null);
    assert.equal(resolveDirectorateIdForTarget({ type: 'All' }, catalogs), 'dir-fallback');
    assert.equal(resolveDirectorateIdForTarget({ type: 'Directorate', id: 'dir-1' }, catalogs), 'dir-1');
    assert.equal(resolveDirectorateIdForTarget({ type: 'Team', id: 'team-1' }, catalogs), 'dir-2');
    assert.equal(resolveDirectorateIdForTarget({ type: 'User', id: 'u-1' }, catalogs), 'dir-3');
  });
});

describe('isGoalVisibleToUser', () => {
  const ctx = {
    userId: 'u-1',
    directorateId: 'dir-1',
    teamIds: ['team-1'],
    coordinatorId: 'c-1',
  };

  it('shows the right goals for each assignee type', () => {
    assert.equal(isGoalVisibleToUser({ assignee_type: 'All' }, ctx), true);
    assert.equal(isGoalVisibleToUser({ assignee_type: 'User', assignee_id: 'u-1' }, ctx), true);
    assert.equal(isGoalVisibleToUser({ assignee_type: 'User', assignee_id: 'other' }, ctx), false);
    assert.equal(isGoalVisibleToUser({ assignee_type: 'Team', assignee_id: 'team-1' }, ctx), true);
    assert.equal(isGoalVisibleToUser({ assignee_type: 'Directorate', assignee_id: 'dir-1' }, ctx), true);
    assert.equal(isGoalVisibleToUser({ assignee_type: 'Directorate', assignee_id: 'dir-2' }, ctx), false);
    assert.equal(isGoalVisibleToUser({ assignee_type: 'Coordinator', assignee_id: 'c-1' }, ctx), true);
    assert.equal(isGoalVisibleToUser({ assignee_type: 'Coordinator', assignee_id: 'u-1' }, ctx), true);
    assert.equal(isGoalVisibleToUser({ assignee_type: 'Coordinator', assignee_id: 'c-9' }, ctx), false);
  });
});
