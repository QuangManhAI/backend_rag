import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

/** First human-readable constraint message, searching nested errors depth-first. */
export function firstValidationMessage(errors: ValidationError[]): string {
  for (const e of errors) {
    const constraints = e.constraints ? Object.values(e.constraints) : [];
    if (constraints.length) return constraints[0];
    const nested = firstValidationMessage(e.children ?? []);
    if (nested) return nested;
  }
  return 'validation error';
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException(firstValidationMessage(errors)),
  });
}
