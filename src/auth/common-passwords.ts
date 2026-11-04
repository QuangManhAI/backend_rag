import { BadRequestException } from '@nestjs/common';

/**
 * Password policy for register / change-password / admin bootstrap (prompt_security S2).
 *
 * Rules (OWASP-aligned, deliberately stricter than the previous 8-character minimum):
 *  - 10..200 characters (200 is the Argon2 payload ceiling already enforced by the DTOs);
 *  - not one of the 200 most common passwords;
 *  - must not contain the user's email (normalised by dropping `.`, `-` and `_`).
 */

/** The 200 most common passwords (a compact, embedded list — no runtime dependency). */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456',
  'password',
  '12345678',
  'qwerty',
  '123456789',
  '111111',
  '1234567',
  'abc123',
  'password1',
  '123123',
  'admin',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'charlie',
  'aa123456',
  'donald',
  'qwerty123',
  'password123',
  '000000',
  '1234',
  'master',
  '1234567890',
  'qazwsx',
  'login',
  'starwars',
  'whatever',
  'zaq12wsx',
  'baseball',
  'passw0rd',
  'trustno1',
  'superman',
  'ashley',
  'michael',
  'shadow',
  '1231234',
  '654321',
  '123qwe',
  'killer',
  'jordan',
  'jennifer',
  'zxcvbnm',
  'asdfgh',
  'hunter',
  'buster',
  'soccer',
  'harley',
  'batman',
  'andrew',
  'tigger',
  'sunshine1',
  'iloveu',
  '2000',
  'chocolate',
  'pussy',
  'soccer1',
  'anthony',
  'friends',
  'butterfly',
  'purple',
  'angel',
  'jordan23',
  'liverpool',
  'justin',
  'loveme',
  'fuckyou',
  '123123',
  'football1',
  'secret',
  'andrea',
  'carlos',
  'jennifer1',
  'joshua',
  'bubbles',
  '12345678910',
  'superman1',
  'qazwsxedc',
  'harley1',
  'daniel',
  'thomas',
  'robert',
  'maggie',
  'love',
  'jackson',
  'jordan1',
  'hannah',
  'robert1',
  'amanda',
  'lovely',
  'jasmine',
  'nicole',
  'michelle',
  'matthew',
  'computer',
  'pepper',
  'ginger',
  'freedom',
  'nicole1',
  'jessica',
  'nathan',
  'junior',
  'jasmine1',
  'maggie1',
  'abcdef',
  'mustang',
  'cookie',
  'summer',
  'soccer2',
  'chelsea',
  'lakers',
  'madison',
  'summer1',
  'ashley1',
  'bailey',
  'amanda1',
  'nicole2',
  'banana',
  'coffee',
  'forever',
  'angel1',
  'elizabeth',
  'purple1',
  'hannah1',
  'peanut',
  'cheese',
  'orange',
  'cookie1',
  'summer2',
  'matrix',
  'buster1',
  'bananas',
  'love1',
  'jackson1',
  'taylor',
  'sparky',
  'freedom1',
  'hunter1',
  'austin',
  'jasmine2',
  'charlie1',
  'cricket',
  'toyota',
  'toyota1',
  'patrick',
  'johnson',
  'gordon',
  'dallas',
  'william',
  'george',
  'chicken',
  'sparky1',
  'jasmine3',
  'genesis',
  'mother',
  'butterfly1',
  'wizard',
  'marina',
  'scooter',
  'phoenix',
  'guitar',
  'shannon',
  'maverick',
  'chicago',
  'sparkle',
  'joseph',
  'butterfly2',
  'compaq',
  'princess1',
  'snoopy',
  'jonathan',
  'cougar',
  'golden',
  'taylor1',
  'samantha',
  'nicole3',
  'tiffany',
  'brandon',
  'lovers',
  'barbie',
  'victor',
  'matthew1',
  'daniel1',
  'tennis',
  'nicole4',
  'crystal',
  'jason',
  'scooby',
  'merlin',
  'soccer3',
  'lovers1',
  'porsche',
  'guitar1',
  'asdfasdf',
  'diamond',
  'patrick1',
  'jasmine4',
  'alexander',
  'andrea1',
  'matthew2',
  'creative',
  'mike',
  'brandon1',
  'falcon',
  'access',
  'yankees',
  '987654321',
  'dallas1',
  'eagles',
  'charlie2',
  'couple',
  'boston',
  'braves',
  'yankees1',
  'barbie1',
  'midnight',
  'love2',
  'sandra',
  'starwars1',
  'boston1',
  'wizard1',
  'marina1',
]);

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export const PASSWORD_TOO_SHORT = 'password too short';
export const PASSWORD_TOO_LONG = 'password too long';
export const PASSWORD_TOO_COMMON = 'password too common';
export const PASSWORD_CONTAINS_EMAIL = 'password contains email';

/**
 * The local part of an email address (everything before `@`), with the separators that make
 * emails look different while meaning the same thing removed.
 */
export function normalizeForEmailMatch(value: string): string {
  return value.toLowerCase().replace(/[.\-_]/g, '');
}

/** The part of an email before the `@`, normalised for the password check. */
export function emailLocalPart(email: string): string {
  const at = email.lastIndexOf('@');
  return normalizeForEmailMatch(at >= 0 ? email.slice(0, at) : email);
}

/**
 * Throws `BadRequestException` when the password violates the policy. `email` is optional so the
 * policy can also be enforced for accounts whose email is not known yet.
 */
export function validatePassword(password: string, email?: string): void {
  // The blacklist is checked first: a common password is wrong even when it is short, and the
  // more specific message is the more useful one.
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new BadRequestException(PASSWORD_TOO_COMMON);
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(PASSWORD_TOO_SHORT);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new BadRequestException(PASSWORD_TOO_LONG);
  }
  if (email) {
    const needle = emailLocalPart(email);
    // Very short needles would reject almost every password.
    if (
      needle.length >= 3 &&
      normalizeForEmailMatch(password).includes(needle)
    ) {
      throw new BadRequestException(PASSWORD_CONTAINS_EMAIL);
    }
  }
}
