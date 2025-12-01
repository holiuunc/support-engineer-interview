import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

// Cache the key at module level
let CACHED_KEY: Buffer | null = null;

/**
 * Get the encryption key from environment variable
 * In production, use a proper key management service (AWS KMS, Azure Key Vault, etc.)
 */
function getEncryptionKey(): Buffer {
  if (CACHED_KEY) return CACHED_KEY;

  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }

  const key = Buffer.from(keyHex, 'hex');

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). ` +
      'Generate one with: openssl rand -hex 32'
    );
  }

  CACHED_KEY = key;
  return key;
}

/**
 * Hash SSN deterministically for uniqueness checks (Blind Index)
 * Uses HMAC-SHA256 with a separate PEPPER
 */
export function hashSSN(ssn: string): string {
  // In production, use a separate PEPPER environment variable
  const pepper = process.env.SSN_PEPPER || 'default-pepper-do-not-use-in-prod';
  
  // Remove non-digit characters to normalize before hashing
  const normalizedSSN = ssn.replace(/\D/g, '');
  
  return crypto
    .createHmac('sha256', pepper)
    .update(normalizedSSN)
    .digest('hex');
}

/**
 * Encrypt plaintext using AES-256-GCM
 * Returns format: iv:authTag:ciphertext (all in hex)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex-encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * Expects format: iv:authTag:ciphertext (all in hex)
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format. Expected format: iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Check if a string is already encrypted (has the expected format)
 */
export function isEncrypted(data: string): boolean {
  const parts = data.split(':');
  if (parts.length !== 3) {
    return false;
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  // Check if all parts are valid hex strings with expected lengths
  const hexRegex = /^[0-9a-f]+$/i;
  return (
    hexRegex.test(ivHex) &&
    ivHex.length === IV_LENGTH * 2 &&
    hexRegex.test(authTagHex) &&
    authTagHex.length === AUTH_TAG_LENGTH * 2 &&
    hexRegex.test(ciphertext) &&
    ciphertext.length > 0
  );
}
