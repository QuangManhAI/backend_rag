import { BadRequestException, type ValidationError } from '@nestjs/common';
import { createValidationPipe, firstValidationMessage } from './validation';

describe('validation pipe & error message extraction', () => {
  it('extracts first nested constraint message or falls back cleanly', () => {
    const errors: ValidationError[] = [
      {
        property: 'outer',
        children: [
          {
            property: 'inner',
            constraints: { isString: 'inner must be a string' },
          },
        ],
      },
    ];
    expect(firstValidationMessage(errors)).toBe('inner must be a string');
    expect(firstValidationMessage([])).toBe('validation error');
  });

  it('createValidationPipe configures strict whitelist and exceptionFactory', async () => {
    const pipe = createValidationPipe();
    class SampleDto {
      query!: string;
    }
    await expect(
      pipe.transform({ extra: 'bad' }, { type: 'body', metatype: SampleDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
