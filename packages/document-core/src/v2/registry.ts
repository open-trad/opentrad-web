import {
  type TemplateDefinitionV2,
  TemplateDefinitionV2Schema,
  type TemplateIdV2,
  type TemplateVersionV2,
} from "./common.js";
import type { RiskFindingV2 } from "./risk.js";

export interface TemplateEvaluationContext {
  readonly asOf?: string;
}

export interface TemplateRegistration<Draft = unknown, Model = unknown> {
  readonly definition: TemplateDefinitionV2;
  readonly parseDraft: (value: unknown) => Draft;
  readonly createDraft: (input: { id: string; now: string | Date }) => Draft;
  readonly compile: (draft: Draft, context?: TemplateEvaluationContext) => Model;
  readonly preflight: (
    draft: Draft,
    context?: TemplateEvaluationContext,
  ) => readonly RiskFindingV2[];
}

interface TemplateRegistrationShape {
  readonly definition: TemplateDefinitionV2;
  readonly parseDraft: (value: unknown) => unknown;
  readonly createDraft: (input: { id: string; now: string | Date }) => unknown;
  readonly compile: (draft: never, context?: TemplateEvaluationContext) => unknown;
  readonly preflight: (
    draft: never,
    context?: TemplateEvaluationContext,
  ) => readonly RiskFindingV2[];
}

type PublishedRegistration<Registration extends TemplateRegistrationShape> = {
  readonly definition: TemplateDefinitionV2;
  readonly parseDraft: Registration["parseDraft"];
  readonly createDraft: Registration["createDraft"];
  readonly compile: Registration["compile"];
  readonly preflight: Registration["preflight"];
};

export interface TemplateRegistry<
  Registration extends TemplateRegistrationShape = TemplateRegistration,
> {
  readonly get: (
    templateId: TemplateIdV2 | string,
    templateVersion: TemplateVersionV2 | string,
  ) => PublishedRegistration<Registration>;
  readonly list: () => readonly PublishedRegistration<Registration>[];
}

const REGISTRATION_FUNCTION_KEYS = ["parseDraft", "createDraft", "compile", "preflight"] as const;
const MAX_REGISTRATIONS = 100;

interface RegistrationCandidate<Registration extends TemplateRegistrationShape> {
  readonly definition: TemplateDefinitionV2;
  readonly parseDraft: Registration["parseDraft"];
  readonly createDraft: Registration["createDraft"];
  readonly compile: Registration["compile"];
  readonly preflight: Registration["preflight"];
}

function ownDataProperty(object: object, key: PropertyKey): PropertyDescriptor | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  return descriptor && "value" in descriptor ? descriptor : undefined;
}

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = ownDataProperty(value, key);
    if (!descriptor) throw new Error("模板定义无效");
    deepFreeze(descriptor.value, seen);
  }
  Object.freeze(value);
}

function validateRegistration<Registration extends TemplateRegistrationShape>(
  value: Registration,
): RegistrationCandidate<Registration> {
  try {
    if (value === null || typeof value !== "object") throw new Error("invalid");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid");

    const definitionDescriptor = ownDataProperty(value, "definition");
    if (!definitionDescriptor) throw new Error("invalid");
    const functionDescriptors = REGISTRATION_FUNCTION_KEYS.map((key) =>
      ownDataProperty(value, key),
    );
    if (functionDescriptors.some((descriptor) => typeof descriptor?.value !== "function")) {
      throw new Error("invalid");
    }

    const parsed = TemplateDefinitionV2Schema.safeParse(definitionDescriptor.value);
    if (!parsed.success) throw new Error("definition");
    return {
      definition: parsed.data,
      parseDraft: functionDescriptors[0]?.value as Registration["parseDraft"],
      createDraft: functionDescriptors[1]?.value as Registration["createDraft"],
      compile: functionDescriptors[2]?.value as Registration["compile"],
      preflight: functionDescriptors[3]?.value as Registration["preflight"],
    };
  } catch (error) {
    if (error instanceof Error && error.message === "definition") {
      throw new Error("模板定义无效");
    }
    throw new Error("模板注册无效");
  }
}

function snapshotRegistrations<Registration extends TemplateRegistrationShape>(
  registrations: readonly Registration[],
): RegistrationCandidate<Registration>[] {
  try {
    if (!Array.isArray(registrations) || Object.getPrototypeOf(registrations) !== Array.prototype) {
      throw new Error("invalid");
    }
    if (registrations.length > MAX_REGISTRATIONS) throw new Error("invalid");
    const keys = Reflect.ownKeys(registrations);
    if (keys.length !== registrations.length + 1) throw new Error("invalid");

    const snapshot: RegistrationCandidate<Registration>[] = [];
    for (let index = 0; index < registrations.length; index += 1) {
      const descriptor = ownDataProperty(registrations, String(index));
      if (!descriptor) throw new Error("invalid");
      snapshot.push(validateRegistration(descriptor.value as Registration));
    }
    return snapshot;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("模板")) throw error;
    throw new Error("模板注册无效");
  }
}

function definePublishedProperty(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

function publishRegistration<Registration extends TemplateRegistrationShape>(
  candidate: RegistrationCandidate<Registration>,
): PublishedRegistration<Registration> {
  deepFreeze(candidate.definition);
  const published = Object.create(null) as PublishedRegistration<Registration>;
  definePublishedProperty(published, "definition", candidate.definition);
  for (const key of REGISTRATION_FUNCTION_KEYS) {
    definePublishedProperty(published, key, candidate[key]);
  }
  return Object.freeze(published) as PublishedRegistration<Registration>;
}

export function createTemplateRegistry<const Registration extends TemplateRegistrationShape>(
  registrations: readonly Registration[],
): TemplateRegistry<Registration> {
  const candidates = snapshotRegistrations(registrations);
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.definition.id}@${candidate.definition.version}`;
    if (keys.has(key)) throw new Error("模板版本重复注册");
    keys.add(key);
  }

  const entries = new Map<string, PublishedRegistration<Registration>>();
  const publishedRegistrations = candidates.map((candidate) => publishRegistration(candidate));
  for (const registration of publishedRegistrations) {
    entries.set(`${registration.definition.id}@${registration.definition.version}`, registration);
  }
  const list = Object.freeze(publishedRegistrations);

  return Object.freeze({
    get(templateId: TemplateIdV2 | string, templateVersion: TemplateVersionV2 | string) {
      if (typeof templateId !== "string" || typeof templateVersion !== "string") {
        throw new Error("不支持的模板版本");
      }
      const registration = entries.get(`${templateId}@${templateVersion}`);
      if (!registration) throw new Error("不支持的模板版本");
      return registration;
    },
    list() {
      return list;
    },
  });
}
