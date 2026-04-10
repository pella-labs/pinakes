# Testing Map and Geospatial Data

Geospatial operations involve coordinates, distances, and spatial queries. Floating point precision is a constant concern.

## Distance Calculation

```typescript
it('calculates distance between two points', () => {
  const nyc = { lat: 40.7128, lng: -74.0060 };
  const la = { lat: 34.0522, lng: -118.2437 };

  const distance = haversine(nyc, la);
  expect(distance).toBeCloseTo(3944, 0); // ~3944 km
});
```

## Bounding Box Queries

```typescript
it('finds points within bounding box', () => {
  const points = [
    { id: '1', lat: 40.7, lng: -74.0 },  // NYC
    { id: '2', lat: 34.0, lng: -118.2 },  // LA
    { id: '3', lat: 51.5, lng: -0.1 },    // London
  ];

  const box = { north: 45, south: 35, east: -70, west: -80 };
  const results = findInBounds(points, box);

  expect(results.map(r => r.id)).toEqual(['1']);
});
```

## Edge Cases

- Points on the international date line (longitude 180/-180)
- Points at the poles
- Zero-distance queries
- Very large bounding boxes (spanning the globe)
- Negative coordinates

## Precision

Geospatial calculations involve floating point math. Use `toBeCloseTo` rather than exact equality for distance and area comparisons.
