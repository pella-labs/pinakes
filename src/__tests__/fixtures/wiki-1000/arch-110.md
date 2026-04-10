# Microkernel Architecture

## Also Known As

**Plugin architecture**. A minimal core system with extensibility via plugins.

## Structure

```
+-----------------------------+
|         Plugins             |
|  [Plugin A] [Plugin B] ... |
+-----------------------------+
|      Plugin Interface       |
+-----------------------------+
|       Core System           |
+-----------------------------+
```

## Examples

- **Eclipse IDE** — core platform + plugin ecosystem
- **VS Code** — extensions add languages, themes, features
- **Webpack** — core bundler + loaders/plugins
- **Express.js** — minimal core + middleware

## When to Use

- Products that need customer-specific customizations
- Platforms with third-party extensions
- Systems where the core is stable but features vary

## Plugin Interface Design

Keep the plugin API small and stable. Version it independently from the core. Use hooks/events rather than subclassing.

See [[arch-025]], [[arch-044]].
