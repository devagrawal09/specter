import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { MemoryStore } from './fakes';

describe('public HTTP contract', () => {
  let store: MemoryStore;
  let app: ReturnType<typeof buildApp>;
  const dispatch = vi.fn(async () => undefined);

  beforeEach(() => {
    store = new MemoryStore();
    dispatch.mockClear();
    app = buildApp({ store, dispatchPending: dispatch });
  });

  afterEach(async () => {
    await app.close();
  });

  it('closes an eligible work order and the unchanged reader observes it', async () => {
    const before = await app.inject({ method: 'GET', url: '/work-orders/WO-1001' });
    expect(before.statusCode).toBe(200);
    expect(before.json().data.workOrder.status).toBe('in_progress');

    const response = await app.inject({
      method: 'POST',
      url: '/work-orders/WO-1001/close',
      payload: { requestedBy: 'route-test' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        eventId: '00000000-0000-4000-8000-000000000001',
        workOrder: {
          id: 'WO-1001',
          title: 'Fixture WO-1001',
          status: 'closed',
          inspectionPassed: true,
          closedAt: '2025-02-01T12:00:00.000Z',
          version: 2,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-02-01T12:00:00.000Z',
        },
      },
    });

    const after = await app.inject({ method: 'GET', url: '/work-orders/WO-1001' });
    expect(after.json().data.workOrder).toEqual(response.json().data.workOrder);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it.each([
    ['WO-1002', 'INVALID_STATUS'],
    ['WO-1003', 'INSPECTION_REQUIRED'],
    ['WO-1004', 'ALREADY_CLOSED'],
    ['WO-1005', 'INVALID_STATUS'],
  ])('returns a stable conflict for %s', async (id, code) => {
    const response = await app.inject({ method: 'POST', url: `/work-orders/${id}/close`, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ ok: false, error: { code } });
  });

  it('maps missing records to the stable 404 envelope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/work-orders/WO-9999/close',
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'WORK_ORDER_NOT_FOUND', message: 'Work order WO-9999 was not found' },
    });
  });

  it('maps malformed JSON to the stable 400 envelope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/work-orders/WO-1001/close',
      headers: { 'content-type': 'application/json' },
      payload: '{"requestedBy":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
    });
  });

  it('validates ids and bodies at runtime', async () => {
    const badId = await app.inject({ method: 'GET', url: '/work-orders/not-an-id' });
    expect(badId.statusCode).toBe(400);
    expect(badId.json()).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });

    const extraField = await app.inject({
      method: 'POST',
      url: '/work-orders/WO-1001/close',
      payload: { unexpected: true },
    });
    expect(extraField.statusCode).toBe(400);
    expect(extraField.json()).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('keeps the other public operations available', async () => {
    expect((await app.inject({ method: 'GET', url: '/work-orders' })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/work-orders',
          payload: { id: 'WO-1010', title: 'New work' },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/work-orders/WO-1010/inspection',
          payload: { passed: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/work-orders/WO-1010/remind' })).statusCode,
    ).toBe(202);
    expect(
      (await app.inject({ method: 'GET', url: '/work-orders/WO-1010/history' })).statusCode,
    ).toBe(200);
  });

  it('reports stable degraded readiness when a runtime dependency is unavailable', async () => {
    await app.close();
    app = buildApp({ store, ready: async () => false });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'NOT_READY', message: 'Database is not ready' },
    });
  });
});
