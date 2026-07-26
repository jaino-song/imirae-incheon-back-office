"use strict";

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const plugin = require("../data-component");

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: { jsx: true },
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
});

ruleTester.run(
  "require-data-component",
  plugin.rules["require-data-component"],
  {
    valid: [
      {
        code: '<div data-component="desktop_clients-new_basic_name-field" />',
      },
      {
        code: '<section data-component="mobile_contracts-new_review_summary-card" />',
      },
      {
        code: '<main data-component="legacy-page-shell" />',
      },
      {
        code: '<main data-component="legacy-page-shell" />',
        options: [{ banLegacyFormat: false }],
      },
      {
        code: '<main data-component="desktop_clients_shell" />',
        options: [{ banLegacyFormat: true }],
      },
      {
        code: '<section data-component="desktop_clients_detail"><div data-component="desktop_clients_detail_header" /></section>',
      },
      {
        code: '<div data-component="desktop_clients_detail" data-source-component="ClientDetailPanel" />',
      },
      {
        code: '<div data-component="desktop_clients_detail" data-slot="title-row" />',
      },
      {
        code: '<span data-slot="title-row" />',
      },
      {
        code: '<span data-slot={slotName} />',
      },
      {
        code: "<div>{children}</div>",
      },
      {
        code: "<next-route-announcer />",
      },
      {
        code: "<nextjs-portal />",
      },
    ],
    invalid: [
      {
        code: "<div />",
        errors: [{ messageId: "missingDataComponent" }],
      },
      {
        code: '<div data-component="Desktop_clients-new_basic_name-field" />',
        errors: [{ messageId: "invalidFormat" }],
      },
      {
        code: '<section data-component="desktop_clients_detail"><div data-component="desktop_clients_header" /></section>',
        errors: [{ messageId: "brokenParentPath" }],
      },
      {
        code: '<div data-component="desktop_clients_detail" data-source-component="client-detail-panel" />',
        errors: [{ messageId: "invalidSourceComponent" }],
      },
      {
        code: '<main data-component="legacy-page-shell" />',
        options: [{ banLegacyFormat: true }],
        errors: [{ messageId: "legacyFormat" }],
      },
      {
        code: '<div data-component="Desktop_clients_detail" />',
        options: [{ banLegacyFormat: true }],
        errors: [{ messageId: "invalidFormat" }],
      },
      {
        code: '<span data-slot="" />',
        errors: [{ messageId: "emptyDataSlot" }],
      },
      {
        code: '<span data-slot="title_row" />',
        errors: [{ messageId: "invalidDataSlot" }],
      },
      {
        code: '<span data-slot="desktop_clients_detail" />',
        errors: [{ messageId: "invalidDataSlot" }],
      },
      {
        code: "<span data-slot />",
        errors: [{ messageId: "emptyDataSlot" }],
      },
      {
        code: '<div className="contents">{children}</div>',
        errors: [{ messageId: "missingDataComponent" }],
      },
      {
        code: "<div><Child /></div>",
        errors: [{ messageId: "missingDataComponent" }],
      },
      {
        code: "<div hidden />",
        errors: [{ messageId: "missingDataComponent" }],
      },
    ],
  },
);
