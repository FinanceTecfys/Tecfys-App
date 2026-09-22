import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * E-signature integration. Planned flow:
 *   approved scoring -> draft contract -> generate contract PDF from the
 *   client + Tecfys data -> createRequest() at Signaturit -> webhook updates
 *   signature_requests.status -> on "completed" the contract becomes "signed"
 *   and enters the loan book.
 *
 * Only the contract of the provider lives here for now; the PDF template and
 * the webhook route are the next branch.
 */
export interface SignatureSigner {
  name: string;
  email: string;
  nif?: string;
  role: "client" | "guarantor" | "tecfys";
}

export interface SignatureRequestInput {
  contractId: string;
  contractNumber: string;
  document: { fileName: string; content: ArrayBuffer };
  signers: SignatureSigner[];
}

export interface SignatureProvider {
  readonly name: string;
  isConfigured(): boolean;
  createRequest(input: SignatureRequestInput): Promise<{ externalId: string; status: string }>;
}

class SignaturitProvider implements SignatureProvider {
  readonly name = "signaturit";

  isConfigured() {
    const env = serverEnv();
    return Boolean(env.SIGNATURIT_TOKEN && env.SIGNATURIT_API_URL);
  }

  async createRequest(): Promise<{ externalId: string; status: string }> {
    // POST {SIGNATURIT_API_URL}/v3/signatures.json (multipart: files[], recipients[n][name|email])
    // with "Authorization: Bearer {SIGNATURIT_TOKEN}". Pending the contract template.
    throw new Error("Signaturit integration not implemented yet");
  }
}

export const signatureProvider: SignatureProvider = new SignaturitProvider();
