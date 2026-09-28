/**
 * Checking a new vault password (audit M-9).
 *
 * Once the encrypted vault leaves the device — a stolen browser profile,
 * backup or disk image — it is exactly as strong as its password: the KDF
 * slows each guess, but crackers try common passwords, and simple runs and
 * repeats, first. So beyond the 8-character minimum this refuses those:
 *  - a common password, also with l33t swaps (p@ssw0rd), with digits or
 *    symbols tacked on either end (Password123!), or doubled
 *    (passwordpassword) — including the obvious wallet words;
 *  - keyboard, alphabet and digit runs (12345678, qwertyui, abcd1234);
 *  - fewer than 4 different characters (aaaaaaaa, 12121212);
 *  - digits only, under 12 of them.
 * It is a floor, not a meter: anything else passes, e.g. a few unrelated
 * words. Apply it only where a password is SET (create / import / change) —
 * never where an existing one is typed, or a legacy password stops working.
 */
export const MIN_PASSWORD_LENGTH = 8;

const RUNS = [
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890123456789',
  'qwertyuiopasdfghjklzxcvbnm',
  'qwertzuiopasdfghjklyxcvbnm',
  'azertyuiopqsdfghjklmwxcvbn',
  '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p',
  'zaq12wsxcde34rfvbgt56yhnmju78ik9ol0p',
  '1q2w3e4r5t6y7u8i9o0p',
  'q1w2e3r4t5y6u7i8o9p0',
  'a1b2c3d4e5f6g7h8i9j0',
];

// Letters only: a password is compared after its end digits and symbols are
// stripped and l33t swaps undone, so "Dragon2024!" and "dr4g0n" both hit
// "dragon".
const COMMON = new Set((
  'password passwd passw pass mypassword mypass passpass secret secrets letmein welcome ' +
  'login admin administrator root user guest test testing demo default changeme temp ' +
  'iloveyou iloveu loveyou love lovely lover sunshine princess prince angel angels ' +
  'football baseball basketball soccer hockey golf tennis cricket rugby ' +
  'monkey dragon master shadow superman batman spiderman ironman hulk avengers marvel ' +
  'trustno trustnoone whatever freedom starwars starwar jedi yoda vader pokemon pikachu ' +
  'minecraft fortnite roblox zelda mario nintendo playstation xbox gamer ' +
  'michael jennifer jordan hunter charlie killer ranger buster thomas tigger robert ' +
  'daniel andrew joshua matthew anthony ashley jessica amanda nicole justin michelle ' +
  'william james david richard joseph charles christopher jason george maggie ginger ' +
  'computer internet samsung google apple iphone android facebook twitter instagram ' +
  'hello hellokitty flower flowers family summer winter spring autumn orange banana ' +
  'cheese cookie cookies chocolate pepper purple yellow silver golden diamond money ' +
  'mustang corvette mercedes ferrari porsche harley yankees dallas cowboys chelsea ' +
  'liverpool arsenal barcelona madrid juventus matrix merlin gandalf phoenix legend ' +
  'qazwsx qweasd asdfgh zxcvbn qwerty azerty qwertz asdf zxcv abc abcd abcdef ' +
  'blink blessed jesus christ heaven god myspace zombie ninja samurai tiger lion ' +
  'bitcoin btc crypto cryptocurrency ethereum ether eth solana sol cardano doge ' +
  'dogecoin shiba wallet mywallet metamask ledger trezor satoshi nakamoto hodl ' +
  'moon tothemoon lambo blockchain defi nft token tokens coin coins ' +
  'thanos thanoswallet litho lithosphere makalu kamet infinity gauntlet'
).split(' '));

const reversed = (s: string) => [...s].reverse().join('');
const isRun = (s: string) => s.length >= 3 && RUNS.some((r) => r.includes(s) || reversed(r).includes(s));

/** Why this can't be the new password, or null if it can. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (new Set(lower).size < 4) return 'Too repetitive — use more different characters.';

  const alnum = lower.replace(/[^a-z0-9]/g, '');
  const base = lower
    .replace(/^[^a-z]+|[^a-z]+$/g, '')          // end digits / symbols
    .replace(/[@4]/g, 'a').replace(/[$5]/g, 's').replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/7/g, 't')
    .replace(/[^a-z]/g, '');
  const unit = /^(.+?)\1+$/.exec(base)?.[1] ?? base;   // passwordpassword → password
  // A short letter core is a run by chance too often ("8#Rty!29^" → rty) to
  // count on its own; a repeated one (abcabcabc) is not chance.
  if (isRun(alnum) || (base.length >= 4 && isRun(base)) || (unit !== base && isRun(unit))) {
    return 'Avoid keyboard or alphabet runs like 12345678 or qwerty.';
  }
  if (/^\d+$/.test(password) && password.length < 12) return 'A numbers-only password needs at least 12 digits.';
  if (COMMON.has(base) || COMMON.has(unit)) {
    return 'Too common — it’s among the first passwords an attacker tries.';
  }
  return null;
}
