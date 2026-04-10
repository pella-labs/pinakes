# Bounded Contexts in Practice

## Defining Boundaries

A **bounded context** is where a particular model applies. The same real-world concept (e.g., "Customer") may have different representations in different contexts.

## Example: E-Commerce

| Context | "Customer" means... |
|---|---|
| Sales | Name, email, purchase history, loyalty tier |
| Shipping | Name, address, delivery preferences |
| Billing | Name, payment methods, invoices |
| Support | Name, ticket history, satisfaction score |

Each context has its own `Customer` model. They share an ID but nothing else.

## Integration Between Contexts

Options, from tightest to loosest coupling:

1. **Shared Kernel** — both teams co-own a small shared model (risky)
2. **Customer-Supplier** — upstream publishes, downstream consumes
3. **Conformist** — downstream accepts upstream's model as-is
4. **Anti-Corruption Layer** — downstream translates upstream's model into its own

## Context Mapping

Draw a context map early. Update it as the system evolves. It's the most valuable DDD artifact for a distributed team.

See [[arch-006]], [[arch-013]].
