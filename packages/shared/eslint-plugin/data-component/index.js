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

const FRAMEWORK_INJECTED_ELEMENTS = new Set([
  "next-route-announcer",
  "nextjs-portal",
]);

const CANONICAL_DATA_COMPONENT_REGEX =
  /^(desktop|mobile)_[a-z0-9]+(?:-[a-z0-9]+)*(?:_[a-z0-9]+(?:-[a-z0-9]+)*){1,}$/;
const LEGACY_KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const DATA_SLOT_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
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

function isAnonymousChildrenWrapper(node, elementName) {
  if (elementName !== "div" || node.attributes.length !== 0) return false;

  const element = node.parent;
  if (!element || element.type !== "JSXElement") return false;

  const substantiveChildren = element.children.filter((child) => {
    if (child.type === "JSXText") return child.value.trim() !== "";
    return !(
      child.type === "JSXExpressionContainer" &&
      child.expression.type === "JSXEmptyExpression"
    );
  });

  return (
    substantiveChildren.length === 1 &&
    substantiveChildren[0].type === "JSXExpressionContainer" &&
    substantiveChildren[0].expression.type === "Identifier" &&
    substantiveChildren[0].expression.name === "children"
  );
}

function validateDataSlot(node, context) {
  const dataSlotAttr = getAttribute(node, "data-slot");
  if (!dataSlotAttr) return;

  if (!dataSlotAttr.value) {
    context.report({
      node: dataSlotAttr,
      messageId: "emptyDataSlot",
    });
    return;
  }

  const value = getLiteralAttributeValue(dataSlotAttr);
  if (value === null) return;

  if (value.length === 0) {
    context.report({
      node: dataSlotAttr,
      messageId: "emptyDataSlot",
    });
    return;
  }

  const encodesRouteContext =
    value.startsWith("desktop_") ||
    value.startsWith("mobile_") ||
    value.includes("_");
  if (!DATA_SLOT_REGEX.test(value) || encodesRouteContext) {
    context.report({
      node: dataSlotAttr,
      messageId: "invalidDataSlot",
      data: { value },
    });
  }
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
    schema: [
      {
        type: "object",
        properties: {
          banLegacyFormat: {
            type: "boolean",
            default: false,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingDataComponent:
        "Structural element <{{element}}> is missing a 'data-component' attribute.",
      invalidFormat:
        "data-component value '{{value}}' must use the canonical platform_page_organism_component format or, while banLegacyFormat is false, the legacy kebab-case migration format.",
      legacyFormat:
        "data-component value '{{value}}' is a legacy dash-separated value; migrate to the {platform}_{page}_{...} format.",
      brokenParentPath:
        "data-component value '{{value}}' must preserve its parent owner path '{{parent}}_'.",
      invalidSourceComponent:
        "data-source-component value '{{value}}' must be the exported PascalCase component name.",
      emptyDataSlot:
        "data-slot must have a non-empty kebab-case value.",
      invalidDataSlot:
        "data-slot value '{{value}}' must use kebab-case and must not encode route context or '_' path segments.",
    },
  },
  create(context) {
    const banLegacyFormat =
      context.options[0] && context.options[0].banLegacyFormat === true;

    return {
      JSXOpeningElement(node) {
        validateDataSlot(node, context);

        const elementName = node.name && node.name.name;

        // Skip if not a string name (e.g., member expressions like Component.Sub)
        if (typeof elementName !== "string") return;

        // These custom elements are injected by the framework at runtime and
        // are not authored structural ownership boundaries.
        if (FRAMEWORK_INJECTED_ELEMENTS.has(elementName)) return;

        // Skip non-structural elements
        if (!STRUCTURAL_ELEMENTS.has(elementName)) return;

        // Find data-component attribute
        const dataComponentAttr = getAttribute(node, "data-component");

        if (!dataComponentAttr) {
          if (isAnonymousChildrenWrapper(node, elementName)) return;

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
          const isCanonical =
            CANONICAL_DATA_COMPONENT_REGEX.test(literalValue);
          const isLegacy = LEGACY_KEBAB_CASE_REGEX.test(literalValue);

          if (isLegacy && banLegacyFormat) {
            context.report({
              node: dataComponentAttr,
              messageId: "legacyFormat",
              data: { value: literalValue },
            });
          } else if (!isCanonical && !isLegacy) {
            context.report({
              node: dataComponentAttr,
              messageId: "invalidFormat",
              data: { value: literalValue },
            });
          } else if (isCanonical) {
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
