import { describe, expect, it } from "vitest";
import { detectPiiRequest } from "./question-pii-guard";

describe("detectPiiRequest", () => {
  it("returns null for an ordinary comprehension question", () => {
    expect(detectPiiRequest("What discount did the presenter mention?")).toBeNull();
  });

  it("returns null for an ordinary opinion question", () => {
    expect(detectPiiRequest("How likely are you to recommend this product?")).toBeNull();
  });

  it("returns null for an empty or whitespace-only prompt", () => {
    expect(detectPiiRequest("")).toBeNull();
    expect(detectPiiRequest("   ")).toBeNull();
  });

  const rejectionTable: Array<{ name: string; prompt: string; category: string }> = [
    {
      name: "English phone number",
      prompt: "What is your phone number?",
      category: "phone number",
    },
    { name: "Indonesian phone number", prompt: "Berapa nomor HP kamu?", category: "phone number" },
    {
      name: "email address",
      prompt: "Please share your email address to continue",
      category: "email address",
    },
    { name: "home address", prompt: "What is your home address?", category: "home address" },
    { name: "Indonesian address", prompt: "Tuliskan alamat rumah Anda", category: "home address" },
    {
      name: "national ID (NIK)",
      prompt: "Masukkan nomor NIK Anda",
      category: "government ID number",
    },
    { name: "KTP", prompt: "What is your KTP number?", category: "government ID number" },
    { name: "income", prompt: "What is your monthly income?", category: "income" },
    { name: "Indonesian income", prompt: "Berapa penghasilan bulanan Anda?", category: "income" },
    {
      name: "health status",
      prompt: "Do you have any health conditions?",
      category: "health status",
    },
    {
      name: "bank account",
      prompt: "What is your bank account number?",
      category: "bank or card details",
    },
    {
      name: "credit card",
      prompt: "Enter your credit card number",
      category: "bank or card details",
    },
    {
      name: "full name",
      prompt: "What is your full legal name?",
      category: "full name for identification",
    },
  ];

  it.each(rejectionTable)("flags $name with the reason and category", ({ prompt, category }) => {
    const finding = detectPiiRequest(prompt);
    expect(finding).not.toBeNull();
    expect(finding?.category).toBe(category);
    expect(finding?.reason.length).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    expect(detectPiiRequest("WHAT IS YOUR EMAIL?")).not.toBeNull();
  });
});
