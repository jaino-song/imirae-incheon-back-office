"use strict";

const PAGE_BASENAMES = new Set(["page.tsx", "page.jsx"]);
const RAW_UI_ELEMENTS = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "dialog",
]);

function getFilename(context) {
  return context.filename || (context.getFilename && context.getFilename()) || "";
}

function isPageFile(context) {
  const filename = getFilename(context);
  const basename = filename.split(/[\\/]/).pop();

  return PAGE_BASENAMES.has(basename);
}

const noRawUiInPages = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw UI HTML elements in Next.js page files",
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
      rawUiElement:
        "Raw <{{name}}> is not allowed in page files. Import the design-system equivalent (Button/Input/Select/Textarea/Dialog from @/components/ui).",
    },
  },
  create(context) {
    if (!isPageFile(context)) return {};

    const options = context.options[0] || {};
    const allowedElements = new Set(options.allow || []);

    return {
      JSXOpeningElement(node) {
        const name = node.name && node.name.name;

        if (typeof name !== "string") return;
        if (allowedElements.has(name)) return;
        if (!RAW_UI_ELEMENTS.has(name)) return;

        context.report({
          node,
          messageId: "rawUiElement",
          data: { name },
        });
      },
    };
  },
};

module.exports = noRawUiInPages;
