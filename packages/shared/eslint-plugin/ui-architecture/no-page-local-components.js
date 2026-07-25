"use strict";

const PAGE_BASENAMES = new Set(["page.tsx", "page.jsx"]);
const COMPONENT_NAME_REGEX = /^[A-Z]/;

function getFilename(context) {
  return context.filename || (context.getFilename && context.getFilename()) || "";
}

function isPageFile(context) {
  const filename = getFilename(context);
  const basename = filename.split(/[\\/]/).pop();

  return PAGE_BASENAMES.has(basename);
}

function isAllowedName(name, allowPatterns) {
  return allowPatterns.some((pattern) => pattern.test(name));
}

function createAllowPatterns(options) {
  return (options.allow || []).map((pattern) => new RegExp(pattern));
}

function isComponentName(name) {
  return typeof name === "string" && COMPONENT_NAME_REGEX.test(name);
}

function isComponentFunction(init) {
  return (
    init &&
    (init.type === "ArrowFunctionExpression" ||
      init.type === "FunctionExpression")
  );
}

function collectDefaultExportedNames(program) {
  const names = new Set();

  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      if (statement.declaration.type === "Identifier") {
        names.add(statement.declaration.name);
      }
      continue;
    }

    if (statement.type !== "ExportNamedDeclaration") continue;

    for (const specifier of statement.specifiers || []) {
      if (
        specifier.exported &&
        specifier.exported.name === "default" &&
        specifier.local &&
        specifier.local.name
      ) {
        names.add(specifier.local.name);
      }
    }
  }

  return names;
}

function reportFunctionDeclaration(context, node, defaultExportedNames, allowPatterns) {
  const name = node.id && node.id.name;

  if (!isComponentName(name)) return;
  if (defaultExportedNames.has(name)) return;
  if (isAllowedName(name, allowPatterns)) return;

  context.report({
    node: node.id || node,
    messageId: "pageLocalComponent",
    data: { name },
  });
}

function reportVariableDeclaration(context, node, defaultExportedNames, allowPatterns) {
  for (const declarator of node.declarations) {
    if (!declarator.id || declarator.id.type !== "Identifier") continue;
    if (!isComponentName(declarator.id.name)) continue;
    if (!isComponentFunction(declarator.init)) continue;
    if (defaultExportedNames.has(declarator.id.name)) continue;
    if (isAllowedName(declarator.id.name, allowPatterns)) continue;

    context.report({
      node: declarator.id,
      messageId: "pageLocalComponent",
      data: { name: declarator.id.name },
    });
  }
}

const noPageLocalComponents = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow page-local React component declarations in Next.js page files",
      category: "Best Practices",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "array",
            items: { type: "string" },
            default: [],
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      pageLocalComponent:
        "Page files must only assemble design-system components. Move component '{{name}}' into the design-system layers (see docs/design-system/AGENT_UI_RULES.md).",
    },
  },
  create(context) {
    if (!isPageFile(context)) return {};

    const allowPatterns = createAllowPatterns(context.options[0] || {});

    return {
      Program(node) {
        const defaultExportedNames = collectDefaultExportedNames(node);

        for (const statement of node.body) {
          if (statement.type === "FunctionDeclaration") {
            reportFunctionDeclaration(
              context,
              statement,
              defaultExportedNames,
              allowPatterns
            );
            continue;
          }

          if (statement.type === "VariableDeclaration") {
            reportVariableDeclaration(
              context,
              statement,
              defaultExportedNames,
              allowPatterns
            );
            continue;
          }

          if (
            statement.type === "ExportNamedDeclaration" &&
            statement.declaration
          ) {
            if (statement.declaration.type === "FunctionDeclaration") {
              reportFunctionDeclaration(
                context,
                statement.declaration,
                defaultExportedNames,
                allowPatterns
              );
            }

            if (statement.declaration.type === "VariableDeclaration") {
              reportVariableDeclaration(
                context,
                statement.declaration,
                defaultExportedNames,
                allowPatterns
              );
            }
          }
        }
      },
    };
  },
};

module.exports = noPageLocalComponents;
