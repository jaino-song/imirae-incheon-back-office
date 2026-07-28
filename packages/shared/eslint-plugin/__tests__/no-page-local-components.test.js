"use strict";

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../ui-architecture/no-page-local-components");

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

ruleTester.run("no-page-local-components", rule, {
  valid: [
    {
      filename: "/components/Foo.tsx",
      code: `
        function LocalCard() {
          return <div />;
        }

        export default function Foo() {
          return <LocalCard />;
        }
      `,
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        export default function ContractsPage() {
          return <div />;
        }
      `,
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        const ContractsPage = () => <div />;

        export default ContractsPage;
      `,
    },
    {
      filename: "/app/contracts/page.jsx",
      options: [{ allow: ["Loading$", "Skeleton$"] }],
      code: `
        function ContractLoading() {
          return <div />;
        }

        const EmptySkeleton = () => <div />;

        export default function ContractsPage() {
          return (
            <div>
              <ContractLoading />
              <EmptySkeleton />
            </div>
          );
        }
      `,
    },
  ],
  invalid: [
    {
      filename: "/app/contracts/page.tsx",
      code: `
        function LocalCard() {
          return <div />;
        }

        export default function ContractsPage() {
          return <LocalCard />;
        }
      `,
      errors: [{ messageId: "pageLocalComponent" }],
    },
    {
      filename: "/app/contracts/page.tsx",
      code: `
        const InlineCard = () => <div />;
        let InlinePanel = function () {
          return <div />;
        };

        export default function ContractsPage() {
          return <InlineCard />;
        }
      `,
      errors: [
        { messageId: "pageLocalComponent" },
        { messageId: "pageLocalComponent" },
      ],
    },
  ],
});
