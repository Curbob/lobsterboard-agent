/**
 * LobsterBoard Agent - Crypto utilities
 * 
 * Uses ECDH for key exchange and AES-256-GCM for symmetric encryption.
 * This ensures data is encrypted in transit even over HTTP.
 */

const crypto = require('crypto');

const CURVE = 'prime256v1'; // P-256, widely supported
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Generate a new ECDH key pair
 * @returns {{ publicKey: string, privateKey: string }} Base64-encoded keys
 */
function generateKeyPair() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  
  return {
    publicKey: ecdh.getPublicKey('base64'),
    privateKey: ecdh.getPrivateKey('base64'),
  };
}

/**
 * Derive shared secret from our private key and their public key
 * @param {string} privateKeyBase64 - Our private key (base64)
 * @param {string} theirPublicKeyBase64 - Their public key (base64)
 * @returns {Buffer} 32-byte shared secret (SHA-256 of ECDH result)
 */
function deriveSharedSecret(privateKeyBase64, theirPublicKeyBase64) {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.setPrivateKey(Buffer.from(privateKeyBase64, 'base64'));
  
  const sharedPoint = ecdh.computeSecret(Buffer.from(theirPublicKeyBase64, 'base64'));
  
  // Hash the shared point to get a 256-bit key
  return crypto.createHash('sha256').update(sharedPoint).digest();
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string|object} data - Data to encrypt (objects are JSON-stringified)
 * @param {Buffer} key - 32-byte encryption key
 * @returns {string} Base64-encoded encrypted payload (iv + authTag + ciphertext)
 */
function encrypt(data, key) {
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  
  const authTag = cipher.getAuthTag();
  
  // Pack: iv (12 bytes) + authTag (16 bytes) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  
  return packed.toString('base64');
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encryptedBase64 - Base64-encoded encrypted payload
 * @param {Buffer} key - 32-byte encryption key
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedBase64, key) {
  const packed = Buffer.from(encryptedBase64, 'base64');
  
  // Unpack: iv (12 bytes) + authTag (16 bytes) + ciphertext
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  
  return decrypted.toString('utf8');
}

/**
 * Decrypt and parse JSON
 * @param {string} encryptedBase64 - Base64-encoded encrypted payload
 * @param {Buffer} key - 32-byte encryption key
 * @returns {object} Parsed JSON object
 */
function decryptJson(encryptedBase64, key) {
  return JSON.parse(decrypt(encryptedBase64, key));
}

module.exports = {
  generateKeyPair,
  deriveSharedSecret,
  encrypt,
  decrypt,
  decryptJson,
};
