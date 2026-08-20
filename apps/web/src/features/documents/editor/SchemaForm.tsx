import type {
  TemplateFieldManifestEntryV1,
  TemplateRegistration,
  v2,
} from "@opentrad/document-core";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { getDraftField, parseRawFieldValue, setDraftField, updateDraftFromRaw } from "./fieldPaths";

type RepeatableItemField = v2.TemplateRepeatableItemFieldV1;
type EditorField = TemplateFieldManifestEntryV1 | RepeatableItemField;
type Registration = ReturnType<typeof v2.V2_TEMPLATE_REGISTRY.get> | TemplateRegistration;

const GUARANTEE_ROOT_PATH = "source.guaranteeRequirement";
const GUARANTEE_METHODS_PATH = `${GUARANTEE_ROOT_PATH}.allowedMethods`;

function isGuaranteePath(path: string): boolean {
  return path === GUARANTEE_ROOT_PATH || path.startsWith(`${GUARANTEE_ROOT_PATH}.`);
}

export interface FormIssue {
  readonly path: string;
  readonly message: string;
}

export interface SchemaFormProps {
  readonly registration: Registration;
  readonly draft: unknown;
  readonly issues?: readonly FormIssue[];
  readonly onDraftChange: (draft: unknown) => void;
  readonly onValidationChange?: (issues: readonly FormIssue[]) => void;
  readonly onAttachmentFiles?: (
    field: Extract<EditorField, { control: "attachment" }>,
    path: string,
    files: FileList,
  ) => void;
}

function errorIssues(error: unknown): readonly FormIssue[] {
  if (error === null || typeof error !== "object") return [{ path: "", message: "字段值无效" }];
  const descriptor = Reflect.getOwnPropertyDescriptor(error, "issues");
  if (!descriptor || !("value" in descriptor) || !Array.isArray(descriptor.value)) {
    return [{ path: "", message: error instanceof Error ? error.message : "字段值无效" }];
  }
  return descriptor.value.flatMap((issue): FormIssue[] => {
    if (issue === null || typeof issue !== "object") return [];
    const path = Reflect.getOwnPropertyDescriptor(issue, "path")?.value;
    const message = Reflect.getOwnPropertyDescriptor(issue, "message")?.value;
    return Array.isArray(path) && typeof message === "string"
      ? [{ path: path.map(String).join("."), message }]
      : [];
  });
}

function localizedZh(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const descriptor = Reflect.getOwnPropertyDescriptor(value, "zhCN");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : "";
}

