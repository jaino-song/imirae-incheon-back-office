"use strict";

const STRUCTURAL_ELEMENTS = new Set([
  "div",
  "section",
  "nav",
  "main",
  "aside",
  "article",
  "header",
  "footer",
]);

const CANONICAL_DATA_COMPONENT_REGEX =
  /^(desktop|mobile)_[a-z0-9]+(?:-[a-z0-9]+)*(?:_[a-z0-9]+(?:-[a-z0-9]+)*){1,}$/;
const LEGACY_KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SOURCE_COMPONENT_REGEX = /^[A-Z][A-Za-z0-9]*$/;

function getAttribute(node, name) {
  return node.attributes.find(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name &&
      attr.name.name === name
  );
}

function getLiteralAttributeValue(attribute) {
  const value = attribute && attribute.value;
  return value &&
    value.type === "Literal" &&
    typeof value.value === "string"
    ? value.value
    : null;
}

function getNearestCanonicalParent(node) {
  let current = node.parent && node.parent.parent;
  while (current) {
    if (current.type === "JSXElement") {
      const value = getLiteralAttributeValue(
        getAttribute(current.openingElement, "data-component")
      );
      if (value && CANONICAL_DATA_COMPONENT_REGEX.test(value)) return value;
    }
    current = current.parent;
  }
  return null;
}

function isValidDataComponent(value) {
  return (
    CANONICAL_DATA_COMPONENT_REGEX.test(value) ||
    LEGACY_KEBAB_CASE_REGEX.test(value)
  );
}

const requireDataComponent = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require data-component attribute on structural DOM elements",
      category: "Best Practices",
    },
    fixable: null,
    schema: [],
    messages: {
      missingDataComponent:
        "Structural element <{{element}}> is missing a 'data-component' attribute.",
      invalidFormat:
        "data-component value '{{value}}' must use the canonical platform_page_organism_component format or the legacy kebab-case migration format.",
      brokenParentPath:
        "data-component value '{{value}}' must preserve its parent owner path '{{parent}}_'.",
      invalidSourceComponent:
        "data-source-component value '{{value}}' must be the exported PascalCase component name.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const elementName = node.name && node.name.name;

        // Skip if not a string name (e.g., member expressions like Component.Sub)
        if (typeof elementName !== "string") return;

        // Skip non-structural elements
        if (!STRUCTURAL_ELEMENTS.has(elementName)) return;

        // Find data-component attribute
        const dataComponentAttr = getAttribute(node, "data-component");

        if (!dataComponentAttr) {
          context.report({
            node,
            messageId: "missingDataComponent",
            data: { element: elementName },
          });
          return;
        }

        // Canonical names are preferred; legacy kebab-case stays valid until
        // the remaining routes complete the migration.
        const literalValue = getLiteralAttributeValue(dataComponentAttr);
        if (literalValue) {
          if (!isValidDataComponent(literalValue)) {
            context.report({
              node: dataComponentAttr,
              messageId: "invalidFormat",
              data: { value: literalValue },
            });
          } else if (CANONICAL_DATA_COMPONENT_REGEX.test(literalValue)) {
            const parent = getNearestCanonicalParent(node);
            if (parent && !literalValue.startsWith(`${parent}_`)) {
              context.report({
                node: dataComponentAttr,
                messageId: "brokenParentPath",
                data: { value: literalValue, parent },
              });
            }
          }
        }

        const sourceComponentAttr = getAttribute(node, "data-source-component");
        const sourceComponent = getLiteralAttributeValue(sourceComponentAttr);
        if (sourceComponent && !SOURCE_COMPONENT_REGEX.test(sourceComponent)) {
          context.report({
            node: sourceComponentAttr,
            messageId: "invalidSourceComponent",
            data: { value: sourceComponent },
          });
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: "eslint-plugin-data-component",
    version: "1.0.0",
  },
  rules: {
    "require-data-component": requireDataComponent,
  },
};

module.exports = plugin;
