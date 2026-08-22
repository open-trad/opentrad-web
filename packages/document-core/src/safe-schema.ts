import { z } from "./zod.js";

interface SafeIssue {
  code: "custom";
  message: string;
  path?: PropertyKey[];
}

interface ArraySchemaOptions<Output> {
  max?: number;
  min?: number;
  refine?: (value: Output[], addIssue: (issue: SafeIssue) => void) => void;
}

type ObjectOutput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;
type TupleOutput<Items extends readonly z.ZodType[]> = {
  -readonly [Index in keyof Items]: z.output<Items[Index]>;
};

function parseChild<T extends z.ZodType>(
  schema: T,
  input: unknown,
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
): { data: z.output<T>; success: true } | { success: false } {
  try {
    const result = schema.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          ...issue,
          path: [...path, ...issue.path],
        });
      }
      return { success: false };
    }
    return { data: result.data, success: true };
  } catch {
    context.addIssue({
      code: "custom",
      message: "Schema validation failed safely",
      path,
    });
    return { success: false };
  }
}

function defineOwnData(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isolatedValueSchema<T extends z.ZodType>(schema: T) {
  return z.transform<unknown, z.output<T>>((input, context) => {
    const result = parseChild(schema, input, context, []);
    return result.success ? result.data : z.NEVER;
  });
}

export function isolatedObjectSchema<const Shape extends z.ZodRawShape>(
  shape: Shape,
  refine?: (value: ObjectOutput<Shape>, addIssue: (issue: SafeIssue) => void) => void,
) {
  return z.transform<unknown, ObjectOutput<Shape>>((input, context) => {
    try {
      if (!isPlainObject(input)) {
        context.addIssue({
          code: "custom",
          message: "Expected a plain object",
        });
        return z.NEVER;
      }

      const output = Object.create(null) as ObjectOutput<Shape>;
      let success = true;
      for (const key of Object.keys(shape)) {
        const fieldDescriptor = Reflect.getOwnPropertyDescriptor(shape, key);
        const fieldSchema = fieldDescriptor?.value as z.ZodType | undefined;
        if (!fieldSchema) {
          context.addIssue({ code: "custom", message: "Invalid schema field", path: [key] });
          success = false;
          continue;
        }
        const inputDescriptor = Reflect.getOwnPropertyDescriptor(input, key);
        if (inputDescriptor && !("value" in inputDescriptor)) {
          context.addIssue({ code: "custom", message: "Accessors are not accepted", path: [key] });
          success = false;
          continue;
        }
        const fieldResult = parseChild(
          fieldSchema,
          inputDescriptor && "value" in inputDescriptor ? inputDescriptor.value : undefined,
          context,
          [key],
        );
        if (!fieldResult.success) {
          success = false;
          continue;
        }
        if (fieldResult.data !== undefined || inputDescriptor !== undefined) {
          defineOwnData(output, key, fieldResult.data);
        }
      }

      if (!success) {
        return z.NEVER;
      }
      refine?.(output, (issue) => context.addIssue({ ...issue }));
      return context.issues.length === 0 ? output : z.NEVER;
    } catch {
      context.addIssue({ code: "custom", message: "Object validation failed safely" });
      return z.NEVER;
    }
  });
}

export function isolatedArraySchema<T extends z.ZodType>(
  element: T,
  options: ArraySchemaOptions<z.output<T>> = {},
) {
  return z.transform<unknown, z.output<T>[]>((input, context) => {
    try {
      if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
        context.addIssue({ code: "custom", message: "Expected a plain array" });
        return z.NEVER;
      }
      if (options.min !== undefined && input.length < options.min) {
        context.addIssue({ code: "custom", message: `Expected at least ${options.min} entries` });
        return z.NEVER;
      }
      if (options.max !== undefined && input.length > options.max) {
        context.addIssue({ code: "custom", message: `Expected at most ${options.max} entries` });
        return z.NEVER;
      }

      const output: z.output<T>[] = [];
      let success = true;
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = Reflect.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor || !("value" in descriptor)) {
          context.addIssue({
            code: "custom",
            message: "Sparse arrays are not accepted",
            path: [index],
          });
          success = false;
          continue;
        }
        const itemResult = parseChild(element, descriptor.value, context, [index]);
        if (!itemResult.success) {
          success = false;
          continue;
        }
        defineOwnData(output, index, itemResult.data);
      }

      if (!success) {
        return z.NEVER;
      }
      options.refine?.(output, (issue) => context.addIssue({ ...issue }));
      return context.issues.length === 0 ? output : z.NEVER;
    } catch {
      context.addIssue({ code: "custom", message: "Array validation failed safely" });
      return z.NEVER;
    }
  });
}

