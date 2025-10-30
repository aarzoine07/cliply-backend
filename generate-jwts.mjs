// generate-jwts.mjs
import { readFileSync } from 'fs';
import { importPKCS8, SignJWT } from 'jose';

console.log('Reading private key...');
const privateKeyPem = readFileSync('supabase/keys/jwt-private.pem', 'utf8');

console.log('Importing private key...');
const privateKey = await importPKCS8(privateKeyPem, 'RS256');

const makeToken = async (userId, workspaceId) => {
  return await new SignJWT({
    role: 'authenticated',
    sub: userId,
    workspace_id: workspaceId,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'cliply-local' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
};

console.log('Generating JWTs...');
const jwtA = await makeToken('user_a', 'workspace_a');
const jwtB = await makeToken('user_b', 'workspace_b');

console.log('\n✅ SUPABASE_JWT_A:\n', jwtA);
console.log('\n✅ SUPABASE_JWT_B:\n', jwtB);
