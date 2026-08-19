import type { FormParty } from "./draftConversion";

const partyFields: Array<{
  key: keyof FormParty;
  label: string;
  type?: "email" | "tel";
}> = [
  { key: "name", label: "名称" },
  { key: "address", label: "地址" },
  { key: "contactName", label: "联系人" },
  { key: "phone", label: "电话", type: "tel" },
  { key: "email", label: "邮箱", type: "email" },
  { key: "taxId", label: "税号" },
  { key: "bankName", label: "开户行" },
  { key: "bankAccount", label: "银行账号" },
];

export function PartyFields({
  partyRole,
  party,
  errors,
  onChange,
}: {
  partyRole: "seller" | "buyer";
  party: FormParty;
  errors: Record<string, string>;
  onChange: (party: FormParty) => void;
}) {
  const prefix = partyRole === "seller" ? "报价方" : "采购方";
  return (
    <fieldset className="party-fields">
      <legend>{prefix}信息</legend>
      <div className="field-grid">
        {partyFields.map((field) => {
          const path = `${partyRole}.${field.key}`;
          const error = errors[path];
          const errorId = `${partyRole}-${
            field.key === "contactName"
              ? "contact-name"
              : field.key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)
          }-error`;
          return (
            <label key={field.key} className={field.key === "address" ? "wide-field" : undefined}>
              <span>
                {prefix}
                {field.label}
                {field.key === "name" ? " *" : ""}
              </span>
              <input
                name={path}
                aria-label={`${prefix}${field.label}`}
                type={field.type ?? "text"}
                value={party[field.key]}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => onChange({ ...party, [field.key]: event.target.value })}
              />
              {error && (
                <small className="field-error" id={errorId}>
                  {error}
                </small>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
