import { defineConfig } from 'wxt';

// 豆包 Pilot — standalone MV3 extension. Independent codebase (not derived from
// any existing extension); only targets 豆包 (doubao.com).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: () => ({
    name: '豆包 Pilot',
    description: '让豆包网页版获得浏览器与本机操作能力',
    // Pinning `key` fixes the extension ID (nllcakgmmoebgfchfjbcbkpdbffcodac) so
    // the native-host installer can whitelist the origin without the user ever
    // having to look up or paste their ID — true one-click setup.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5+Lb0D+G5xs1ExhzktC6ydB1DXDe5YMfzto51ILzi5uW1rHOYnLQaPiLwKgqXF77S8TyGGnnpCA6M6nLZQ2NfVWa+bVExu8MNhRrxgSa9scg/oGW2mq3M9Uqy59iNPomz/2Nyr+LFS6YnuAU2N6jEziRhOFfuWJg5n2kFcwvI/ZdPO9EaRx1w3+WNApVc4mVPOYItFwq/IMbI9ez3NI1VARYLHMaof0xvf9fJLpgQCmfd51hVnnT97TgGN2WnhjnBC7Uv7AqoJEBcd6WnCkmmqNYkB4hEgQS/D2BFicJJxcOl0BQ5k1om2k12b+4c/FMM8jQPS+JwIpZzkt4VRZFrQIDAQAB',
    permissions: ['storage', 'tabs', 'debugger', 'nativeMessaging', 'scripting', 'downloads'],
    host_permissions: ['*://www.doubao.com/*'],
    action: {
      default_title: '豆包 Pilot',
    },
    web_accessible_resources: [
      {
        resources: ['host/*'],
        matches: ['*://www.doubao.com/*'],
      },
    ],
  }),
});
