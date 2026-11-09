import { describe, expect, it } from "vitest";

import { configQuantityForMonth } from "@/server/invoices";
import {
  buildRecurringServicesTemplate,
  calculateIntakeQuote,
  specialtyReportsFromIntake,
  type IntakeQuoteAnswers,
  type TemplateLineItem,
} from "@/server/quote";

const TODAY = { year: 2026, month: 10, day: 28 };

function answers(patch: Partial<IntakeQuoteAnswers>): IntakeQuoteAnswers {
  return {
    serviceKeys: [],
    bookkeepingFrequency: "monthly",
    ...patch,
  } as IntakeQuoteAnswers;
}

function annualReportAnswers(lineBilling?: IntakeQuoteAnswers["lineBilling"]): IntakeQuoteAnswers {
  return answers({
    reportDefinitions: [
      { name: "Annual report", frequency: "annual", pricingMode: "flat", flatPrice: 250 },
    ],
    routineSchedule: {
      "specialty:Annual report": { bucket: "annual", order: 0, daysAfterPeriodEnd: 31 },
    },
    billingMonths: { specialty_report_1: 1 },
    lineBilling,
  });
}

function annualTemplate(answers: IntakeQuoteAnswers) {
  const quote = calculateIntakeQuote(answers, TODAY);
  const template = buildRecurringServicesTemplate(
    quote,
    [],
    specialtyReportsFromIntake(answers, TODAY),
    [],
    answers.billingMonths ?? {},
    answers.lineBilling ?? {},
    { closingFrequency: "monthly", routineSchedule: answers.routineSchedule },
  );
  return { quote, line: template[0]! as TemplateLineItem };
}

describe("October 28 server billing remediation", () => {
  it("oct28_unpriced_specialty_report_remains_visible", () => {
    const quote = calculateIntakeQuote(answers({
      reportDefinitions: [{ name: "Monthly unpriced report", frequency: "monthly" }],
    }), TODAY);
    const line = quote.lines.find((candidate) => candidate.service_key === "specialty_report_1");
    expect(line).toMatchObject({
      product_name: "Specialty Report: Monthly unpriced report",
      unit_price: null,
      amount: null,
      unpriced: true,
      calc_quantity: 1,
    });
  });

  it("annual specialty preview metadata and invoice quantity both bill $250 once", () => {
    const { quote, line } = annualTemplate(annualReportAnswers());
    expect(quote.lines[0]).toMatchObject({ unit_price: 250, calc_quantity: 1, quantity: 1 / 12 });
    expect(line).toMatchObject({ unit_price: 250, calc_quantity: 1, calc_frequency: "annual", bill_frequency: "annual" });
    const quantity = configQuantityForMonth(line, "annual", 2027, 1, 1);
    expect(quantity).toBe(1);
    expect(quantity * line.unit_price!).toBe(250);
  });

  it("monthly $25 calculation-rate override bills $300 annually in preview and invoice", () => {
    const { quote, line } = annualTemplate(annualReportAnswers({
      specialty_report_1: { calcFrequency: "monthly", billingFrequency: "annual", calcUnitPrice: 25 },
    }));
    expect(quote.lines[0]?.price_override).toBe(25);
    expect(line).toMatchObject({ unit_price: 25, calc_quantity: 1, discount: 0, calc_frequency: "monthly", bill_frequency: "annual" });
    const quantity = configQuantityForMonth(line, "annual", 2027, 1, 1);
    expect(quantity).toBe(12);
    expect(quantity * line.unit_price!).toBe(300);
  });

  it("annual $250 calculation rate bills $20.83 monthly without a second division", () => {
    const { line } = annualTemplate(annualReportAnswers({
      specialty_report_1: { calcFrequency: "annual", billingFrequency: "monthly" },
    }));
    const quantity = configQuantityForMonth(line, "monthly", 2026, 10, 1);
    expect(Math.round(quantity * line.unit_price! * 100) / 100).toBe(20.83);
  });

  it("natural monthly quantity stays correct at an annual close", () => {
    const input = answers({
      serviceKeys: ["bank_feed_management"],
      bookkeepingFrequency: "annual",
      lineBilling: {
        bank_feed_management: { calcFrequency: "monthly", billingFrequency: "annual", calcUnitPrice: 100 },
      },
    });
    const quote = calculateIntakeQuote(input, TODAY);
    const [line] = buildRecurringServicesTemplate(quote, [], [], [], {}, input.lineBilling, {
      closingFrequency: "annual",
    });
    expect(line).toMatchObject({ unit_price: 100, calc_quantity: 1, calc_frequency: "monthly", bill_frequency: "annual" });
    expect(configQuantityForMonth(line!, "annual", 2027, 1, 1)).toBe(12);
  });
});
