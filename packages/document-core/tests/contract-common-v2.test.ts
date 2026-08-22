import { describe, expect, it } from "vitest";
import { createStandardGoodsQuoteDraft } from "../src/index";
import type { ContractSignersV1, PaymentScheduleV1 } from "../src/v2/index";
import {
  BilingualContractTextV1Schema,
  CISG_CHOICES_V1,
  CisgChoiceV1Schema,
  ContractGeneralTermsV1Schema,
  ContractMetaV2Schema,
  ContractSignersV1Schema,
  ContractSignerV1Schema,
  PaymentMilestoneV1Schema,
  PaymentScheduleV1Schema,
} from "../src/v2/index";

function contractMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractNumber: "CT-20260820-001",
    title: "销售合同",
    signingDate: "2026-08-20",
    signingPlace: "上海",
    effectiveMode: "signature",
    copies: 2,
    language: "zh-CN",
    layoutStyleId: "classic-formal.v1",
    ...overrides,
  };
}

function generalTerms(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    noticeAddresses: "以合同所列地址送达",
    confidentiality: "双方对商业秘密承担保密义务",
    forceMajeure: "及时通知并提供证明",
    changeControl: "变更须经双方书面确认",
    termination: "按约定解除",
    breachRemedies: "赔偿实际损失",
    governingLaw: "中华人民共和国法律",
    disputeMethod: "arbitration",
    arbitrationCommission: "上海国际经济贸易仲裁委员会",
    severability: "部分无效不影响其他条款",
    entireAgreement: "正文与附件构成完整协议",
    ...overrides,
  };
}

function milestone(id = "deposit", amountBps = 10_000): Record<string, unknown> {
  return { id, trigger: "合同生效后付款", amountBps, dueDays: 10 };
}

function signer(partyId = "seller"): Record<string, unknown> {
  return {
    partyId,
    role: { zhCN: "卖方", enUS: "Seller" },
    signatoryName: "张三",
    signatoryTitle: "法定代表人",
    dateLabel: { zhCN: "签署日期", enUS: "Date" },
    sealLabel: { zhCN: "盖章", enUS: "Seal" },
  };
}

function expectDeepSafeOutput(value: unknown, path = "output"): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value), `${path} frozen`).toBe(true);
  expect(Object.getPrototypeOf(value), `${path} prototype`).toBe(
    Array.isArray(value) ? Array.prototype : null,
  );
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    expect(descriptor && "value" in descriptor, `${path}.${String(key)} own data`).toBe(true);
    if (descriptor && "value" in descriptor) {
      expectDeepSafeOutput(descriptor.value, `${path}.${String(key)}`);
    }
  }
}

interface SchemaLike {
  safeParse(input: unknown): { success: boolean; data?: unknown };
}

function reachableSchemas(root: object): SchemaLike[] {
  const schemas: SchemaLike[] = [];
  const pending: object[] = [root];
  const visited = new WeakSet<object>();
  let visitedCount = 0;
  while (pending.length > 0 && visitedCount < 200) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    visitedCount += 1;
    if (current !== root && "safeParse" in current && typeof current.safeParse === "function") {
      schemas.push(current as SchemaLike);
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const child = descriptor.value;
      if ((typeof child === "object" && child !== null) || typeof child === "function") {
        pending.push(child as object);
      }
    }
  }
  return schemas;
}

const publicSchemas: readonly SchemaLike[] = [
  ContractMetaV2Schema,
  ContractGeneralTermsV1Schema,
  PaymentMilestoneV1Schema,
  PaymentScheduleV1Schema,
  ContractSignerV1Schema,
  ContractSignersV1Schema,
  BilingualContractTextV1Schema,
  CisgChoiceV1Schema,
];

