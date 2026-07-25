"use strict";

const PAGE_BASENAMES = new Set(["page.tsx", "page.jsx"]);
const VISUAL_TAILWIND_REGEX = /^(bg|text|border|rounded|shadow)-/;
const INTERNAL_ALLOWED_BASE_TOKENS = new Set([
  "text-left",
  "text-center",
  "text-right",
  "text-justify",
  "border-collapse",
  "border-separate",
]);

function getFilename(context) {
  return context.filename || (context.getFilename && context.getFilename()) || "";
}

function isPageFile(context) {
  const filename = getFilename(context);
  const basename = filename.split(/[\\/]/).pop();

  return PAGE_BASENAMES.has(basename);
}

function getBaseToken(token) {
  const lastVariantIndex = token.lastIndexOf(":");

  if (lastVariantIndex === -1) return token;

  return token.slice(lastVariantIndex + 1);
}

function createAllowChecker(allow) {
  return function isAllowed(token, baseToken) {
    return allow.some((pattern) => {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);

        return token.startsWith(prefix) || baseToken.startsWith(prefix);
      }

      return pattern === token || pattern === baseToken;
    });
  };
}

function inspectClassString(context, node, value, isAllowed) {
  const tokens = value.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const baseToken = getBaseToken(token);

    if (INTERNAL_ALLOWED_BASE_TOKENS.has(baseToken)) continue;
    if (isAllowed(token, baseToken)) continue;
    if (!VISUAL_TAILWIND_REGEX.test(baseToken)) continue;

    context.report({
      node,
      messageId: "visualTailwindInPage",
      data: { className: token },
    });
  }
}

function inspectExpression(context, node, expression, isAllowed) {
  if (!expression) return;

  if (expression.type === "Literal" && typeof expression.value === "string") {
    inspectClassString(context, node, expression.value, isAllowed);
    return;
  }

  if (expression.type === "TemplateLiteral") {
    for (const quasi of expression.quasis) {
      inspectClassString(context, node, quasi.value.cooked || "", isAllowed);
    }
    return;
  }

  if (expression.type === "CallExpression") {
    for (const argument of expression.arguments) {
      inspectExpression(context, node, argument, isAllowed);
    }
    return;
  }

  if (expression.type === "ArrayExpression") {
    for (const element of expression.elements) {
      inspectExpression(context, node, element, isAllowed);
    }
    return;
  }

  if (expression.type === "ConditionalExpression") {
    inspectExpression(context, node, expression.consequent, isAllowed);
    inspectExpression(context, node, expression.alternate, isAllowed);
    return;
  }

  if (expression.type === "LogicalExpression") {
    inspectExpression(context, node, expression.left, isAllowed);
    inspectExpression(context, node, expression.right, isAllowed);
    return;
  }

  if (expression.type === "ObjectExpression") {
    for (const property of expression.properties) {
      if (property.type !== "Property") continue;

      if (property.key.type === "Literal") {
        inspectExpression(context, node, property.key, isAllowed);
      }
    }
  }
}

const noVisualTailwindInPages = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow visual Tailwind classes in Next.js page className attributes",
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
      visualTailwindInPage:
        "Visual Tailwind class '{{className}}' belongs inside design-system components; pages may only use layout classes.",
    },
  },
  create(context) {
    if (!isPageFile(context)) return {};

    const options = context.options[0] || {};
    const isAllowed = createAllowChecker(options.allow || []);

    return {
      JSXAttribute(node) {
        if (!node.name || node.name.name !== "className") return;
        if (!node.value) return;

        if (
          node.value.type === "Literal" &&
          typeof node.value.value === "string"
        ) {
          inspectClassString(context, node.value, node.value.value, isAllowed);
          return;
        }

        if (node.value.type === "JSXExpressionContainer") {
          inspectExpression(context, node.value, node.value.expression, isAllowed);
        }
      },
    };
  },
};

module.exports = noVisualTailwindInPages;
