import crypto from "node:crypto";

import type { PlatformAuthProvider, SignRequestInput } from "../auth";

export class KalshiAuth implements PlatformAuthProvider {
  private readonly apiKeyId: string;
  private readonly privateKeyPem: string;

  constructor(apiKeyId: string, privateKeyPem: string) {
    this.apiKeyId = apiKeyId;
    this.privateKeyPem = privateKeyPem;
  }

  getHeaders(): Record<string, string> {
    return {
      "KALSHI-ACCESS-KEY": this.apiKeyId,
    };
  }

  signRequest(request: SignRequestInput): SignRequestInput {
    const timestamp = Date.now().toString();
    const path = new URL(request.url).pathname;
    const message = `${timestamp}${request.method.toUpperCase()}${path}`;

    const sign = crypto.createSign("RSA-SHA256");
    sign.update(message);
    sign.end();

    const signature = sign.sign({
      key: this.privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    });

    const result: SignRequestInput = {
      method: request.method,
      url: request.url,
      headers: {
        ...request.headers,
        "KALSHI-ACCESS-KEY": this.apiKeyId,
        "KALSHI-ACCESS-TIMESTAMP": timestamp,
        "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
      },
    };

    if (request.body !== undefined) {
      result.body = request.body;
    }

    return result;
  }
}
