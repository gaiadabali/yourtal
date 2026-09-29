import { describe, expect, it } from "vitest";
import {
  detectPiiRequest,
  detectPredictionRequest,
  detectTeenPersonalQuestion,
} from "./question-pii-guard";

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

describe("detectPredictionRequest", () => {
  it("returns null for an ordinary comprehension question", () => {
    expect(detectPredictionRequest("What discount did the presenter mention?")).toBeNull();
  });

  it("returns null for an empty or whitespace-only prompt", () => {
    expect(detectPredictionRequest("")).toBeNull();
    expect(detectPredictionRequest("   ")).toBeNull();
  });

  const rejectionTable: Array<{ name: string; prompt: string }> = [
    { name: "English 'will'", prompt: "Will the price go up next month?" },
    { name: "English 'predict'", prompt: "Predict next quarter's revenue" },
    { name: "English 'guess'", prompt: "Guess how many units were sold" },
    { name: "Indonesian 'akan'", prompt: "Apakah harga akan naik bulan depan?" },
    { name: "Indonesian 'menebak'", prompt: "Coba menebak jumlah penjualan" },
    { name: "Indonesian 'ramal'", prompt: "Ramalkan penjualan tahun depan" },
  ];

  it.each(rejectionTable)("flags $name (red line 1)", ({ prompt }) => {
    const finding = detectPredictionRequest(prompt);
    expect(finding).not.toBeNull();
    expect(finding?.reason.length).toBeGreaterThan(0);
  });
});

describe("detectTeenPersonalQuestion", () => {
  it("returns null for an ordinary comprehension question", () => {
    expect(detectTeenPersonalQuestion("What discount did the presenter mention?")).toBeNull();
  });

  it("returns null for an ordinary opinion question, same as detectPiiRequest", () => {
    expect(detectTeenPersonalQuestion("How likely are you to recommend this product?")).toBeNull();
  });

  it("returns null for an empty or whitespace-only prompt", () => {
    expect(detectTeenPersonalQuestion("")).toBeNull();
    expect(detectTeenPersonalQuestion("   ")).toBeNull();
  });

  const rejectionTable: Array<{ name: string; prompt: string; category: string }> = [
    { name: "English age", prompt: "How old are you?", category: "age or date of birth" },
    { name: "Indonesian age", prompt: "Berapa umur kamu?", category: "age or date of birth" },
    {
      name: "date of birth",
      prompt: "What is your date of birth?",
      category: "age or date of birth",
    },
    { name: "English school", prompt: "What school do you go to?", category: "school" },
    { name: "Indonesian school", prompt: "Sekolah kamu di mana?", category: "school" },
    {
      name: "English location",
      prompt: "What suburb do you live in?",
      category: "where you live",
    },
    { name: "Indonesian location", prompt: "Kamu tinggal di mana?", category: "where you live" },
    { name: "appearance", prompt: "What is your weight?", category: "appearance" },
    { name: "family", prompt: "Tell us about your parents", category: "family" },
    {
      name: "social media handle",
      prompt: "What is your Instagram username?",
      category: "social media handle",
    },
    {
      name: "relationship status",
      prompt: "Do you have a girlfriend?",
      category: "relationship status",
    },
  ];

  it.each(rejectionTable)("flags $name with the reason and category", ({ prompt, category }) => {
    const finding = detectTeenPersonalQuestion(prompt);
    expect(finding).not.toBeNull();
    expect(finding?.category).toBe(category);
    expect(finding?.reason.length).toBeGreaterThan(0);
  });
});