export function isolatedTupleSchema<const Items extends readonly z.ZodType[]>(items: Items) {
  return z.transform<unknown, TupleOutput<Items>>((input, context) => {
    try {
      if (
        !Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Array.prototype ||
        input.length !== items.length
      ) {
        context.addIssue({ code: "custom", message: `Expected exactly ${items.length} entries` });
        return z.NEVER;
      }

      const output: unknown[] = [];
      let success = true;
      for (let index = 0; index < items.length; index += 1) {
        const itemSchema = Reflect.getOwnPropertyDescriptor(items, String(index))?.value as
          | z.ZodType
          | undefined;
        const inputDescriptor = Reflect.getOwnPropertyDescriptor(input, String(index));
        if (!itemSchema || !inputDescriptor || !("value" in inputDescriptor)) {
          context.addIssue({ code: "custom", message: "Invalid tuple entry", path: [index] });
          success = false;
          continue;
        }
        const itemResult = parseChild(itemSchema, inputDescriptor.value, context, [index]);
        if (!itemResult.success) {
          success = false;
          continue;
        }
        defineOwnData(output, index, itemResult.data);
      }
      return success ? (output as TupleOutput<Items>) : z.NEVER;
    } catch {
      context.addIssue({ code: "custom", message: "Tuple validation failed safely" });
      return z.NEVER;
    }
  });
}

export function isolatedRecordSchema<Key extends z.ZodType, Value extends z.ZodType>(
  keySchema: Key,
  valueSchema: Value,
  maxKeys: number,
) {
  return z.transform<unknown, Record<string, z.output<Value>>>((input, context) => {
    try {
      if (!isPlainObject(input)) {
        context.addIssue({ code: "custom", message: "Expected a plain record" });
        return z.NEVER;
      }
      const keys = Reflect.ownKeys(input);
      if (keys.length > maxKeys) {
        context.addIssue({ code: "custom", message: `Expected at most ${maxKeys} keys` });
        return z.NEVER;
      }

      const output = Object.create(null) as Record<string, z.output<Value>>;
      let success = true;
      for (const key of keys) {
        if (typeof key !== "string") {
          context.addIssue({ code: "custom", message: "Record symbols are not accepted" });
          success = false;
          continue;
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !("value" in descriptor)) {
          context.addIssue({
            code: "custom",
            message: "Record accessors are not accepted",
            path: [key],
          });
          success = false;
          continue;
        }
        const parsedKey = parseChild(keySchema, key, context, [key]);
        const parsedValue = parseChild(valueSchema, descriptor.value, context, [key]);
        if (!parsedKey.success || typeof parsedKey.data !== "string" || !parsedValue.success) {
          success = false;
          continue;
        }
        defineOwnData(output, parsedKey.data, parsedValue.data);
      }
      return success ? output : z.NEVER;
    } catch {
      context.addIssue({ code: "custom", message: "Record validation failed safely" });
      return z.NEVER;
    }
  });
}

export function isolatedDiscriminatedUnionSchema<
  const Options extends Readonly<Record<string, z.ZodType>>,
>(discriminator: string, options: Options) {
  return z.transform<unknown, z.output<Options[keyof Options]>>((input, context) => {
    try {
      if (!isPlainObject(input)) {
        context.addIssue({ code: "custom", message: "Expected a plain discriminated object" });
        return z.NEVER;
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(input, discriminator);
      const tag = descriptor && "value" in descriptor ? descriptor.value : undefined;
      if (typeof tag !== "string" || !Object.hasOwn(options, tag)) {
        context.addIssue({
          code: "custom",
          message: `Unsupported ${discriminator}`,
          path: [discriminator],
        });
        return z.NEVER;
      }
      const option = Reflect.getOwnPropertyDescriptor(options, tag)?.value as z.ZodType | undefined;
      if (!option) {
        context.addIssue({ code: "custom", message: "Invalid union option" });
        return z.NEVER;
      }
      const result = parseChild(option, input, context, []);
      return result.success ? (result.data as z.output<Options[keyof Options]>) : z.NEVER;
    } catch {
      context.addIssue({ code: "custom", message: "Union validation failed safely" });
      return z.NEVER;
    }
  });
}
