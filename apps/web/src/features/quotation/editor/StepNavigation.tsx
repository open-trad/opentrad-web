import { Check, FileText } from "lucide-react";

export const QUOTATION_STEPS = [
  "基本信息",
  "客户信息",
  "商品明细",
  "条款与备注",
  "审核与完成",
] as const;

export function StepNavigation({
  activeStep,
  onSelect,
}: {
  activeStep: number;
  onSelect: (step: number) => void;
}) {
  return (
    <aside className="editor-steps" aria-label="报价单步骤">
      <div className="steps-title">
        <FileText size={18} />
        <strong>报价单向导</strong>
      </div>
      <ol>
        {QUOTATION_STEPS.map((step, index) => {
          const active = index === activeStep;
          const completed = index < activeStep;
          return (
            <li className={active ? "active" : completed ? "completed" : ""} key={step}>
              <button
                type="button"
                aria-label={`${step}${active ? "，当前步骤" : completed ? "，已完成" : ""}`}
                aria-current={active ? "step" : undefined}
                data-completed={completed ? "true" : "false"}
                onClick={() => onSelect(index)}
              >
                <span className="step-number">{completed ? <Check size={13} /> : index + 1}</span>
                <span>
                  <strong>{step}</strong>
                  {active && <small>正在编辑</small>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
