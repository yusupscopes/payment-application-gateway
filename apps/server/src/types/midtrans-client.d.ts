declare module "midtrans-client" {
  export class CoreApi {
    constructor(config: {
      isProduction: boolean;
      serverKey: string;
      clientKey: string;
    });
    charge(payload: Record<string, unknown>): Promise<unknown>;
    refund(
      transactionId: string,
      payload: Record<string, unknown>,
    ): Promise<unknown>;
    transaction: {
      status(transactionId: string): Promise<unknown>;
    };
  }

  export class Snap {
    constructor(config: {
      isProduction: boolean;
      serverKey: string;
      clientKey: string;
    });
    createTransaction(payload: Record<string, unknown>): Promise<unknown>;
    createTransactionToken(payload: Record<string, unknown>): Promise<unknown>;
    createTransactionRedirectUrl(
      payload: Record<string, unknown>,
    ): Promise<unknown>;
  }

  export class MidtransError extends Error {
    httpStatusCode?: number;
    constructor(message: string, httpStatusCode?: number);
  }
}
