import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTeamMemberIds, isActiveProfile } from './teamMembers.ts';

const team = { id: 'team-leao', name: 'LEÃO', manager_id: 'mgr-1', members: ['old-1', 'old-2', 'broker-1'] };

describe('isActiveProfile', () => {
  it('accepts active and Ativo', () => {
    assert.equal(isActiveProfile({ status: 'active' }), true);
    assert.equal(isActiveProfile({ status: 'Ativo' }), true);
    assert.equal(isActiveProfile({ status: 'inactive' }), false);
    assert.equal(isActiveProfile({ status: 'Inativo' }), false);
  });
});

describe('getTeamMemberIds', () => {
  it('counts only active people currently on the team', () => {
    const profiles = [
      { id: 'mgr-1', role: 'GERENTE', status: 'Ativo', team_id: 'team-leao' },
      { id: 'coord-1', role: 'COORDENADOR', status: 'active', team_id: 'team-leao', manager_id: 'mgr-1' },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `broker-${i + 1}`,
        role: 'CORRETOR',
        status: 'Ativo',
        team_id: 'team-leao',
        manager_id: 'mgr-1',
        coordinator_id: 'coord-1',
      })),
      { id: 'old-1', role: 'CORRETOR', status: 'Inativo', team_id: 'team-leao' },
      { id: 'other-team', role: 'CORRETOR', status: 'Ativo', team_id: 'other', manager_id: 'mgr-1' },
    ];
    const ids = getTeamMemberIds(team, profiles);
    assert.equal(ids.length, 9);
    assert.equal(ids.includes('old-1'), false);
    assert.equal(ids.includes('other-team'), false);
  });
});
