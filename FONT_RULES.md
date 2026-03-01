# MAC Terminal — Font & Button Rules

## 3-Size Font Scale

| Size | Use | Font | Weight |
|------|-----|------|--------|
| **18px** | Section titles, card headers, stat values | DM Serif Display 400 | 400 |
| **14px** | Body text, descriptions, reasons, notes, buttons, inputs, tickers, prices | Inter / JetBrains Mono | 400–700 |
| **12px** | Labels, timestamps, uppercase metadata, badges, pills, arrows | Inter / JetBrains Mono | 600–800 |

## When to Use 12px (Metadata Only)
- `text-transform: uppercase` labels with `letter-spacing`
- Timestamps ("Updated 3:42 PM", "Generated 2:15 PM", "Last scan: ...")
- Tiny badges/pills (`padding: 1–2px 5–6px; border-radius: 3px`)
- Toggle arrows (▶ ▼)
- Score circles
- "via Source" attribution
- A/D bar numbers inside colored bars
- Table headers (TH elements with letter-spacing)
- Loading/progress messages

## Unified Button Style
All buttons use the `.refresh-btn` class from `styles.css`:
```css
.refresh-btn {
  background: rgba(37,99,235,0.08);
  border: 1px solid var(--blue);
  color: var(--blue);
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}
```
For smaller inline buttons, add: `style="padding:4px 10px;font-size:12px;"`

## Color Variables (Text)
| Variable | Light Mode | Dark Mode | Use |
|----------|-----------|-----------|-----|
| `--text-primary` | `#0F172A` | `#F1F5F9` | Headings, important text |
| `--text-secondary` | `#334155` | `#CBD5E1` | Body text, descriptions |
| `--text-muted` | `#64748B` | `#64748B` | Labels, timestamps, metadata |

## Font Families
- **DM Serif Display** — Section titles only (18px, weight 400)
- **Inter** — All body text, labels, buttons
- **JetBrains Mono** — Prices, tickers, timestamps, monospace data
