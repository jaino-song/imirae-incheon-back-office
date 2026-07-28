"use strict";

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../ui-architecture/no-visual-tailwind-in-pages");

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

ruleTester.run("no-visual-tailwind-in-pages", rule, {
  valid: [
    {
      filename: "/components/Foo.tsx",
      code: `
        export default function Foo() {
          return <div className="rounded-lg bg-white" />;
        }
      `,
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export default function ContractsPage() {
          return <div className="flex gap-2 text-center border-collapse" />;
        }
      `,
    },
    {
      filename: "/app/contracts/page.jsx",
      options: [{ allow: ["bg-brand-*", "shadow-soft"] }],
      code: `
        export default function ContractsPage() {
          return <div className="bg-brand-surface shadow-soft" />;
        }
      `,
    },
  ],
  invalid: [
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export default function ContractsPage() {
          return <div className="flex hover:bg-red-500 rounded-lg" />;
        }
      `,
      errors: [
        { messageId: "visualTailwindInPage" },
        { messageId: "visualTailwindInPage" },
      ],
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export default function ContractsPage() {
          return <div className={cn("grid", "md:text-gray-900", condition && "border-gray-200")} />;
        }
      `,
      errors: [
        { messageId: "visualTailwindInPage" },
        { messageId: "visualTailwindInPage" },
      ],
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export default function ContractsPage() {
          return <div className={\`grid shadow-sm \${toneClass} text-left\`} />;
        }
      `,
      errors: [{ messageId: "visualTailwindInPage" }],
    },
  ],
});
