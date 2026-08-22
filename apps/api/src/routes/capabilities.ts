import { CAPABILITIES, CapabilitiesResponseSchema } from "@opentrad/contracts";
import type { FastifyInstance } from "fastify";

export function registerCapabilitiesRoute(app: FastifyInstance): void {
  const response = CapabilitiesResponseSchema.parse({ capabilities: CAPABILITIES });
  app.get("/api/v1/capabilities", async () => response);
}
