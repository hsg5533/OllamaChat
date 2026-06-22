const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// Exclude native build dirs from Metro's file watcher. On Windows (no watchman)
// these dirs churn during gradle builds and crash the watcher with ENOENT.
const config = {
  resolver: {
    blockList: [
      /[/\\]android[/\\]app[/\\]\.cxx[/\\].*/,
      /[/\\]android[/\\].*[/\\]build[/\\].*/,
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
