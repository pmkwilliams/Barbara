export interface SignRequestInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface PlatformAuthProvider {
  getHeaders(): Record<string, string> | Promise<Record<string, string>>;
  signRequest(request: SignRequestInput): SignRequestInput | Promise<SignRequestInput>;
}
