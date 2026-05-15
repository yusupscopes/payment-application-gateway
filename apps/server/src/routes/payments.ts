import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { PaymentGateway } from "../core/payment-gateway.js";

const providerNameSchema = z.enum(["stripe", "midtrans", "xendit"]);

const chargeSchema = z.object({
  provider: providerNameSchema,
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  paymentMethod: z.string().min(1),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  customerId: z.string().optional(),
});

const refundSchema = z.object({
  provider: providerNameSchema,
  transactionId: z.string().min(1),
  amount: z.number().positive().optional(),
  reason: z.string().optional(),
});

const verifySchema = z.object({
  provider: providerNameSchema,
  transactionId: z.string().min(1),
});

export function createPaymentRoutes(gateway: PaymentGateway) {
  const app = new Hono();

  app.post("/charge", zValidator("json", chargeSchema), async (c) => {
    const payload = c.req.valid("json");
    const result = await gateway.charge(payload);
    return c.json(result, result.success ? 200 : 502);
  });

  app.post("/refund", zValidator("json", refundSchema), async (c) => {
    const payload = c.req.valid("json");
    const result = await gateway.refund(payload);
    return c.json(result, result.success ? 200 : 502);
  });

  app.post("/verify", zValidator("json", verifySchema), async (c) => {
    const payload = c.req.valid("json");
    const result = await gateway.verify(payload);
    return c.json(result, result.success ? 200 : 502);
  });

  return app;
}
