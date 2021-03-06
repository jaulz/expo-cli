const HtmlWebpackPlugin = require('html-webpack-plugin');
const { overrideWithPropertyOrConfig } = require('./utils/config');
const getPathsAsync = require('./utils/getPathsAsync');
const getConfigAsync = require('./utils/getConfigAsync');
const getMode = require('./utils/getMode');

const DEFAULT_MINIFY = {
  removeComments: true,
  collapseWhitespace: true,
  removeRedundantAttributes: true,
  useShortDoctype: true,
  removeEmptyAttributes: true,
  removeStyleLinkTypeAttributes: true,
  keepClosingSlash: true,
  minifyJS: true,
  minifyCSS: true,
  minifyURLs: true,
};

module.exports = async function createIndexHTMLFromAppJSONAsync(env) {
  const locations = await getPathsAsync(env);
  const config = await getConfigAsync(env);
  const isProduction = getMode(env) === 'production';

  const { web: { name, build = {} } = {} } = config;
  /**
   * The user can disable minify with
   * `web.minifyHTML = false || {}`
   */
  const minify = overrideWithPropertyOrConfig(
    isProduction ? build.minifyHTML : false,
    DEFAULT_MINIFY
  );

  // Generates an `index.html` file with the <script> injected.
  return new HtmlWebpackPlugin({
    // The file to write the HTML to.
    filename: locations.production.indexHtml,
    // The title to use for the generated HTML document.
    title: name,
    // Pass a html-minifier options object to minify the output.
    // https://github.com/kangax/html-minifier#options-quick-reference
    minify,
    // The `webpack` require path to the template.
    template: locations.template.indexHtml,
  });
};
