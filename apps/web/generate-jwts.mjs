import { readFileSync } from 'fs';
import { importSPKI, exportJWK } from 'jose';

console.log("👋 Starting JWK generation...");

const publicKeyPem = readFileSync('supabase/keys/jwt-public.pem', 'utf8');
const publicKey = await importSPKI(publicKeyPem, 'RS256');
const jwk = await exportJWK(publicKey);

jwk.alg = 'RS256';
jwk.use = 'sig';
jwk.kid = 'cliply-local';

console.log(JSON.stringify(jwk, null, 2));