describe("V2 contract metadata", () => {
  it("models all three mutually exclusive effective modes", () => {
    expect(ContractMetaV2Schema.parse(contractMeta())).toEqual(contractMeta());
    expect(
      ContractMetaV2Schema.safeParse(
        contractMeta({ effectiveMode: "date", effectiveDate: "2026-09-01" }),
      ).success,
    ).toBe(true);
    expect(
      ContractMetaV2Schema.safeParse(
        contractMeta({ effectiveMode: "condition", effectiveCondition: "双方完成盖章后生效" }),
      ).success,
    ).toBe(true);

    for (const invalid of [
      contractMeta({ effectiveMode: "date" }),
      contractMeta({ effectiveMode: "condition" }),
      contractMeta({ effectiveMode: "signature", effectiveDate: "2026-09-01" }),
      contractMeta({ effectiveMode: "signature", effectiveCondition: "完成交付" }),
      contractMeta({
        effectiveMode: "date",
        effectiveDate: "2026-09-01",
        effectiveCondition: "完成交付",
      }),
      contractMeta({
        effectiveMode: "condition",
        effectiveDate: "2026-09-01",
        effectiveCondition: "完成交付",
      }),
      contractMeta({ effectiveMode: "condition", effectiveCondition: "  " }),
    ]) {
      expect(ContractMetaV2Schema.safeParse(invalid).success).toBe(false);
    }
  });

  it("models language priority as a strict bilingual discriminator", () => {
    for (const language of ["zh-CN", "en-US"]) {
      expect(ContractMetaV2Schema.safeParse(contractMeta({ language })).success).toBe(true);
      expect(
        ContractMetaV2Schema.safeParse(contractMeta({ language, languagePriority: "zh-CN" }))
          .success,
      ).toBe(false);
    }
    for (const languagePriority of ["zh-CN", "en-US"]) {
      expect(
        ContractMetaV2Schema.safeParse(contractMeta({ language: "zh-en", languagePriority }))
          .success,
      ).toBe(true);
    }
    expect(ContractMetaV2Schema.safeParse(contractMeta({ language: "zh-en" })).success).toBe(false);
    expect(
      ContractMetaV2Schema.safeParse(contractMeta({ language: "zh-en", languagePriority: "zh-en" }))
        .success,
    ).toBe(false);
  });

  it("requires real calendar dates and integer copies from 1 through 100", () => {
    expect(
      ContractMetaV2Schema.safeParse(contractMeta({ signingDate: "2028-02-29" })).success,
    ).toBe(true);
    for (const signingDate of ["2027-02-29", "2026-04-31", "2026-2-01"]) {
      expect(ContractMetaV2Schema.safeParse(contractMeta({ signingDate })).success).toBe(false);
    }
    expect(
      ContractMetaV2Schema.safeParse(
        contractMeta({ effectiveMode: "date", effectiveDate: "2027-02-29" }),
      ).success,
    ).toBe(false);
    for (const copies of [1, 100]) {
      expect(ContractMetaV2Schema.safeParse(contractMeta({ copies })).success).toBe(true);
    }
    for (const copies of [0, 101, 1.5]) {
      expect(ContractMetaV2Schema.safeParse(contractMeta({ copies })).success).toBe(false);
    }
  });
});

describe("V2 contract terms and international choices", () => {
  it("preserves the selected court or arbitration forum without inference", () => {
    const arbitration = generalTerms();
    const { arbitrationCommission: _omittedForum, ...courtTerms } = generalTerms();
    const court = {
      ...courtTerms,
      disputeMethod: "court",
      court: "上海市浦东新区人民法院",
      governingLaw: "用户明确选择的适用法",
      noticeAddresses: "用户明确填写的通知地址",
    };
    expect(ContractGeneralTermsV1Schema.parse(arbitration)).toEqual(arbitration);
    expect(ContractGeneralTermsV1Schema.parse(court)).toEqual(court);
    for (const invalid of [
      generalTerms({ arbitrationCommission: "" }),
      generalTerms({ arbitrationCommission: undefined }),
      generalTerms({ court: "上海市某法院" }),
      generalTerms({ disputeMethod: "court", arbitrationCommission: undefined }),
      generalTerms({
        disputeMethod: "court",
        court: "上海市某法院",
        arbitrationCommission: "上海仲裁委员会",
      }),
      generalTerms({ disputeMethod: "court", court: "  ", arbitrationCommission: undefined }),
      generalTerms({ unknown: true }),
    ]) {
      expect(ContractGeneralTermsV1Schema.safeParse(invalid).success).toBe(false);
    }
  });

  it("requires complete nonblank bilingual text and exact frozen CISG choices", () => {
    const bilingual = { zhCN: "本合同适用约定文本", enUS: "The agreed text applies." };
    expect(BilingualContractTextV1Schema.parse(bilingual)).toEqual(bilingual);
    for (const invalid of [
      { zhCN: "中文" },
      { enUS: "English" },
      { zhCN: "  ", enUS: "English" },
      { zhCN: "中文", enUS: "\n\t" },
      { ...bilingual, extra: true },
    ]) {
      expect(BilingualContractTextV1Schema.safeParse(invalid).success).toBe(false);
    }
    expect(CISG_CHOICES_V1).toEqual(["apply", "exclude", "undecided"]);
    expect(Object.isFrozen(CISG_CHOICES_V1)).toBe(true);
    expect(CISG_CHOICES_V1.every((choice) => CisgChoiceV1Schema.safeParse(choice).success)).toBe(
      true,
    );
    expect(CisgChoiceV1Schema.safeParse("automatic").success).toBe(false);
  });
});

