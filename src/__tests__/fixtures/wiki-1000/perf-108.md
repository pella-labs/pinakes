# Flame Graph Interpretation

## Reading the X-Axis

The x-axis does NOT represent time. It represents the proportion of total samples in which a function appears. Wider = more CPU time.

## Top-Down vs Bottom-Up

- **Top-down** (flame graph): root at bottom, leaves at top. Shows call hierarchy.
- **Bottom-up** (icicle graph): root at top, leaves at bottom. Same data, different perspective.

## Common Patterns

### The Plateau
A wide, flat function at the top of the flame graph. This function is where the CPU is actually spending time (leaf function). Optimize this directly.

### The Funnel
Many different call paths converge to one function. The function itself may be fast, but it's called from everywhere. Reducing call frequency may help more than optimizing the function.

### The Sawtooth
Repeated patterns indicating recursive calls or tight loops. Check if the recursion depth or iteration count can be reduced.

### The GC Mountain
A large proportion of samples in garbage collection functions. Indicates allocation pressure — reduce object creation in hot paths.

## Differential Flame Graphs

Compare two profiles by overlaying them. Red = slower than baseline, blue = faster. Use this to measure the impact of optimization efforts or identify performance regressions.

See [[perf-026]] for profiling and [[perf-058]] for Node.js profiling.
