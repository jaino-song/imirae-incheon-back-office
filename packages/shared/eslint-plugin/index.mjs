import dataComponentPlugin from "./data-component/index.js";
import noPageLocalComponents from "./ui-architecture/no-page-local-components.js";
import noPageStyleConstants from "./ui-architecture/no-page-style-constants.js";
import noRawUiInPages from "./ui-architecture/no-raw-ui-in-pages.js";
import noVisualTailwindInPages from "./ui-architecture/no-visual-tailwind-in-pages.js";

export const uiArchitecture = {
  meta: {
    name: "eslint-plugin-ui-architecture",
    version: "1.0.0",
  },
  rules: {
    "no-page-local-components": noPageLocalComponents,
    "no-page-style-constants": noPageStyleConstants,
    "no-raw-ui-in-pages": noRawUiInPages,
    "no-visual-tailwind-in-pages": noVisualTailwindInPages,
  },
};

dataComponentPlugin.uiArchitecture = uiArchitecture;

export default dataComponentPlugin;
