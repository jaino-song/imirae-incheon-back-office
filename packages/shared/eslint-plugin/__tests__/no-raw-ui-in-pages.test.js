"use strict";

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../ui-architecture/no-raw-ui-in-pages");

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

ruleTester.run("no-raw-ui-in-pages", rule, {
  valid: [
    {
      filename: "/components/Foo.tsx",
      code: `
        export default function Foo() {
          return <button>Save</button>;
        }
      `,
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export default function ContractsPage() {
          return <form><div /></form>;
        }
      `,
    },
    {
      filename: "/app/contracts/page.jsx",
      options: [{ allow: ["button", "dialog"] }],
      code: `
        export default function ContractsPage() {
          return (
            <dialog>
              <button>Save</button>
            </dialog>
          );
        }
      `,
    },
  ],
  invalid: [
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export default function ContractsPage() {
          return (
            <form>
              <button>Save</button>
              <input />
            </form>
          );
        }
      `,
      errors: [
        { messageId: "rawUiElement" },
        { messageId: "rawUiElement" },
      ],
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export default function ContractsPage() {
          return (
            <div>
              <select />
              <textarea />
              <dialog />
            </div>
          );
        }
      `,
      errors: [
        { messageId: "rawUiElement" },
        { messageId: "rawUiElement" },
        { messageId: "rawUiElement" },
      ],
    },
  ],
});
