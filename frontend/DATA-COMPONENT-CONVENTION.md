# Data-Component Naming Convention

`data-component`는 화면에서 요소가 **어디에 속하는지**를 나타내고,
`data-source-component`는 그 DOM root를 **어떤 React 컴포넌트가 렌더링했는지**를 나타낸다.

## Canonical format

```text
{platform}_{route-or-surface}_{owner}_{child}[_{subpart}...]
```

- `platform`: `desktop` 또는 `mobile`
- 의미 단위 사이는 `_`
- 한 의미 단위 안의 복합어는 `-`
- 전체 값은 다음 정규식을 만족해야 한다.

```regex
/^(desktop|mobile)_[a-z0-9]+(?:-[a-z0-9]+)*(?:_[a-z0-9]+(?:-[a-z0-9]+)*){1,}$/
```

예:

```text
desktop_clients-detail_panel
desktop_clients-detail_panel_service-records
desktop_clients-detail_panel_service-records_overview-grid_header-card
desktop_clients-detail_panel_service-records_overview-grid_header-card_head_title-row_title
```

## Full-parent-path rule

모든 annotated child는 route/surface root부터 현재 component boundary까지의 의미 있는
부모 경로를 빠짐없이 유지한다. 부모가 `P`라면 자식은 반드시 `P_...`로 시작한다.

- 최대 depth 제한이 없다.
- 중간에서 page prefix만 남기고 namespace를 다시 시작하지 않는다.
- `info-card-title`, `detail-panel-header` 같은 context-free fallback을 사용하지 않는다.
- 단순 styling wrapper는 새 component layer가 아니다. 의미 있는 이름이 없는 모든
  `<div>`/`<span>`에 기계적인 이름을 추가하지 않는다.

## Reusable components

재사용 composite는 caller가 완성된 `data-component` base를 전달해야 한다.
컴포넌트 root는 base를 그대로 사용하고 내부 named part는 `${base}_${suffix}`로 만든다.

```tsx
<InfoCard data-component={`${panelBase}_service-records_header-card`} />
```

`InfoCard` 내부:

```text
..._header-card
..._header-card_head
..._header-card_head_title-row
..._header-card_head_title-row_title
..._header-card_body
```

같은 concrete DOM root를 여러 React wrapper가 공유하면 가장 바깥의 semantic owner가
`data-source-component`를 소유한다. 예:

```html
<div
  data-component="desktop_clients-detail_panel_service-records_overview-grid_header-card"
  data-source-component="ServiceRecordHeaderCard"
>
```

## Selector discipline

`data-component`는 debugging/inspection 계약이지 styling 또는 runtime behavior hook이 아니다.
공용 컴포넌트 내부 동작과 CSS는 `data-slot`, class, ref를 사용한다. 기존
`[data-component="..."]` consumer가 있는 값을 변경할 때 producer와 consumer를 같은
변경에서 함께 옮긴다.

## Annotation scope

다음에는 부여한다.

- route/screen/panel/template root
- 재사용 component root
- composite의 이름 있는 subpart
- debugging 또는 테스트에서 독립적으로 식별할 가치가 있는 action/field/state

다음에는 억지로 부여하지 않는다.

- 의미 없는 layout-only wrapper
- inline text의 모든 `<span>`/`<p>`
- SVG/third-party internals
- shadcn primitive 내부 (`data-slot` 유지)
