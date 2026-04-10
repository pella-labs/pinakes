# Proxy Pattern

Terse note. Three variants:

**Virtual Proxy** — lazy initialization. Don't load heavy object until needed.

**Protection Proxy** — access control. Check permissions before delegating.

**Remote Proxy** — represent a remote object locally. Handle network calls transparently.

```typescript
class ImageProxy implements Image {
  private realImage: RealImage | null = null;

  constructor(private path: string) {}

  display(): void {
    if (!this.realImage) {
      this.realImage = new RealImage(this.path); // expensive load
    }
    this.realImage.display();
  }
}
```

Used heavily in ORMs (lazy loading), RPC frameworks (remote proxy), and authorization layers (protection proxy).

See [[arch-045]], [[arch-030]].
