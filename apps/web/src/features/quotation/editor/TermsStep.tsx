import type { QuotationFormState } from "./draftConversion";

const termFields: Array<[keyof QuotationFormState["terms"], string]> = [
  ["delivery", "交货条款"],
  ["payment", "付款条款"],
  ["quality", "质量与检验"],
  ["warranty", "质保条款"],
  ["notes", "备注"],
];

export function TermsStep({
  form,
  onChange,
}: {
  form: QuotationFormState;
  onChange: (form: QuotationFormState) => void;
}) {
  return (
    <div className="terms-fields">
      {termFields.map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <textarea
            rows={key === "notes" ? 5 : 3}
            value={form.terms[key]}
            onChange={(event) =>
              onChange({
                ...form,
                terms: { ...form.terms, [key]: event.target.value },
              })
            }
          />
        </label>
      ))}
    </div>
  );
}
