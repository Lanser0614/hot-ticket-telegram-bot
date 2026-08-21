export class ValidationError extends Error {
  public override readonly name = 'ValidationError';

  public constructor(message: string) {
    super(message);
  }
}

export class RateLimitError extends Error {
  public override readonly name = 'RateLimitError';

  public constructor(message = 'Слишком много запросов. Повторите позже.') {
    super(message);
  }
}
