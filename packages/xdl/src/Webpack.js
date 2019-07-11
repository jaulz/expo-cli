/**
 * @flow
 */
import * as ConfigUtils from '@expo/config';
import { choosePort, prepareUrls } from 'react-dev-utils/WebpackDevServerUtils';
import webpack from 'webpack';
import WebpackDevServer from 'webpack-dev-server';
import chalk from 'chalk';
import createWebpackCompiler from './createWebpackCompiler';
import * as ProjectUtils from './project/ProjectUtils';
import * as ProjectSettings from './ProjectSettings';
import * as Web from './Web';
import * as Doctor from './project/Doctor';
import XDLError from './XDLError';
import ip from './ip';

import type { User as ExpUser } from './User'; //eslint-disable-line

export const HOST = '0.0.0.0';
export const DEFAULT_PORT = 19006;
const WEBPACK_LOG_TAG = 'expo';

let webpackDevServerInstance: WebpackDevServer | null = null;
let webpackServerPort: number | null = null;

export type BundlingOptions = {
  isValidationEnabled?: boolean,
  isImageEditingEnabled?: boolean,
  isDebugInfoEnabled?: boolean,
  isPolyfillEnabled?: boolean,
  webpackEnv?: Object,
  mode?: 'development' | 'production' | 'test' | 'none',
  https?: boolean,
  nonInteractive?: boolean,
  onWebpackFinished?: (error: Error) => void,
};

export async function startAsync(
  projectRoot: string,
  options: BundlingOptions = {},
  deprecatedVerbose?: boolean
): Promise<{ url: string, server: WebpackDevServer }> {
  if (typeof deprecatedVerbose !== 'undefined') {
    throw new XDLError(
      'WEBPACK_DEPRECATED',
      'startAsync(root, options, verbose): The `verbose` option is deprecated.'
    );
  }

  if (webpackDevServerInstance) {
    ProjectUtils.logError(projectRoot, WEBPACK_LOG_TAG, 'Webpack is already running.');
    return;
  }

  const { env, config } = await createWebpackConfigAsync(projectRoot, options);

  webpackServerPort = await getAvailablePortAsync();

  ProjectUtils.logInfo(
    projectRoot,
    WEBPACK_LOG_TAG,
    `Starting Webpack on port ${webpackServerPort} in ${chalk.underline(env.mode)} mode.`
  );

  const protocol = env.https ? 'https' : 'http';
  const urls = prepareUrls(protocol, '::', webpackServerPort);
  const useYarn = ConfigUtils.isUsingYarn(projectRoot);
  const appName = await getProjectNameAsync(projectRoot);
  const nonInteractive = validateBoolOption(
    'nonInteractive',
    options.nonInteractive,
    process.stdout.isTTY
  );

  await new Promise(resolve => {
    // Create a webpack compiler that is configured with custom messages.
    const compiler = createWebpackCompiler({
      projectRoot,
      nonInteractive,
      webpack,
      appName,
      config,
      urls,
      useYarn,
      onFinished: resolve,
    });
    webpackDevServerInstance = new WebpackDevServer(compiler, config.devServer);
    // Launch WebpackDevServer.
    webpackDevServerInstance.listen(webpackServerPort, HOST, error => {
      if (error) {
        ProjectUtils.logError(projectRoot, WEBPACK_LOG_TAG, error);
      }
      if (typeof options.onWebpackFinished === 'function') {
        options.onWebpackFinished(error);
      }
    });
  });

  await ProjectSettings.setPackagerInfoAsync(projectRoot, {
    webpackServerPort,
  });

  const host = ip.address();
  return {
    url: `${protocol}://${host}:${webpackServerPort}`,
    server: webpackDevServerInstance,
    port: webpackServerPort,
    protocol,
    host,
  };
}

export async function stopAsync(projectRoot: string): Promise<void> {
  if (webpackDevServerInstance) {
    await new Promise(resolve => webpackDevServerInstance.close(() => resolve()));
    webpackDevServerInstance = null;
    webpackServerPort = null;
    await ProjectSettings.setPackagerInfoAsync(projectRoot, {
      webpackServerPort: null,
    });
  }
}

export async function openAsync(projectRoot: string, options: BundlingOptions): Promise<void> {
  if (!webpackDevServerInstance) {
    await startAsync(projectRoot, options);
  }
  await Web.openProjectAsync(projectRoot);
}

