import { z } from "zod";
import { CAPABILITIES, ConversionCapabilitySchema } from "./conversion.js";
import { JobErrorCodeSchema, JobStatusSchema } from "./jobs.js";
import { safeSchema } from "./safety.js";

const intrinsicArrayIsArray = Array.isArray;
const intrinsicObjectIs = Object.is;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;

export const UsernameSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_.]+$/u);

const PasswordSchema = z.string().min(12).max(128);

export const UsernameSignInRequestSchema = safeSchema(
  z.strictObject({ username: UsernameSchema, password: PasswordSchema }),
);
export type UsernameSignInRequest = z.infer<typeof UsernameSignInRequestSchema>;

const RegisterRequestRawSchema = z.strictObject({
  username: UsernameSchema,
  password: PasswordSchema,
  acknowledgements: z.strictObject({ noPasswordRecovery: z.literal(true) }),
});
export const RegisterRequestSchema = safeSchema(RegisterRequestRawSchema);
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const RegistrationResponseSchema = safeSchema(
  z.strictObject({
    user: z.strictObject({ id: z.string().uuid(), username: UsernameSchema }),
    recoveryAvailable: z.literal(false),
  }),
);
export type RegistrationResponse = z.infer<typeof RegistrationResponseSchema>;

export const AuthOptionsResponseSchema = safeSchema(z.strictObject({ githubEnabled: z.boolean() }));
export type AuthOptionsResponse = z.infer<typeof AuthOptionsResponseSchema>;

export const ApiErrorResponseSchema = safeSchema(
  z.strictObject({
    error: z.strictObject({ code: JobErrorCodeSchema, retryable: z.boolean().optional() }),
  }),
);
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

function exactDataEqual(left: unknown, right: unknown, depth = 0): boolean {
  if (intrinsicObjectIs(left, right)) return true;
  if (
    depth > 12 ||
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    intrinsicArrayIsArray(left) !== intrinsicArrayIsArray(right)
  ) {
    return false;
  }
  const leftKeys = intrinsicReflectOwnKeys(left);
  const rightKeys = intrinsicReflectOwnKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let leftIndex = 0; leftIndex < leftKeys.length; leftIndex += 1) {
    const leftKey = leftKeys[leftIndex];
    let rightKeyFound = false;
    for (let rightIndex = 0; rightIndex < rightKeys.length; rightIndex += 1) {
      if (rightKeys[rightIndex] === leftKey) {
        rightKeyFound = true;
        break;
      }
    }
    if (!rightKeyFound || leftKey === undefined) return false;
    const leftDescriptor = intrinsicReflectGetOwnPropertyDescriptor(left, leftKey);
    const rightDescriptor = intrinsicReflectGetOwnPropertyDescriptor(right, leftKey);
    if (
      !leftDescriptor ||
      !("value" in leftDescriptor) ||
      !rightDescriptor ||
      !("value" in rightDescriptor) ||
      !exactDataEqual(leftDescriptor.value, rightDescriptor.value, depth + 1)
    ) {
      return false;
    }
  }
  return true;
}

const CapabilitiesResponseRawSchema = z
  .strictObject({
    capabilities: z.array(ConversionCapabilitySchema).length(CAPABILITIES.length),
  })
  .superRefine((response, context) => {
    for (let index = 0; index < response.capabilities.length; index += 1) {
      if (!exactDataEqual(response.capabilities[index], CAPABILITIES[index])) {
        context.addIssue({
          code: "custom",
          message: "Capability matrix must match the canonical release",
          path: ["capabilities", index],
        });
      }
    }
  });

export const CapabilitiesResponseSchema = safeSchema(CapabilitiesResponseRawSchema);
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

export const JobResponseSchema = safeSchema(z.strictObject({ job: JobStatusSchema }));
export type JobResponse = z.infer<typeof JobResponseSchema>;
