---
id: rule-data-testid
c3-seal: 38c7141a10fce3a4d7538a065357b5196283ead0f26881956b0ac185320c6124
title: data-testid
type: rule
goal: Make every interactive or observable React element in the three Ani-Mime windows locatable by automated tests without coupling to CSS classes, DOM position, or visual styling.
---

## Goal

Make every interactive or observable React element in the three Ani-Mime windows locatable by automated tests without coupling to CSS classes, DOM position, or visual styling.

## Rule

React components MUST attach a kebab-cased `data-testid` attribute to every element a test might need to find — buttons, inputs, toggles, status indicators, containers, cards, labels. When in doubt, add one. Tests MUST prefer `getByRole()`, then `getByTestId()`, then `getByText()` — never CSS class or `:nth-child()` selectors.

## Golden Example

```tsx
// src/components/Settings.tsx
<button
  type="button"
  data-testid="settings-tab-appearance"
  aria-selected={active === "appearance"}
  onClick={() => setActive("appearance")}
>
  Appearance
</button>

<label htmlFor="pet-select" data-testid="pet-select-label">Pet</label>
<select id="pet-select" data-testid="pet-select" value={pet} onChange={onPetChange}>
  {pets.map(p => (
    <option key={p.id} data-testid={`pet-option-${p.id}`} value={p.id}>{p.name}</option>
  ))}
</select>
```
```ts
// e2e/settings.spec.ts
await page.getByTestId("settings-tab-appearance").click();
await page.getByTestId("pet-select").selectOption("shiba");
await expect(page.getByTestId("pet-option-shiba")).toHaveAttribute("value", "shiba");
```
## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| <div className="tab active">Appearance</div> | <button data-testid="settings-tab-appearance"> | A styled div has no role, no test id, and can't be found without coupling to .tab.active |
| container.querySelector(".pet-card:nth-child(2)") | page.getByTestId("pet-card-shiba") | Position-based selectors break the moment the catalog order or CSS changes |
| Icon-only <button><Icon /></button> | <button aria-label="Close" data-testid="bubble-close"> | No accessible name, no test id — both a11y and test coverage suffer |
## Scope

Applies to every React component under src/components/ and src/ui/ that renders interactive or stateful UI. Purely decorative wrappers do not need test ids. Unit tests under src/**/*.test.{ts,tsx} and e2e tests under e2e/*.spec.ts MUST follow the selector priority above.
