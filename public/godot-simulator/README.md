# Godot Web Simulator Export

Generated Godot Web files are intentionally excluded from Git. A `.pck` export is
larger than GitHub's normal single-file limit, and committing only part of an
export would leave a broken simulator.

From the repository root, generate the complete local export with:

```bash
pnpm demo:godot:web
```

The React dashboard embeds `index.html` from this directory when the complete
export exists. Without it, the dashboard keeps working and displays the export
instructions instead of presenting a non-functional demo as a live simulator.
