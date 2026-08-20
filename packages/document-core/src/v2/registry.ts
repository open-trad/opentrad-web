import { snapshotCompositeInput } from "../boundaries.js";
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

export interface CreateRepeatableItemInput<Draft> {
  readonly id: string;
  readonly now: string | Date;
  readonly draft: Draft;
}

export type CreateRepeatableItemV1<Draft, Item = unknown> = (
  path: string,
  input: CreateRepeatableItemInput<Draft>,
) => Item;

export interface TemplateRegistration<Draft = unknown, Model = unknown> {
  readonly definition: TemplateDefinitionV2;
  readonly parseDraft: (value: unknown) => Draft;
  readonly createDraft: (input: { id: string; now: string | Date }) => Draft;
  readonly compile: (draft: Draft, context?: TemplateEvaluationContext) => Model;
  readonly preflight: (
    draft: Draft,
    context?: TemplateEvaluationContext,
  ) => readonly RiskFindingV2[];
  readonly createRepeatableItem?: CreateRepeatableItemV1<Draft>;
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
  readonly createRepeatableItem?: CreateRepeatableItemV1<never>;
}

type RegistrationDraft<Registration extends TemplateRegistrationShape> = [Registration] extends [
  never,
]
  ? unknown
  : ReturnType<Registration["parseDraft"]>;

type PublishedRegistration<Registration extends TemplateRegistrationShape> = {
  readonly definition: TemplateDefinitionV2;
  readonly parseDraft: Registration["parseDraft"];
  readonly createDraft: Registration["createDraft"];
  readonly compile: Registration["compile"];
  readonly preflight: Registration["preflight"];
  readonly createRepeatableItem: CreateRepeatableItemV1<RegistrationDraft<Registration>>;
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
  readonly createRepeatableItem?: CreateRepeatableItemV1<never>;
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
    const repeatableFactoryDescriptor = Reflect.getOwnPropertyDescriptor(
      value,
      "createRepeatableItem",
    );
    if (
      repeatableFactoryDescriptor !== undefined &&
      (!("value" in repeatableFactoryDescriptor) ||
        typeof repeatableFactoryDescriptor.value !== "function")
    ) {
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
      createRepeatableItem: repeatableFactoryDescriptor?.value as
        | CreateRepeatableItemV1<never>
        | undefined,
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

function readOwnPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") throw new Error("invalid");
    const descriptor = ownDataProperty(current, segment);
    if (!descriptor) throw new Error("invalid");
    current = descriptor.value;
  }
  return current;
}

function factoryInput<Draft>(value: CreateRepeatableItemInput<Draft>): {
  readonly draft: unknown;
  readonly id: string;
  readonly now: string | Date;
} {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("invalid");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("id") ||
    !keys.includes("now") ||
    !keys.includes("draft")
  ) {
    throw new Error("invalid");
  }
  const id = ownDataProperty(value, "id")?.value;
  const now = ownDataProperty(value, "now")?.value;
  const draft = ownDataProperty(value, "draft")?.value;
  if (typeof id !== "string" || id.trim().length === 0 || id.length > 200) {
    throw new Error("invalid");
  }
  if (
    typeof now !== "string" &&
    !(
      now instanceof Date &&
      Object.getPrototypeOf(now) === Date.prototype &&
      Number.isFinite(Date.prototype.getTime.call(now))
    )
  ) {
    throw new Error("invalid");
  }
  return { draft, id, now };
}

function safeSnapshot(value: unknown): unknown {
  return snapshotCompositeInput(value, { maxTotalValues: 10_000 });
}

function plainArrayAt(value: unknown, path: string): unknown[] {
  const items = readOwnPath(value, path);
  if (!Array.isArray(items) || Object.getPrototypeOf(items) !== Array.prototype) {
    throw new Error("invalid");
  }
  return items;
}

function objectListIdentities(items: readonly unknown[], idPath: string): Map<string, unknown> {
  const identities = new Map<string, unknown>();
  for (const item of items) {
    const identity = readOwnPath(item, idPath);
    if (typeof identity !== "string" || identities.has(identity)) throw new Error("invalid");
    identities.set(identity, item);
  }
  return identities;
}

function assertRepeatableItemShape(valueKind: "object-list" | "string-list", item: unknown): void {
  if (valueKind === "string-list") {
    if (typeof item !== "string") throw new Error("invalid");
    return;
  }
  if (
    item === null ||
    typeof item !== "object" ||
    Array.isArray(item) ||
    Object.getPrototypeOf(item) !== null
  ) {
    throw new Error("invalid");
  }
}

function assertRepeatableListShape(
  valueKind: "object-list" | "string-list",
  items: readonly unknown[],
): void {
  for (const item of items) assertRepeatableItemShape(valueKind, item);
}

function canonicalSafeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid");
    return `n:${Object.is(value, -0) ? "-0" : String(value)}`;
  }
  if (value === undefined) return "u:";
  if (typeof value !== "object") throw new Error("invalid");
  if (Array.isArray(value)) return `a:[${value.map(canonicalSafeValue).join(",")}]`;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new Error("invalid");
  return `o:{${(keys as string[])
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalSafeValue(ownDataProperty(value, key)?.value)}`,
    )
    .join(",")}}`;
}

function addedStructuralListItem(before: readonly unknown[], after: readonly unknown[]): unknown {
  const remaining = new Map<string, number>();
  for (const item of before) {
    const identity = canonicalSafeValue(item);
    remaining.set(identity, (remaining.get(identity) ?? 0) + 1);
  }
  let added: unknown;
  let hasAdded = false;
  for (const item of after) {
    const identity = canonicalSafeValue(item);
    const count = remaining.get(identity) ?? 0;
    if (count > 0) {
      remaining.set(identity, count - 1);
      continue;
    }
    if (hasAdded) throw new Error("invalid");
    added = item;
    hasAdded = true;
  }
  if (!hasAdded || [...remaining.values()].some((count) => count !== 0)) {
    throw new Error("invalid");
  }
  return added;
}

function publishedRepeatableFactory<Registration extends TemplateRegistrationShape>(
  candidate: RegistrationCandidate<Registration>,
): CreateRepeatableItemV1<RegistrationDraft<Registration>> {
  const factory = (path: string, input: CreateRepeatableItemInput<unknown>) => {
    try {
      if (typeof path !== "string") throw new Error("invalid");
      const field = candidate.definition.fieldManifest.find((entry) => entry.path === path);
      if (
        !field ||
        field.control !== "repeatable" ||
        (field.valueKind !== "object-list" && field.valueKind !== "string-list") ||
        !Number.isInteger(field.maxItems)
      ) {
        throw new Error("invalid");
      }
      if (!candidate.createRepeatableItem) throw new Error("invalid");
      const safeInput = factoryInput(input);
      const inputSnapshot = safeSnapshot(safeInput.draft);
      const parsedDraft = safeSnapshot(candidate.parseDraft(inputSnapshot));
      const parsedItems = plainArrayAt(parsedDraft, path);
      assertRepeatableListShape(field.valueKind, parsedItems);
      if (parsedItems.length >= field.maxItems) throw new Error("invalid");
      let originalIdentities: Map<string, unknown> | undefined;
      let idPath: string | undefined;
      if (field.valueKind === "object-list") {
        idPath = field.item.idPath;
        if (idPath) {
          originalIdentities = objectListIdentities(parsedItems, idPath);
          if (originalIdentities.has(safeInput.id)) throw new Error("invalid");
        }
      }
      const now =
        typeof safeInput.now === "string"
          ? safeInput.now
          : new Date(Date.prototype.getTime.call(safeInput.now));
      const rawItem = candidate.createRepeatableItem(path, {
        draft: safeSnapshot(parsedDraft) as never,
        id: safeInput.id,
        now,
      });
      const item = safeSnapshot(rawItem);
      assertRepeatableItemShape(field.valueKind, item);
      if (
        field.valueKind === "object-list" &&
        idPath &&
        readOwnPath(item, idPath) !== safeInput.id
      ) {
        throw new Error("invalid");
      }
      const nextDraft = safeSnapshot(parsedDraft);
      const nextItems = plainArrayAt(nextDraft, path);
      nextItems.push(item);
      assertRepeatableListShape(field.valueKind, nextItems);
      const parsedCandidate = safeSnapshot(candidate.parseDraft(nextDraft));
      const candidateItems = plainArrayAt(parsedCandidate, path);
      assertRepeatableListShape(field.valueKind, candidateItems);
      if (
        candidateItems.length !== parsedItems.length + 1 ||
        candidateItems.length > field.maxItems
      ) {
        throw new Error("invalid");
      }
      let parsedItem: unknown;
      if (field.valueKind === "object-list" && idPath) {
        const candidateIdentities = objectListIdentities(candidateItems, idPath);
        if (
          candidateIdentities.size !== (originalIdentities?.size ?? 0) + 1 ||
          ![...(originalIdentities?.keys() ?? [])].every((identity) =>
            candidateIdentities.has(identity),
          ) ||
          !candidateIdentities.has(safeInput.id)
        ) {
          throw new Error("invalid");
        }
        parsedItem = candidateIdentities.get(safeInput.id);
      } else {
        parsedItem = addedStructuralListItem(parsedItems, candidateItems);
      }
      if (parsedItem === undefined) throw new Error("invalid");
      deepFreeze(parsedItem);
      return parsedItem;
    } catch {
      throw new Error("无法创建重复项");
    }
  };
  return Object.freeze(factory) as CreateRepeatableItemV1<RegistrationDraft<Registration>>;
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
  definePublishedProperty(published, "createRepeatableItem", publishedRepeatableFactory(candidate));
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
