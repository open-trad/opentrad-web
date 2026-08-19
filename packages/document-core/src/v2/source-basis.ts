export interface OfficialSourceDescriptor {
  readonly authority: string;
  readonly title: string;
  readonly url: string;
  readonly reviewedAt: "2026-08-19";
}

function source(authority: string, title: string, url: string): Readonly<OfficialSourceDescriptor> {
  return Object.freeze({ authority, title, url, reviewedAt: "2026-08-19" as const });
}

export const OFFICIAL_SOURCES = Object.freeze({
  "samr-contract-library": source(
    "国家市场监督管理总局",
    "全国合同示范文本库",
    "https://htsfwb.samr.gov.cn/",
  ),
  "samr-entrustment-2025": source(
    "国家市场监督管理总局",
    "委托合同（GF—2025—1001）",
    "https://htsfwb.samr.gov.cn/View?id=50b57729-0fca-45d2-92c3-fe7e6a989815",
  ),
  "prc-civil-code": source(
    "全国人民代表大会",
    "中华人民共和国民法典",
    "https://wb.flk.npc.gov.cn/flfg/PDF/bd53dd912c1048f2aecbaa229238334b.pdf",
  ),
  "mof-order-87": source(
    "中华人民共和国财政部",
    "政府采购货物和服务招标投标管理办法",
    "https://tfs.mof.gov.cn/caizhengbuling/201707/t20170718_2652603.htm",
  ),
  "mof-demand-management": source(
    "中华人民共和国财政部",
    "政府采购需求管理办法",
    "https://www.mof.gov.cn/gkml/caizhengwengao/wg2021/wg202005/202109/t20210917_3753625.htm",
  ),
  "prc-tendering-law": source(
    "国家市场监督管理总局法规库",
    "中华人民共和国招标投标法",
    "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_1f79dd79321441a0831f3aed697b4535.html",
  ),
  "ndrc-standard-construction": source(
    "国家发展和改革委员会",
    "简明标准施工招标文件和标准设计施工总承包招标文件通知",
    "https://zfxxgk.ndrc.gov.cn/upload/images/202210/20221091765984.pdf",
  ),
  "ndrc-tenderer-responsibility": source(
    "国家发展和改革委员会",
    "招标人主体责任履行指引",
    "https://www.ndrc.gov.cn/xxgk/zcfb/tz/202511/t20251111_1401536_ext.html",
  ),
  "icc-incoterms-2020": source(
    "International Chamber of Commerce",
    "What the Incoterms 2020 rules do and do not do",
    "https://library.iccwbo.org/clp/clp-incoterms-qa-2020.htm?AGENT=ICC_HQ",
  ),
  "trade-gov-proforma": source(
    "International Trade Administration",
    "Pro Forma Invoice",
    "https://www.trade.gov/pro-forma-invoice",
  ),
  "uncitral-cisg": source(
    "UNCITRAL",
    "United Nations Convention on Contracts for the International Sale of Goods",
    "https://uncitral.un.org/en/texts/salegoods/conventions/sale_of_goods/cisg",
  ),
} as const);

export type OfficialSourceKey = keyof typeof OFFICIAL_SOURCES;
