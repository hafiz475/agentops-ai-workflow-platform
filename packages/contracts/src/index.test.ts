import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { serviceStatusSchema } from './index.js';

describe('serviceStatusSchema', () => {
  it('rejects an invalid service response', () => {
    assert.throws(() => serviceStatusSchema.parse({ status: 'maybe' }));
  });
});
