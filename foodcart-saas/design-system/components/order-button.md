# OrderButton

## Purpose

Prominent pill-shaped button driving visitors to third-party ordering platforms (DoorDash, UberEats, Grubhub).

## Anatomy

```
[OrderButton]
├── background
├── label
└── optional platform icon
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `platform` | `string` | — | Platform name |
| `href` | `string` | — | External order URL |
| `children` | `ReactNode` | — | Label |

## Tokens

- Background: `component.order-button.background`
- Background hover: `component.order-button.background-hover`
- Text: `component.order-button.text`
- Radius: `component.order-button.radius`
- Padding: `component.order-button.padding-x`, `component.order-button.padding-y`
- Font weight: `component.order-button.font-weight`

## Accessibility

- Renders as `<a>` with `href`; do not use a `<button>` for navigation.
- External link warns users if opening in a new tab (`target="_blank"` with `rel="noopener noreferrer"`).
- Focus ring matches `semantic.focus-ring`.
- Minimum touch target 44×44 px.

## Usage examples

```tsx
<OrderButton platform="DoorDash" href="https://doordash.com/store/...">
  Order on DoorDash
</OrderButton>
```
