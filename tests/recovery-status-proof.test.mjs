import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryEvidenceStatus } from '../utility/portabase-core.mjs';

const layers = { database: { verified: true }, storage: { verified: true }, functions: { verified: true } };
test('inventory verification cannot claim restored storage for full, selective or drill recovery', () => {
  for (const mode of ['execute', 'limited-drill']) {
    for (const restorePlan of [undefined, {}]) {
      for (const storage of [
        { verified: true, destination: 'inventory-only' },
        { verified: true, storageServingRestored: false },
      ]) assert.equal(recoveryEvidenceStatus({ ...layers, mode, captureStatus: 'COMPLETE', restorePlan, storage }), 'FAILED');
    }
  }
  assert.equal(recoveryEvidenceStatus({ ...layers, mode: 'execute', captureStatus: 'COMPLETE',
    storage: { verified: true, destination: 's3', storageServingRestored: false } }), 'DATABASE_RESTORED_OBJECTS_IN_S3');
});

test('recovery proof requires explicit boolean verification from every layer', () => {
  for (const layer of ['database', 'storage', 'functions']) {
    for (const verified of ['false', 'true', 1, {}, []]) {
      assert.equal(recoveryEvidenceStatus({ ...layers, mode: 'execute', captureStatus: 'COMPLETE', [layer]: { verified } }), 'FAILED');
    }
  }
});
