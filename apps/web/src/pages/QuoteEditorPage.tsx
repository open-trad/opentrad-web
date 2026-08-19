import { Check, ChevronRight, FileText, PanelRight, Save } from "lucide-react";
import { useState } from "react";

const steps = ["基本信息", "客户信息", "商品明细", "条款与备注", "审核与完成"];

export function QuoteEditorPage() {
  const [companyName, setCompanyName] = useState("远航国际贸易有限公司");
  const [customerName, setCustomerName] = useState("环球供应链有限公司");
  const [productName, setProductName] = useState("工业级节能电机");

  return (
    <div className="editor-page">
      <div className="editor-topbar">
        <div>
          <span className="eyebrow">报价单编辑器</span>
          <h1>标准商品报价单</h1>
        </div>
        <div className="editor-actions">
          <button type="button" className="secondary-button">
            <Save size={16} /> 保存草稿
          </button>
          <button type="button" className="primary-button">
            预览 <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="editor-workspace">
        <aside className="editor-steps" aria-label="报价单步骤">
          <div className="steps-title">
            <FileText size={18} />
            <strong>报价单向导</strong>
          </div>
          <ol>
            {steps.map((step, index) => (
              <li className={index === 0 ? "active" : ""} key={step}>
                <span>{index === 0 ? <Check size={13} /> : index + 1}</span>
                <div>
                  <strong>{step}</strong>
                  {index === 0 && <small>正在编辑</small>}
                </div>
              </li>
            ))}
          </ol>
        </aside>

        <section className="quote-form" aria-label="报价单基本信息">
          <div className="form-section-heading">
            <span>01</span>
            <div>
              <h2>基本信息</h2>
              <p>填写交易双方与商品信息，预览会实时更新。</p>
            </div>
          </div>
          <form>
            <label>
              <span>公司名称</span>
              <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
            </label>
            <label>
              <span>客户名称</span>
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </label>
            <label>
              <span>产品名称</span>
              <input value={productName} onChange={(event) => setProductName(event.target.value)} />
            </label>
            <div className="form-row">
              <label>
                <span>报价编号</span>
                <input value="QT-2026-00819" readOnly />
              </label>
              <label>
                <span>币种</span>
                <select defaultValue="USD">
                  <option value="USD">USD · 美元</option>
                  <option value="CNY">CNY · 人民币</option>
                  <option value="EUR">EUR · 欧元</option>
                </select>
              </label>
            </div>
            <label>
              <span>报价主题</span>
              <textarea defaultValue="感谢贵司垂询，现提供以下商品报价。" rows={4} />
            </label>
          </form>
          <div className="form-footer">
            <span>所有信息仅保存在当前设备</span>
            <button type="button" className="primary-button">
              下一步 <ChevronRight size={16} />
            </button>
          </div>
        </section>

        <section className="preview-panel" aria-label="A4 报价单预览">
          <div className="preview-toolbar">
            <span>
              <PanelRight size={16} /> 文档预览
            </span>
            <span>A4 · 100%</span>
          </div>
          <article className="a4-sheet">
            <header>
              <div className="document-brand">OpenTrad</div>
              <p>{companyName || "未填写公司名称"}</p>
              <h2>报价单</h2>
              <span>QUOTATION</span>
            </header>
            <div className="quote-reference">
              <span>报价编号：QT-2026-00819</span>
              <span>报价日期：2026-08-19</span>
              <span>有效期限：30 天</span>
            </div>
            <div className="quote-parties">
              <div>
                <small>供应商（FROM）</small>
                <strong>{companyName || "未填写公司名称"}</strong>
                <p>宁波市海曙区商贸路 128 号</p>
              </div>
              <div>
                <small>客户（TO）</small>
                <strong>{customerName || "未填写客户名称"}</strong>
                <p>采购与供应链管理部</p>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>商品名称</th>
                  <th>数量</th>
                  <th>单价 (USD)</th>
                  <th>金额 (USD)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>01</td>
                  <td>{productName || "未填写产品名称"}</td>
                  <td>20</td>
                  <td>85.00</td>
                  <td>1,700.00</td>
                </tr>
                <tr>
                  <td>02</td>
                  <td>配套控制模块</td>
                  <td>20</td>
                  <td>25.00</td>
                  <td>500.00</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>合计金额 (USD)</td>
                  <td>2,200.00</td>
                </tr>
              </tfoot>
            </table>
            <div className="quote-terms">
              <strong>条款与备注</strong>
              <p>1. 交货期：收到订单后 20 个工作日。</p>
              <p>2. 报价有效期为 30 天，价格包含标准包装。</p>
            </div>
            <footer>OpenTrad 开源商贸 · 本地生成的示意报价单</footer>
          </article>
        </section>
      </div>
    </div>
  );
}
