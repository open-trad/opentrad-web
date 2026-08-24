import {
  type RegisterRequest,
  RegisterRequestSchema,
  RegistrationResponseSchema,
} from "@opentrad/contracts";
import type { FastifyInstance } from "fastify";
import { createInternalEmailAlias } from "../auth/auth.js";
import { applyAuthResponseHeaders } from "../auth/fastifyHandler.js";

const REGISTER_BODY_LIMIT = 4 * 1_024;
const intrinsicBufferToString = Buffer.prototype.toString;
const intrinsicJsonParse = JSON.parse;
const intrinsicReflectApply = Reflect.apply;
const intrinsicStringStartsWith = String.prototype.startsWith;

export interface RegistrationAuthRuntime {
  readonly api: {
    readonly signUpEmail: (input: {
      body: {
        email: string;
        name: string;
        password: string;
        username: string;
      };
      returnHeaders: true;
    }) => Promise<{
      headers: Headers;
      response: { user: { id: string } };
    }>;
  };
}

function parseRegistrationBody(value: unknown): RegisterRequest | undefined {
  try {
    if (
      !Buffer.isBuffer(value) ||
      value.byteLength === 0 ||
      value.byteLength > REGISTER_BODY_LIMIT
    ) {
      return undefined;
    }
    const text = intrinsicReflectApply(intrinsicBufferToString, value, ["utf8"]) as string;
    return RegisterRequestSchema.parse(intrinsicReflectApply(intrinsicJsonParse, JSON, [text]));
  } catch {
    return undefined;
  }
}

export function registerRegistrationRoute(
  app: FastifyInstance,
  auth: RegistrationAuthRuntime,
  publicOrigin: string,
): void {
  app.post(
    "/api/v1/register",
    {
      bodyLimit: REGISTER_BODY_LIMIT,
      config: {
        rateLimit: {
          groupId: "register",
          max: 5,
          timeWindow: 60_000,
        },
      },
    },
    async (request, reply) => {
      if (request.headers["content-type"] !== "application/json") {
        return reply.status(415).send({ error: { code: "INVALID_REQUEST" } });
      }
      const body = parseRegistrationBody(request.body);
      if (!body) return reply.status(400).send({ error: { code: "INVALID_REQUEST" } });
      try {
        const result = await auth.api.signUpEmail({
          body: {
            email: createInternalEmailAlias(),
            name: body.username,
            password: body.password,
            username: body.username,
          },
          returnHeaders: true,
        });
        const response = RegistrationResponseSchema.parse({
          recoveryAvailable: false,
          user: { id: result.response.user.id, username: body.username },
        });
        applyAuthResponseHeaders(
          reply,
          result.headers,
          publicOrigin,
          intrinsicReflectApply(intrinsicStringStartsWith, publicOrigin, ["https://"]) as boolean,
        );
        return reply.status(201).send(response);
      } catch {
        return reply.status(400).send({ error: { code: "INVALID_REQUEST" } });
      }
    },
  );
}
