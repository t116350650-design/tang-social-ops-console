const decoder = new TextDecoder();
const encoder = new TextEncoder();
const fromB64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const toB64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
export async function decryptPwaEnvelope(envelope, passphrase) {
  if (envelope?.version !== 1 || envelope.algorithm !== 'aes-256-gcm' || envelope.kdf !== 'pbkdf2-sha256' || envelope.iterations !== 210000 || envelope.hash !== 'SHA-256') throw new Error('不支持的信封');
  const salt = fromB64(envelope.salt), iv = fromB64(envelope.iv), tag = fromB64(envelope.tag), ciphertext = fromB64(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('不支持的信封');
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const combined = new Uint8Array(ciphertext.length + tag.length); combined.set(ciphertext); combined.set(tag, ciphertext.length);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, combined);
  return JSON.parse(decoder.decode(plain));
}
