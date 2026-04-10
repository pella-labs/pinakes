# Anti-Corruption Layer

## Problem

When integrating with a legacy system (or a third-party API), their model leaks into your domain code. Over time, your code becomes a mirror of their bad decisions.

## Solution

An **anti-corruption layer** (ACL) translates between the external model and your internal model. It's a boundary that prevents foreign concepts from polluting your domain.

## Structure

```typescript
// External model (legacy API response)
interface LegacyCustomerDTO {
  CUST_NO: string;
  CUST_NM: string;
  CUST_ADDR_1: string;
  CUST_ADDR_2: string;
  CUST_ZIP: string;
  CUST_STAT_CD: string; // "A", "I", "S"
}

// Your domain model
interface Customer {
  id: CustomerId;
  name: string;
  address: Address;
  status: CustomerStatus;
}

// The ACL
class CustomerTranslator {
  toDomain(dto: LegacyCustomerDTO): Customer {
    return {
      id: CustomerId.from(dto.CUST_NO),
      name: dto.CUST_NM.trim(),
      address: Address.from(dto.CUST_ADDR_1, dto.CUST_ADDR_2, dto.CUST_ZIP),
      status: this.mapStatus(dto.CUST_STAT_CD),
    };
  }

  private mapStatus(code: string): CustomerStatus {
    const map: Record<string, CustomerStatus> = {
      'A': 'active', 'I': 'inactive', 'S': 'suspended'
    };
    return map[code] ?? 'unknown';
  }
}
```

## When to Use

- Integrating with legacy systems
- Consuming third-party APIs you don't control
- Migrating between systems ([[arch-024]])

See [[arch-007]], [[arch-006]].
