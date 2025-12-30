import DefaultTheme from "vitepress/theme";
import { h } from "vue";
// @ts-ignore
import ProgressiveExample from "./components/ProgressiveExample.vue";
// @ts-ignore
import AlphaBanner from "./components/AlphaBanner.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ProgressiveExample", ProgressiveExample);
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      // "home-hero-info-before": () => h("img", { src: "logo-banner.svg", alt: "AIDK", style: { maxWidth: "400px", width: "100%" } }),
      "home-hero-after": () => h(AlphaBanner),
    });
  },
};
