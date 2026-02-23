process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/socialclaw';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-123';

import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app';
import { closePool } from '../src/db/client';

describe('api integration', () => {
  const app = buildApp();
  const token = jwt.sign({ sub: 'user_1', tenantId: 'tenant_1', role: 'owner' }, process.env.JWT_SECRET as string);

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closePool().catch(() => undefined);
  });

  it('serves health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('rejects missing auth for protected route', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'A', slug: 'a' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts authenticated request and reaches schema validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    expect([400, 422]).toContain(res.statusCode);
  });
});
