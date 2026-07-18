import express, { ErrorRequestHandler, RequestHandler } from "express";
import { z, ZodError } from "zod";
import { AppError } from "./errors.js";
import { ReturnService } from "./services/return-service.js";

const createReturnSchema = z
  .object({
    orderId: z.string().trim().min(1).max(80),
    customerId: z.string().trim().min(1).max(80),
    itemSku: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(500),
    refundAmountCents: z.number().int().positive().max(10_000_000),
  })
  .strict();
const inspectionSchema = z.object({ outcome: z.enum(["accepted", "rejected"]) }).strict();
const emptyBodySchema = z.object({}).strict();

type AsyncHandler = (request: express.Request, response: express.Response) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (request, response, next) => {
  void handler(request, response).catch(next);
};
const routeId = (value: string | string[] | undefined): string =>
  typeof value === "string" ? value : "";

export function createApp(
  service: Pick<ReturnService, "list" | "get" | "create" | "receive" | "inspect" | "approveRefund">,
  readiness: () => Promise<void> = async () => undefined,
): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get(
    "/health",
    asyncRoute(async (_request, response) => {
      try {
        await readiness();
        response.status(200).json({ ok: true, data: { status: "ready" } });
      } catch {
        response.status(503).json({
          ok: false,
          error: { code: "NOT_READY", message: "A required dependency is unavailable." },
        });
      }
    }),
  );

  app.get(
    "/returns",
    asyncRoute(async (_request, response) => {
      response.status(200).json({ ok: true, data: { returns: await service.list() } });
    }),
  );

  app.get(
    "/returns/:id",
    asyncRoute(async (request, response) => {
      response.status(200).json({ ok: true, data: { return: await service.get(routeId(request.params.id)) } });
    }),
  );

  app.post(
    "/returns",
    asyncRoute(async (request, response) => {
      const input = createReturnSchema.parse(request.body);
      response.status(201).json({ ok: true, data: { return: await service.create(input) } });
    }),
  );

  app.post(
    "/returns/:id/receive",
    asyncRoute(async (request, response) => {
      emptyBodySchema.parse(request.body ?? {});
      response.status(200).json({
        ok: true,
        data: { return: await service.receive(routeId(request.params.id)) },
      });
    }),
  );

  app.post(
    "/returns/:id/inspect",
    asyncRoute(async (request, response) => {
      const { outcome } = inspectionSchema.parse(request.body);
      response.status(200).json({
        ok: true,
        data: { return: await service.inspect(routeId(request.params.id), outcome) },
      });
    }),
  );

  app.post(
    "/returns/:id/approve-refund",
    asyncRoute(async (request, response) => {
      emptyBodySchema.parse(request.body ?? {});
      response.status(200).json({ ok: true, data: await service.approveRefund(routeId(request.params.id)) });
    }),
  );

  app.use((_request, _response, next) => {
    next(new AppError(404, "ROUTE_NOT_FOUND", "Route was not found."));
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof SyntaxError && "type" in error && error.type === "entity.parse.failed") {
      response.status(400).json({
        ok: false,
        error: { code: "MALFORMED_JSON", message: "Request body contains malformed JSON." },
      });
      return;
    }
    if (error instanceof ZodError) {
      response.status(400).json({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      });
      return;
    }
    if (error instanceof AppError) {
      response.status(error.status).json({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }
    console.error("unhandled request error", error);
    response.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
  };
  app.use(errorHandler);

  return app;
}
