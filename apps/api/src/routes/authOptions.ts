import { AuthOptionsResponseSchema } from "@opentrad/contracts";
import type { FastifyInstance } from "fastify";

export function registerAuthOptionsRoute(app: FastifyInstance, githubEnabled: boolean): void {
  const response = AuthOptionsResponseSchema.parse({ githubEnabled });
  app.get("/api/v1/auth-options", async () => response);
}
