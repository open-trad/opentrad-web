import { describe, expect, it, vi } from "vitest";
import { createStandardGoodsQuoteDraft } from "../src/index";
import {
  BidDraftBaseV1Schema,
  BidExportDecisionV1Schema,
  BidGuaranteeRecordV1Schema,
  BidGuaranteeRequirementV1Schema,
  BidPriceDeclarationV1Schema,
  BidProjectReferenceV1Schema,
  DeviationEntryV1Schema,
  decideBidExport,
  EvidenceRefV1Schema,
  preflightBidCommon,
  QualificationItemV1Schema,
  RequirementResponseV1Schema,
  SignSealChecklistItemV1Schema,
  SolicitationSnapshotV1Schema,
  VersionEvidenceV1Schema,
} from "../src/v2/index";

type JsonRecord = Record<string, unknown>;

function attachment(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    category: "technical",
    displayName: `${id}.pdf`,
    mediaType: "application/pdf",
    pageCount: 20,
    required: true,
    status: "attached",
    includedInSubmission: true,
    ...overrides,
  };
}

function versionEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mainSolicitationAttachmentId: "source-main",
    clarificationAttachments: [
      { clarificationId: "CL-01", attachmentId: "source-clarification-01" },
    ],
    allClarificationsIncluded: true,
    userConfirmedExactVersion: true,
    ...overrides,
  };
}

function guaranteeRequirement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    required: true,
    allowedMethods: ["bank-guarantee"],
    amountMinor: "100000",
    sourceRefIds: ["source-guarantee"],
    ...overrides,
  };
}

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer: "某采购单位",
    agency: "某采购代理机构",
    projectName: "设备采购项目",
    projectNumber: "CG-2026-001",
    packageNumber: "包1",
    versionLabel: "招标文件正式版及澄清01",
    issueDate: "2026-08-01",
    clarificationIds: ["CL-01"],
    versionEvidence: versionEvidence(),
    bidDeadline: "2026-08-25T09:00:00+08:00",
    openingTime: "2026-08-25T09:30:00+08:00",
    openingPlace: "采购平台线上开标室",
    bidValidityDays: 90,
    submissionMode: "electronic",
    signatureRules: "按采购平台要求电子签章",
    sealingRules: "电子文件加密后提交",
    currency: "CNY",
    taxBasis: "tax-included",
    evaluationMethod: "comprehensive-score",
    maximumPriceMinor: "2000000",
    jointVentureAllowed: false,
    subcontractAllowed: false,
    submissionCopies: { original: 0, copies: 0, electronic: 1 },
    guaranteeRequirement: guaranteeRequirement(),
    ...overrides,
  };
}

function evidenceRefs(): Record<string, unknown>[] {
  return [
    {
      id: "source-requirement",
      kind: "solicitation",
      sourceRef: "第三章 3.2",
      attachmentId: "source-main",
      page: 10,
    },
    {
      id: "source-guarantee",
      kind: "solicitation",
      sourceRef: "第二章 17.1",
      attachmentId: "source-main",
      page: 6,
    },
    {
      id: "proof-qualification",
      kind: "proof",
      attachmentId: "proof-qualification",
      page: 1,
      label: "营业执照证明页",
    },
  ];
}

function requirement(
  id = "requirement-1",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    sourceRefIds: ["source-requirement"],
    category: "technical",
    requirementText: "设备必须满足招标参数。",
    substantial: true,
    responseStatus: "reviewed",
    responseText: "所投设备满足该参数。",
    compliance: "yes",
    evidenceRefIds: ["proof-qualification"],
    reviewStatus: "accepted",
    ...overrides,
  };
}

function qualification(
  id = "qualification-1",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    sourceRefIds: ["source-requirement"],
    name: "营业执照",
    required: true,
    issuer: "登记机关",
    certificateNumber: "CERT-001",
    validUntil: "2028-08-01",
    attachmentId: "proof-qualification",
    status: "attached",
    userConfirmedTruth: true,
    ...overrides,
  };
}