export async function bundleAsync(projectRoot: string, options: BundlingOptions): Promise<void> {
  const { config } = await createWebpackConfigAsync(projectRoot, options);

  const compiler = webpack(config);

  try {
    return new Promise((resolve, reject) =>
      // We generate the stats.json file in the webpack-config
      compiler.run((error, stats) => {
        // TODO: Bacon: account for CI
        if (error) {
          // TODO: Bacon: Clean up error messages
          return reject(error);
        }
        resolve(stats);
      })
    );
  } catch (error) {
    ProjectUtils.logError(
      projectRoot,
      WEBPACK_LOG_TAG,
      `There was a problem bundling your web project: ${error.message}`
    );
    throw error;
  }
}

export async function getProjectNameAsync(projectRoot: string): Promise<string> {
  const { exp } = await ProjectUtils.readConfigJsonAsync(projectRoot);
  const { webName } = ConfigUtils.getNameFromConfig(exp);
  return webName;
}

export function getServer(projectRoot: string): WebpackDevServer | null {
  if (webpackDevServerInstance == null) {
    ProjectUtils.logError(projectRoot, WEBPACK_LOG_TAG, 'Webpack is not running.');
  }
  return webpackDevServerInstance;
}

export function getPort(): number | null {
  return webpackServerPort;
}

export async function getUrlAsync(projectRoot: string): Promise<string> {
  const devServer = getServer(projectRoot);
  if (!devServer) {
    return null;
  }
  const host = ip.address();
  const urlType = await getProtocolAsync(projectRoot);
  return `${urlType}://${host}:${webpackServerPort}`;
}

export async function getProtocolAsync(projectRoot: string): Promise<'http' | 'https'> {
  // TODO: Bacon: Handle when not in expo
  const { https } = await ProjectSettings.readAsync(projectRoot);
  if (https === true) {
    return 'https';
  }
  return 'http';
}

export async function getAvailablePortAsync(
  options: { host: string, defaultPort: number } = {}
): Promise<number> {
  try {
    return await choosePort(options.host || HOST, options.defaultPort || DEFAULT_PORT);
  } catch (error) {
    throw new XDLError('NO_PORT_FOUND', 'No available port found: ' + error.message);
  }
}

export function setMode(mode: 'development' | 'production' | 'test' | 'none'): void {
  process.env.BABEL_ENV = mode;
  process.env.NODE_ENV = mode;
}

function validateBoolOption(name, value, defaultValue) {
  if (typeof value === 'undefined') {
    value = defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new XDLError('WEBPACK_INVALID_OPTION', `'${name}' option must be a boolean.`);
  }

  return value;
}

function transformCLIOptions(options) {
  // Transform the CLI flags into more explicit values
  return {
    ...options,
    isImageEditingEnabled: options.pwa,
    isPolyfillEnabled: options.polyfill,
  };
}

async function createWebpackConfigAsync(
  projectRoot: string,
  options: BundlingOptions = {}
): Promise<{ env: Object, config: WebpackDevServer.Configuration }> {
  const fullOptions = transformCLIOptions(options);
  if (validateBoolOption('isValidationEnabled', fullOptions.isValidationEnabled, true)) {
    await Doctor.validateWebSupportAsync(projectRoot);
  }

  const env = await getWebpackConfigEnvFromBundlingOptionsAsync(projectRoot, fullOptions);

  setMode(env.mode);

  const config = await Web.invokeWebpackConfigAsync(env);

  return { env, config };
}

async function getNextProjectSettingsAsync(projectRoot: string, settings: Object) {
  let nextSettings = {};
  // Change settings before reading them
  if (typeof settings.https === 'boolean') {
    nextSettings.https = settings.https;
  }
  if (typeof settings.dev === 'boolean') {
    nextSettings.dev = settings.dev;
  }

  if (Object.keys(nextSettings).length) {
    await ProjectSettings.setAsync(projectRoot, nextSettings);
  }

  return await ProjectSettings.readAsync(projectRoot);
}

async function getWebpackConfigEnvFromBundlingOptionsAsync(
  projectRoot: string,
  settings: BundlingOptions
): Promise<Object> {
  let { dev, https } = await getNextProjectSettingsAsync(projectRoot, settings);

  const mode =
    typeof settings.mode === 'string' ? settings.mode : dev ? 'development' : 'production';

  const isImageEditingEnabled = validateBoolOption(
    'isImageEditingEnabled',
    settings.isImageEditingEnabled,
    true
  );
  const isDebugInfoEnabled = validateBoolOption(
    'isDebugInfoEnabled',
    settings.isDebugInfoEnabled,
    Web.isInfoEnabled()
  );

  return {
    projectRoot,
    pwa: isImageEditingEnabled,
    mode,
    https,
    polyfill: validateBoolOption('isPolyfillEnabled', settings.isPolyfillEnabled, false),
    development: dev,
    production: !dev,
    info: isDebugInfoEnabled,
    ...(settings.webpackEnv || {}),
  };
}
