# Mobile Data-Component Naming Convention

모바일도 frontend와 같은 full-parent-path 계약을 사용한다. 유일한 platform prefix는
`mobile`이다.

```text
mobile_clients_detail-sheet
mobile_clients_detail-sheet_stack
mobile_clients_detail-sheet_stack_detail-page
mobile_clients_detail-sheet_stack_detail-page_content
mobile_clients_detail-sheet_stack_detail-page_content_service-records
```

## Rules

- 형식:
  `/^(desktop|mobile)_[a-z0-9]+(?:-[a-z0-9]+)*(?:_[a-z0-9]+(?:-[a-z0-9]+)*){1,}$/`
- 자식은 직계 parent scope의 완전한 값을 prefix로 유지한다.
- depth 제한과 namespace restart는 없다.
- shared/mobile-redesign/v3 composite는 route-aware caller가 완성된 base를 전달한다.
- composite 내부 named part는 `${base}_${suffix}`로만 확장한다.
- `data-source-component`는 실제 exported component 이름을 PascalCase literal로 root에 기록한다.
- CSS와 imperative behavior는 `data-component` 대신 `data-slot`, class, ref를 사용한다.

예:

```tsx
<MobileDetailSheet data-component="mobile_clients_detail-sheet" />
```

렌더 경로:

```text
mobile_clients_detail-sheet
mobile_clients_detail-sheet_stack
mobile_clients_detail-sheet_stack_list-page
mobile_clients_detail-sheet_stack_scrim
mobile_clients_detail-sheet_stack_detail-page
mobile_clients_detail-sheet_stack_detail-page_header
mobile_clients_detail-sheet_stack_detail-page_header_close
```

단순 layout wrapper나 모든 inline text에 기계적인 `_div`, `_span` 이름을 붙이지 않는다.
route/screen/component root와 의미 있는 named subpart만 annotation한다.
