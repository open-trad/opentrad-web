import type { QuotationFormState } from "./draftConversion";
import { PartyFields } from "./PartyFields";

export function BuyerStep({
  form,
  errors,
  onChange,
}: {
  form: QuotationFormState;
  errors: Record<string, string>;
  onChange: (form: QuotationFormState) => void;
}) {
  return (
    <PartyFields
      partyRole="buyer"
      party={form.buyer}
      errors={errors}
      onChange={(buyer) => onChange({ ...form, buyer })}
    />
  );
}