function deviation(
  requirementId = "requirement-1",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requirementId,
    type: "technical",
    sourceRefIds: ["source-requirement"],
    requirement: "原要求",
    response: "我方响应",
    deviation: "存在一项明确偏差",
    ...overrides,
  };
}

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "bid-common-test",
    templateId: "bid.government.goods.v1",
    templateVersion: "1.0.0",
    source: source(),
    bidder: {
      legalName: "宁波义星科技有限公司",
      entityType: "company",
      contactName: "张三",
      email: "bid@example.com",
    },
    authorizedRepresentative: "张三",
    consortiumMembers: [],
    requirements: [requirement()],
    qualifications: [qualification()],
    evidenceRefs: evidenceRefs(),
    businessDeviations: [],
    technicalDeviations: [],
    projectReferences: [],
    attachments: [
      attachment("source-main"),
      attachment("source-clarification-01"),
      attachment("proof-qualification", { category: "qualification" }),
      attachment("bid-guarantee", { category: "commercial" }),
    ],
    priceDeclaration: {
      itemizedTotalMinor: "1000000",
      bidLetterTotalMinor: "1000000",
      openingTotalMinor: "1000000",
      userConfirmed: true,
    },
    bidGuarantee: {
      method: "bank-guarantee",
      amountMinor: "100000",
      reference: "BG-2026-001",
      attachmentId: "bid-guarantee",
      userConfirmed: true,
    },
    signSealChecklist: [
      {
        id: "sign-1",
        sourceRefIds: ["source-requirement"],
        label: "投标函电子签章",
        required: true,
        confirmed: true,
      },
    ],
    finalReviewers: [{ name: "李四", role: "合规复核", reviewedAt: "2026-08-20T12:00:00Z" }],
    updatedAt: "2026-08-20T12:00:00Z",
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function exportInput(
  sourceValue: Record<string, unknown>,
  findings: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    draft: draft({ source: sourceValue }),
    findings,
    asOf: "2026-08-25T00:59:59Z",
    ...extra,
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
  VersionEvidenceV1Schema,
  SolicitationSnapshotV1Schema,
  EvidenceRefV1Schema,
  RequirementResponseV1Schema,
  QualificationItemV1Schema,
  BidPriceDeclarationV1Schema,
  BidProjectReferenceV1Schema,
  BidGuaranteeRequirementV1Schema,
  BidGuaranteeRecordV1Schema,
  SignSealChecklistItemV1Schema,
  DeviationEntryV1Schema,
  BidDraftBaseV1Schema,
  BidExportDecisionV1Schema,
];

