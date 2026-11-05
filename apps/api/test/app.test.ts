import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Dependencies } from '../src/app.js';
import { buildApp } from '../src/app.js';

const healthyDependencies = (state = { postgresChecks: 0 }): Dependencies => ({
  async checkPostgres() {
    state.postgresChecks += 1;
  },
  async checkRedis() {},
  aiClient: {
    async ready() {
      return { status: 'ok', service: 'ai-service', version: '0.1.0' };
    },
  },
  async close() {},
});

describe('service probes', () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('reports liveness without dependency checks', async () => {
    const state = { postgresChecks: 0 };
    const app = await buildApp(undefined, healthyDependencies(state));
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.equal(state.postgresChecks, 0);
  });

  it('reports readiness when all dependencies respond', async () => {
    const app = await buildApp(undefined, healthyDependencies());
    apps.push(app);
    assert.equal((await app.inject({ method: 'GET', url: '/ready' })).statusCode, 200);
  });

  it('reports unavailable when a dependency fails', async () => {
    const dependencies = healthyDependencies();
    dependencies.checkPostgres = async () => {
      throw new Error('database unavailable');
    };
    const app = await buildApp(undefined, dependencies);
    apps.push(app);
    assert.equal((await app.inject({ method: 'GET', url: '/ready' })).statusCode, 503);
  });
});
