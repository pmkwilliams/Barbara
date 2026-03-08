import crypto from "node:crypto";

import { describe, expect, test } from "bun:test";

import { KalshiAuth } from "../../src/kalshi/auth";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const apiKeyId = "test-api-key-id";
const auth = new KalshiAuth(apiKeyId, privateKey);

describe("KalshiAuth", () => {
  test("getHeaders returns only KALSHI-ACCESS-KEY", () => {
    const headers = auth.getHeaders();
    expect(headers).toEqual({ "KALSHI-ACCESS-KEY": apiKeyId });
  });

  test("signRequest produces valid RSA-PSS signature verifiable with public key", () => {
    const signed = auth.signRequest({
      method: "GET",
      url: "https://api.kalshi.com/trade-api/v2/markets",
    });

    const timestamp = signed.headers?.["KALSHI-ACCESS-TIMESTAMP"];
    const signatureB64 = signed.headers?.["KALSHI-ACCESS-SIGNATURE"];

    expect(timestamp).toBeDefined();
    expect(signatureB64).toBeDefined();

    const message = `${timestamp}GET/trade-api/v2/markets`;

    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(message);
    verify.end();

    const isValid = verify.verify(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(signatureB64!, "base64")
    );

    expect(isValid).toBe(true);
  });

  test("PSS probabilistic signatures differ for same input", () => {
    const signed1 = auth.signRequest({
      method: "GET",
      url: "https://api.kalshi.com/trade-api/v2/markets",
    });
    const signed2 = auth.signRequest({
      method: "GET",
      url: "https://api.kalshi.com/trade-api/v2/markets",
    });

    const ts1 = signed1.headers?.["KALSHI-ACCESS-TIMESTAMP"];
    const ts2 = signed2.headers?.["KALSHI-ACCESS-TIMESTAMP"];
    const sig1 = signed1.headers?.["KALSHI-ACCESS-SIGNATURE"];
    const sig2 = signed2.headers?.["KALSHI-ACCESS-SIGNATURE"];

    // If timestamps are the same, signatures MUST differ due to PSS random salt
    if (ts1 === ts2) {
      expect(sig1).not.toBe(sig2);
    }
    // If timestamps differ, signatures will naturally differ (different message)
  });

  test("signRequest strips query params from signing path", () => {
    const signed = auth.signRequest({
      method: "GET",
      url: "https://api.kalshi.com/trade-api/v2/markets?limit=10&status=open",
    });

    const timestamp = signed.headers?.["KALSHI-ACCESS-TIMESTAMP"];
    const signatureB64 = signed.headers?.["KALSHI-ACCESS-SIGNATURE"];

    expect(timestamp).toBeDefined();
    expect(signatureB64).toBeDefined();

    // Verify signature was made with path WITHOUT query params
    const correctMessage = `${timestamp}GET/trade-api/v2/markets`;

    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(correctMessage);
    verify.end();

    const isValid = verify.verify(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(signatureB64!, "base64")
    );

    expect(isValid).toBe(true);
  });

  test("all three KALSHI-ACCESS-* headers present in signed output", () => {
    const signed = auth.signRequest({
      method: "POST",
      url: "https://api.kalshi.com/trade-api/v2/portfolio/orders",
      headers: { "Content-Type": "application/json" },
    });

    expect(signed.headers?.["KALSHI-ACCESS-KEY"]).toBe(apiKeyId);
    expect(signed.headers?.["KALSHI-ACCESS-TIMESTAMP"]).toBeDefined();
    expect(signed.headers?.["KALSHI-ACCESS-SIGNATURE"]).toBeDefined();
    // Original headers preserved
    expect(signed.headers?.["Content-Type"]).toBe("application/json");
  });
});
