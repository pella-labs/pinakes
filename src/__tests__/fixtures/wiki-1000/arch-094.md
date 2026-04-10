---
source: ai-generated
---
# Domain Services vs Application Services

## Domain Services

Contain domain logic that doesn't belong to any single entity or value object.

```typescript
class TransferService {
  transfer(from: Account, to: Account, amount: Money): void {
    from.debit(amount);
    to.credit(amount);
  }
}
```

Rules:
- Stateless
- Operate on domain objects
- Named using ubiquitous language
- Part of the domain layer

## Application Services

Orchestrate use cases. Coordinate domain objects, repositories, and external services.

```typescript
class TransferUseCase {
  constructor(
    private accountRepo: AccountRepository,
    private transferService: TransferService,
    private eventBus: EventBus,
  ) {}

  async execute(fromId: string, toId: string, amount: Money): Promise<void> {
    const from = await this.accountRepo.findById(fromId);
    const to = await this.accountRepo.findById(toId);
    this.transferService.transfer(from, to, amount);
    await this.accountRepo.save(from);
    await this.accountRepo.save(to);
    this.eventBus.publish(new TransferCompleted(fromId, toId, amount));
  }
}
```

Rules:
- Thin — no domain logic
- Coordinate and delegate
- Part of the application layer
- Transaction management lives here

See [[arch-006]], [[arch-010]].
