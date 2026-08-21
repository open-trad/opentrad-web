export const LOGGER_REDACT_PATHS = Object.freeze([
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.set-cookie",
  "req.headers.idempotency-key",
  "req.headers.x-opentrad-processing-consent",
  "res.headers.set-cookie",
  "authorization",
  "cookie",
  "set-cookie",
  "body",
  "password",
  "email",
  "alias",
  "username",
  "userId",
  "user.id",
  "githubClientId",
  "githubClientSecret",
  "clientId",
  "clientSecret",
  "err",
  "error",
  "cause",
] as const);

export interface PrivacyLogStream {
  readonly write: (line: string) => void;
}

export function createPrivacyLoggerOptions(stream?: PrivacyLogStream) {
  return {
    level: "info",
    redact: {
      censor: "[REDACTED]",
      paths: Array.from(LOGGER_REDACT_PATHS),
      remove: false,
    },
    serializers: {
      error: () => ({ code: "REQUEST_FAILED" }),
      req: (request: { method?: unknown }) => ({
        method: typeof request.method === "string" ? request.method : "UNKNOWN",
      }),
      res: (reply: { statusCode?: unknown }) => ({
        statusCode: typeof reply.statusCode === "number" ? reply.statusCode : 500,
      }),
    },
    ...(stream ? { stream } : {}),
  };
}
