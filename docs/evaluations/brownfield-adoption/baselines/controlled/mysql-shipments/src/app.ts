import { Hono } from "hono";
import { z } from "zod";
import { AppError, normalizeError } from "./errors.js";
import type { ShipmentService } from "./service.js";

const createShipmentSchema = z.object({
  reference: z.string().trim().min(1).max(64),
  recipientName: z.string().trim().min(1).max(160),
  paymentCaptured: z.boolean(),
  inventoryAllocated: z.boolean()
}).strict();

type Dependencies = {
  service: ShipmentService;
  readiness: () => Promise<{ mysql: "up"; redis: "up" }>;
};

const success = <T>(data: T) => ({ ok: true as const, data });
const failure = (error: AppError) => ({
  ok: false as const,
  error: {
    code: error.code,
    message: error.message,
    ...(error.details === undefined ? {} : { details: error.details })
  }
});

export function createApp(dependencies: Dependencies): Hono {
  const app = new Hono();

  app.get("/health/live", (context) => context.json(success({ status: "up" })));
  app.get("/health/ready", async (context) => {
    try {
      return context.json(success({ status: "ready", dependencies: await dependencies.readiness() }));
    } catch {
      return context.json({ ok: false, error: { code: "NOT_READY", message: "A required dependency is unavailable" } }, 503);
    }
  });

  app.get("/shipments", async (context) => context.json(success({ shipments: await dependencies.service.list() })));
  app.get("/shipments/:id", async (context) => context.json(success({ shipment: await dependencies.service.get(context.req.param("id")) })));
  app.get("/shipments/:id/history", async (context) => context.json(success({ history: await dependencies.service.history(context.req.param("id")) })));

  app.post("/shipments", async (context) => {
    let raw: unknown;
    try {
      raw = await context.req.json();
    } catch {
      throw new AppError(400, "BAD_JSON", "Request body must be valid JSON");
    }
    const parsed = createShipmentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request body is invalid", parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      })));
    }
    return context.json(success({ shipment: await dependencies.service.create(parsed.data) }), 201);
  });

  app.post("/shipments/:id/dispatch", async (context) => {
    const result = await dependencies.service.dispatch(context.req.param("id"));
    return context.json(success(result));
  });

  app.notFound((context) => context.json(failure(new AppError(404, "NOT_FOUND", "Route not found")), 404));
  app.onError((rawError, context) => {
    const error = normalizeError(rawError);
    return context.json(failure(error), error.status);
  });
  return app;
}
