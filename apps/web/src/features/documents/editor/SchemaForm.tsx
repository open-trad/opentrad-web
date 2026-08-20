import type {
  TemplateFieldManifestEntryV1,
  TemplateRegistration,
  v2,
} from "@opentrad/document-core";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { getDraftField, parseRawFieldValue, setDraftField, updateDraftFromRaw } from "./fieldPaths";

type RepeatableItemField = v2.TemplateRepeatableItemFieldV1;
type EditorField = TemplateFieldManifestEntryV1 | RepeatableItemField;
type Registration = ReturnType<typeof v2.V2_TEMPLATE_REGISTRY.get> | TemplateRegistration;

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
  if (field.control === "checkbox") {
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
  const [sessionKeys, setSessionKeys] = useState(() =>
    items.map((_, index) => stableId(prefix, index)),
  );
  const fixed = field.minItems === field.maxItems;

  const itemKey = (item: unknown, index: number): string => {
    if (field.item.kind === "object" && field.item.idPath) {
      const identity = getDraftField(item, field.item.idPath);
      if (typeof identity === "string") return identity;
    }
    return sessionKeys[index] ?? `${prefix}-${index}`;
  };

  const commitItems = (nextItems: readonly unknown[]) =>
    onCandidate(setDraftField(draft, field.path, nextItems));

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
        return (
          <fieldset key={itemKey(item, index)} aria-label={`${field.label} 第 ${index + 1} 项`}>
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
            {!fixed ? (
              <div className="repeatable-row-actions-v2">
                <button
                  type="button"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={() => {
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
                  disabled={index === items.length - 1}
                  onClick={() => {
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
                {items.length > field.minItems ? (
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
            ) : null}
          </fieldset>
        );
      })}
      {!fixed && items.length < field.maxItems ? (
        <button
          type="button"
          onClick={() => {
            const item = registration.createRepeatableItem(field.path, {
              id: crypto.randomUUID(),
              now: new Date().toISOString(),
              draft,
            });
            setSessionKeys((current) => [...current, stableId(prefix, nextKey.current++)]);
            commitItems([...items, item]);
          }}
        >
          <Plus size={15} aria-hidden="true" /> 添加{field.label}
        </button>
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
  const allIssues = [...issues, ...localIssues];
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

  const updateRaw = (field: EditorField, path: string, raw: unknown): void => {
    setRawValues((current) => ({ ...current, [path]: raw }));
    try {
      const currentValue = getDraftField(draft, path);
      const parsedRaw = parseRawFieldValue(
        field as TemplateFieldManifestEntryV1,
        raw,
        currentValue,
      );
      const candidate =
        field.control === "select" && !field.required && raw === ""
          ? updateDraftFromRaw(draft, { ...field, path } as TemplateFieldManifestEntryV1, raw)
          : setDraftField(draft, path, parsedRaw);
      acceptCandidate(candidate);
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
              if (!isVisible(field, draft)) return null;
              if (field.control === "repeatable") {
                return (
                  <RepeatableControl
                    key={field.path}
                    field={field}
                    registration={registration}
                    draft={draft}
                    issues={allIssues}
                    rawValues={rawValues}
                    onRawValue={(itemField, path, raw) => updateRaw(itemField, path, raw)}
                    onCandidate={acceptCandidate}
                    onAttachmentFiles={onAttachmentFiles}
                  />
                );
              }
              return (
                <FieldControl
                  key={field.path}
                  field={field}
                  path={field.path}
                  value={getDraftField(draft, field.path)}
                  rootDraft={draft}
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
