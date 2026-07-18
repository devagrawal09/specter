import Fastify, { type FastifyBaseLogger, type FastifyError } from 'fastify';
import { z, type ZodType } from 'zod';
import { DomainError } from './domain/errors';
import type { WorkOrderStore } from './store';

const idSchema = z.string().regex(/^WO-[0-9]{4}$/, 'id must match WO-0000');
const paramsSchema = z.object({ id: idSchema }).strict();
const createSchema = z
  .object({ id: idSchema, title: z.string().trim().min(1).max(200) })
  .strict();
const inspectionSchema = z.object({ passed: z.boolean() }).strict();
const closeSchema = z
  .object({ requestedBy: z.string().trim().min(1).max(80).default('api') })
  .strict();

export interface AppDependencies {
  store: WorkOrderStore;
  dispatchPending?: () => Promise<unknown>;
  ready?: () => Promise<boolean>;
  logger?: boolean | { level: string } | FastifyBaseLogger;
}

function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new DomainError(400, 'INVALID_REQUEST', 'Request validation failed', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

function triggerDispatch(dispatchPending: (() => Promise<unknown>) | undefined): void {
  if (dispatchPending !== undefined) {
    void dispatchPending().catch(() => {
      // The event remains in the transactional outbox and will be retried by the interval/restart path.
    });
  }
}

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({ logger: dependencies.logger ?? false });

  app.get('/health/live', async () => ({ ok: true, data: { status: 'live' } }));

  app.get('/health/ready', async (_request, reply) => {
    const ready = (await dependencies.ready?.()) ?? true;
    return reply.code(ready ? 200 : 503).send({
      ok: ready,
      ...(ready
        ? { data: { status: 'ready' } }
        : { error: { code: 'NOT_READY', message: 'Database is not ready' } }),
    });
  });

  app.get('/work-orders', async () => ({
    ok: true,
    data: { workOrders: await dependencies.store.list() },
  }));

  // Existing reader: the close operation changes persisted state without changing this contract.
  app.get('/work-orders/:id', async (request) => {
    const { id } = parse(paramsSchema, request.params);
    const workOrder = await dependencies.store.get(id);
    if (workOrder === null) {
      throw new DomainError(404, 'WORK_ORDER_NOT_FOUND', `Work order ${id} was not found`);
    }
    return { ok: true, data: { workOrder } };
  });

  app.get('/work-orders/:id/history', async (request) => {
    const { id } = parse(paramsSchema, request.params);
    const history = await dependencies.store.history(id);
    if (history === null) {
      throw new DomainError(404, 'WORK_ORDER_NOT_FOUND', `Work order ${id} was not found`);
    }
    return { ok: true, data: { history } };
  });

  app.post('/work-orders', async (request, reply) => {
    const input = parse(createSchema, request.body);
    const workOrder = await dependencies.store.create(input);
    return reply.code(201).send({ ok: true, data: { workOrder } });
  });

  app.patch('/work-orders/:id/inspection', async (request) => {
    const { id } = parse(paramsSchema, request.params);
    const { passed } = parse(inspectionSchema, request.body);
    const workOrder = await dependencies.store.setInspection(id, passed);
    return { ok: true, data: { workOrder } };
  });

  // Legacy durable-job behavior, shared by the new close operation.
  app.post('/work-orders/:id/remind', async (request, reply) => {
    const { id } = parse(paramsSchema, request.params);
    const result = await dependencies.store.requestReminder(id);
    triggerDispatch(dependencies.dispatchPending);
    return reply.code(202).send({ ok: true, data: result });
  });

  app.post('/work-orders/:id/close', async (request) => {
    const { id } = parse(paramsSchema, request.params);
    const { requestedBy } = parse(closeSchema, request.body ?? {});
    const result = await dependencies.store.close(id, requestedBy);
    triggerDispatch(dependencies.dispatchPending);
    return { ok: true, data: result };
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      ok: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `No route for ${request.method} ${request.url}`,
      },
    }),
  );

  app.setErrorHandler((error: FastifyError | DomainError, request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    if (error.statusCode === 400 || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(400).send({
        ok: false,
        error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
      });
    }

    request.log.error({ err: error }, 'unhandled request error');
    return reply.code(500).send({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  return app;
}
