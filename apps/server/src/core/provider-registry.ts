import type { IPaymentProvider, ProviderName } from "../types/payment.js";

export class ProviderNotFoundError extends Error {
  constructor(public readonly providerName: ProviderName) {
    super(`Payment provider "${providerName}" is not registered`);
    this.name = "ProviderNotFoundError";
  }
}

export class ProviderRegistry {
  private providers = new Map<ProviderName, IPaymentProvider>();

  register(provider: IPaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  resolve(name: ProviderName): IPaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ProviderNotFoundError(name);
    }
    return provider;
  }

  getRegisteredProviders(): ProviderName[] {
    return Array.from(this.providers.keys());
  }
}
