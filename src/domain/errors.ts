export class ValidationError extends Error {
  public override readonly name = 'ValidationError';

  public constructor(message: string) {
    super(message);
  }
}

