import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { CredentialConfigurationError } from "./plaidCredentialConfiguration";

function encryptionKey() {
  if (typeof window !== "undefined") throw new Error("Server credentials unavailable");
  const value = process.env.PLAID_CREDENTIAL_ENCRYPTION_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new CredentialConfigurationError("ENCRYPTION_CONFIGURATION_INVALID");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new CredentialConfigurationError("ENCRYPTION_CONFIGURATION_INVALID");
  return key;
}

export function encryptPlaidSecret(value: string, binding: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptPlaidSecret(value: string, binding: string): string {
  try {
    if (value.length > 8192) throw new Error();
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    const decode = (part: string) => {
      if (!part || !/^[A-Za-z0-9+/]+={0,2}$/.test(part)) throw new Error();
      const decoded = Buffer.from(part, "base64");
      if (decoded.toString("base64") !== part) throw new Error();
      return decoded;
    };
    if (version !== "v1" || extra !== undefined) throw new Error();
    const nonce = decode(iv), authTag = decode(tag);
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString("utf8");
  } catch { throw new Error("Unable to decrypt saved Plaid credentials"); }
}
