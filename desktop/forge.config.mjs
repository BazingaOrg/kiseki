import path from 'node:path';

export default {
  packagerConfig: {asar: true, name: 'Kiseki', icon: undefined, extraResource: [path.resolve('staging/kiseki-runtime')], ignore: [/^\/staging(?:\/|$)/, /^\/test(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/docs(?:\/|$)/]},
  makers: [{name: '@electron-forge/maker-zip', platforms: ['darwin']}],
};
