/**
 * Base error class for service-layer domain errors.
 * Does NOT carry HTTP status codes — HTTP mapping is the route handler's responsibility.
 */
export class ServiceError extends Error {
  public readonly errors?: string[];

  constructor(detail: string, errors?: string[]) {
    super(detail);
    this.name = new.target.name;
    this.errors = errors;
  }
}
