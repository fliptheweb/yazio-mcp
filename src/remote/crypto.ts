import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const SALT = 'yazio-mcp';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts what the storage must not show in plain text, with keys made from `SESSION_SECRET`.
 * A value is bound to its context (the storage key): it does not open under another key.
 */
export class Sealer {
  private readonly encryptionKey: Buffer;
  private readonly macKey: Buffer;

  constructor(secret: string) {
    this.encryptionKey = Buffer.from(hkdfSync('sha256', secret, SALT, 'encryption', 32));
    this.macKey = Buffer.from(hkdfSync('sha256', secret, SALT, 'mac', 32));
  }

  seal(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}`;
  }

  /** The plain text, or `null` when the value was changed or was sealed with another secret */
  open(sealed: string, context: string): string | null {
    const [version, iv, body] = sealed.split('.');
    if (version !== VERSION || !iv || !body) return null;
    try {
      const bytes = Buffer.from(body, 'base64url');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(iv, 'base64url')
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
      return (
        decipher.update(bytes.subarray(0, bytes.length - TAG_BYTES), undefined, 'utf8') +
        decipher.final('utf8')
      );
    } catch {
      return null;
    }
  }

  /** A keyed hash, for a storage key that must not show the value it stands for */
  mac(value: string): string {
    return createHmac('sha256', this.macKey).update(value).digest('base64url');
  }
}
