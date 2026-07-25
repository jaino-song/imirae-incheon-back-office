"use strict";

const PAGE_BASENAMES = new Set(["page.tsx", "page.jsx"]);
const DEFAULT_FORBIDDEN_NAME_PATTERN =
  "(_CLS|_CLASS|_CLASS_NAME|_CLASSES)$";

function getFilename(context) {
  return context.filename || (context.getFilename && context.getFilename()) || "";
}

function isPageFile(context) {
  const filename = getFilename(context);
  const basename = filename.split(/[\\/]/).pop();

  return PAGE_BASENAMES.has(basename);
}

function isStringLikeInit(init) {
  return (
    (init && init.type === "Literal" && typeof init.value === "string") ||
    (init && init.type === "TemplateLiteral")
  );
}

function reportVariableDeclaration(context, node, forbiddenNameRegex) {
  if (node.kind !== "const") return;

  for (const declarator of node.declarations) {
    if (!declarator.id || declarator.id.type !== "Identifier") continue;
    if (!forbiddenNameRegex.test(declarator.id.name)) continue;
    if (!isStringLikeInit(declarator.init)) continue;

    context.report({
      node: declarator.id,
      messageId: "pageStyleConstant",
      data: { name: declarator.id.name },
    });
  }
}

const noPageStyleConstants = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow page-local Tailwind class constants in Next.js page files",
      category: "Best Practices",
    },
    schema: [
      {
        type: "object",
        properties: {
          forbiddenNamePattern: { type: "string" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      pageStyleConstant:
        "Page files must not define visual class constant '{{name}}'. Move styling into design-system components (see docs/design-system/AGENT_UI_RULES.md).",
    },
  },
  create(context) {
    if (!isPageFile(context)) return {};

    const options = context.options[0] || {};
    const forbiddenNameRegex = new RegExp(
      options.forbiddenNamePattern || DEFAULT_FORBIDDEN_NAME_PATTERN
    );

    return {
      Program(node) {
        for (const statement of node.body) {
          if (statement.type === "VariableDeclaration") {
            reportVariableDeclaration(context, statement, forbiddenNameRegex);
            continue;
          }

          if (
            statement.type === "ExportNamedDeclaration" &&
            statement.declaration &&
            statement.declaration.type === "VariableDeclaration"
          ) {
            reportVariableDeclaration(
              context,
              statement.declaration,
              forbiddenNameRegex
            );
          }
        }
      },
    };
  },
};

module.exports = noPageStyleConstants;
