import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionsForRole, buildCatalogRoleMatrix, PERMISSION_CATALOG } from './permissionCatalog.js';
import { getHrDefaultManagementMenuKeys } from './navMenuCatalog.js';

describe('default permission matrix policy', () => {
  it('HR does not receive management Project/Task grants', () => {
    const matrix = buildCatalogRoleMatrix();
    assert.deepEqual(matrix.HR['projects.view'] ?? [], []);
    assert.deepEqual(matrix.HR['projects.create'] ?? [], []);
    assert.deepEqual(matrix.HR['projects.delete'] ?? [], []);
    assert.deepEqual(matrix.HR['tasks.assign'] ?? [], []);
    // Self-service My Project remains.
    assert.ok((matrix.HR['projects.self.view'] ?? []).includes('view'));
  });

  it('HR does not receive Administration grants', () => {
    const matrix = buildCatalogRoleMatrix();
    assert.deepEqual(matrix.HR['users.manage'] ?? [], []);
    assert.deepEqual(matrix.HR['users.view'] ?? [], []);
    assert.deepEqual(matrix.HR['permissions.view'] ?? [], []);
    assert.deepEqual(matrix.HR['settings.view'] ?? [], []);
    assert.deepEqual(matrix.HR['audit.view'] ?? [], []);
  });

  it('Manager keeps project portfolio grants', () => {
    const matrix = buildCatalogRoleMatrix();
    assert.ok((matrix.MANAGER['projects.view'] ?? []).includes('view'));
    assert.ok((matrix.MANAGER['projects.create'] ?? []).includes('create'));
  });

  it('HR inherent management menus exclude Projects portfolio', () => {
    const keys = getHrDefaultManagementMenuKeys();
    assert.equal(
      keys.some((k) => k.includes('/projects') && k.includes('scope=manage')),
      false
    );
    assert.ok(keys.some((k) => k.includes('/payroll')));
  });

  it('actionsForRole strips HR project keys even if catalog entry listed HR historically', () => {
    const entry = PERMISSION_CATALOG.find((p) => p.key === 'projects.view');
    assert.ok(entry);
    const actions = actionsForRole(entry!, 'HR');
    assert.equal(actions == null || actions.length === 0, true);
  });
});
