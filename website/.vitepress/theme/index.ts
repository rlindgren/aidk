import DefaultTheme from 'vitepress/theme'
import ProgressiveExample from './components/ProgressiveExample.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ProgressiveExample', ProgressiveExample)
  }
}