describe("V2 bid source and evidence schemas", () => {
  it("parses the complete source and all common truth primitives", () => {
    expect(VersionEvidenceV1Schema.safeParse(versionEvidence()).success).toBe(true);
    expect(SolicitationSnapshotV1Schema.safeParse(source()).success).toBe(true);
    for (const evidence of evidenceRefs()) {
      expect(EvidenceRefV1Schema.safeParse(evidence).success).toBe(true);
    }
    expect(RequirementResponseV1Schema.safeParse(requirement()).success).toBe(true);
    expect(QualificationItemV1Schema.safeParse(qualification()).success).toBe(true);
    expect(BidPriceDeclarationV1Schema.safeParse(draft().priceDeclaration as object).success).toBe(
      true,
    );
    expect(BidGuaranteeRequirementV1Schema.safeParse(guaranteeRequirement()).success).toBe(true);
    expect(BidGuaranteeRecordV1Schema.safeParse(draft().bidGuarantee as object).success).toBe(true);
    expect(
      SignSealChecklistItemV1Schema.safeParse((draft().signSealChecklist as object[])[0]).success,
    ).toBe(true);
    expect(DeviationEntryV1Schema.safeParse(deviation()).success).toBe(true);
    expect(
      BidProjectReferenceV1Schema.safeParse({
        id: "project-1",
        projectName: "历史项目",
        customer: "某客户",
        period: "2025年",
        scope: "供货和安装",
        evidenceAttachmentId: "proof-qualification",
        userConfirmedTruth: true,
      }).success,
    ).toBe(true);
    expect(BidDraftBaseV1Schema.safeParse(draft()).success).toBe(true);
  });

  it("distinguishes solicitation citations from proof attachment pages", () => {
    expect(
      EvidenceRefV1Schema.safeParse({
        id: "bad-proof",
        kind: "proof",
        sourceRef: "第三章",
        attachmentId: "proof-qualification",
        page: 1,
      }).success,
    ).toBe(false);
    expect(
      EvidenceRefV1Schema.safeParse({
        id: "bad-source",
        kind: "solicitation",
        attachmentId: "source-main",
        page: 1,
      }).success,
    ).toBe(false);
    expect(
      EvidenceRefV1Schema.safeParse({
        id: "bad-page",
        kind: "proof",
        attachmentId: "proof-qualification",
        page: 0,
        label: "证明",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate ids and orphaned source, proof, deviation, sign, and guarantee references", () => {
    const duplicate = draft({ requirements: [requirement("same"), requirement("same")] });
    expect(BidDraftBaseV1Schema.safeParse(duplicate).success).toBe(false);

    const cases = [
      draft({
        requirements: [requirement("requirement-1", { sourceRefIds: ["missing-source"] })],
      }),
      draft({
        requirements: [requirement("requirement-1", { evidenceRefIds: ["missing-proof"] })],
      }),
      draft({ technicalDeviations: [deviation("missing-requirement")] }),
      draft({
        signSealChecklist: [
          {
            id: "sign-1",
            sourceRefIds: ["missing-source"],
            label: "签章",
            required: true,
            confirmed: false,
          },
        ],
      }),
      draft({
        source: source({
          guaranteeRequirement: guaranteeRequirement({ sourceRefIds: ["missing-source"] }),
        }),
      }),
      draft({
        evidenceRefs: [
          ...evidenceRefs().slice(0, 2),
          {
            id: "proof-qualification",
            kind: "proof",
            attachmentId: "missing-attachment",
            page: 1,
            label: "证明",
          },
        ],
      }),
    ];
    for (const value of cases) expect(BidDraftBaseV1Schema.safeParse(value).success).toBe(false);
  });
});

describe("V2 bid export state machine", () => {
  it("covers source-incomplete priority, review watermarks, blocking review, and ready states", () => {
    const incomplete = decideBidExport(
      exportInput(source({ versionLabel: "TBD" }), [
        {
          code: "DUPLICATE",
          severity: "error",
          impact: "blockSubmission",
          message: "不得提交",
        },
      ]),
    );
    expect(incomplete.mode).toBe("internal-draft");
    expect(incomplete.canExportSubmission).toBe(false);
    expect(incomplete.watermarks).toEqual([
      {
        id: "unbound-source",
        text: {
          zhCN: "内部投标底稿 · 未绑定完整招标文件版本 · 不得提交",
          enUS: "INTERNAL BID DRAFT · SOURCE VERSION INCOMPLETE · DO NOT SUBMIT",
        },
        scope: "every-page",
      },
    ]);

    const watermark = decideBidExport(
      exportInput(source(), [
        {
          code: "REVIEW_ME",
          severity: "warning",
          impact: "watermark",
          message: "需复核",
        },
      ]),
    );
    expect(watermark).toMatchObject({ mode: "review-copy", canExportSubmission: false });
    expect(watermark.watermarks[0]?.text.zhCN).toBe("审核稿 · 不得提交");

    const blocked = decideBidExport(
      exportInput(source(), [
        {
          code: "BLOCK_ME",
          severity: "error",
          impact: "blockSubmission",
          message: "阻断",
        },
      ]),
    );
    expect(blocked).toMatchObject({
      mode: "review-copy",
      canExportSubmission: false,
      blockingCodes: ["BLOCK_ME"],
      reviewCodes: ["BLOCK_ME"],
    });

    for (const findings of [
      [],
      [{ code: "NOTE", severity: "info", impact: "advisory", message: "提示" }],
    ]) {
      const ready = decideBidExport(exportInput(source(), findings));
      expect(ready).toMatchObject({
        mode: "submission-ready",
        canExportSubmission: true,
        watermarks: [],
        blockingCodes: [],
        reviewCodes: [],
      });
    }
  });

  it("treats blanks, placeholders, unconfirmed versions, and incomplete clarification sets as internal", () => {
    const evidenceWithoutMain = versionEvidence();
    delete evidenceWithoutMain.mainSolicitationAttachmentId;
    const incompleteSources = [
      source({ projectNumber: "" }),
      source({ signatureRules: "待确认" }),
      source({ versionLabel: "TBD" }),
      source({ openingTime: undefined }),
      source({ openingPlace: undefined }),
      source({ sealingRules: undefined }),
      source({ versionEvidence: evidenceWithoutMain }),
      source({ versionEvidence: versionEvidence({ userConfirmedExactVersion: false }) }),
      source({ versionEvidence: versionEvidence({ allClarificationsIncluded: false }) }),
      source({
        clarificationIds: ["CL-01", "CL-02"],
        versionEvidence: versionEvidence(),
      }),
    ];
    for (const incompleteSource of incompleteSources) {
      for (const key of ["openingTime", "openingPlace", "sealingRules"] as const) {
        if (incompleteSource[key] === undefined) delete incompleteSource[key];
      }
      const decision = decideBidExport(exportInput(incompleteSource, []));
      expect(decision.mode).toBe("internal-draft");
      expect(decision.blockingCodes[0]).toBe("BID_SOURCE_VERSION_INCOMPLETE");
    }
  });

  it("deduplicates codes stably and gives source incompleteness first priority", () => {
    const findings = [
      { code: "B", severity: "error", impact: "blockSubmission", message: "B1" },
      { code: "W", severity: "warning", impact: "watermark", message: "W" },
      { code: "B", severity: "error", impact: "blockSubmission", message: "B2" },
      { code: "A", severity: "info", impact: "advisory", message: "A" },
    ];
    expect(decideBidExport(exportInput(source(), findings))).toMatchObject({
      blockingCodes: ["B"],
      reviewCodes: ["B", "W"],
    });
    expect(
      decideBidExport(exportInput(source({ versionLabel: "待补" }), findings)).blockingCodes,
    ).toEqual(["BID_SOURCE_VERSION_INCOMPLETE", "B"]);
  });

  it("does not read the clock and evaluates deadlines only with an explicit asOf", () => {
    const pending = decideBidExport({ draft: draft(), findings: [] });
    expect(pending).toMatchObject({
      mode: "review-copy",
      canExportSubmission: false,
      blockingCodes: ["BID_DEADLINE_NOT_EVALUATED"],
      reviewCodes: ["BID_DEADLINE_NOT_EVALUATED"],
    });
    expect(pending.submissionChecks).toEqual(["BID_DEADLINE_NOT_EVALUATED"]);

    expect(
      decideBidExport({
        ...exportInput(source(), []),
        asOf: "2026-08-25T00:59:59Z",
      }).mode,
    ).toBe("submission-ready");
    expect(
      decideBidExport({
        ...exportInput(source(), []),
        asOf: "2026-08-25T01:00:00Z",
      }),
    ).toMatchObject({
      mode: "review-copy",
      blockingCodes: ["BID_DEADLINE_REACHED"],
      submissionChecks: [],
    });
  });

  it("prioritizes internal codes and caps 500 external findings without throwing", () => {
    const findings = Array.from({ length: 500 }, (_, index) => ({
      code: `EXTERNAL_${index}`,
      severity: "error",
      impact: "blockSubmission",
      message: "外部阻断项",
    }));
    const decision = decideBidExport({
      ...exportInput(source(), findings),
      asOf: "2026-08-25T01:00:00Z",
    });
    expect(decision.mode).toBe("review-copy");
    expect(decision.blockingCodes).toHaveLength(500);
    expect(decision.blockingCodes[0]).toBe("BID_DEADLINE_REACHED");
    expect(decision.blockingCodes.at(-1)).toBe("BID_FINDING_CODES_TRUNCATED");
    expect(decision.reviewCodes).toHaveLength(500);
  });

  it("strictly parses unknown input and does not let callers forge output state", () => {
    for (const extra of [
      { mode: "submission-ready" },
      { watermarks: [] },
      { canExportSubmission: true },
      { blockingCodes: [] },
    ]) {
      expect(() => decideBidExport({ ...exportInput(source(), []), ...extra })).toThrow();
    }
    expect(() => decideBidExport(undefined)).toThrow();
    expect(() => decideBidExport({ ...exportInput(source(), []), asOf: "now" })).toThrow();
    expectDeepSafeOutput(decideBidExport(exportInput(source(), [])));
  });

  it("derives common blocking findings internally so callers cannot omit or downgrade them", () => {
    const unsafeDraft = draft({
      signSealChecklist: [
        {
          id: "sign-1",
          sourceRefIds: ["source-requirement"],
          label: "签章",
          required: true,
          confirmed: false,
        },
      ],
    });
    expect(
      decideBidExport({
        draft: unsafeDraft,
        findings: [],
        asOf: "2026-08-25T00:59:59Z",
      }),
    ).toMatchObject({
      mode: "review-copy",
      canExportSubmission: false,
      blockingCodes: ["BID_SIGN_SEAL_UNCONFIRMED"],
    });
    expect(
      decideBidExport({
        draft: unsafeDraft,
        findings: [
          {
            code: "BID_SIGN_SEAL_UNCONFIRMED",
            severity: "info",
            impact: "advisory",
            message: "调用方试图降级",
          },
        ],
        asOf: "2026-08-25T00:59:59Z",
      }).mode,
    ).toBe("review-copy");
  });
});

describe("V2 bid common preflight", () => {
  it("blocks unanswered, unreviewed, rejected, partial, and noncompliant substantial rows", () => {
    const rows = [
      requirement("not-started", {
        responseStatus: "not-started",
        responseText: "",
        compliance: "unreviewed",
        reviewStatus: "pending",
      }),
      requirement("drafted", { responseStatus: "drafted" }),
      requirement("rejected", { reviewStatus: "rejected" }),
      requirement("partial", { compliance: "partial" }),
      requirement("no", { compliance: "no" }),
    ];
    const findings = preflightBidCommon(
      draft({
        requirements: rows,
        technicalDeviations: [deviation("partial"), deviation("no")],
      }),
    );
    expect(findings.map((finding) => finding.code)).toContain(
      "BID_SUBSTANTIAL_REQUIREMENT_NOT_ACCEPTED",
    );
    expect(findings.map((finding) => finding.code)).toContain(
      "BID_SUBSTANTIAL_REQUIREMENT_NONCOMPLIANT",
    );
    expect(findings.every((finding) => finding.impact === "blockSubmission")).toBe(true);
  });

  it("requires every partial or no response to have a keyed deviation", () => {
    const findings = preflightBidCommon(
      draft({
        requirements: [requirement("partial", { substantial: false, compliance: "partial" })],
      }),
    );
    expect(findings.map((finding) => finding.code)).toContain("BID_DEVIATION_MISSING");
    expect(
      preflightBidCommon(
        draft({
          requirements: [requirement("partial", { substantial: false, compliance: "partial" })],
          technicalDeviations: [deviation("partial")],
        }),
      ).map((finding) => finding.code),
    ).not.toContain("BID_DEVIATION_MISSING");
  });

  it("requires applicable qualifications to be attached and truth-confirmed", () => {
    const requiredNotApplicable = qualification("required-na", { status: "not-applicable" });
    delete requiredNotApplicable.attachmentId;
    const findings = preflightBidCommon(
      draft({
        qualifications: [
          requiredNotApplicable,
          qualification("unconfirmed", { userConfirmedTruth: false }),
        ],
      }),
    );
    expect(findings.map((finding) => finding.code)).toContain("BID_QUALIFICATION_REQUIRED_MISSING");
    expect(findings.map((finding) => finding.code)).toContain(
      "BID_QUALIFICATION_TRUTH_UNCONFIRMED",
    );
  });

  it("requires submission evidence to be included without forcing attached sources into submission", () => {
    const attachments = clone(draft().attachments as Record<string, unknown>[]);
    attachments[0] = attachment("source-main", { includedInSubmission: false });
    attachments[2] = attachment("proof-qualification", {
      category: "qualification",
      status: "missing",
    });
    const codes = preflightBidCommon(draft({ attachments })).map((finding) => finding.code);
    expect(codes).not.toContain("BID_SOURCE_ATTACHMENT_NOT_READY");
    expect(codes).toContain("BID_EVIDENCE_ATTACHMENT_NOT_READY");
  });

  it("accepts attached solicitation sources without forcing them into the submission set", () => {
    const attachments = clone(draft().attachments as Record<string, unknown>[]);
    attachments[0] = attachment("source-main", { includedInSubmission: false });

    const codes = preflightBidCommon(draft({ attachments })).map((finding) => finding.code);

    expect(codes).not.toContain("BID_SOURCE_ATTACHMENT_NOT_READY");
    expect(codes).not.toContain("BID_REQUIRED_ATTACHMENT_NOT_READY");
  });

  it("still requires non-source required attachments to enter the submission set", () => {
    const attachments = clone(draft().attachments as Record<string, unknown>[]);
    attachments.push(
      attachment("unreferenced-required", {
        status: "attached",
        includedInSubmission: false,
      }),
    );

    expect(preflightBidCommon(draft({ attachments })).map((finding) => finding.code)).toContain(
      "BID_REQUIRED_ATTACHMENT_NOT_READY",
    );
  });

  it("blocks every required manifest attachment even when no field references it", () => {
    const attachments = clone(draft().attachments as Record<string, unknown>[]);
    attachments.push(
      attachment("unreferenced-required", {
        status: "missing",
        includedInSubmission: false,
      }),
    );
    const unsafeDraft = draft({ attachments });
    expect(preflightBidCommon(unsafeDraft).map((finding) => finding.code)).toContain(
      "BID_REQUIRED_ATTACHMENT_NOT_READY",
    );
    expect(
      decideBidExport({
        draft: unsafeDraft,
        findings: [],
        asOf: "2026-08-25T00:59:59Z",
      }).mode,
    ).toBe("review-copy");
  });

  it("requires every required sign/seal and guarantee record to be confirmed", () => {
    const unconfirmed = draft({
      signSealChecklist: [
        {
          id: "sign-1",
          sourceRefIds: ["source-requirement"],
          label: "签章",
          required: true,
          confirmed: false,
        },
      ],
      bidGuarantee: {
        method: "bank-guarantee",
        amountMinor: "100000",
        reference: "BG-2026-001",
        attachmentId: "bid-guarantee",
        userConfirmed: false,
      },
    });
    const codes = preflightBidCommon(unconfirmed).map((finding) => finding.code);
    expect(codes).toContain("BID_SIGN_SEAL_UNCONFIRMED");
    expect(codes).toContain("BID_GUARANTEE_UNCONFIRMED");
    const missingGuarantee = draft();
    delete missingGuarantee.bidGuarantee;
    expect(preflightBidCommon(missingGuarantee).map((finding) => finding.code)).toContain(
      "BID_GUARANTEE_MISSING",
    );
  });

  it("uses BigInt to require three equal confirmed totals below the ceiling", () => {
    const huge = "900719925474099300";
    const accepted = draft({
      source: source({ maximumPriceMinor: huge }),
      priceDeclaration: {
        itemizedTotalMinor: huge,
        bidLetterTotalMinor: huge,
        openingTotalMinor: huge,
        userConfirmed: true,
      },
    });
    expect(preflightBidCommon(accepted).map((finding) => finding.code)).not.toContain(
      "BID_PRICE_TOTAL_MISMATCH",
    );

    const mismatch = draft({
      source: source({ maximumPriceMinor: "900719925474099301" }),
      priceDeclaration: {
        itemizedTotalMinor: "900719925474099300",
        bidLetterTotalMinor: "900719925474099301",
        openingTotalMinor: "900719925474099300",
        userConfirmed: false,
      },
    });
    expect(preflightBidCommon(mismatch).map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["BID_PRICE_TOTAL_MISMATCH", "BID_PRICE_UNCONFIRMED"]),
    );

    const over = draft({
      source: source({ maximumPriceMinor: "999999" }),
      priceDeclaration: {
        itemizedTotalMinor: "1000000",
        bidLetterTotalMinor: "1000000",
        openingTotalMinor: "1000000",
        userConfirmed: true,
      },
    });
    expect(preflightBidCommon(over).map((finding) => finding.code)).toContain(
      "BID_PRICE_ABOVE_MAXIMUM",
    );
  });
});

describe("V2 bid collection bounds", () => {
  it("accepts 100 attachments and rejects 101 before reading numeric values or descriptors", () => {
    const hundred = Array.from({ length: 100 }, (_, index) => attachment(`attachment-${index}`));
    const sourceWithoutGuarantee = source({
      clarificationIds: [],
      versionEvidence: versionEvidence({ clarificationAttachments: [] }),
      guaranteeRequirement: { required: false, allowedMethods: [], sourceRefIds: [] },
    });
    const base = draft({
      source: sourceWithoutGuarantee,
      evidenceRefs: [],
      requirements: [],
      qualifications: [],
      attachments: [
        attachment("source-main"),
        attachment("bid-guarantee"),
        ...hundred.slice(0, 98),
      ],
      signSealChecklist: [],
    });
    delete base.bidGuarantee;
    expect(BidDraftBaseV1Schema.safeParse(base).success).toBe(true);

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
    expect(BidDraftBaseV1Schema.safeParse(draft({ attachments: oversized })).success).toBe(false);
    expect(numericReads).toBe(0);
    expect(numericDescriptorReads).toBe(0);
  });

  it("accepts 500 responses and rejects 501 before reading any item", () => {
    const fiveHundred = Array.from({ length: 500 }, (_, index) =>
      requirement(`r-${index}`, { substantial: false }),
    );
    expect(BidDraftBaseV1Schema.safeParse(draft({ requirements: fiveHundred })).success).toBe(true);

    let numericReads = 0;
    const oversized = new Proxy(new Array(501), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) numericReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(BidDraftBaseV1Schema.safeParse(draft({ requirements: oversized })).success).toBe(false);
    expect(numericReads).toBe(0);
  });

  it("enforces 200 qualifications/deviations and 100 refs/checklist limits", () => {
    expect(
      BidDraftBaseV1Schema.safeParse(
        draft({
          qualifications: Array.from({ length: 201 }, (_, index) => qualification(`q-${index}`)),
        }),
      ).success,
    ).toBe(false);
    expect(
      BidDraftBaseV1Schema.safeParse(
        draft({ technicalDeviations: Array.from({ length: 201 }, () => deviation()) }),
      ).success,
    ).toBe(false);
    expect(
      BidDraftBaseV1Schema.safeParse(
        draft({
          evidenceRefs: Array.from({ length: 101 }, (_, index) => ({
            ...evidenceRefs()[0],
            id: `e-${index}`,
          })),
        }),
      ).success,
    ).toBe(false);
    expect(
      BidDraftBaseV1Schema.safeParse(
        draft({
          signSealChecklist: Array.from({ length: 101 }, (_, index) => ({
            id: `s-${index}`,
            sourceRefIds: ["source-requirement"],
            label: "签章",
            required: false,
            confirmed: false,
          })),
        }),
      ).success,
    ).toBe(false);
  });
});

describe("V2 bid security boundaries", () => {
  it("turns hostile values into getter-free no-throw safeParse failures", () => {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "issuer", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret正文";
      },
    });
    const dangerous = ["__proto__", "constructor", "prototype"].map((key) => {
      const value = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(value, key, { enumerable: true, value: {} });
      return value;
    });
    const customPrototype = Object.create({ inherited: true });
    const sparse = new Array(1);
    const cycle = Object.create(null) as Record<string, unknown>;
    cycle.self = cycle;
    const throwing = new Proxy(Object.create(null), {
      ownKeys() {
        throw new Error("secret正文");
      },
    });
    const { proxy: revoked, revoke } = Proxy.revocable(Object.create(null), {});
    revoke();

    for (const schema of publicSchemas) {
      for (const input of [
        accessor,
        ...dangerous,
        customPrototype,
        sparse,
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

  it("rejects unknown, symbol, undefined, HTML, XML controls, and lone surrogates", () => {
    const symbolSource = source() as Record<PropertyKey, unknown>;
    symbolSource[Symbol("hidden")] = true;
    expect(SolicitationSnapshotV1Schema.safeParse(symbolSource).success).toBe(false);
    expect(SolicitationSnapshotV1Schema.safeParse(source({ unknown: true })).success).toBe(false);
    expect(SolicitationSnapshotV1Schema.safeParse(source({ agency: undefined })).success).toBe(
      false,
    );
    for (const issuer of ["<b>单位</b>", "单位\u0001", "单位\ud800"]) {
      expect(SolicitationSnapshotV1Schema.safeParse(source({ issuer })).success).toBe(false);
    }
    expect(
      SolicitationSnapshotV1Schema.safeParse(source({ issuer: "某采购单位 🧭" })).success,
    ).toBe(true);
  });

  it("rejects normalized invalid dates, 24:00, and invalid offsets", () => {
    for (const bidDeadline of [
      "2026-02-31T00:00:00Z",
      "2026-12-01T24:00:00Z",
      "2026-08-25T09:00:00+14:01",
    ]) {
      expect(SolicitationSnapshotV1Schema.safeParse(source({ bidDeadline })).success).toBe(false);
    }
    expect(() =>
      decideBidExport({
        ...exportInput(source(), []),
        asOf: "2026-02-31T00:00:00Z",
      }),
    ).toThrow();
  });

  it("returns deeply frozen null-prototype own-data trees with no raw schema bypass", () => {
    const input = draft();
    const parsed = BidDraftBaseV1Schema.parse(input);
    (input.source as JsonRecord).issuer = "已篡改";
    expect(parsed.source.issuer).toBe("某采购单位");
    expectDeepSafeOutput(parsed);
    for (const schema of publicSchemas) expect(reachableSchemas(schema as object)).toEqual([]);
  });

  it("does not trigger inherited setters or leak draft text to console", () => {
    const originalIssuer = Reflect.getOwnPropertyDescriptor(Object.prototype, "issuer");
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    let setterCalls = 0;
    try {
      Object.defineProperty(Object.prototype, "issuer", {
        configurable: true,
        set() {
          setterCalls += 1;
        },
      });
      const parsed = SolicitationSnapshotV1Schema.parse(source());
      expect(parsed.issuer).toBe("某采购单位");
      expect(setterCalls).toBe(0);
      expect(() =>
        decideBidExport({
          ...exportInput(source({ issuer: "<script>secret正文</script>" }), []),
        }),
      ).toThrow();
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      for (const spy of spies) spy.mockRestore();
      if (originalIssuer) Object.defineProperty(Object.prototype, "issuer", originalIssuer);
      else Reflect.deleteProperty(Object.prototype, "issuer");
    }
  });
});

describe("V1 compatibility", () => {
  it("does not change the V1 standard quote contract", () => {
    const existing = createStandardGoodsQuoteDraft({
      id: "bid-common-v2-v1",
      now: "2026-08-20T00:00:00.000Z",
    });
    expect(existing.templateId).toBe("quotation.goods.standard.v1");
    expect(existing.templateVersion).toBe("1.0.0");
  });
});
