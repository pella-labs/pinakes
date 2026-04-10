# Onion Architecture

## Layers

Similar to clean architecture but uses the "onion" metaphor:

```
+-------------------------------------------+
|            Infrastructure                  |
|  +-------------------------------------+  |
|  |          Application Services        |  |
|  |  +-------------------------------+  |  |
|  |  |       Domain Services          |  |  |
|  |  |  +-------------------------+  |  |  |
|  |  |  |     Domain Model        |  |  |  |
|  |  |  +-------------------------+  |  |  |
|  |  +-------------------------------+  |  |
|  +-------------------------------------+  |
+-------------------------------------------+
```

## Key Rule

Dependencies flow inward. The domain model at the center has no dependencies on anything.

## vs. Clean Architecture

Practically identical. Onion architecture predates clean architecture (Jeffrey Palermo, 2008 vs. Robert Martin, 2012). The concepts are the same; the naming differs.

## When It's Overkill

For simple CRUD apps, this adds layers without value. Reserve for systems with complex domain logic.

See [[arch-010]], [[arch-009]], [[arch-019]].
