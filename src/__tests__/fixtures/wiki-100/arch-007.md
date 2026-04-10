---
source: extracted
---

# API Gateway Pattern

An **API gateway** is the single entry point for all client requests in a microservices architecture. It sits between external clients and internal services, handling cross-cutting concerns like authentication, rate limiting, and request routing.

## Responsibilities

- **Request routing**: maps external URLs to internal service endpoints
- **Authentication and authorization**: validates tokens before forwarding (see [[auth-flow]])
- **Rate limiting**: protects backend services from abuse
- **Response aggregation**: combines responses from multiple services into a single client response
- **Protocol translation**: accepts REST from clients, forwards as gRPC to internal services
- **Caching**: short-lived response caching for read-heavy endpoints

## Backend for Frontend (BFF)

The **BFF pattern** creates separate API gateways for different client types. A mobile BFF returns compact payloads optimized for bandwidth. A web BFF returns richer data. An admin BFF exposes management endpoints.

```typescript
// Mobile BFF — compact response
app.get('/api/mobile/orders/:id', async (req, res) => {
  const order = await orderService.getOrder(req.params.id);
  res.json({
    id: order.id,
    status: order.status,
    total: order.total,
    itemCount: order.items.length,
  });
});

// Web BFF — full response with nested data
app.get('/api/web/orders/:id', async (req, res) => {
  const [order, customer, shipment] = await Promise.all([
    orderService.getOrder(req.params.id),
    customerService.getCustomer(order.customerId),
    shipmentService.getShipment(order.shipmentId),
  ]);
  res.json({ order, customer, shipment });
});
```

## Implementation Choices

Popular gateway implementations include Kong, AWS API Gateway, Envoy (as edge proxy), and custom gateways built on Express/Fastify. For service mesh deployments ([[arch-006]]), the ingress gateway often serves as the API gateway.

## Anti-patterns

Avoid putting business logic in the gateway. It should be a thin routing and policy layer, not a service. Also avoid making it a single point of failure — deploy multiple instances behind a load balancer.
