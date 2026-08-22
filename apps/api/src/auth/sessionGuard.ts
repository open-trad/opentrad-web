import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";

const intrinsicFreeze = Object.freeze;
const intrinsicObjectCreate = Object.create;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;

export interface SessionAuthRuntime {
  readonly api: {
    readonly getSession: (input: { headers: Headers }) => Promise<unknown>;
  };
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly userId: string;
}

export class AuthenticationRequiredError extends Error {
  readonly code = "AUTH_REQUIRED";
  readonly statusCode = 401;

  constructor() {
    super("AUTH_REQUIRED");
  }
}

function ownObject(value: unknown, name: string): object | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, name);
  return descriptor &&
    "value" in descriptor &&
    descriptor.value !== null &&
    typeof descriptor.value === "object"
    ? descriptor.value
    : undefined;
}

function ownString(value: object, name: string): string | undefined {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, name);
  return descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string" &&
    descriptor.value.length > 0 &&
    descriptor.value.length <= 256
    ? descriptor.value
    : undefined;
}

export async function requireSession(
  request: FastifyRequest,
  auth: SessionAuthRuntime,
): Promise<AuthenticatedSession> {
  try {
    const result = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    const session = ownObject(result, "session");
    const user = ownObject(result, "user");
    const sessionId = session ? ownString(session, "id") : undefined;
    const userId = user ? ownString(user, "id") : undefined;
    if (!sessionId || !userId) throw new AuthenticationRequiredError();
    const output = intrinsicObjectCreate(null) as { sessionId: string; userId: string };
    Object.defineProperty(output, "sessionId", { enumerable: true, value: sessionId });
    Object.defineProperty(output, "userId", { enumerable: true, value: userId });
    return intrinsicFreeze(output);
  } catch {
    throw new AuthenticationRequiredError();
  }
}
