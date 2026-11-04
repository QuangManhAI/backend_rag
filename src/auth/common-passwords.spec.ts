import {
  COMMON_PASSWORDS,
  normalizeForEmailMatch,
  PASSWORD_CONTAINS_EMAIL,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_COMMON,
  PASSWORD_TOO_LONG,
  PASSWORD_TOO_SHORT,
  validatePassword,
} from './common-passwords';
import { BadRequestException } from '@nestjs/common';

describe('validatePassword', () => {
  it('accepts a decent password', () => {
    expect(() => validatePassword('correct horse battery')).not.toThrow();
  });

  it('rejects a password below the minimum length', () => {
    expect(() => validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toThrow(
      new BadRequestException(PASSWORD_TOO_SHORT),
    );
  });

  it('rejects a password above the maximum length', () => {
    expect(() => validatePassword('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toThrow(
      new BadRequestException(PASSWORD_TOO_LONG),
    );
  });

  it('rejects the most common passwords, case-insensitively', () => {
    for (const common of COMMON_PASSWORDS) {
      expect(() => validatePassword(common)).toThrow(
        new BadRequestException(PASSWORD_TOO_COMMON),
      );
      expect(() => validatePassword(common.toUpperCase())).toThrow(
        new BadRequestException(PASSWORD_TOO_COMMON),
      );
    }
  });

  it('rejects a password that contains the email', () => {
    expect(() =>
      validatePassword('alice.smith-secret', 'alice.smith@example.com'),
    ).toThrow(new BadRequestException(PASSWORD_CONTAINS_EMAIL));
  });

  it('ignores the separators when matching the email', () => {
    expect(() =>
      validatePassword('alicesmith-secret', 'alice.smith@example.com'),
    ).toThrow(new BadRequestException(PASSWORD_CONTAINS_EMAIL));
  });

  it('does not reject a password when the email needle is too short', () => {
    // A two-character needle would reject nearly every password.
    expect(() =>
      validatePassword('correct horse battery', 'ab@x.com'),
    ).not.toThrow();
  });

  it('normalizeForEmailMatch drops the separators and lowercases', () => {
    expect(normalizeForEmailMatch('Alice.Smith-X_y')).toBe('alicesmithxy');
  });
});