describe("V2 payment and signature primitives", () => {
  it("exports readonly collection aliases for validated schedules and signers", () => {
    const paymentSchedule: PaymentScheduleV1 = [];
    const signers: ContractSignersV1 = [];
    expect(paymentSchedule).toEqual([]);
    expect(signers).toEqual([]);
  });

  it("validates bounded milestones and exact 10,000 basis-point schedules", () => {
    expect(PaymentMilestoneV1Schema.parse(milestone())).toEqual(milestone());
    for (const invalid of [
      milestone("bad id", 10_000),
      { ...milestone(), trigger: "  " },
      { ...milestone(), amountBps: -1 },
      { ...milestone(), amountBps: 10_001 },
      { ...milestone(), amountBps: 1.5 },
      { ...milestone(), dueDays: -1 },
      { ...milestone(), dueDays: 36_501 },
      { ...milestone(), dueDays: 1.5 },
      { ...milestone(), retentionBps: 500 },
    ]) {
      expect(PaymentMilestoneV1Schema.safeParse(invalid).success).toBe(false);
    }
    expect(
      PaymentScheduleV1Schema.safeParse([milestone("deposit", 3_000), milestone("delivery", 7_000)])
        .success,
    ).toBe(true);
    expect(PaymentScheduleV1Schema.safeParse([milestone("deposit", 9_999)]).success).toBe(false);
    expect(
      PaymentScheduleV1Schema.safeParse([milestone("deposit", 10_000), milestone("x", 1)]).success,
    ).toBe(false);
    expect(
      PaymentScheduleV1Schema.safeParse([
        milestone("duplicate", 5_000),
        milestone("duplicate", 5_000),
      ]).success,
    ).toBe(false);
    expect(PaymentScheduleV1Schema.safeParse([]).success).toBe(false);
    expect(PaymentScheduleV1Schema.safeParse(new Array(1)).success).toBe(false);
    expect(
      PaymentScheduleV1Schema.safeParse(
        Array.from({ length: 100 }, (_, index) => milestone(`m-${index}`, 100)),
      ).success,
    ).toBe(true);
  });

  it("fails 101 milestones before reading any numeric element or descriptor", () => {
    let numericReads = 0;
    let numericDescriptorReads = 0;
    const oversized = new Proxy(new Array(101), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) numericReads += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && /^\d+$/.test(property)) numericDescriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expect(PaymentScheduleV1Schema.safeParse(oversized).success).toBe(false);
    expect(numericReads).toBe(0);
    expect(numericDescriptorReads).toBe(0);
  });

  it("requires unique party ids in 1..10 signers", () => {
    expect(ContractSignerV1Schema.parse(signer())).toEqual(signer());
    expect(ContractSignersV1Schema.safeParse([]).success).toBe(false);
    expect(ContractSignersV1Schema.safeParse([signer("same"), signer("same")]).success).toBe(false);
    expect(
      ContractSignersV1Schema.safeParse(
        Array.from({ length: 10 }, (_, index) => signer(`p-${index}`)),
      ).success,
    ).toBe(true);
    expect(
      ContractSignersV1Schema.safeParse(
        Array.from({ length: 11 }, (_, index) => signer(`p-${index}`)),
      ).success,
    ).toBe(false);
    expect(ContractSignersV1Schema.safeParse(new Array(1)).success).toBe(false);
    expect(ContractSignerV1Schema.safeParse({ ...signer(), partyRole: "seller" }).success).toBe(
      false,
    );
    expect(
      ContractSignerV1Schema.safeParse({
        ...signer(),
        role: { zhCN: "卖方", enUS: "Seller", unknown: true },
      }).success,
    ).toBe(false);
  });
});