function scaledToDecimal(value: unknown, scale: number): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : "0";
  if (!/^\d+$/u.test(raw)) return raw;
  const padded = raw.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale) || "0";
  const fraction = padded.slice(-scale).replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function rawValue(field: EditorField, value: unknown): string {
  switch (field.valueKind) {
    case "localized-text":
      return localizedZh(value);
    case "money-minor":
    case "basis-points":
      return scaledToDecimal(value, 2);
    case "offset-datetime":
      return typeof value === "string" ? value.replace(/:00(?:Z|[+-]\d{2}:\d{2})$/u, "") : "";
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
}

function isVisible(field: EditorField, rootDraft: unknown, itemDraft?: unknown): boolean {
  if (!field.visibleWhen) return true;
  const source = itemDraft ?? rootDraft;
  return getDraftField(source, field.visibleWhen.path) === field.visibleWhen.equals;
}

function dynamicOptions(
  field: Extract<EditorField, { control: "select" }>,
  rootDraft: unknown,
): readonly { readonly label: string; readonly value: string }[] {
  if ("options" in field && field.options) return field.options;
  if (!("optionSourcePath" in field)) return [];
  const source = getDraftField(rootDraft, field.optionSourcePath);
  if (!Array.isArray(source)) return [];
  return source.flatMap((item) => {
    if (
      field.optionFilter &&
      getDraftField(item, field.optionFilter.path) !== field.optionFilter.equals
    ) {
      return [];
    }
    const value = getDraftField(item, field.optionValuePath);
    const label = getDraftField(item, field.optionLabelPath);
    return typeof value === "string" && typeof label === "string" ? [{ value, label }] : [];
  });
}

function stableId(prefix: string, sequence: number): string {
  return `${prefix}-${sequence}`;
}

function ownLocalizedText(value: unknown): { readonly zhCN: string; readonly enUS: string } {
  if (value === null || typeof value !== "object") return { zhCN: "", enUS: "" };
  const zh = Reflect.getOwnPropertyDescriptor(value, "zhCN");
  const en = Reflect.getOwnPropertyDescriptor(value, "enUS");
  return {
    zhCN: zh && "value" in zh && typeof zh.value === "string" ? zh.value : "",
    enUS: en && "value" in en && typeof en.value === "string" ? en.value : "",
  };
}

function repeatableBlockedReason(path: string): string {
  if (/matrix|deviation/iu.test(path)) return "请先创建对应要求，再添加此项。";
  if (/performance|caseStudies|experience/iu.test(path)) return "请先创建项目业绩，再添加此项。";
  if (/evidence/iu.test(path)) return "请先附加来源文件，再添加此项。";
  return "请先创建所需来源或附件，再添加此项。";
}

interface RepeatableFactoryPlan {
  readonly generatedIdentity: boolean;
  readonly sourceOptions: readonly { readonly label: string; readonly value: string }[];
  readonly reason?: string;
}

interface ExactFactorySourceBinding {
  readonly sourcePath: string;
  readonly identityPath: string;
  readonly labelPath: string;
}

const EXACT_FACTORY_SOURCE_BINDINGS: Readonly<
  Record<string, Readonly<Record<string, ExactFactorySourceBinding>>>
> = Object.freeze({
  "bid.government.goods.v1": Object.freeze({
    technicalMatrix: {
      sourcePath: "requirements",
      identityPath: "id",
      labelPath: "requirementText",
    },
    businessMatrix: {
      sourcePath: "requirements",
      identityPath: "id",
      labelPath: "requirementText",
    },
  }),
  "bid.government.services.v1": Object.freeze({
    performanceEvidence: {
      sourcePath: "projectReferences",
      identityPath: "id",
      labelPath: "projectName",
    },
  }),
  "bid.construction.works.v1": Object.freeze({
    "projectManager.experience": {
      sourcePath: "projectReferences",
      identityPath: "id",
      labelPath: "projectName",
    },
  }),
  "bid.enterprise.goods.v1": Object.freeze({
    requirementMatrix: {
      sourcePath: "requirements",
      identityPath: "id",
      labelPath: "requirementText",
    },
    contractAcceptanceDeviations: {
      sourcePath: "businessDeviations",
      identityPath: "requirementId",
      labelPath: "requirement",
    },
  }),
  "bid.enterprise.services.v1": Object.freeze({
    caseStudies: {
      sourcePath: "projectReferences",
      identityPath: "id",
      labelPath: "projectName",
    },
    contractDeviations: {
      sourcePath: "businessDeviations",
      identityPath: "requirementId",
      labelPath: "requirement",
    },
  }),
});

function exactFactorySourceOptions(
  registration: Registration,
  field: Extract<TemplateFieldManifestEntryV1, { control: "repeatable" }>,
  draft: unknown,
): readonly { readonly label: string; readonly value: string }[] | undefined {
  const binding = EXACT_FACTORY_SOURCE_BINDINGS[registration.definition.id]?.[field.path];
  if (!binding) return undefined;
  const source = getDraftField(draft, binding.sourcePath);
  if (!Array.isArray(source)) return [];
  const staticConstraints =
    field.item.kind === "object"
      ? field.item.fields.flatMap((itemField) => {
          if (
            itemField.control !== "select" ||
            !("options" in itemField) ||
            itemField.options?.length !== 1
          ) {
            return [];
          }
          const option = itemField.options[0];
          return option ? [{ path: itemField.path, value: option.value }] : [];
        })
      : [];
  return source.flatMap((item) => {
    if (
      staticConstraints.some(
        (constraint) => getDraftField(item, constraint.path) !== constraint.value,
      )
    ) {
      return [];
    }
    const value = getDraftField(item, binding.identityPath);
    const label = getDraftField(item, binding.labelPath);
    return typeof value === "string" && typeof label === "string" ? [{ value, label }] : [];
  });
}

function planRepeatableFactory(
  registration: Registration,
  field: Extract<TemplateFieldManifestEntryV1, { control: "repeatable" }>,
  draft: unknown,
  items: readonly unknown[],
): RepeatableFactoryPlan {
  if (field.item.kind !== "object") {
    return { generatedIdentity: true, sourceOptions: [] };
  }

  let identityOptions: readonly { readonly label: string; readonly value: string }[] | undefined;
  for (const itemField of field.item.fields) {
    if (itemField.control === "select" && "optionSourcePath" in itemField) {
      const options = dynamicOptions(itemField, draft);
      const minimum =
        ("minItems" in itemField ? itemField.minItems : undefined) ?? (itemField.required ? 1 : 0);
      if (minimum > 0 && options.length === 0) {
        return {
          generatedIdentity: false,
          sourceOptions: [],
          reason: repeatableBlockedReason(field.path),
        };
      }
      if (field.item.idPath === itemField.path) identityOptions = options;
    }
    if (itemField.control === "attachment" && itemField.required) {
      const descriptors = getDraftField(draft, itemField.descriptorPath);
      if (!Array.isArray(descriptors) || descriptors.length === 0) {
        return {
          generatedIdentity: false,
          sourceOptions: [],
          reason: repeatableBlockedReason(field.path),
        };
      }
    }
  }

  const exactSourceOptions = exactFactorySourceOptions(registration, field, draft);
  const sourceOptions = exactSourceOptions ?? identityOptions;
  if (sourceOptions) {
    const used = new Set(
      items.flatMap((item) => {
        const identity =
          field.item.kind === "object" && field.item.idPath
            ? getDraftField(item, field.item.idPath)
            : undefined;
        return typeof identity === "string" ? [identity] : [];
      }),
    );
    const available = sourceOptions.filter((option) => !used.has(option.value));
    return {
      generatedIdentity: false,
      sourceOptions: available,
      ...(available.length === 0
        ? { reason: `暂无可添加的${field.label}来源；请先创建新的来源。` }
        : {}),
    };
  }

  return { generatedIdentity: true, sourceOptions: [] };
}

interface FieldControlProps {
  readonly field: EditorField;
  readonly path: string;
  readonly value: unknown;
  readonly rootDraft: unknown;
  readonly issue?: FormIssue;
  readonly rawOverride?: unknown;
  readonly onRawChange: (raw: unknown) => void;
  readonly onAttachmentFiles?: SchemaFormProps["onAttachmentFiles"];
}

function FieldControl({
  field,
  path,
  value,
  rootDraft,
  issue,
  rawOverride,
  onRawChange,
  onAttachmentFiles,
}: FieldControlProps) {
  const reactId = useId();
  const errorId = issue ? `${reactId}-error` : undefined;
  const label = `${field.label}${field.required ? "（必填）" : ""}`;
  const shared = {
    "aria-describedby": errorId,
    "aria-invalid": issue ? (true as const) : undefined,
    "data-field-path": path,
  };

  let control: ReactNode;
  if (field.valueKind === "localized-text") {
    const localized = ownLocalizedText(rawOverride ?? value);
    const required = field.required ? "（必填）" : "";
    const LocalizedControl = field.control === "textarea" ? "textarea" : "input";
    control = (
      <div className="document-localized-field-v2">
        <LocalizedControl
          {...shared}
          aria-label={`${field.label}（中文）${required}`}
          value={localized.zhCN}
          onChange={(event) => onRawChange({ ...localized, zhCN: event.currentTarget.value })}
        />
        <LocalizedControl
          {...shared}
          aria-label={`${field.label}（英文）${required}`}
          data-field-path={`${path}.enUS`}
          value={localized.enUS}
          onChange={(event) => onRawChange({ ...localized, enUS: event.currentTarget.value })}
        />
      </div>
    );
  } else if (field.control === "checkbox") {
    control = (
      <input
        {...shared}
        type="checkbox"
        aria-label={label}
        checked={Boolean(value)}
        onChange={(event) => onRawChange(event.target.checked)}
      />
    );
  } else if (field.control === "select") {
    const options = dynamicOptions(field, rootDraft);
    if (field.valueKind === "string-list" && field.multiple) {
      const selected = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
      control = (
        <select
          {...shared}
          multiple
          aria-label={label}
          value={selected}
          onChange={(event) =>
            onRawChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
          }
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    } else {
      control = (
        <select
          {...shared}
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onRawChange(event.target.value)}
        >
          {!field.required ? <option value="">未选择</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
  } else if (field.control === "attachment") {
    control = (
      <input
        {...shared}
        type="file"
        aria-label={label}
        accept={field.allowedMediaTypes.join(",")}
        multiple={field.cardinality === "multiple"}
        onChange={(event) => {
          if (event.currentTarget.files)
            onAttachmentFiles?.(field, path, event.currentTarget.files);
        }}
      />
    );
  } else if (field.control === "repeatable") {
    control = (
      <NestedStringList
        field={field}
        values={
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : []
        }
        onChange={onRawChange}
      />
    );
  } else {
    const displayValue = rawOverride ?? rawValue(field, value);
    if (field.control === "textarea") {
      control = (
        <textarea
          {...shared}
          aria-label={label}
          value={String(displayValue)}
          onChange={(event) => onRawChange(event.target.value)}
        />
      );
    } else {
      const type =
        field.control === "date"
          ? "date"
          : field.control === "datetime"
            ? "datetime-local"
            : "text";
      control = (
        <input
          {...shared}
          type={type}
          inputMode={
            field.control === "money" || field.control === "percent" || field.control === "number"
              ? "decimal"
              : undefined
          }
          aria-label={label}
          value={String(displayValue)}
          onChange={(event) => onRawChange(event.target.value)}
        />
      );
    }
  }

  return (
    <div className="document-field-v2">
      <span>{label}</span>
      {control}
      {issue ? (
        <small id={errorId} className="document-field-error-v2">
          {issue.message}
        </small>
      ) : null}
    </div>
  );
}

function NestedStringList({
  field,
  values,
  onChange,
}: {
  readonly field: Extract<EditorField, { control: "repeatable" }>;
  readonly values: readonly string[];
  readonly onChange: (value: unknown) => void;
}) {
  const prefix = useId();
  const nextKey = useRef(values.length);
  const [keys, setKeys] = useState(() => values.map((_, index) => stableId(prefix, index)));
  const [pending, setPending] = useState(false);
  const itemLabel = field.item.kind === "value" ? field.item.label : field.label;

  return (
    <div className="nested-list-v2">
      {values.map((value, index) => (
        <div key={keys[index] ?? `${prefix}-${index}`}>
          <input
            type="text"
            aria-label={`${itemLabel} 第 ${index + 1} 项`}
            value={value}
            onChange={(event) =>
              onChange(
                values.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
              )
            }
          />
          {values.length > field.minItems ? (
            <button
              type="button"
              aria-label={`删除${itemLabel} 第 ${index + 1} 项`}
              onClick={() => {
                onChange(values.filter((_, itemIndex) => itemIndex !== index));
                setKeys((current) => current.filter((_, itemIndex) => itemIndex !== index));
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> 删除
            </button>
          ) : null}
        </div>
      ))}
      {pending ? (
        <input
          type="text"
          aria-label={`${itemLabel} 第 ${values.length + 1} 项`}
          defaultValue=""
          onChange={(event) => {
            if (event.target.value.length === 0) return;
            const key = stableId(prefix, nextKey.current++);
            setKeys((current) => [...current, key]);
            setPending(false);
            onChange([...values, event.target.value]);
          }}
        />
      ) : null}
      {values.length + Number(pending) < field.maxItems ? (
        <button type="button" onClick={() => setPending(true)}>
          <Plus size={14} aria-hidden="true" /> 添加{itemLabel}
        </button>
      ) : null}
    </div>
  );
}

interface RepeatableControlProps {
  readonly field: Extract<TemplateFieldManifestEntryV1, { control: "repeatable" }>;
  readonly registration: Registration;
  readonly draft: unknown;
  readonly issues: readonly FormIssue[];
  readonly rawValues: Readonly<Record<string, unknown>>;
  readonly onRawValue: (field: RepeatableItemField, path: string, value: unknown) => void;
  readonly onCandidate: (candidate: unknown) => void;
  readonly onAttachmentFiles?: SchemaFormProps["onAttachmentFiles"];
}

function RepeatableControl({
  field,
  registration,
  draft,
  issues,
  rawValues,
  onRawValue,
  onCandidate,
  onAttachmentFiles,
}: RepeatableControlProps) {
  const values = getDraftField(draft, field.path);
  const items = Array.isArray(values) ? values : [];
  const prefix = useId();
  const nextKey = useRef(items.length);
  const pendingActionFocus = useRef<string | undefined>(undefined);
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [sessionKeys, setSessionKeys] = useState(() =>
    items.map((_, index) => stableId(prefix, index)),
  );
  const [pendingGuaranteeMethod, setPendingGuaranteeMethod] = useState<string | null>(null);
  const [selectedFactorySource, setSelectedFactorySource] = useState("");
  const [factoryError, setFactoryError] = useState<string | undefined>(undefined);
  const fixed = field.minItems === field.maxItems;
  const stagedGuaranteeMethods = field.path === GUARANTEE_METHODS_PATH;
  const blockedReasonId = `${prefix}-add-reason`;
  const factoryPlan = useMemo(
    () => planRepeatableFactory(registration, field, draft, items),
    [draft, field, items, registration],
  );
  const selectedSourceAvailable = factoryPlan.sourceOptions.some(
    (option) => option.value === selectedFactorySource,
  );
  const canAddFromFactory =
    !factoryPlan.reason && (factoryPlan.generatedIdentity || selectedSourceAvailable);
  const addReason =
    factoryError ??
    factoryPlan.reason ??
    (!factoryPlan.generatedIdentity && !selectedSourceAvailable
      ? `请选择${field.label}来源后再添加。`
      : undefined);

  const itemKey = (item: unknown, index: number): string => {
    if (field.item.kind === "object" && field.item.idPath) {
      const identity = getDraftField(item, field.item.idPath);
      if (typeof identity === "string") return identity;
    }
    return sessionKeys[index] ?? `${prefix}-${index}`;
  };

  const commitItems = (nextItems: readonly unknown[]) =>
    onCandidate(setDraftField(draft, field.path, nextItems));

  useEffect(() => {
    const action = pendingActionFocus.current;
    if (!action) return;
    pendingActionFocus.current = undefined;
    actionRefs.current.get(action)?.focus();
  });

  return (
    <section className="repeatable-field-v2" aria-label={field.label}>
      <header>
        <h3>{field.label}</h3>
        <small>
          {items.length} / {field.maxItems}
        </small>
      </header>
      {items.map((item, index) => {
        const rowPath = `${field.path}.${index}`;
        const rowKey = itemKey(item, index);
        return (
          <fieldset key={rowKey} aria-label={`${field.label} 第 ${index + 1} 项`}>
            <legend>第 {index + 1} 项</legend>
            {field.item.kind === "value" ? (
              <div className="document-field-v2">
                <span>{field.item.label}</span>
                {field.item.control === "textarea" ? (
                  <textarea
                    aria-label={`${field.item.label} 第 ${index + 1} 项`}
                    aria-invalid={issues.some((entry) => entry.path === rowPath) || undefined}
                    aria-describedby={
                      issues.some((entry) => entry.path === rowPath)
                        ? `${prefix}-${index}-error`
                        : undefined
                    }
                    data-field-path={rowPath}
                    value={typeof item === "string" ? item : ""}
                    onChange={(event) =>
                      commitItems(
                        items.map((value, itemIndex) =>
                          itemIndex === index ? event.target.value : value,
                        ),
                      )
                    }
                  />
                ) : (
                  <input
                    type="text"
                    aria-label={`${field.item.label} 第 ${index + 1} 项`}
                    aria-invalid={issues.some((entry) => entry.path === rowPath) || undefined}
                    aria-describedby={
                      issues.some((entry) => entry.path === rowPath)
                        ? `${prefix}-${index}-error`
                        : undefined
                    }
                    data-field-path={rowPath}
                    value={typeof item === "string" ? item : ""}
                    onChange={(event) =>
                      commitItems(
                        items.map((value, itemIndex) =>
                          itemIndex === index ? event.target.value : value,
                        ),
                      )
                    }
                  />
                )}
                {issues.find((entry) => entry.path === rowPath) ? (
                  <small id={`${prefix}-${index}-error`} className="document-field-error-v2">
                    {issues.find((entry) => entry.path === rowPath)?.message}
                  </small>
                ) : null}
              </div>
            ) : (
              field.item.fields.map((itemField) => {
                if (!isVisible(itemField, draft, item)) return null;
                const path = `${rowPath}.${itemField.path}`;
                return (
                  <FieldControl
                    key={itemField.path}
                    field={itemField}
                    path={path}
                    value={getDraftField(draft, path)}
                    rootDraft={draft}
                    issue={issues.find((entry) => entry.path === path)}
                    rawOverride={rawValues[path]}
                    onRawChange={(raw) => onRawValue(itemField, path, raw)}
                    onAttachmentFiles={onAttachmentFiles}
                  />
                );
              })
            )}
            <div className="repeatable-row-actions-v2">
              <button
                type="button"
                aria-label="上移"
                ref={(node) => {
                  const action = `${rowKey}-up`;
                  if (node) actionRefs.current.set(action, node);
                  else actionRefs.current.delete(action);
                }}
                disabled={index === 0}
                onClick={() => {
                  pendingActionFocus.current = `${rowKey}-down`;
                  const next = [...items];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  setSessionKeys((current) => {
                    const keys = [...current];
                    const previousKey = keys[index - 1] ?? stableId(prefix, index - 1);
                    const currentKey = keys[index] ?? stableId(prefix, index);
                    keys[index - 1] = currentKey;
                    keys[index] = previousKey;
                    return keys;
                  });
                  commitItems(next);
                }}
              >
                <ArrowUp size={14} aria-hidden="true" /> 上移
              </button>
              <button
                type="button"
                aria-label="下移"
                ref={(node) => {
                  const action = `${rowKey}-down`;
                  if (node) actionRefs.current.set(action, node);
                  else actionRefs.current.delete(action);
                }}
                disabled={index === items.length - 1}
                onClick={() => {
                  pendingActionFocus.current = `${rowKey}-up`;
                  const next = [...items];
                  [next[index], next[index + 1]] = [next[index + 1], next[index]];
                  setSessionKeys((current) => {
                    const keys = [...current];
                    const currentKey = keys[index] ?? stableId(prefix, index);
                    const nextKey = keys[index + 1] ?? stableId(prefix, index + 1);
                    keys[index] = nextKey;
                    keys[index + 1] = currentKey;
                    return keys;
                  });
                  commitItems(next);
                }}
              >
                <ArrowDown size={14} aria-hidden="true" /> 下移
              </button>
              {!fixed && items.length > field.minItems ? (
                <button
                  type="button"
                  aria-label="删除"
                  onClick={() => {
                    commitItems(items.filter((_, itemIndex) => itemIndex !== index));
                    setSessionKeys((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    );
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" /> 删除
                </button>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      {stagedGuaranteeMethods && pendingGuaranteeMethod !== null ? (
        <div className="repeatable-pending-value-v2">
          <input
            type="text"
            aria-label="新增保证方式"
            value={pendingGuaranteeMethod}
            onChange={(event) => setPendingGuaranteeMethod(event.currentTarget.value)}
          />
          <button
            type="button"
            disabled={pendingGuaranteeMethod.trim().length === 0}
            onClick={() => {
              const method = pendingGuaranteeMethod.trim();
              if (!method) return;
              setSessionKeys((current) => [...current, stableId(prefix, nextKey.current++)]);
              setPendingGuaranteeMethod(null);
              commitItems([...items, method]);
            }}
          >
            确认添加保证方式
          </button>
          <button type="button" onClick={() => setPendingGuaranteeMethod(null)}>
            取消
          </button>
        </div>
      ) : null}
      {!stagedGuaranteeMethods && factoryPlan.sourceOptions.length > 0 ? (
        <label className="repeatable-factory-source-v2">
          <span>新增{field.label}来源</span>
          <select
            aria-label={`选择${field.label}来源`}
            value={selectedSourceAvailable ? selectedFactorySource : ""}
            onChange={(event) => {
              setFactoryError(undefined);
              setSelectedFactorySource(event.currentTarget.value);
            }}
          >
            <option value="">请选择</option>
            {factoryPlan.sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!fixed && items.length < field.maxItems ? (
        <button
          type="button"
          disabled={!stagedGuaranteeMethods && !canAddFromFactory}
          aria-describedby={
            !stagedGuaranteeMethods && !canAddFromFactory ? blockedReasonId : undefined
          }
          onClick={() => {
            if (stagedGuaranteeMethods) {
              setPendingGuaranteeMethod("");
              return;
            }
            const id = factoryPlan.generatedIdentity ? crypto.randomUUID() : selectedFactorySource;
            if (!id || !canAddFromFactory) return;
            try {
              const item = registration.createRepeatableItem(field.path, {
                id,
                now: new Date().toISOString(),
                draft,
              });
              setFactoryError(undefined);
              setSelectedFactorySource("");
              setSessionKeys((current) => [...current, stableId(prefix, nextKey.current++)]);
              commitItems([...items, item]);
            } catch {
              setFactoryError("当前来源无法创建此项，请检查来源内容后重试。");
            }
          }}
        >
          <Plus size={15} aria-hidden="true" /> 添加{field.label}
        </button>
      ) : null}
      {!stagedGuaranteeMethods && !fixed && items.length < field.maxItems && addReason ? (
        <small id={blockedReasonId} className="document-field-help-v2">
          {addReason}
        </small>
      ) : null}
    </section>
  );
}

export function SchemaForm({
  registration,
  draft,
  issues = [],
  onDraftChange,
  onValidationChange,
  onAttachmentFiles,
}: SchemaFormProps) {
  const [localIssues, setLocalIssues] = useState<readonly FormIssue[]>([]);
  const [rawValues, setRawValues] = useState<Readonly<Record<string, unknown>>>({});
  const pendingGuaranteeRef = useRef<unknown | undefined>(undefined);
  const [pendingGuarantee, setPendingGuarantee] = useState<unknown | undefined>(undefined);
  const allIssues = [...issues, ...localIssues];
  const displayDraft =
    pendingGuarantee === undefined
      ? draft
      : setDraftField(draft, GUARANTEE_ROOT_PATH, pendingGuarantee);
  const sections = useMemo(() => {
    const output = new Map<string, TemplateFieldManifestEntryV1[]>();
    for (const field of registration.definition.fieldManifest) {
      const list = output.get(field.section) ?? [];
      list.push(field);
      output.set(field.section, list);
    }
    return [...output.entries()];
  }, [registration]);

  const acceptCandidate = (candidate: unknown): void => {
    try {
      const parsed = registration.parseDraft(candidate);
      setLocalIssues([]);
      onValidationChange?.([]);
      onDraftChange(parsed);
    } catch (error) {
      const nextIssues = errorIssues(error);
      setLocalIssues(nextIssues);
      onValidationChange?.(nextIssues);
    }
  };

  const stageGuaranteeCandidate = (candidate: unknown): void => {
    const group = getDraftField(candidate, GUARANTEE_ROOT_PATH);
    const rebased = setDraftField(draft, GUARANTEE_ROOT_PATH, group);
    try {
      const parsed = registration.parseDraft(rebased);
      pendingGuaranteeRef.current = undefined;
      setPendingGuarantee(undefined);
      setRawValues((current) =>
        Object.fromEntries(Object.entries(current).filter(([path]) => !isGuaranteePath(path))),
      );
      setLocalIssues([]);
      onValidationChange?.([]);
      onDraftChange(parsed);
    } catch (error) {
      pendingGuaranteeRef.current = group;
      setPendingGuarantee(group);
      const nextIssues = errorIssues(error);
      setLocalIssues(nextIssues);
      onValidationChange?.(nextIssues);
    }
  };

  const updateRaw = (field: EditorField, path: string, raw: unknown): void => {
    setRawValues((current) => ({ ...current, [path]: raw }));
    try {
      const sourceDraft =
        isGuaranteePath(path) && pendingGuaranteeRef.current !== undefined
          ? setDraftField(draft, GUARANTEE_ROOT_PATH, pendingGuaranteeRef.current)
          : draft;
      const currentValue = getDraftField(sourceDraft, path);
      const parsedRaw = parseRawFieldValue(
        field as TemplateFieldManifestEntryV1,
        raw,
        currentValue,
      );
      const candidate =
        field.control === "select" && !field.required && raw === ""
          ? updateDraftFromRaw(sourceDraft, { ...field, path } as TemplateFieldManifestEntryV1, raw)
          : setDraftField(sourceDraft, path, parsedRaw);
      if (isGuaranteePath(path)) stageGuaranteeCandidate(candidate);
      else acceptCandidate(candidate);
    } catch (error) {
      const nextIssues = [{ path, message: error instanceof Error ? error.message : "字段值无效" }];
      setLocalIssues(nextIssues);
      onValidationChange?.(nextIssues);
    }
  };

  const firstIssue = allIssues[0];
  return (
    <form className="schema-form-v2" onSubmit={(event) => event.preventDefault()} noValidate>
      {firstIssue ? (
        <button
          type="button"
          className="validation-jump-v2"
          onClick={() => {
            const controls = document.querySelectorAll<HTMLElement>("[data-field-path]");
            for (const control of controls) {
              if (control.dataset.fieldPath === firstIssue.path) {
                control.focus();
                break;
              }
            }
          }}
        >
          定位第一个错误
        </button>
      ) : null}
      {sections.map(([section, fields]) => (
        <fieldset
          className="schema-section-v2"
          aria-label={section}
          data-section={section}
          key={section}
        >
          <legend>{section}</legend>
          <div className="schema-section-grid-v2">
            {fields.map((field) => {
              if (!isVisible(field, displayDraft)) return null;
              if (field.control === "repeatable") {
                return (
                  <RepeatableControl
                    key={field.path}
                    field={field}
                    registration={registration}
                    draft={displayDraft}
                    issues={allIssues}
                    rawValues={rawValues}
                    onRawValue={(itemField, path, raw) => updateRaw(itemField, path, raw)}
                    onCandidate={
                      isGuaranteePath(field.path) ? stageGuaranteeCandidate : acceptCandidate
                    }
                    onAttachmentFiles={onAttachmentFiles}
                  />
                );
              }
              return (
                <FieldControl
                  key={field.path}
                  field={field}
                  path={field.path}
                  value={getDraftField(displayDraft, field.path)}
                  rootDraft={displayDraft}
                  issue={allIssues.find((entry) => entry.path === field.path)}
                  rawOverride={rawValues[field.path]}
                  onRawChange={(raw) => updateRaw(field, field.path, raw)}
                  onAttachmentFiles={onAttachmentFiles}
                />
              );
            })}
          </div>
        </fieldset>
      ))}
    </form>
  );
}
