# Adapter Pattern

## Purpose

Convert the interface of a class into another interface that clients expect. Lets classes work together that couldn't otherwise because of incompatible interfaces.

## In Hexagonal Architecture

Adapters are the outer ring. They adapt external systems (databases, APIs, message brokers) to the ports defined by the domain.

## Example

```typescript
// Port (defined in domain)
interface PaymentGateway {
  charge(amount: Money, card: CardToken): Promise<PaymentResult>;
}

// Adapter for Stripe
class StripePaymentAdapter implements PaymentGateway {
  constructor(private stripe: Stripe) {}

  async charge(amount: Money, card: CardToken): Promise<PaymentResult> {
    const result = await this.stripe.charges.create({
      amount: amount.cents,
      currency: amount.currency.toLowerCase(),
      source: card.value,
    });
    return {
      success: result.status === 'succeeded',
      transactionId: result.id,
    };
  }
}

// Adapter for PayPal
class PayPalPaymentAdapter implements PaymentGateway {
  // Different API, same port interface
}
```

See [[arch-009]], [[arch-013]].
