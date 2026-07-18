import request from "supertest";
import { expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";

const service = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  receive: vi.fn(),
  inspect: vi.fn(),
  approveRefund: vi.fn(),
};

it("returns a focused stable 400 envelope for malformed JSON", async () => {
  const response = await request(createApp(service))
    .post("/returns")
    .set("Content-Type", "application/json")
    .send('{"orderId":')
    .expect(400);

  expect(response.body).toEqual({
    ok: false,
    error: {
      code: "MALFORMED_JSON",
      message: "Request body contains malformed JSON.",
    },
  });
  expect(service.create).not.toHaveBeenCalled();
});
