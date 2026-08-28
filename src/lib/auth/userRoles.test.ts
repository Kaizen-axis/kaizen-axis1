import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getReceptionUnitCode,
  getUserRoleLabel,
  isReceptionRole,
  normalizeUserRole,
  USER_ROLE_OPTIONS,
} from './userRoles.ts';

describe('user role catalog', () => {
  it('maps each reception role to its fixed unit', () => {
    assert.equal(getReceptionUnitCode('RECEPCAO'), 'zona_oeste');
    assert.equal(getReceptionUnitCode('recepcao_zn'), 'zona_norte');
    assert.equal(getReceptionUnitCode('GERENTE'), null);
  });

  it('recognizes both reception roles and exposes the new option', () => {
    assert.equal(isReceptionRole('RECEPCAO'), true);
    assert.equal(isReceptionRole('RECEPCAO_ZN'), true);
    assert.equal(isReceptionRole('CORRETOR'), false);
    assert.equal(USER_ROLE_OPTIONS.some(option => option.value === 'RECEPCAO_ZN'), true);
    assert.equal(getUserRoleLabel('RECEPCAO_ZN'), 'RECEPÇÃO ZN');
  });

  it('normalizes known roles and safely defaults unknown values', () => {
    assert.equal(normalizeUserRole(' recepcao_zn '), 'RECEPCAO_ZN');
    assert.equal(normalizeUserRole('cargo_invalido'), 'CORRETOR');
  });
});
