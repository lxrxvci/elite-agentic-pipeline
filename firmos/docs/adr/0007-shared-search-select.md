# ADR-0007: Shared searchable single- and multi-select control

**Status:** Approved and implemented (2026-11-13)

## Context

The 2026-11-13 Yecny × Agentic transcript settles a repeated complaint: search fields, native selects, card choices, and custom dropdowns force different workflows on different screens. Jason wants one searchable input that also opens a browsable dropdown, with checkboxes for multi-select, full-width alignment, persistent inline add, pencil editing when it does not slow the interface, and adaptive list height.

The app already has Radix Popover, Radix Select, `cmdk`, a native-select shell, `PickerCombobox`, `InstitutionSelect`, and `ContactPicker`. Their behavior and accessibility models are not interchangeable. In particular, `cmdk` uses `aria-selected` for its active row, which cannot also represent independent checked state for multi-select. A listbox option also cannot contain a separate edit button.

## Decision

1. Build `components/ui/search-select.tsx` as the shared control. It accepts stable option IDs, labels, descriptions, keywords, and arbitrary option data. Single- and multi-select use the same trigger, popover, filtering, sizing, and keyboard model.
2. Click or ArrowDown opens an unfiltered list using the declared `optionOrder`; focus alone stays closed so returning from a selection does not reopen it. `alphabetical` sorts true catalogs by label. `source` preserves numeric, chronological, workflow, and ranked input order. Typing filters without changing that contract. Large sources use debounced server results and ignore stale responses.
3. Multi-select stays open and uses independent checked state. Single-select closes and remains closed after focus returns. Pointer-down on an option does not steal focus from the input. The high-frequency popover has no enter/exit animation.
4. Adaptive height follows Jason's rule: show all rows through ten, ten rows from 11–20 options, then one additional row per ten additional options, capped at twenty and constrained by Radix's available viewport height.
5. Inline add and rename are optional callbacks so fixed system choices do not become editable database entries. The pencil remains visible inside an option but is not a nested button. Pointer users click it; keyboard users press F2 on the active option. Rename opens a separate form mode.
6. The approved proofs are payroll-provider single-select, merchant-processor multi-select with add/rename, and async contact/client lookup. Native selects, Radix-style selects, institution selects, and `PickerCombobox` now delegate to the same behavior while retaining their existing call-site contracts. All preserve existing intake answer shapes and server persistence.
7. Verification covers unit and server tests, 150/500/2,000-option cases, production build, real-browser selection/add/rename flows, desktop/tablet/mobile screenshots, and scoped axe scans. Jason approved the shared control before the remaining transcript work began.
8. Native and Radix-style adapters default to authored source order; true staff/client/catalog consumers opt into alphabetical ordering. Fixed intake options use source order unless explicitly marked alphabetical. First/last pins keep placeholders and All/None choices ahead of catalogs and custom Other choices last. Clock clients, contact matches, workstation work, and conversations preserve intentional ranking. Exact payroll 1–31, close-tier, cadence, month, weekday, adapter, sentinel, filtering, and keyboard-order regressions guard this policy.

9. On 2026-11-18, multi-select selections moved to a vertical list beneath the input, with one removal control per selected item. The closed input no longer concatenates selected names. SOP-linked intake fields use the same searchable three-way choice: Use existing SOP, Create new SOP, or I’m not sure. Business association pickers retain source order and query only clients linked to the selected canonical contact; new contacts have no association options.

## Consequences

- No new runtime dependency was added. Radix Popover supplies positioning and viewport constraints; the component owns selection and active-descendant behavior.
- Contact/client empty queries now return an alphabetical browse page of up to twenty records per group instead of an empty result.
- Merchant options keep local additions and renames across parent rerenders, and successful renames update the parent's row snapshot for remounts.
- Single-select closes on a choice; multi-select remains open with independent checked state. Optional add/rename callbacks and `onBusyChange` let forms prevent navigation while asynchronous catalog writes settle.