describe("V2 contract security boundaries", () => {
  it("rejects HTML, XML controls, lone surrogates, per-string and aggregate budgets", () => {
    for (const contractNumber of ["<b>CT-1</b>", "CT-\u0001", "CT-\ud800", "x".repeat(65)]) {
      expect(
        ContractMetaV2Schema.safeParse(contractMeta({ contractNumber })).success,
        JSON.stringify(contractNumber),
      ).toBe(false);
    }
    expect(
      ContractGeneralTermsV1Schema.safeParse(generalTerms({ otherTerms: "汉".repeat(16_385) }))
        .success,
    ).toBe(false);
    expect(
      ContractGeneralTermsV1Schema.safeParse(
        generalTerms({
          noticeAddresses: "a".repeat(8_000),
          confidentiality: "b".repeat(8_000),
          forceMajeure: "c".repeat(8_000),
          changeControl: "d".repeat(8_000),
          termination: "e".repeat(8_000),
          breachRemedies: "f".repeat(8_000),
          governingLaw: "g".repeat(8_000),
          arbitrationCommission: "h".repeat(8_000),
          severability: "i".repeat(8_000),
          entireAgreement: "j".repeat(8_000),
        }),
      ).success,
    ).toBe(false);
  });

  it("turns every hostile input into a no-throw failure for every public schema", () => {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "contractNumber", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    });
    const dangerousCases = ["__proto__", "constructor", "prototype"].map((key) => {
      const value = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(value, key, { enumerable: true, value: {} });
      return value;
    });
    const symbol = Object.create(null) as Record<PropertyKey, unknown>;
    symbol[Symbol("hidden")] = true;
    const customPrototype = Object.create({ inherited: true });
    const cycle = Object.create(null) as Record<string, unknown>;
    cycle.self = cycle;
    const throwing = new Proxy(Object.create(null), {
      ownKeys() {
        throw new Error("malicious ownKeys");
      },
    });
    const { proxy: revoked, revoke } = Proxy.revocable(Object.create(null), {});
    revoke();

    for (const schema of publicSchemas) {
      for (const input of [
        accessor,
        ...dangerousCases,
        symbol,
        customPrototype,
        cycle,
        throwing,
        revoked,
      ]) {
        let result: { success: boolean } | undefined;
        expect(() => {
          result = schema.safeParse(input);
        }).not.toThrow();
        expect(result?.success).toBe(false);
      }
    }
    expect(getterCalls).toBe(0);
  });

  it("returns isolated deeply frozen own-data outputs and ignores inherited setters", () => {
    const originalPartyId = Reflect.getOwnPropertyDescriptor(Object.prototype, "partyId");
    let setterCalls = 0;
    try {
      Object.defineProperty(Object.prototype, "partyId", {
        configurable: true,
        set() {
          setterCalls += 1;
        },
      });
      const input = signer();
      const parsed = ContractSignerV1Schema.parse(input);
      (input.role as Record<string, unknown>).zhCN = "被篡改";
      expect(parsed.role.zhCN).toBe("卖方");
      expect(setterCalls).toBe(0);
      expectDeepSafeOutput(parsed);
      expect(() => {
        (parsed.role as { zhCN: string }).zhCN = "mutated";
      }).toThrow();
      expectDeepSafeOutput(PaymentScheduleV1Schema.parse([milestone()]));
    } finally {
      if (originalPartyId) Object.defineProperty(Object.prototype, "partyId", originalPartyId);
      else Reflect.deleteProperty(Object.prototype, "partyId");
    }
  });

  it("does not expose reachable raw or unbounded child schemas", () => {
    for (const schema of publicSchemas) expect(reachableSchemas(schema as object)).toEqual([]);
  });
});

describe("V1 compatibility", () => {
  it("keeps the V1 draft contract unchanged", () => {
    const draft = createStandardGoodsQuoteDraft({
      id: "contract-common-v2-v1",
      now: "2026-08-20T00:00:00.000Z",
    });
    expect(draft.templateId).toBe("quotation.goods.standard.v1");
    expect(draft.templateVersion).toBe("1.0.0");
  });
});
