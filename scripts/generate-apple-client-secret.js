// Generate the Apple "client secret" JWT that Supabase needs in the
// Apple provider config. Uses only Node built-ins; no npm install required.
//
// Usage (PowerShell):
//   $env:APPLE_TEAM_ID = KHXB77M9AG
//   $env:APPLE_SERVICES_ID = com.ropeaccess.logbook.signin
//   $env:APPLE_KEY_ID = GPMVJ3V65K
//   $env:APPLE_P8_PATH = C:\Users\MC\Downloads\AuthKey_GPMVJ3V65K.p8
//   node scripts/generate-apple-client-secret.js
//
// Usage (bash/zsh):
//   APPLE_TEAM_ID=ABCDE12345 \
//   APPLE_SERVICES_ID=com.ropeaccess.logbook.signin \
//   APPLE_KEY_ID=ABCDE12345 \
//   APPLE_P8_PATH=./AuthKey_ABCDE12345.p8 \
//   node scripts/generate-apple-client-secret.js
//
// Apple caps client_secret JWTs at ~6 months. Calendar-remind yourself.

const fs = require('node:fs');
const crypto = require('node:crypto');

const { APPLE_TEAM_ID, APPLE_SERVICES_ID, APPLE_KEY_ID, APPLE_P8_PATH } = process.env;

if (!APPLE_TEAM_ID || !APPLE_SERVICES_ID || !APPLE_KEY_ID || !APPLE_P8_PATH) {
  console.error('Missing env: APPLE_TEAM_ID, APPLE_SERVICES_ID, APPLE_KEY_ID, APPLE_P8_PATH');
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const now = Math.floor(Date.now() / 1000);
const exp = now + 60 * 60 * 24 * 180; // 180 days; Apple max is ~6 months

const header = { alg: 'ES256', kid: APPLE_KEY_ID, typ: 'JWT' };
const payload = {
  iss: APPLE_TEAM_ID,
  iat: now,
  exp,
  aud: 'https://appleid.apple.com',
  sub: APPLE_SERVICES_ID,
};

const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

const privateKey = crypto.createPrivateKey({
  key: fs.readFileSync(APPLE_P8_PATH, 'utf8'),
  format: 'pem',
});

// dsaEncoding 'ieee-p1363' is critical — Apple expects raw r||s (64 bytes),
// not the default DER-encoded ASN.1 signature.
const signature = crypto.sign('SHA256', Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363',
});

console.log(`${signingInput}.${base64url(signature)}`);
