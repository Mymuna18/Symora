// @ts-check

/** Only use fixed, public-safe messages here, never driver errors or input values. */
export class ReportError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {string} [field] */
  constructor(status, code, message, field) {
    super(message);
    this.name = "ReportError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}
