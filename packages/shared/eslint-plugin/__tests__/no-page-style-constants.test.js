"use strict";

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../ui-architecture/no-page-style-constants");

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

ruleTester.run("no-page-style-constants", rule, {
  valid: [
    {
      filename: "/components/Foo.tsx",
      code: `
        const CARD_CLASS = "rounded-lg bg-white";

        export default function Foo() {
          return <div className={CARD_CLASS} />;
        }
      `,
    },
    {
      filename: "/app/contracts/page.tsx",
      options: [{ forbiddenNamePattern: "_STYLE$" }],
      code: `
        const CARD_CLASS = "rounded-lg bg-white";

        export default function ContractsPage() {
          return <div className={CARD_CLASS} />;
        }
      `,
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        let CARD_CLASS = "rounded-lg bg-white";
        const CARD_CLASS_NAME = getClassName();

        export default function ContractsPage() {
          return <div className={CARD_CLASS_NAME || CARD_CLASS} />;
        }
      `,
    },
  ],
  invalid: [
    {
      filename: "/app/contracts/page.tsx",
      code: `
        const CARD_CLASS = "rounded-lg bg-white";

        export default function ContractsPage() {
          return <div className={CARD_CLASS} />;
        }
      `,
      errors: [{ messageId: "pageStyleConstant" }],
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export const PANEL_CLASSES = \`border border-gray-200\`;

        export default function ContractsPage() {
          return <div className={PANEL_CLASSES} />;
        }
      `,
      errors: [{ messageId: "pageStyleConstant" }],
    },
  ],
});
