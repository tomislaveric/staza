import { getAppLocale } from "../app-locales.js";

const languages = [
  { value: "en", flag: "🇬🇧", label: "English" },
  { value: "de", flag: "🇩🇪", label: "Deutsch" }
];

export const LanguageSelector = (locale = getAppLocale()) => `
  <div class="language-selector" role="radiogroup" aria-label="Language">
    ${languages.map(({ value, flag, label }) => `
      <label class="language-option${locale === value ? " is-selected" : ""}">
        <input type="radio" name="app-language" value="${value}" data-locale-selector${locale === value ? " checked" : ""}>
        <span class="language-flag" aria-hidden="true">${flag}</span>
        <span lang="${value}" translate="no">${label}</span>
      </label>`).join("")}
  </div>
`;
