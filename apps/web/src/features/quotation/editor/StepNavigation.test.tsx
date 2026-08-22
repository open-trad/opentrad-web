import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StepNavigation } from "./StepNavigation";

afterEach(cleanup);

describe("quotation step navigation labels", () => {
  it("gives the active and future step buttons explicit Chinese labels", () => {
    render(<StepNavigation activeStep={0} onSelect={() => undefined} />);

    const navigation = screen.getByRole("complementary", { name: "报价单步骤" });
    const buttons = within(navigation).getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("aria-label", "基本信息，当前步骤");
    expect(buttons[1]).toHaveAttribute("aria-label", "客户信息");
  });

  it("announces completed and current state without relying on visible step text", () => {
    render(<StepNavigation activeStep={3} onSelect={() => undefined} />);

    const navigation = screen.getByRole("complementary", { name: "报价单步骤" });
    const buttons = within(navigation).getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("aria-label", "基本信息，已完成");
    expect(buttons[3]).toHaveAttribute("aria-label", "条款与备注，当前步骤");
  });
});
